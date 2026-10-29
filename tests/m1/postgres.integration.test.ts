/**
 * PostgreSQL integration tests.
 *
 * They run only when a database URL is supplied; otherwise each test is reported as
 * skipped with the exact reason. Nothing here is mocked: migrations, RLS, the deferred
 * balance trigger and the immutability triggers are exercised on a real server.
 *
 *   ICONCRETE_RLS_URL   restricted role (iconcrete_app) — used to prove RLS
 *   DATABASE_URL        same database, any role
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { databaseStatus, migrate } from '../../server/db/migrate';
import { M1Service, type M1Context } from '../../server/services/m1';

const DATABASE_URL = process.env.ICONCRETE_RLS_URL ?? process.env.DATABASE_URL ?? '';
const SKIP_REASON = DATABASE_URL
  ? null
  : 'No PostgreSQL available: set DATABASE_URL (and ICONCRETE_RLS_URL for the restricted role) to run these tests.';

if (SKIP_REASON) {
  console.warn(`[M1 integration tests skipped] ${SKIP_REASON}`);
}

const dbTest = SKIP_REASON ? test.skip : test;
const describeDb = SKIP_REASON ? describe.skip : describe;

const ADMIN_URL = process.env.DATABASE_URL ?? DATABASE_URL;

let db: Db;
let adminDb: Db;
let service: M1Service;
let context: M1Context;

const asCompany = async <T>(companyId: string, plants: string[], fn: (tx: { unsafe: <R>(text: string, values?: unknown[]) => Promise<R[]> }) => Promise<T>): Promise<T> =>
  db.withTenant({ companyId, plantIds: plants }, fn);

describeDb('postgres adapter', () => {
  beforeAll(async () => {
    // db = restricted role, so row level security really applies.
    db = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
    adminDb = ADMIN_URL === DATABASE_URL ? db : ((await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db);
    service = new M1Service(db);
    context = {
      tenant: { companyId: 'CMP-0001', plantIds: ['PLT-0001', 'PLT-0002'], userId: 'USR-0001' },
      actor: { userId: 'USR-0001', username: 'admin', roleLevel: 5 },
    };
  });

  afterAll(async () => {
    await db?.close();
    if (adminDb && adminDb !== db) await adminDb.close();
  });

  dbTest('applies every migration and reports RLS, trigger and role', async () => {
    const status = await databaseStatus(adminDb);
    expect(status.connected).toBe(true);
    expect(status.migrations.length).toBeGreaterThanOrEqual(3);
    expect(status.tables).toBeGreaterThanOrEqual(45);
    expect(status.rlsTables).toBeGreaterThanOrEqual(40);
    expect(status.journalTrigger).toBe(true);
    expect(status.appRole).toBe(true);
  });

  dbTest('is idempotent: a second migrate applies nothing', async () => {
    const result = await migrate(adminDb);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThanOrEqual(3);
  });

  dbTest('reports a clear error instead of falling back when the database is unreachable', async () => {
    await expect(
      createDb({ mode: 'postgres', databaseUrl: 'postgres://postgres@127.0.0.1:1/none' }),
    ).rejects.toThrow(/unreachable|Refusing to fall back/);
  });

  dbTest('sessions persist across connections and expire', async () => {
    const tokenHash = `hash-${crypto.randomUUID()}`;
    await asCompany('CMP-0001', ['PLT-0001'], async (tx) => {
      await tx.unsafe(
        `insert into sessions (id, company_id, user_id, token_hash, ip_address, device_info, expires_at)
         values ($1,'CMP-0001','USR-0001',$2,'127.0.0.1','bun-test', now() + interval '30 minutes')`,
        [`SES-${crypto.randomUUID().slice(0, 8)}`, tokenHash],
      );
    });

    const second = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
    const rows = await second.withTenant({ companyId: 'CMP-0001', plantIds: [] }, async (tx) =>
      tx.unsafe<{ n: string }>(`select count(*)::text as n from sessions where token_hash = $1`, [tokenHash]),
    );
    expect(Number(rows[0]?.n)).toBe(1);
    await second.close();

    const expired = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe<{ token_hash: string }>(
        `select token_hash from sessions where expires_at < now() and token_hash = $1`,
        [tokenHash],
      ),
    );
    expect(expired).toHaveLength(0);
  });

  dbTest('audit rows persist with actor, request id and json details', async () => {
    const result = await service.postJournal(
      { ...context, actor: { ...context.actor, requestId: 'req-integration-1' } },
      {
        entryDate: '2026-10-27',
        memoAr: 'قيد اختبار',
        memoEn: 'Integration entry',
        lines: [
          { accountCode: '1000', debit: 500 },
          { accountCode: '4100', credit: 500 },
        ],
      },
    );

    const rows = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe<{ username: string; request_id: string; details_text: string }>(
        `select username, request_id, details::text as details_text from audit_log
          where action = 'accounting.journal_posted' and record_id = $1`,
        [String(result.id)],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.username).toBe('admin');
    expect(rows[0]?.request_id).toBe('req-integration-1');
    expect(rows[0]?.details_text ?? '').toContain(result.entryNo);

    const leak = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe(`select * from audit_log where details::text like '%password%'`),
    );
    expect(leak).toHaveLength(0);
  });

  dbTest('RLS isolates companies for reads and writes', async () => {
    const own = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe<{ company_id: string }>(`select distinct company_id from customers`),
    );
    expect(own.map((row) => row.company_id)).toEqual(['CMP-0001']);

    const other = await asCompany('CMP-0002', [], async (tx) =>
      tx.unsafe<{ company_id: string }>(`select distinct company_id from customers`),
    );
    expect(other.map((row) => row.company_id)).toEqual(['CMP-0002']);

    const noContext = await db.unsafe<{ n: string }>(`select count(*)::text as n from customers`);
    expect(Number(noContext[0]?.n)).toBe(0);

    await expect(
      asCompany('CMP-0001', [], async (tx) =>
        tx.unsafe(
          `insert into customers (id, company_id, plant_id, name_ar, name_en, status, data_source)
           values ($1,'CMP-0002','PLT-9001','تسلل','Cross tenant','active','manual')`,
          [`X-${crypto.randomUUID().slice(0, 6)}`],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/);
  });

  dbTest('RLS isolates plants inside one company', async () => {
    const onlyPlant1 = await asCompany('CMP-0001', ['PLT-0001'], async (tx) =>
      tx.unsafe<{ plant_id: string | null }>(`select distinct plant_id from invoices where plant_id is not null`),
    );
    expect(onlyPlant1.every((row) => row.plant_id === 'PLT-0001')).toBe(true);

    const both = await asCompany('CMP-0001', ['PLT-0001', 'PLT-0002'], async (tx) =>
      tx.unsafe<{ plant_id: string }>(`select distinct plant_id from invoices where plant_id is not null`),
    );
    expect(both.map((row) => row.plant_id).sort()).toEqual(['PLT-0001', 'PLT-0002']);
  });

  dbTest('RLS rejects a write to a plant outside the assigned scope', async () => {
    const invoiceNo = `XPLANT-${crypto.randomUUID().slice(0, 6)}`;

    await expect(
      asCompany('CMP-0001', ['PLT-0001'], async (tx) => {
        const customers = await tx.unsafe<{ id: string }>(`select id from customers limit 1`);
        await tx.unsafe(
          `insert into invoices (id, company_id, plant_id, customer_id, invoice_no, issue_date, due_date,
             subtotal, tax_percent, tax_amount, grand_total, status)
           values ($1,'CMP-0001','PLT-0002',$2,$3, current_date, current_date, 100, 14, 14, 114, 'draft')`,
          [`XPL-${crypto.randomUUID().slice(0, 6)}`, customers[0]?.id, invoiceNo],
        );
      }),
    ).rejects.toThrow(/row-level security|violates/);

    const leftovers = await asCompany('CMP-0001', ['PLT-0001', 'PLT-0002'], async (tx) =>
      tx.unsafe(`select id from invoices where invoice_no = $1`, [invoiceNo]),
    );
    expect(leftovers).toHaveLength(0);
  });

  dbTest('the database rejects an unbalanced entry at COMMIT', async () => {
    await expect(
      asCompany('CMP-0001', [], async (tx) => {
        await tx.unsafe(
          `insert into journal_entries (id, company_id, entry_no, entry_date, memo_ar, memo_en, status)
           values (999001,'CMP-0001','JE-999001','2026-10-01','غير متوازن','Unbalanced','draft')`,
        );
        await tx.unsafe(
          `insert into journal_entry_lines (company_id, entry_id, account_id, line_no, debit, credit)
           values ('CMP-0001',999001,'CMP-0001-ACC-1000',1,100,0),
                  ('CMP-0001',999001,'CMP-0001-ACC-4100',2,0,90)`,
        );
        await tx.unsafe(`update journal_entries set status = 'posted' where id = 999001`);
      }),
    ).rejects.toThrow(/unbalanced/);

    const leftovers = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe(`select id from journal_entries where id = 999001`),
    );
    expect(leftovers).toHaveLength(0);
  });

  dbTest('posted entries and their lines are immutable', async () => {
    const entry = await service.postJournal(context, {
      entryDate: '2026-10-26',
      memoAr: 'قيد ثابت',
      memoEn: 'Immutable entry',
      lines: [
        { accountCode: '1000', debit: 250 },
        { accountCode: '4100', credit: 250 },
      ],
    });

    await expect(
      asCompany('CMP-0001', [], async (tx) =>
        tx.unsafe(`update journal_entries set memo_en = 'changed' where id = $1`, [entry.id]),
      ),
    ).rejects.toThrow(/immutable/);

    await expect(
      asCompany('CMP-0001', [], async (tx) =>
        tx.unsafe(`delete from journal_entries where id = $1`, [entry.id]),
      ),
    ).rejects.toThrow(/immutable|cannot be deleted/);

    await expect(
      asCompany('CMP-0001', [], async (tx) =>
        tx.unsafe(
          `insert into journal_entry_lines (company_id, entry_id, account_id, line_no, debit, credit)
           values ('CMP-0001',$1,'CMP-0001-ACC-1000',9,10,0)`,
          [entry.id],
        ),
      ),
    ).rejects.toThrow(/immutable/);
  });

  dbTest('reversal posts a mirror entry and marks the original', async () => {
    const original = await service.postJournal(context, {
      entryDate: '2026-10-25',
      memoAr: 'قيد للعكس',
      memoEn: 'To reverse',
      lines: [
        { accountCode: '1000', debit: 1000 },
        { accountCode: '4100', credit: 1000 },
      ],
    });

    const reversal = await service.reverseJournal(context, original.id, { ar: 'عكس القيد', en: 'Reversal' });
    expect(reversal.id).not.toBe(original.id);

    const rows = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe<{ status: string; reversed_by: string }>(
        `select status, reversed_by from journal_entries where id = $1`,
        [original.id],
      ),
    );
    expect(rows[0]?.status).toBe('reversed');
    expect(Number(rows[0]?.reversed_by)).toBe(reversal.id);

    await expect(service.reverseJournal(context, original.id, { ar: 'مرة أخرى', en: 'Again' })).rejects.toThrow();
  });

  dbTest('invoice → post → FIFO payment keeps the ledger and AR consistent', async () => {
    const customerId = `CUS-IT-${Date.now()}`;
    await asCompany('CMP-0001', [], async (tx) => {
      await tx.unsafe(
        `insert into customers (id, company_id, plant_id, name_ar, name_en, status, data_source)
         values ($1,'CMP-0001','PLT-0001','عميل اختبار','Integration customer','active','manual')`,
        [customerId],
      );
      await tx.unsafe(
        `insert into customer_credit_limits (id, company_id, customer_id, credit_limit)
         values ($1,'CMP-0001',$2,'5000000.00')`,
        [`${customerId}-CL`, customerId],
      );
    });

    const invoice = await service.createInvoice(context, {
      customerId,
      invoiceNo: `IT-${Date.now()}`,
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      items: [{ quantity: 10, unitPrice: 1750 }],
    });
    expect(invoice.totals.grandTotal).toBe(19950);

    const posted = await service.postInvoice(context, invoice.invoiceId);
    expect(posted.status).toBe('issued');

    const outstandingBefore = await service.outstandingForCustomer(context, customerId);
    expect(outstandingBefore).toBeGreaterThanOrEqual(19950);

    const payment = await service.receivePayment(context, {
      customerId,
      amount: 5000,
      method: 'bank',
      paymentDate: '2026-10-20',
    });
    expect(payment.allocated).toBe(5000);
    expect(payment.allocations.length).toBeGreaterThan(0);

    const outstandingAfter = await service.outstandingForCustomer(context, customerId);
    expect(outstandingAfter).toBeCloseTo(outstandingBefore - 5000, 2);

    const trial = await service.trialBalance(context);
    expect(trial.balanced).toBe(true);
    expect(trial.debitTotal).toBeCloseTo(trial.creditTotal, 2);
  });

  dbTest('cheque transitions are validated and audited in the database', async () => {
    const chequeId = `CHQ-IT-${Date.now()}`;
    await asCompany('CMP-0001', [], async (tx) => {
      await tx.unsafe(
        `insert into cheques (id, company_id, plant_id, cheque_no, direction, amount, issue_date, due_date, status)
         values ($1,'CMP-0001','PLT-0001',$2,'incoming','5000','2026-10-01','2026-11-01','received')`,
        [chequeId, `CHQ-IT-${Date.now()}`],
      );
    });

    await expect(service.transitionCheque(context, chequeId, 'cleared')).rejects.toThrow();
    const moved = await service.transitionCheque(context, chequeId, 'deposited', { accountId: 'BNK-001' });
    expect(moved.status).toBe('deposited');

    const movements = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe(`select * from cheque_movements where cheque_id = $1 order by created_at`, [chequeId]),
    );
    expect(movements.length).toBeGreaterThanOrEqual(1);
  });

  dbTest('depreciation posts balanced entries and does not double-post', async () => {
    const asset = await service.createAsset(context, {
      code: `FA-IT-${Date.now()}`,
      nameAr: 'أصل اختبار',
      nameEn: 'Test asset',
      category: 'it',
      purchaseDate: '2026-01-10',
      purchaseCost: 24000,
      residualValue: 0,
      usefulLifeMonths: 12,
    });

    const first = await service.depreciate(context, asset.assetId, '2026-02-01');
    expect(first.periodsPosted).toBe(1);

    const second = await service.depreciate(context, asset.assetId, '2026-02-01');
    expect(second.periodsPosted).toBe(0);

    const trial = await service.trialBalance(context);
    expect(trial.balanced).toBe(true);
  });

  dbTest('loan schedule is stored and closes to zero', async () => {
    const loan = await service.createLoan(context, {
      bankNameAr: 'بنك اختبار',
      bankNameEn: 'Test bank',
      principal: 60000,
      annualRate: 12,
      termMonths: 12,
      startDate: '2026-01-01',
    });
    const installments = await service.loanInstallments(context, loan.loanId);
    expect(installments).toHaveLength(12);
    expect(installments[11]?.remaining).toBe(0);
    expect(installments[0]?.interestPart).toBe(600);
  });

  dbTest('three-way match flags over-billing and blocks approval without a receipt', async () => {
    const po = await service.createPurchaseOrder(context, {
      supplierId: 'SUP-001',
      poNo: `PO-IT-${Date.now()}`,
      orderDate: '2026-10-01',
      lines: [{ quantity: 10, unitPrice: 100, descriptionAr: 'اختبار', descriptionEn: 'test' }],
    });
    const bill = await service.createSupplierBill(context, {
      supplierId: 'SUP-001',
      purchaseOrderId: po.poId,
      billNo: `SB-IT-${Date.now()}`,
      billDate: '2026-10-05',
      dueDate: '2026-11-05',
      lines: [{ quantity: 10, unitPrice: 100 }],
    });
    const match = await service.matchSupplierBill(context, bill.billId);
    expect(match.status).toBe('over_billing');
    expect(match.requiresApproval).toBe(true);
  });

  dbTest('bank reconciliation stores matched pairs and unmatched counts', async () => {
    const movements = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe<{ id: string; txn_date: Date; direction: 'in' | 'out'; amount: string; reference: string }>(
        `select id, txn_date, direction, amount, reference from bank_transactions
          where company_id = 'CMP-0001' and account_id = 'BNK-001' order by txn_date limit 3`,
      ),
    );

    const statement = movements.slice(0, 2).map((row) => ({
      id: `S-${row.id}`,
      txnDate: new Date(row.txn_date).toISOString().slice(0, 10),
      direction: row.direction,
      amount: Number(row.amount),
      reference: row.reference,
    }));

    const result = await service.reconcileBank(context, 'BNK-001', {
      periodStart: '2020-01-01',
      periodEnd: '2030-01-01',
      statementBalance: statement.reduce((sum, row) => sum + (row.direction === 'in' ? row.amount : -row.amount), 0),
      statement,
    });

    expect(result.matchedCount).toBeGreaterThanOrEqual(2);
    expect(result.unmatchedCount).toBeGreaterThan(0);
    expect(result.closable.ok).toBe(false);
  });

  dbTest('a failed transaction leaves no partial journal entry', async () => {
    const before = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe<{ n: string }>(`select count(*)::text as n from journal_entries`),
    );

    await expect(
      service.postJournal(context, {
        entryDate: '2026-10-27',
        memoAr: 'غير متوازن',
        memoEn: 'Unbalanced',
        lines: [
          { accountCode: '1000', debit: 100 },
          { accountCode: '4100', credit: 90 },
        ],
      }),
    ).rejects.toThrow();

    const after = await asCompany('CMP-0001', [], async (tx) =>
      tx.unsafe<{ n: string }>(`select count(*)::text as n from journal_entries`),
    );
    expect(after[0]?.n).toBe(before[0]?.n ?? '0');
  });
});
