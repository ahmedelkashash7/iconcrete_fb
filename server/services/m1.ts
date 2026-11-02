/**
 * M1 services — the only place that writes accounting data.
 *
 * Every write runs inside db.withTenant(), which sets app.company_id / app.plant_ids
 * with SET LOCAL so PostgreSQL row level security applies to the statement itself.
 * Balancing is validated here (fast, bilingual errors) AND by the deferred database
 * trigger (authoritative, survives any client).
 */
import { validateJournal, type JournalEntryInput } from '../../src/core/accounting';
import { computeInvoiceTotals, agingReport, type InvoiceAgingInput } from '../../src/core/invoicing';
import { fifoAllocate, creditDecision, outstandingFor } from '../../src/core/allocation';
import { applyChequeTransition, type ChequeStatus } from '../../src/core/cheques';
import { straightLineSchedule } from '../../src/core/assets';
import { annuitySchedule } from '../../src/core/loans';
import { matchThreeWay, type ThreeWayInput } from '../../src/core/threeway';
import { reconcileBank, canCloseReconciliation, type BookTransaction, type StatementTransaction } from '../../src/core/reconciliation';
import { dec, decToNumber } from '../../src/core/decimal';
import type { Db, Executor, TenantContext } from '../db/client';

export interface Actor {
  userId: string;
  username: string;
  roleLevel: number;
  ip?: string;
  requestId?: string;
}

export class M1Error extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, status: number, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface M1Context {
  tenant: TenantContext;
  actor: Actor;
}

const money = (value: number): string => value.toFixed(2);
const audit = async (
  tx: Executor,
  context: M1Context,
  action: string,
  table: string,
  recordId: string | null,
  details: Record<string, unknown>,
): Promise<void> => {
  await tx.unsafe(
    `insert into audit_log (company_id, plant_id, user_id, username, action, table_name, record_id,
       ip_address, request_id, details)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      context.tenant.companyId,
      context.tenant.plantIds[0] ?? null,
      context.actor.userId,
      context.actor.username,
      action,
      table,
      recordId,
      context.actor.ip ?? null,
      context.actor.requestId ?? null,
      JSON.stringify(details),
    ],
  );
};

const nextEntryNo = async (tx: Executor, companyId: string): Promise<string> => {
  const rows = await tx.unsafe<{ n: string }>(
    `select coalesce(max(substring(entry_no from 4)::int), 0) + 1 as n
       from journal_entries where company_id = $1 and entry_no like 'JE-%'`,
    [companyId],
  );
  return `JE-${String(Number(rows[0]?.n ?? 1)).padStart(6, '0')}`;
};

const postableAccount = async (tx: Executor, companyId: string, code: string): Promise<string> => {
  const rows = await tx.unsafe<{ id: string }>(
    `select id from gl_accounts where company_id = $1 and code = $2 and is_postable and deleted_at is null`,
    [companyId, code],
  );
  const id = rows[0]?.id;
  if (!id) throw new M1Error('gl_account_missing', 422, `GL account ${code} does not exist for this company`);
  return id;
};

export interface JournalLineRequest {
  accountCode: string;
  debit?: string | number;
  credit?: string | number;
  descriptionAr?: string;
  descriptionEn?: string;
  plantId?: string | null;
}

export interface JournalRequest {
  entryDate: string;
  memoAr?: string;
  memoEn?: string;
  plantId?: string | null;
  sourceType?: string;
  sourceId?: string | null;
  lines: JournalLineRequest[];
}

const writeEntry = async (
  tx: Executor,
  context: M1Context,
  request: JournalRequest,
  options: { reversalOf?: number | null } = {},
): Promise<{ id: number; entryNo: string }> => {
  const companyId = context.tenant.companyId;

  const accountCodeById = new Map<string, string>();
  const resolved = [] as { accountId: string; debit: number; credit: number; descriptionAr: string; descriptionEn: string; plantId: string | null }[];
  for (const line of request.lines) {
    const accountId = await postableAccount(tx, companyId, line.accountCode);
    accountCodeById.set(accountId, line.accountCode);
    resolved.push({
      accountId,
      debit: Number(line.debit ?? 0),
      credit: Number(line.credit ?? 0),
      descriptionAr: line.descriptionAr ?? '',
      descriptionEn: line.descriptionEn ?? '',
      plantId: line.plantId ?? request.plantId ?? null,
    });
  }

  const candidate: JournalEntryInput = {
    companyId,
    plantId: request.plantId ?? null,
    entryDate: request.entryDate,
    memoAr: request.memoAr ?? '',
    memoEn: request.memoEn ?? '',
    sourceType: request.sourceType ?? 'manual',
    sourceId: request.sourceId ?? null,
    lines: resolved.map((line) => ({ accountId: line.accountId, debit: line.debit, credit: line.credit })),
  };

  const validation = validateJournal(candidate);
  if (!validation.ok) {
    throw new M1Error('journal_invalid', 422, 'Journal entry failed double-entry validation', { errors: validation.errors });
  }

  const entryNo = await nextEntryNo(tx, companyId);
  const inserted = await tx.unsafe<{ id: string }>(
    `insert into journal_entries (company_id, plant_id, entry_no, entry_date, memo_ar, memo_en,
       source_type, source_id, status, reversal_of, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10) returning id`,
    [
      companyId,
      request.plantId ?? null,
      entryNo,
      request.entryDate,
      request.memoAr ?? '',
      request.memoEn ?? '',
      request.sourceType ?? 'manual',
      request.sourceId ?? null,
      options.reversalOf ?? null,
      context.actor.username,
    ],
  );
  const entryId = Number(inserted[0]?.id);

  for (const [index, line] of resolved.entries()) {
    await tx.unsafe(
      `insert into journal_entry_lines (company_id, entry_id, account_id, line_no, description_ar,
         description_en, debit, credit, plant_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        companyId,
        entryId,
        line.accountId,
        index + 1,
        line.descriptionAr,
        line.descriptionEn,
        money(line.debit),
        money(line.credit),
        line.plantId,
      ],
    );
  }

  await tx.unsafe(
    `update journal_entries set status = 'posted', posted_at = now(), posted_by = $1 where id = $2`,
    [context.actor.username, entryId],
  );

  return { id: entryId, entryNo };
};

export class M1Service {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------- journal
  async postJournal(context: M1Context, request: JournalRequest): Promise<{ id: number; entryNo: string }> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const entry = await writeEntry(tx, context, request);
      await audit(tx, context, 'accounting.journal_posted', 'journal_entries', String(entry.id), {
        entryNo: entry.entryNo,
        lines: request.lines.length,
        sourceType: request.sourceType ?? 'manual',
      });
      return entry;
    });
  }

  async reverseJournal(context: M1Context, entryId: number, memo: { ar: string; en: string }): Promise<{ id: number; entryNo: string }> {
    if (context.actor.roleLevel < 4) throw new M1Error('forbidden', 403);

    return this.db.withTenant(context.tenant, async (tx) => {
      const entries = await tx.unsafe<{
        id: string; entry_no: string; entry_date: Date; memo_ar: string; memo_en: string;
        plant_id: string | null; source_type: string; source_id: string | null; status: string; reversed_by: string | null;
      }>(
        `select id, entry_no, entry_date, memo_ar, memo_en, plant_id, source_type, source_id, status, reversed_by
           from journal_entries where id = $1 and company_id = $2`,
        [entryId, context.tenant.companyId],
      );
      const entry = entries[0];
      if (!entry) throw new M1Error('not_found', 404);
      if (entry.status !== 'posted') throw new M1Error('not_posted', 409, 'Only a posted entry can be reversed');
      if (entry.reversed_by) throw new M1Error('already_reversed', 409);

      const lines = await tx.unsafe<{ account_id: string; debit: string; credit: string; description_ar: string; description_en: string; plant_id: string | null }>(
        `select account_id, debit, credit, description_ar, description_en, plant_id
           from journal_entry_lines where entry_id = $1 order by line_no`,
        [entryId],
      );

      const request: JournalRequest = {
        entryDate: new Date().toISOString().slice(0, 10),
        memoAr: memo.ar,
        memoEn: memo.en,
        plantId: entry.plant_id,
        sourceType: 'reversal',
        sourceId: String(entryId),
        lines: lines.map((line) => ({
          accountCode: '',
          debit: line.credit,
          credit: line.debit,
          descriptionAr: line.description_ar,
          descriptionEn: line.description_en,
          plantId: line.plant_id,
        })),
      };

      // Account codes are resolved from the original account ids, not from user input.
      const codes = await tx.unsafe<{ id: string; code: string }>(
        `select id, code from gl_accounts where company_id = $1`,
        [context.tenant.companyId],
      );
      const codeById = new Map(codes.map((row) => [row.id, row.code]));
      request.lines = request.lines.map((line, index) => ({
        ...line,
        accountCode: codeById.get(lines[index]?.account_id ?? '') ?? '',
      }));

      const reversal = await writeEntry(tx, context, request, { reversalOf: entryId });
      await tx.unsafe(`update journal_entries set status = 'reversed', reversed_by = $1 where id = $2`, [reversal.id, entryId]);
      await audit(tx, context, 'accounting.journal_reversed', 'journal_entries', String(entryId), {
        originalEntryNo: entry.entry_no,
        reversalEntryNo: reversal.entryNo,
        memoAr: memo.ar,
        memoEn: memo.en,
      });
      return reversal;
    });
  }

  async listJournal(context: M1Context, filter: { from?: string; to?: string; limit?: number } = {}) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe(
        `select id, entry_no, entry_date, memo_ar, memo_en, status, source_type, source_id, plant_id,
                (select coalesce(sum(debit),0) from journal_entry_lines l where l.entry_id = e.id) as total
           from journal_entries e
          where company_id = $1 and deleted_at is null
            and ($2::date is null or entry_date >= $2::date)
            and ($3::date is null or entry_date <= $3::date)
          order by entry_date desc, id desc limit $4`,
        [context.tenant.companyId, filter.from ?? null, filter.to ?? null, filter.limit ?? 50],
      );
      return rows.map((row: Record<string, unknown>) => ({
        ...row,
        id: Number(row.id),
        total: decToNumber(dec(String(row.total ?? 0), 2)),
      }));
    });
  }

  /** Trial balance from posted lines only. */
  async trialBalance(context: M1Context, filter: { from?: string; to?: string } = {}) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<{ account_code: string; name_ar: string; name_en: string; account_type: string; normal_side: string; debit: string; credit: string }>(
        `select a.code as account_code, a.name_ar, a.name_en, a.account_type, a.normal_side,
                coalesce(sum(l.debit),0) as debit, coalesce(sum(l.credit),0) as credit
           from journal_entry_lines l
           join journal_entries e on e.id = l.entry_id and e.status = 'posted'
           join gl_accounts a on a.id = l.account_id
          where l.company_id = $1
            and ($2::date is null or e.entry_date >= $2::date)
            and ($3::date is null or e.entry_date <= $3::date)
          group by a.code, a.name_ar, a.name_en, a.account_type, a.normal_side
          order by a.code`,
        [context.tenant.companyId, filter.from ?? null, filter.to ?? null],
      );

      const lines = rows.map((row) => ({
        accountId: row.account_code,
        accountCode: row.account_code,
        accountNameAr: row.name_ar,
        accountNameEn: row.name_en,
        accountType: row.account_type,
        normalSide: (row.normal_side === 'credit' ? 'credit' : 'debit') as 'debit' | 'credit',
        debit: row.debit,
        credit: row.credit,
      }));

      const debitTotal = lines.reduce((sum, line) => sum + decToNumber(dec(line.debit, 2)), 0);
      const creditTotal = lines.reduce((sum, line) => sum + decToNumber(dec(line.credit, 2)), 0);

      return {
        rows: lines.map((line) => ({
          accountCode: line.accountCode,
          accountNameAr: line.accountNameAr,
          accountNameEn: line.accountNameEn,
          accountType: line.accountType,
          normalSide: line.normalSide,
          debit: decToNumber(dec(line.debit, 2)),
          credit: decToNumber(dec(line.credit, 2)),
          balance: decToNumber(dec(line.debit, 2)) - decToNumber(dec(line.credit, 2)),
        })),
        debitTotal: Number(debitTotal.toFixed(2)),
        creditTotal: Number(creditTotal.toFixed(2)),
        balanced: Math.abs(debitTotal - creditTotal) < 0.005,
      };
    });
  }

  async generalLedger(context: M1Context, accountCode: string, filter: { from?: string; to?: string } = {}) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe(
        `select e.id as entry_id, e.entry_no, e.entry_date, e.memo_ar, e.memo_en, l.debit, l.credit, l.line_no
           from journal_entry_lines l
           join journal_entries e on e.id = l.entry_id and e.status = 'posted'
           join gl_accounts a on a.id = l.account_id
          where l.company_id = $1 and a.code = $2
            and ($3::date is null or e.entry_date >= $3::date)
            and ($4::date is null or e.entry_date <= $4::date)
          order by e.entry_date, e.id, l.line_no`,
        [context.tenant.companyId, accountCode, filter.from ?? null, filter.to ?? null],
      );

      let running = 0;
      const lines = rows.map((row: Record<string, unknown>) => {
        const debit = decToNumber(dec(String(row.debit ?? 0), 2));
        const credit = decToNumber(dec(String(row.credit ?? 0), 2));
        running = Number((running + debit - credit).toFixed(2));
        return {
          entryId: Number(row.entry_id),
          entryNo: String(row.entry_no),
          entryDate: new Date(row.entry_date as string).toISOString().slice(0, 10),
          memoAr: String(row.memo_ar ?? ''),
          memoEn: String(row.memo_en ?? ''),
          debit,
          credit,
          runningBalance: running,
        };
      });

      return { accountCode, lines, debitTotal: Number(lines.reduce((s, l) => s + l.debit, 0).toFixed(2)), creditTotal: Number(lines.reduce((s, l) => s + l.credit, 0).toFixed(2)) };
    });
  }

  // ---------------------------------------------------------- read models
  async listAccounts(context: M1Context) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select id, code, name_ar, name_en, account_type, normal_side, is_postable, is_active
           from gl_accounts
          where company_id = $1 and deleted_at is null
          order by code`,
        [context.tenant.companyId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        nameAr: String(row.name_ar ?? ''),
        nameEn: String(row.name_en ?? ''),
        accountType: String(row.account_type),
        normalSide: String(row.normal_side),
        isPostable: row.is_postable !== false,
        isActive: row.is_active !== false,
      }));
    });
  }

  async listCustomers(context: M1Context) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select c.id, c.name_ar, c.name_en, c.status, c.credit_days,
                coalesce((select cl.credit_limit from customer_credit_limits cl
                           where cl.customer_id = c.id and cl.effective_to is null
                           order by cl.effective_from desc limit 1), 0) as credit_limit
           from customers c
          where c.company_id = $1 and c.deleted_at is null
          order by c.id`,
        [context.tenant.companyId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        nameAr: String(row.name_ar ?? ''),
        nameEn: String(row.name_en ?? ''),
        status: String(row.status),
        creditDays: Number(row.credit_days ?? 0),
        creditLimit: decToNumber(dec(String(row.credit_limit ?? 0), 2)),
      }));
    });
  }

  async listInvoices(
    context: M1Context,
    filter: { status?: string; customerId?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 100), 1), 500);
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select i.id, i.invoice_no, i.customer_id, c.name_ar as customer_name_ar,
                c.name_en as customer_name_en, i.issue_date, i.due_date, i.subtotal, i.tax_amount,
                i.grand_total, i.retention_amount, i.status,
                coalesce((select sum(pa.amount) from payment_allocations pa where pa.invoice_id = i.id), 0) as paid,
                (select count(*)::int from invoice_items it where it.invoice_id = i.id) as item_count
           from invoices i
           join customers c on c.id = i.customer_id
          where i.company_id = $1 and i.deleted_at is null
            and ($2 = '' or i.status = $2)
            and ($3 = '' or i.customer_id = $3)
          order by i.issue_date desc, i.id desc
          limit $4`,
        [context.tenant.companyId, filter.status ?? '', filter.customerId ?? '', limit],
      );
      return rows.map((row) => {
        const grand = decToNumber(dec(String(row.grand_total ?? 0), 2));
        const retention = decToNumber(dec(String(row.retention_amount ?? 0), 2));
        const paid = decToNumber(dec(String(row.paid ?? 0), 2));
        return {
          id: String(row.id),
          invoiceNo: String(row.invoice_no),
          customerId: String(row.customer_id),
          customerNameAr: String(row.customer_name_ar ?? ''),
          customerNameEn: String(row.customer_name_en ?? ''),
          issueDate: new Date(row.issue_date as string).toISOString().slice(0, 10),
          dueDate: new Date(row.due_date as string).toISOString().slice(0, 10),
          subtotal: decToNumber(dec(String(row.subtotal ?? 0), 2)),
          taxAmount: decToNumber(dec(String(row.tax_amount ?? 0), 2)),
          grandTotal: grand,
          paidAmount: paid,
          outstanding: Number((grand - retention - paid).toFixed(2)),
          status: String(row.status),
          itemCount: Number(row.item_count ?? 0),
        };
      });
    });
  }

  async listPayments(context: M1Context, limitParam = 100) {
    const limit = Math.min(Math.max(Math.trunc(limitParam), 1), 500);
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select p.id, p.payment_no, p.customer_id, c.name_ar as customer_name_ar,
                c.name_en as customer_name_en, p.method, p.amount, p.unapplied_amount, p.payment_date,
                p.reference, p.status, p.journal_entry_id,
                (select count(*)::int from payment_allocations pa where pa.payment_id = p.id) as allocation_count
           from payments p
           left join customers c on c.id = p.customer_id
          where p.company_id = $1 and p.deleted_at is null
          order by p.payment_date desc, p.id desc
          limit $2`,
        [context.tenant.companyId, limit],
      );
      return rows.map((row) => ({
        id: String(row.id),
        paymentNo: String(row.payment_no),
        customerId: String(row.customer_id ?? ''),
        customerNameAr: String(row.customer_name_ar ?? ''),
        customerNameEn: String(row.customer_name_en ?? ''),
        method: String(row.method),
        amount: decToNumber(dec(String(row.amount ?? 0), 2)),
        unappliedAmount: decToNumber(dec(String(row.unapplied_amount ?? 0), 2)),
        paymentDate: new Date(row.payment_date as string).toISOString().slice(0, 10),
        reference: String(row.reference ?? ''),
        status: String(row.status),
        allocationCount: Number(row.allocation_count ?? 0),
        journalEntryId: row.journal_entry_id === null ? null : Number(row.journal_entry_id),
      }));
    });
  }

  /** Customer statement: opening balance, activity and closing balance from posted rows. */
  async customerStatement(
    context: M1Context,
    customerId: string,
    filter: { from?: string; to?: string } = {},
  ) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const customers = await tx.unsafe<Record<string, unknown>>(
        `select c.id, c.name_ar, c.name_en, c.credit_days, c.status,
                coalesce((select cl.credit_limit from customer_credit_limits cl
                           where cl.customer_id = c.id and cl.effective_to is null
                           order by cl.effective_from desc limit 1), 0) as credit_limit
           from customers c
          where c.id = $1 and c.company_id = $2 and c.deleted_at is null`,
        [customerId, context.tenant.companyId],
      );
      const customer = customers[0];
      if (!customer) throw new M1Error('customer_not_found', 404);

      const invoices = await tx.unsafe<Record<string, unknown>>(
        `select i.id, i.invoice_no, i.issue_date, i.due_date, i.grand_total, i.retention_amount, i.status,
                coalesce((select sum(pa.amount) from payment_allocations pa where pa.invoice_id = i.id), 0) as paid
           from invoices i
          where i.company_id = $1 and i.customer_id = $2 and i.deleted_at is null
            and i.status not in ('draft','void')
          order by i.issue_date, i.id`,
        [context.tenant.companyId, customerId],
      );
      const payments = await tx.unsafe<Record<string, unknown>>(
        `select p.id, p.payment_no, p.payment_date, p.method, p.amount, p.unapplied_amount, p.reference,
                coalesce(json_agg(json_build_object('invoiceId', pa.invoice_id, 'invoiceNo', i.invoice_no,
                  'amount', pa.amount) order by pa.sequence)
                  filter (where pa.id is not null), '[]'::json) as allocations
           from payments p
           left join payment_allocations pa on pa.payment_id = p.id
           left join invoices i on i.id = pa.invoice_id
          where p.company_id = $1 and p.customer_id = $2 and p.deleted_at is null and p.status = 'posted'
          group by p.id
          order by p.payment_date, p.id`,
        [context.tenant.companyId, customerId],
      );

      const from = filter.from ?? '';
      const to = filter.to ?? '';

      let opening = 0;
      let invoiced = 0;
      let paidTotal = 0;
      const statementLines: Record<string, unknown>[] = [];

      for (const row of invoices) {
        const grand = decToNumber(dec(String(row.grand_total ?? 0), 2));
        const retention = decToNumber(dec(String(row.retention_amount ?? 0), 2));
        const paid = decToNumber(dec(String(row.paid ?? 0), 2));
        const date = new Date(row.issue_date as string).toISOString().slice(0, 10);
        if (date < from) {
          opening = Number((opening + grand - retention - paid).toFixed(2));
          continue;
        }
        if (to !== '' && date > to) continue;
        invoiced = Number((invoiced + grand - retention).toFixed(2));
        statementLines.push({
          id: `inv-${String(row.id)}`,
          kind: 'invoice',
          date,
          reference: String(row.invoice_no),
          debit: grand - retention,
          credit: 0,
          status: String(row.status),
        });
      }

      for (const row of payments) {
        const amount = decToNumber(dec(String(row.amount ?? 0), 2));
        const unapplied = decToNumber(dec(String(row.unapplied_amount ?? 0), 2));
        const date = new Date(row.payment_date as string).toISOString().slice(0, 10);
        if (date < from) {
          opening = Number((opening - amount).toFixed(2));
          continue;
        }
        if (to !== '' && date > to) continue;
        paidTotal = Number((paidTotal + amount - unapplied).toFixed(2));
        const rawAllocations = row.allocations as unknown;
        const allocations =
          typeof rawAllocations === 'string' ? JSON.parse(rawAllocations) : (rawAllocations as unknown[]);
        statementLines.push({
          id: `pmt-${String(row.id)}`,
          kind: 'payment',
          date,
          reference: String(row.payment_no),
          debit: 0,
          credit: amount,
          method: String(row.method),
          note: String(row.reference ?? ''),
          allocations: allocations ?? [],
          status: 'posted',
        });
      }

      statementLines.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      let running = opening;
      const lines = statementLines.map((line) => {
        running = Number((running + Number(line.debit) - Number(line.credit)).toFixed(2));
        return { ...line, balance: running };
      });

      return {
        customer: {
          id: String(customer.id),
          nameAr: String(customer.name_ar ?? ''),
          nameEn: String(customer.name_en ?? ''),
          creditLimit: decToNumber(dec(String(customer.credit_limit ?? 0), 2)),
          creditDays: Number(customer.credit_days ?? 0),
          status: String(customer.status),
        },
        from: from || null,
        to: to || null,
        openingBalance: opening,
        invoiced,
        paid: paidTotal,
        closingBalance: running,
        lines,
      };
    });
  }

  // ------------------------------------------------------------- invoices
  async createInvoice(
    context: M1Context,
    request: {
      customerId: string;
      invoiceNo: string;
      issueDate: string;
      dueDate: string;
      plantId?: string | null;
      taxPercent?: number;
      retentionPercent?: number;
      depositAmount?: number;
      items: { quantity: number; unitPrice: number; descriptionAr?: string; descriptionEn?: string }[];
    },
  ) {
    const totals = computeInvoiceTotals({
      items: request.items,
      taxPercent: request.taxPercent ?? 14,
      retentionPercent: request.retentionPercent ?? 0,
      depositAmount: request.depositAmount ?? 0,
    });

    return this.db.withTenant(context.tenant, async (tx) => {
      const customers = await tx.unsafe<{ id: string; status: string }>(
        `select id, status from customers where id = $1 and company_id = $2 and deleted_at is null`,
        [request.customerId, context.tenant.companyId],
      );
      if (!customers[0]) throw new M1Error('customer_not_found', 404);

      const invoiceId = `INV-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      await tx.unsafe(
        `insert into invoices (id, company_id, plant_id, customer_id, invoice_no, issue_date, due_date,
           subtotal, tax_percent, tax_amount, retention_percent, retention_amount, deposit_amount, grand_total,
           status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15)`,
        [
          invoiceId,
          context.tenant.companyId,
          request.plantId ?? null,
          request.customerId,
          request.invoiceNo,
          request.issueDate,
          request.dueDate,
          money(totals.subtotal),
          totals.taxPercent.toFixed(3),
          money(totals.taxAmount),
          totals.retentionPercent.toFixed(3),
          money(totals.retentionAmount),
          money(totals.depositAmount),
          money(totals.grandTotal),
          context.actor.username,
        ],
      );

      for (const line of totals.lines) {
        const source = request.items[line.lineNo - 1];
        await tx.unsafe(
          `insert into invoice_items (company_id, invoice_id, line_no, description_ar, description_en, quantity, unit_price, line_total)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            context.tenant.companyId,
            invoiceId,
            line.lineNo,
            source?.descriptionAr ?? '',
            source?.descriptionEn ?? '',
            line.quantity.toFixed(3),
            money(line.unitPrice),
            money(line.lineTotal),
          ],
        );
      }

      await audit(tx, context, 'accounting.invoice_created', 'invoices', invoiceId, {
        invoiceNo: request.invoiceNo,
        customerId: request.customerId,
        grandTotal: totals.grandTotal,
        taxAmount: totals.taxAmount,
      });

      return { invoiceId, totals, status: 'draft' as const };
    });
  }

  async postInvoice(context: M1Context, invoiceId: string) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<{
        id: string; customer_id: string; invoice_no: string; issue_date: Date; due_date: Date; plant_id: string | null;
        subtotal: string; tax_amount: string; grand_total: string; retention_amount: string; deposit_amount: string;
        status: string; tax_percent: string; items: string;
      }>(
        `select i.*, (select count(*) from invoice_items it where it.invoice_id = i.id) as items
           from invoices i where i.id = $1 and i.company_id = $2 and i.deleted_at is null`,
        [invoiceId, context.tenant.companyId],
      );
      const invoice = rows[0];
      if (!invoice) throw new M1Error('not_found', 404);
      if (invoice.status !== 'draft') throw new M1Error('not_draft', 409, 'Only a draft invoice can be posted');
      if (Number(invoice.items) === 0) throw new M1Error('invoice_has_no_items', 422);

      const limits = await tx.unsafe<{ credit_limit: string; status: string }>(
        `select coalesce((select credit_limit from customer_credit_limits
                           where customer_id = c.id and effective_to is null
                           order by effective_from desc limit 1), 0) as credit_limit,
                c.status
           from customers c where c.id = $1 and c.company_id = $2`,
        [invoice.customer_id, context.tenant.companyId],
      );
      const limit = limits[0];
      if (!limit) throw new M1Error('customer_not_found', 404);
      if (limit.status !== 'active') throw new M1Error('customer_not_active', 409);

      const outstandingRows = await tx.unsafe<{ outstanding: string }>(
        `select coalesce(sum(i.grand_total - i.retention_amount -
                 coalesce((select sum(pa.amount) from payment_allocations pa where pa.invoice_id = i.id), 0)), 0) as outstanding
           from invoices i
          where i.company_id = $1 and i.customer_id = $2 and i.status not in ('draft','void')`,
        [context.tenant.companyId, invoice.customer_id],
      );

      const decision = creditDecision({
        creditLimit: limit.credit_limit,
        currentOutstanding: outstandingRows[0]?.outstanding ?? '0',
        newAmount: decToNumber(dec(invoice.grand_total, 2)) - decToNumber(dec(invoice.retention_amount, 2)) - decToNumber(dec(invoice.deposit_amount, 2)),
        customerStatus: limit.status,
      });
      if (!decision.allowed) {
        throw new M1Error(decision.reason ?? 'credit_blocked', 409, 'Credit limit check failed', decision);
      }

      const entry = await writeEntry(tx, context, {
        entryDate: new Date(invoice.issue_date).toISOString().slice(0, 10),
        memoAr: `فاتورة ${invoice.invoice_no}`,
        memoEn: `Invoice ${invoice.invoice_no}`,
        plantId: invoice.plant_id,
        sourceType: 'invoice',
        sourceId: invoice.id,
        lines: [
          { accountCode: '1100', debit: Number(invoice.grand_total), plantId: invoice.plant_id },
          { accountCode: '4000', credit: Number(invoice.subtotal), plantId: invoice.plant_id },
          { accountCode: '2100', credit: Number(invoice.tax_amount), plantId: invoice.plant_id },
        ],
      });

      await tx.unsafe(`update invoices set status = 'issued', journal_entry_id = $1 where id = $2`, [entry.id, invoiceId]);
      await audit(tx, context, 'accounting.invoice_posted', 'invoices', invoiceId, {
        invoiceNo: invoice.invoice_no,
        entryNo: entry.entryNo,
        grandTotal: decToNumber(dec(invoice.grand_total, 2)),
        creditUsed: decision.used,
      });

      return { invoiceId, status: 'issued' as const, entry };
    });
  }

  async outstandingForCustomer(context: M1Context, customerId: string): Promise<number> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const invoices = await tx.unsafe<{ id: string; grand_total: string; retention_amount: string; status: string }>(
        `select id, grand_total, retention_amount, status from invoices
          where company_id = $1 and customer_id = $2 and status not in ('draft','void')`,
        [context.tenant.companyId, customerId],
      );
      const allocations = await tx.unsafe<{ invoice_id: string; amount: string }>(
        `select invoice_id, amount from payment_allocations where company_id = $1`,
        [context.tenant.companyId],
      );
      return invoices.reduce(
        (sum, invoice) =>
          sum + outstandingFor(
            { invoiceId: invoice.id, grandTotal: invoice.grand_total, retentionHeld: invoice.retention_amount, status: invoice.status },
            allocations.map((row) => ({ invoiceId: row.invoice_id, amount: row.amount })),
          ),
        0,
      );
    });
  }

  async aging(context: M1Context, asOf = new Date().toISOString().slice(0, 10)) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const invoices = await tx.unsafe<{ id: string; invoice_no: string; customer_id: string; issue_date: Date; due_date: Date; grand_total: string; retention_amount: string; status: string; paid: string; retention_held: string }>(
        `select i.id, i.invoice_no, i.customer_id, i.issue_date, i.due_date, i.grand_total, i.retention_amount,
                i.status,
                coalesce((select sum(pa.amount) from payment_allocations pa where pa.invoice_id = i.id), 0) as paid,
                coalesce((select sum(r.amount) from retentions r where r.invoice_id = i.id and r.status = 'held'), 0) as retention_held
           from invoices i where i.company_id = $1`,
        [context.tenant.companyId],
      );

      const input: InvoiceAgingInput[] = invoices.map((invoice) => ({
        invoiceId: invoice.id,
        invoiceNo: invoice.invoice_no,
        customerId: invoice.customer_id,
        issueDate: new Date(invoice.issue_date).toISOString().slice(0, 10),
        dueDate: new Date(invoice.due_date).toISOString().slice(0, 10),
        grandTotal: invoice.grand_total,
        paidAmount: invoice.paid,
        retentionHeld: invoice.retention_held,
        status: invoice.status,
      }));

      return agingReport(input, asOf);
    });
  }

  // ------------------------------------------------------------- payments
  async receivePayment(
    context: M1Context,
    request: {
      customerId: string;
      amount: string | number;
      method: 'cash' | 'bank' | 'cheque';
      paymentDate: string;
      reference?: string;
      bankAccountId?: string;
      chequeId?: string;
      allocations?: { invoiceId: string; amount: string | number }[];
    },
  ) {
    if (context.actor.roleLevel < 2) throw new M1Error('forbidden', 403);

    return this.db.withTenant(context.tenant, async (tx) => {
      const invoices = await tx.unsafe<{ id: string; invoice_no: string; due_date: Date; grand_total: string; retention_amount: string; status: string; paid: string }>(
        `select i.id, i.invoice_no, i.due_date, i.grand_total, i.retention_amount, i.status,
                coalesce((select sum(pa.amount) from payment_allocations pa where pa.invoice_id = i.id), 0) as paid
           from invoices i
          where i.company_id = $1 and i.customer_id = $2 and i.status not in ('draft','void')
          order by i.due_date, i.invoice_no`,
        [context.tenant.companyId, request.customerId],
      );

      const withAllocations = invoices.map((invoice) => {
        const total = decToNumber(dec(invoice.grand_total, 2));
        const retention = decToNumber(dec(invoice.retention_amount, 2));
        const paid = decToNumber(dec(invoice.paid, 2));
        return {
          invoiceId: invoice.id,
          invoiceNo: invoice.invoice_no,
          dueDate: new Date(invoice.due_date).toISOString().slice(0, 10),
          outstanding: Number((total - retention - paid).toFixed(2)),
          status: invoice.status,
        };
      });
      const allocation = fifoAllocate(
        request.amount,
        withAllocations,
        request.allocations,
      );
      if (allocation.allocations.length === 0) throw new M1Error('nothing_to_allocate', 409);

      const paymentId = `PMT-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      const entry = await writeEntry(tx, context, {
        entryDate: request.paymentDate,
        memoAr: `تحصيل من العميل ${request.customerId}`,
        memoEn: `Customer receipt ${request.customerId}`,
        sourceType: 'payment',
        sourceId: paymentId,
        lines: [
          { accountCode: request.method === 'cash' ? '1000' : '1010', debit: allocation.allocated },
          { accountCode: '1100', credit: allocation.allocated },
        ],
      });

      await tx.unsafe(
        `insert into payments (id, company_id, payment_no, customer_id, direction, method, account_id, cheque_id,
           amount, unapplied_amount, payment_date, reference, status, journal_entry_id, created_by)
         values ($1,$2,$3,$4,'receipt',$5,$6,$7,$8,$9,$10,$11,'posted',$12,$13)`,
        [
          paymentId,
          context.tenant.companyId,
          `RC-${paymentId.slice(-6)}`,
          request.customerId,
          request.method,
          request.bankAccountId ?? null,
          request.chequeId ?? null,
          money(allocation.allocated + allocation.unapplied),
          money(allocation.unapplied),
          request.paymentDate,
          request.reference ?? '',
          entry.id,
          context.actor.username,
        ],
      );

      for (const line of allocation.allocations) {
        await tx.unsafe(
          `insert into payment_allocations (company_id, payment_id, invoice_id, amount, sequence, created_by)
           values ($1,$2,$3,$4,$5,$6)`,
          [context.tenant.companyId, paymentId, line.invoiceId, money(line.amount), line.sequence, context.actor.username],
        );
      }

      for (const line of allocation.allocations) {
        await tx.unsafe(
          `update invoices set status = case
             when (select coalesce(sum(pa.amount),0) from payment_allocations pa where pa.invoice_id = $1)
                  >= grand_total - retention_amount then 'paid'
             else 'partially_paid' end
           where id = $1 and company_id = $2`,
          [line.invoiceId, context.tenant.companyId],
        );
      }

      await audit(tx, context, 'accounting.payment_received', 'payments', paymentId, {
        customerId: request.customerId,
        amount: allocation.allocated,
        unapplied: allocation.unapplied,
        allocations: allocation.allocations,
        entryNo: entry.entryNo,
      });

      return { paymentId, ...allocation, entry };
    });
  }

  // ----------------------------------------------------------------- cheques
  async transitionCheque(
    context: M1Context,
    chequeId: string,
    to: ChequeStatus,
    options: { fee?: string | number; accountId?: string; note?: string } = {},
  ) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<{ id: string; status: ChequeStatus; amount: string; direction: 'incoming' | 'outgoing' }>(
        `select id, status, amount, direction from cheques where id = $1 and company_id = $2 and deleted_at is null`,
        [chequeId, context.tenant.companyId],
      );
      const cheque = rows[0];
      if (!cheque) throw new M1Error('not_found', 404);

      const result = applyChequeTransition({
        chequeId,
        from: cheque.status,
        to,
        direction: cheque.direction,
        amount: cheque.amount,
        fee: options.fee ?? 0,
        accountId: options.accountId ?? null,
        note: options.note,
        actor: context.actor.username,
      });
      if (!result.ok) throw new M1Error(result.reason, 409);

      await tx.unsafe(`update cheques set status = $1, bounce_fee = bounce_fee + $2, account_id = coalesce($3, account_id) where id = $4`, [
        result.status,
        money(result.fee),
        options.accountId ?? null,
        chequeId,
      ]);
      await tx.unsafe(
        `insert into cheque_movements (company_id, cheque_id, from_status, to_status, amount, note, actor)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [context.tenant.companyId, chequeId, cheque.status, result.status, money(result.fee), options.note ?? '', context.actor.username],
      );

      if (result.fee > 0) {
        await writeEntry(tx, context, {
          entryDate: new Date().toISOString().slice(0, 10),
          memoAr: `مصاريف ارتجاع شيك ${chequeId}`,
          memoEn: `Bounced cheque fee ${chequeId}`,
          sourceType: 'cheque_fee',
          sourceId: chequeId,
          lines: [
            { accountCode: '5600', debit: result.fee },
            { accountCode: '1010', credit: result.fee },
          ],
        });
      }

      await audit(tx, context, 'treasury.cheque_transition', 'cheques', chequeId, {
        from: cheque.status,
        to: result.status,
        fee: result.fee,
      });

      return { chequeId, from: cheque.status, ...result };
    });
  }

  // ----------------------------------------------------------------- assets
  async createAsset(
    context: M1Context,
    request: {
      code: string;
      nameAr: string;
      nameEn?: string;
      category: 'vehicle' | 'plant_equipment' | 'it' | 'building' | 'other';
      purchaseDate: string;
      purchaseCost: string | number;
      residualValue?: string | number;
      usefulLifeMonths: number;
      plantId?: string | null;
    },
  ) {
    const assetId = `AST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    return this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `insert into fixed_assets (id, company_id, plant_id, code, name_ar, name_en, category, purchase_date,
           purchase_cost, residual_value, useful_life_months, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)`,
        [
          assetId,
          context.tenant.companyId,
          request.plantId ?? null,
          request.code,
          request.nameAr,
          request.nameEn ?? '',
          request.category,
          request.purchaseDate,
          money(Number(request.purchaseCost)),
          money(Number(request.residualValue ?? 0)),
          request.usefulLifeMonths,
          context.actor.username,
        ],
      );

      await audit(tx, context, 'assets.created', 'fixed_assets', assetId, {
        code: request.code,
        purchaseCost: Number(request.purchaseCost),
        usefulLifeMonths: request.usefulLifeMonths,
      });

      return { assetId };
    });
  }

  async depreciate(context: M1Context, assetId: string, throughPeriod: string) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<{
        id: string; purchase_date: Date; purchase_cost: string; residual_value: string;
        useful_life_months: number; accumulated_depreciation: string; impairment_amount: string;
      }>(
        `select id, purchase_date, purchase_cost, residual_value, useful_life_months,
                accumulated_depreciation, impairment_amount
           from fixed_assets where id = $1 and company_id = $2 and status = 'active'`,
        [assetId, context.tenant.companyId],
      );
      const asset = rows[0];
      if (!asset) throw new M1Error('not_found', 404);

      const schedule = straightLineSchedule({
        assetId,
        purchaseDate: new Date(asset.purchase_date).toISOString().slice(0, 10),
        purchaseCost: asset.purchase_cost,
        residualValue: asset.residual_value,
        usefulLifeMonths: Number(asset.useful_life_months),
        accumulatedDepreciation: asset.accumulated_depreciation,
        impairmentAmount: asset.impairment_amount,
      }).filter((period) => period.period <= throughPeriod);

      let posted = 0;
      for (const period of schedule) {
        const existing = await tx.unsafe<{ id: string }>(
          `select id from depreciation_schedules where asset_id = $1 and period = $2`,
          [assetId, period.period],
        );
        if (existing[0]) continue;

        const entry = await writeEntry(tx, context, {
          entryDate: period.period,
          memoAr: `إهلاك دوري ${period.period.slice(0, 7)}`,
          memoEn: `Depreciation ${period.period.slice(0, 7)}`,
          sourceType: 'depreciation',
          sourceId: assetId,
          lines: [
            { accountCode: '5500', debit: period.amount },
            { accountCode: '1550', credit: period.amount },
          ],
        });

        await tx.unsafe(
          `insert into depreciation_schedules (company_id, asset_id, period, amount, accumulated, book_value, posted_journal_entry_id)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [context.tenant.companyId, assetId, period.period, money(period.amount), money(period.accumulated), money(period.bookValue), entry.id],
        );
        await tx.unsafe(`update fixed_assets set accumulated_depreciation = $1 where id = $2`, [money(period.accumulated), assetId]);
        posted += 1;
      }

      await audit(tx, context, 'assets.depreciated', 'fixed_assets', assetId, { throughPeriod, periodsPosted: posted });
      return { assetId, periodsPosted: posted, schedule: schedule.slice(-posted) };
    });
  }

  // ------------------------------------------------------------------ loans
  async createLoan(
    context: M1Context,
    request: { bankNameAr: string; bankNameEn?: string; principal: string | number; annualRate: string | number; termMonths: number; startDate: string },
  ) {
    const loanId = `LON-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const schedule = annuitySchedule({
      loanId,
      principal: request.principal,
      annualRate: request.annualRate,
      termMonths: request.termMonths,
      startDate: request.startDate,
    });

    await this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `insert into loans (id, company_id, bank_name_ar, bank_name_en, principal, annual_rate, term_months, start_date, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`,
        [
          loanId,
          context.tenant.companyId,
          request.bankNameAr,
          request.bankNameEn ?? '',
          money(Number(request.principal)),
          request.annualRate,
          request.termMonths,
          request.startDate,
          context.actor.username,
        ],
      );

      for (const installment of schedule.installments) {
        await tx.unsafe(
          `insert into loan_installments (company_id, loan_id, installment_no, due_date, payment, principal_part, interest_part, remaining)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            context.tenant.companyId,
            loanId,
            installment.installmentNo,
            installment.dueDate,
            money(installment.payment),
            money(installment.principalPart),
            money(installment.interestPart),
            money(installment.remaining),
          ],
        );
      }

      await audit(tx, context, 'loans.created', 'loans', loanId, {
        principal: Number(request.principal),
        termMonths: request.termMonths,
        installments: schedule.installments.length,
      });
    });

    return { loanId, schedule };
  }

  async loanInstallments(context: M1Context, loanId: string) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe(
        `select installment_no, due_date, payment, principal_part, interest_part, remaining, paid_at
           from loan_installments where company_id = $1 and loan_id = $2 order by installment_no`,
        [context.tenant.companyId, loanId],
      );
      return rows.map((row: Record<string, unknown>) => ({
        ...row,
        payment: decToNumber(dec(String(row.payment ?? 0), 2)),
        principalPart: decToNumber(dec(String(row.principal_part ?? 0), 2)),
        interestPart: decToNumber(dec(String(row.interest_part ?? 0), 2)),
        remaining: decToNumber(dec(String(row.remaining ?? 0), 2)),
      }));
    });
  }

  // ------------------------------------------------------------ procurement
  async createPurchaseOrder(
    context: M1Context,
    request: { supplierId: string; poNo: string; orderDate: string; plantId?: string | null; lines: { quantity: number; unitPrice: number; descriptionAr?: string; descriptionEn?: string; materialCode?: string }[] },
  ) {
    if (context.actor.roleLevel < 4) throw new M1Error('forbidden', 403);
    const poId = `PO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    return this.db.withTenant(context.tenant, async (tx) => {
      const subtotal = request.lines.reduce((sum, line) => sum + Number((line.quantity * line.unitPrice).toFixed(2)), 0);
      const tax = Number((subtotal * 0.14).toFixed(2));

      await tx.unsafe(
        `insert into purchase_orders (id, company_id, plant_id, po_no, supplier_id, order_date, subtotal, tax_amount, total, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10)`,
        [poId, context.tenant.companyId, request.plantId ?? null, request.poNo, request.supplierId, request.orderDate, money(subtotal), money(tax), money(subtotal + tax), context.actor.username],
      );

      for (const [index, line] of request.lines.entries()) {
        await tx.unsafe(
          `insert into purchase_order_lines (company_id, purchase_order_id, line_no, description_ar, description_en, material_code, quantity, unit_price, line_total)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            context.tenant.companyId,
            poId,
            index + 1,
            line.descriptionAr ?? '',
            line.descriptionEn ?? '',
            line.materialCode ?? '',
            line.quantity.toFixed(3),
            money(line.unitPrice),
            money(Number((line.quantity * line.unitPrice).toFixed(2))),
          ],
        );
      }

      await audit(tx, context, 'procurement.po_created', 'purchase_orders', poId, { poNo: request.poNo, subtotal, tax });
      return { poId, subtotal, tax, total: Number((subtotal + tax).toFixed(2)) };
    });
  }

  async createSupplierBill(
    context: M1Context,
    request: { supplierId: string; purchaseOrderId: string; billNo: string; billDate: string; dueDate: string; lines: { quantity: number; unitPrice: number }[] },
  ) {
    const billId = `SB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    return this.db.withTenant(context.tenant, async (tx) => {
      const subtotal = request.lines.reduce((sum, line) => sum + Number((line.quantity * line.unitPrice).toFixed(2)), 0);
      const tax = Number((subtotal * 0.14).toFixed(2));

      await tx.unsafe(
        `insert into supplier_bills (id, company_id, supplier_id, purchase_order_id, bill_no, bill_date, due_date,
           subtotal, tax_amount, total, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_match',$11)`,
        [billId, context.tenant.companyId, request.supplierId, request.purchaseOrderId, request.billNo, request.billDate, request.dueDate, money(subtotal), money(tax), money(subtotal + tax), context.actor.username],
      );

      const existingLines = await tx.unsafe<{ id: string; line_no: number }>(
        `select id, line_no from purchase_order_lines where purchase_order_id = $1 order by line_no`,
        [request.purchaseOrderId],
      );

      for (const [index, line] of request.lines.entries()) {
        await tx.unsafe(
          `insert into supplier_bill_lines (company_id, supplier_bill_id, purchase_order_line_id, line_no, quantity, unit_price, line_total)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            context.tenant.companyId,
            billId,
            existingLines[index]?.id ?? null,
            index + 1,
            line.quantity.toFixed(3),
            money(line.unitPrice),
            money(Number((line.quantity * line.unitPrice).toFixed(2))),
          ],
        );
      }

      await audit(tx, context, 'procurement.bill_created', 'supplier_bills', billId, { billNo: request.billNo, subtotal, tax });
      return { billId, subtotal, tax, total: Number((subtotal + tax).toFixed(2)) };
    });
  }

  async matchSupplierBill(context: M1Context, billId: string) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const bills = await tx.unsafe<{ id: string; purchase_order_id: string; status: string; supplier_id: string; plant_id: string | null }>(
        `select id, purchase_order_id, status, supplier_id, plant_id from supplier_bills
          where id = $1 and company_id = $2 and deleted_at is null`,
        [billId, context.tenant.companyId],
      );
      const bill = bills[0];
      if (!bill) throw new M1Error('not_found', 404);

      const orderLines = await tx.unsafe<{ line_no: number; quantity: string; unit_price: string }>(
        `select line_no, quantity, unit_price from purchase_order_lines where purchase_order_id = $1 order by line_no`,
        [bill.purchase_order_id],
      );
      const receiptLines = await tx.unsafe<{ line_no: number; quantity: string }>(
        `select grl.line_no, grl.quantity
           from goods_receipt_lines grl
           join goods_receipts gr on gr.id = grl.goods_receipt_id
          where gr.purchase_order_id = $1 order by grl.line_no`,
        [bill.purchase_order_id],
      );
      const billLines = await tx.unsafe<{ line_no: number; quantity: string; unit_price: string }>(
        `select line_no, quantity, unit_price from supplier_bill_lines where supplier_bill_id = $1 order by line_no`,
        [billId],
      );

      const input: ThreeWayInput = {
        orderLines: orderLines.map((line) => ({ lineNo: line.line_no, quantity: line.quantity, unitPrice: line.unit_price })),
        receiptLines: receiptLines.map((line) => ({ lineNo: line.line_no, quantity: line.quantity })),
        billLines: billLines.map((line) => ({ lineNo: line.line_no, quantity: line.quantity, unitPrice: line.unit_price })),
      };
      const result = matchThreeWay(input);
      const matchId = `TWM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      await tx.unsafe(
        `insert into three_way_match_results (id, company_id, plant_id, purchase_order_id, goods_receipt_id,
           supplier_bill_id, status, over_receipt_qty, over_billed_qty, price_variance, amount_variance,
           details, requires_approval, created_by)
         values ($1,$2,$3,$4,(select id from goods_receipts where purchase_order_id = $4 order by received_on desc limit 1),
           $5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
        [
          matchId,
          context.tenant.companyId,
          bill.plant_id,
          bill.purchase_order_id,
          billId,
          result.status,
          result.overReceiptQty.toFixed(3),
          result.overBilledQty.toFixed(3),
          money(result.priceVariance),
          money(result.amountVariance),
          JSON.stringify(result),
          result.requiresApproval,
          context.actor.username,
        ],
      );

      if (result.requiresApproval) {
        await tx.unsafe(`update supplier_bills set status = 'disputed' where id = $1`, [billId]);
      } else {
        await tx.unsafe(`update supplier_bills set status = 'matched' where id = $1`, [billId]);
      }

      await audit(tx, context, 'procurement.three_way_match', 'supplier_bills', billId, {
        matchId,
        status: result.status,
        requiresApproval: result.requiresApproval,
        overReceiptQty: result.overReceiptQty,
        overBilledQty: result.overBilledQty,
        priceVariance: result.priceVariance,
      });

      return { matchId, ...result };
    });
  }

  async approveSupplierBill(context: M1Context, billId: string) {
    if (context.actor.roleLevel < 5) throw new M1Error('forbidden', 403);

    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<{ total: string; tax_amount: string; status: string; bill_no: string }>(
        `select total, tax_amount, status, bill_no from supplier_bills where id = $1 and company_id = $2`,
        [billId, context.tenant.companyId],
      );
      const bill = rows[0];
      if (!bill) throw new M1Error('not_found', 404);
      if (bill.status === 'approved') throw new M1Error('already_approved', 409);

      const entry = await writeEntry(tx, context, {
        entryDate: new Date().toISOString().slice(0, 10),
        memoAr: `فاتورة مورد ${bill.bill_no}`,
        memoEn: `Supplier bill ${bill.bill_no}`,
        sourceType: 'supplier_bill',
        sourceId: billId,
        lines: [
          { accountCode: '5000', debit: decToNumber(dec(bill.total, 2)) - decToNumber(dec(bill.tax_amount, 2)) },
          { accountCode: '2100', debit: Number(bill.tax_amount) },
          { accountCode: '2000', credit: Number(bill.total) },
        ],
      });

      await tx.unsafe(`update supplier_bills set status = 'approved', approved_by = $1, approved_at = now(), journal_entry_id = $2 where id = $3`, [
        context.actor.username,
        entry.id,
        billId,
      ]);
      await audit(tx, context, 'procurement.bill_approved', 'supplier_bills', billId, { entryNo: entry.entryNo });
      return { billId, entry };
    });
  }

  // ------------------------------------------------------------- treasury
  async reconcileBank(
    context: M1Context,
    accountId: string,
    request: { periodStart: string; periodEnd: string; statementBalance: number; statement: StatementTransaction[] },
  ) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<{ id: string; txn_date: Date; direction: 'in' | 'out'; amount: string; reference: string }>(
        `select id, txn_date, direction, amount, reference from bank_transactions
          where company_id = $1 and account_id = $2 and txn_date between $3 and $4 order by txn_date`,
        [context.tenant.companyId, accountId, request.periodStart, request.periodEnd],
      );

      const book: BookTransaction[] = rows.map((row) => ({
        id: row.id,
        txnDate: new Date(row.txn_date).toISOString().slice(0, 10),
        direction: row.direction,
        amount: row.amount,
        reference: row.reference,
      }));

      const result = reconcileBank(book, request.statement);
      const reconciliationId = `REC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      await tx.unsafe(
        `insert into bank_reconciliations (id, company_id, account_id, period_start, period_end, statement_balance,
           book_balance, matched_count, unmatched_count, variance, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11)`,
        [
          reconciliationId,
          context.tenant.companyId,
          accountId,
          request.periodStart,
          request.periodEnd,
          money(request.statementBalance),
          money(result.bookBalance),
          result.matchedCount,
          result.unmatchedCount,
          money(result.variance),
          context.actor.username,
        ],
      );

      for (const pair of result.matched) {
        await tx.unsafe(
          `insert into bank_reconciliation_items (company_id, reconciliation_id, bank_transaction_id, amount, match_type)
           values ($1,$2,$3,$4,$5)`,
          [context.tenant.companyId, reconciliationId, pair.bookId, money(pair.amount), pair.matchType],
        );
      }

      await audit(tx, context, 'treasury.bank_reconciled', 'bank_reconciliations', reconciliationId, {
        accountId,
        matched: result.matchedCount,
        unmatched: result.unmatchedCount,
        variance: result.variance,
      });

      return { reconciliationId, ...result, closable: canCloseReconciliation(result) };
    });
  }

  async cashDailyClosing(context: M1Context, accountId: string, date: string, countedBalance: number) {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<{ direction: 'in' | 'out'; amount: string }>(
        `select direction, amount from cash_transactions where company_id = $1 and account_id = $2 and txn_date = $3`,
        [context.tenant.companyId, accountId, date],
      );
      const totalIn = rows.filter((row) => row.direction === 'in').reduce((sum, row) => sum + decToNumber(dec(row.amount, 2)), 0);
      const totalOut = rows.filter((row) => row.direction === 'out').reduce((sum, row) => sum + decToNumber(dec(row.amount, 2)), 0);
      const closing = Number((totalIn - totalOut).toFixed(2));
      const variance = Number((countedBalance - closing).toFixed(2));
      const closingId = `CLS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      await tx.unsafe(
        `insert into cash_closings (id, company_id, account_id, closing_date, total_in, total_out, closing_balance, counted_balance, variance, closed_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          closingId,
          context.tenant.companyId,
          accountId,
          date,
          money(totalIn),
          money(totalOut),
          money(closing),
          money(countedBalance),
          money(variance),
          context.actor.username,
        ],
      );

      await audit(tx, context, 'treasury.cash_closed', 'cash_closings', closingId, { accountId, date, totalIn, totalOut, variance });
      return { closingId, totalIn, totalOut, closingBalance: closing, variance };
    });
  }
}
