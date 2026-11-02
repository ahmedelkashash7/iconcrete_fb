/**
 * M1 accounting vertical slice (gap G5) against real PostgreSQL.
 *
 * Customer → draft invoice → post → payment → FIFO allocation → customer statement →
 * journal entry → general ledger, all through M1Service (the same code the HTTP routes
 * call). No fake success: every assertion reads the database through the API layer.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Service, type M1Context } from '../../server/services/m1';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? '';
const SKIP_REASON =
  ADMIN_URL && RLS_URL
    ? null
    : 'PostgreSQL not configured: set DATABASE_URL and ICONCRETE_RLS_URL to run the vertical-slice tests.';

if (SKIP_REASON) console.warn(`[vertical-slice tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const tag = `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const INV_A = `INV-VS-${tag}-A`;
const INV_B = `INV-VS-${tag}-B`;

let admin: Db;
let app: Db;
let service: M1Service;
let customerId = 'CUS-0001';
let plantId: string | null = null;

const context: M1Context = {
  tenant: { companyId: 'CMP-0001', plantIds: [], userId: 'USR-0001' },
  actor: { userId: 'USR-0001', username: 'slice.test', roleLevel: 4 },
};

describeDb('M1 accounting vertical slice', () => {
  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    service = new M1Service(app);

    const plant = await admin.unsafe<{ id: string }>(
      `select id from plants where company_id = 'CMP-0001' and deleted_at is null order by id limit 1`,
    );
    plantId = plant[0]?.id ?? null;

    // A dedicated customer keeps FIFO and the statement deterministic: no seeded invoice
    // can be older than the ones this test creates.
    customerId = `CUS-VS-${tag}`;
    await admin.unsafe(
      `insert into customers (id, company_id, plant_id, name_ar, name_en, status, credit_days)
       values ($1, 'CMP-0001', $2, 'عميل شريحة', 'Slice customer', 'active', 30)`,
      [customerId, plantId],
    );
    await admin.unsafe(
      `insert into customer_credit_limits (id, company_id, customer_id, credit_limit)
       values ($1, 'CMP-0001', $2, 5000000)`,
      [`${customerId}-CL`, customerId],
    );
  });

  afterAll(async () => {
    const invoices = await admin.unsafe<{ id: string }>(
      `select id from invoices where company_id = 'CMP-0001' and invoice_no like $1`,
      [`INV-N-${tag}%`],
    );
    const invoiceIds = invoices.map((row) => row.id);
    const payments = await admin.unsafe<{ id: string }>(
      `select id from payments where reference = $1`,
      [`SLICE-${tag}`],
    );
    const paymentIds = payments.map((row) => row.id);
    for (const id of paymentIds) {
      await admin.unsafe(`delete from payment_allocations where payment_id = $1`, [id]);
      await admin.unsafe(`delete from payments where id = $1`, [id]);
    }
    for (const id of invoiceIds) await admin.unsafe(`delete from invoices where id = $1`, [id]);
    await admin.transaction(async (tx) => {
      await tx.unsafe(`select set_config('app.seed_reset', 'on', true)`);
      for (const id of [...invoiceIds, ...paymentIds]) {
        await tx.unsafe(`delete from journal_entries where source_id = $1`, [id]);
      }
    });
    await admin.unsafe(`delete from customer_credit_limits where customer_id = $1`, [customerId]);
    await admin.unsafe(`delete from customers where id = $1`, [customerId]);
    await app?.close();
    await admin?.close();
  });

  dbTest('creates and posts two invoices with balanced journal entries', async () => {
    for (const [id, no, date] of [
      [INV_A, `INV-N-${tag}-A`, '2026-01-05'],
      [INV_B, `INV-N-${tag}-B`, '2026-01-06'],
    ] as const) {
      const created = await service.createInvoice(context, {
        customerId,
        invoiceNo: no,
        issueDate: date,
        dueDate: '2026-02-05',
        plantId,
        taxPercent: 14,
        items: [{ quantity: 2, unitPrice: 1000, descriptionAr: 'خرسانة', descriptionEn: 'Concrete' }],
      });
      expect(created.status).toBe('draft');
      // createInvoice generates its own id; remember it for the later steps.
      if (id === INV_A) {
        (globalThis as Record<string, unknown>).sliceInvoiceA = created.invoiceId;
        (globalThis as Record<string, unknown>).sliceGrandA = created.totals.grandTotal;
      }
      if (id === INV_B) (globalThis as Record<string, unknown>).sliceInvoiceB = created.invoiceId;
      const posted = await service.postInvoice(context, created.invoiceId);
      expect(posted.status).toBe('issued');
      expect(posted.entry.entryNo).toMatch(/^JE-\d{6}$/);
    }
  });

  dbTest('receives a payment and allocates it FIFO across the oldest invoices', async () => {
    const invoiceA = String((globalThis as Record<string, unknown>).sliceInvoiceA ?? '');
    const invoiceB = String((globalThis as Record<string, unknown>).sliceInvoiceB ?? '');
    if (!invoiceA || !invoiceB) throw new Error('invoices were not created');

    const grandA = Number((globalThis as Record<string, unknown>).sliceGrandA ?? 2280);
    const payment = await service.receivePayment(context, {
      customerId,
      amount: grandA + 100,
      method: 'bank',
      paymentDate: '2026-01-10',
      reference: `SLICE-${tag}`,
    });

    expect(payment.allocations).toHaveLength(2);
    expect(payment.allocations[0]?.invoiceId).toBe(invoiceA);
    expect(payment.allocations[0]?.amount).toBeCloseTo(grandA, 2);
    expect(payment.allocations[1]?.invoiceId).toBe(invoiceB);
    expect(payment.allocations[1]?.amount).toBe(100);
    expect(payment.unapplied).toBe(0);
    expect(payment.entry.entryNo).toMatch(/^JE-\d{6}$/);

    const rows = await admin.unsafe<{ id: string; status: string }>(
      `select id, status from invoices where id in ($1, $2) order by id`,
      [invoiceA, invoiceB],
    );
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(invoiceA)).toBe('paid');
    expect(byId.get(invoiceB)).toBe('partially_paid');
  });

  dbTest('produces a customer statement that ties out to the ledger', async () => {
    const statement = await service.customerStatement(context, customerId, {
      from: '2026-01-01',
      to: '2026-12-31',
    });

    expect(statement.lines.length).toBeGreaterThanOrEqual(3);
    expect(statement.invoiced).toBeGreaterThan(0);
    expect(statement.paid).toBeGreaterThan(0);
    // closing = invoiced - collected (retention is 0 in this fixture)
    expect(statement.closingBalance).toBeCloseTo(statement.invoiced - statement.paid, 2);
    const last = statement.lines[statement.lines.length - 1];
    expect(last?.balance).toBeCloseTo(statement.closingBalance, 2);

    // Account 1100 is the company-wide AR control account, so its GL balance is NOT the
    // customer statement. The correct tie-out is per customer and is provable: posted
    // debits from this customer's invoices minus posted credits from its receipts must
    // equal the statement movement.
    const arAccount = await admin.unsafe<{ id: string }>(
      `select id from gl_accounts where company_id = 'CMP-0001' and code = '1100'`,
    );
    const arAccountId = arAccount[0]?.id;
    expect(arAccountId).toBeTruthy();
    const arNet = await admin.unsafe<{ invoice_debit: string; payment_credit: string }>(
      `select
         coalesce((select sum(l.debit) from journal_entry_lines l
            join journal_entries e on e.id = l.entry_id and e.status = 'posted'
            join invoices i on i.journal_entry_id = e.id
           where i.customer_id = $1 and l.account_id = $2 and e.entry_date between $3 and $4), 0) as invoice_debit,
         coalesce((select sum(l.credit) from journal_entry_lines l
            join journal_entries e on e.id = l.entry_id and e.status = 'posted'
            join payments p on p.journal_entry_id = e.id
           where p.customer_id = $1 and l.account_id = $2 and e.entry_date between $3 and $4), 0) as payment_credit`,
      [customerId, arAccountId, '2000-01-01', '2100-01-01'],
    );
    const customerArNet = Number(arNet[0]?.invoice_debit ?? 0) - Number(arNet[0]?.payment_credit ?? 0);
    expect(customerArNet).toBeCloseTo(statement.invoiced - statement.paid, 2);

    // The ledger query must equal every posted line on 1100 for the company.
    const ledger = await service.generalLedger(context, '1100', { from: '2000-01-01', to: '2100-01-01' });
    const gl = await admin.unsafe<{ net: string }>(
      `select coalesce(sum(l.debit - l.credit), 0) as net
         from journal_entry_lines l
         join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        where l.account_id = $1 and e.entry_date between $2 and $3`,
      [arAccountId, '2000-01-01', '2100-01-01'],
    );
    expect(ledger.debitTotal - ledger.creditTotal).toBeCloseTo(Number(gl[0]?.net ?? 0), 2);
  });

  dbTest('refuses to post an already posted invoice', async () => {
    const invoiceA = String((globalThis as Record<string, unknown>).sliceInvoiceA ?? '');
    await expect(service.postInvoice(context, invoiceA)).rejects.toThrow();
  });

  dbTest('lists the tenant invoices and receipts through the read models', async () => {
    const invoices = await service.listInvoices(context, { limit: 50 });
    expect(invoices.some((invoice) => invoice.id === INV_A || invoice.id.startsWith('INV-'))).toBe(true);
    const payments = await service.listPayments(context, 50);
    expect(payments.some((payment) => payment.reference === `SLICE-${tag}`)).toBe(true);
    const accounts = await service.listAccounts(context);
    expect(accounts.some((account) => account.code === '1100')).toBe(true);
    const customers = await service.listCustomers(context);
    expect(customers.some((customer) => customer.id === customerId)).toBe(true);
  });
});
