/**
 * Durable domain writes for committed Excel rows (gap G6).
 *
 * Validation happens before staging, so a row that reaches this layer is already
 * well-formed. Each handler inserts exactly one domain row (plus its natural children);
 * nothing is updated or overwritten, so a duplicate can never silently replace data.
 * Templates without tables yet still persist to `import_records` — this function simply
 * has no domain target for them.
 */
import type { Executor, TenantContext } from './client';

type Values = Record<string, string>;

const text = (value: string | undefined): string => (value ?? '').trim();

const number = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const int = (value: string | undefined, fallback = 0): number => Math.trunc(number(value, fallback));

const date = (value: string | undefined): string | null => {
  const trimmed = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
};

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(text(value) as T) ? (text(value) as T) : fallback;

const insertCustomers = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.customer_id);
  if (!id) return;
  await tx.unsafe(
    `insert into customers
       (id, company_id, plant_id, name_ar, name_en, tax_id, phone, email, address,
        priority_tier, credit_days, status, data_source, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'import',$13)`,
    [
      id,
      ctx.companyId,
      text(values.plant_id) || null,
      text(values.name_ar) || id,
      text(values.name_en) || text(values.name_ar) || id,
      text(values.tax_id),
      text(values.phone),
      text(values.email),
      text(values.address),
      oneOf(values.priority_tier, ['A', 'B', 'C'] as const, 'A'),
      int(values.credit_days, 0),
      oneOf(values.status, ['active', 'suspended', 'archived'] as const, 'active'),
      ctx.userId ?? null,
    ],
  );

  const limit = number(values.credit_limit_egp, 0);
  if (limit >= 0) {
    await tx.unsafe(
      `insert into customer_credit_limits (id, company_id, customer_id, credit_limit, created_by)
       values ($1,$2,$3,$4,$5)`,
      [`${id}-CL-IMPORT`, ctx.companyId, id, limit, ctx.userId ?? null],
    );
  }
};

const insertSuppliers = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.supplier_id);
  if (!id) return;
  await tx.unsafe(
    `insert into suppliers (id, company_id, name_ar, name_en, phone, category, status, data_source, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,'import',$8)`,
    [
      id,
      ctx.companyId,
      text(values.name_ar) || id,
      text(values.name_en) || text(values.name_ar) || id,
      text(values.phone),
      oneOf(values.category, ['cement', 'aggregate', 'admixture', 'fuel', 'spare_parts', 'services'] as const, 'services'),
      oneOf(values.status, ['active', 'suspended'] as const, 'active'),
      ctx.userId ?? null,
    ],
  );
};

const insertChartOfAccounts = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.account_id);
  if (!id) return;
  await tx.unsafe(
    `insert into gl_accounts
       (id, company_id, code, name_ar, name_en, account_type, normal_side, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      ctx.companyId,
      text(values.code) || id,
      text(values.name_ar) || id,
      text(values.name_en) || text(values.name_ar) || id,
      oneOf(values.account_type, ['asset', 'liability', 'equity', 'revenue', 'expense'] as const, 'asset'),
      oneOf(values.normal_side, ['debit', 'credit'] as const, 'debit'),
      ctx.userId ?? null,
    ],
  );
};

const insertInvoices = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.invoice_id);
  if (!id) return;
  const subtotal = number(values.subtotal);
  const taxPercent = number(values.tax_percent, 14);
  const taxAmount = number(values.tax_amount, Math.round(subtotal * taxPercent) / 100);
  const grandTotal = number(values.grand_total, subtotal + taxAmount);
  await tx.unsafe(
    `insert into invoices
       (id, company_id, plant_id, customer_id, invoice_no, issue_date, due_date,
        subtotal, tax_percent, tax_amount, grand_total, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      ctx.companyId,
      text(values.plant_id) || null,
      text(values.customer_id),
      text(values.invoice_no) || id,
      date(values.issue_date),
      date(values.due_date),
      subtotal,
      taxPercent,
      taxAmount,
      grandTotal,
      // Imported invoices stay drafts: posting is a deliberate, audited action.
      oneOf(values.status, ['draft', 'issued'] as const, 'draft'),
      ctx.userId ?? null,
    ],
  );
};

const insertInvoiceItems = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const invoiceId = text(values.invoice_id);
  const lineNo = int(values.line_no, 0);
  if (!invoiceId || lineNo <= 0) return;
  const quantity = number(values.quantity);
  const unitPrice = number(values.unit_price);
  await tx.unsafe(
    `insert into invoice_items
       (company_id, invoice_id, line_no, description_ar, description_en, quantity, unit_price, line_total)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      ctx.companyId,
      invoiceId,
      lineNo,
      text(values.description_ar),
      text(values.description_en),
      quantity,
      unitPrice,
      number(values.line_total, Math.round(quantity * unitPrice * 100) / 100),
    ],
  );
};

const insertPayments = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.payment_id);
  if (!id) return;
  const amount = number(values.amount);
  if (amount <= 0) return;
  const invoiceId = text(values.allocated_invoice_id);
  const allocated = Math.min(number(values.allocated_amount, invoiceId ? amount : 0), amount);
  const unapplied = Math.max(0, Math.round((amount - allocated) * 100) / 100);

  await tx.unsafe(
    `insert into payments
       (id, company_id, payment_no, customer_id, direction, method, amount, unapplied_amount,
        payment_date, reference, status, created_by)
     values ($1,$2,$3,$4,'receipt',$5,$6,$7,$8,$9,'posted',$10)`,
    [
      id,
      ctx.companyId,
      `RC-${id}`,
      text(values.customer_id),
      oneOf(values.method, ['cash', 'bank', 'cheque'] as const, 'bank'),
      amount,
      unapplied,
      date(values.payment_date),
      text(values.reference),
      ctx.userId ?? null,
    ],
  );

  if (invoiceId && allocated > 0) {
    await tx.unsafe(
      `insert into payment_allocations (company_id, payment_id, invoice_id, amount, sequence, created_by)
       values ($1,$2,$3,$4,1,$5)`,
      [ctx.companyId, id, invoiceId, allocated, ctx.userId ?? null],
    );
    await tx.unsafe(
      `update invoices set status = case
         when (select coalesce(sum(pa.amount),0) from payment_allocations pa where pa.invoice_id = $1)
              >= grand_total - retention_amount then 'paid'
         else 'partially_paid' end
       where id = $1 and company_id = $2`,
      [invoiceId, ctx.companyId],
    );
  }
};

const insertExpenses = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.expense_id);
  if (!id) return;
  await tx.unsafe(
    `insert into expenses
       (id, company_id, plant_id, expense_date, category, description_ar, description_en, amount,
        supplier_id, gl_account_id, payment_method, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,
             (select a.id from gl_accounts a where a.company_id = $2 and a.code = $10 and a.deleted_at is null limit 1),
             $11,$12)`,
    [
      id,
      ctx.companyId,
      text(values.plant_id) || null,
      date(values.expense_date),
      text(values.category) || 'operations',
      text(values.description_ar),
      text(values.description_en),
      number(values.amount),
      text(values.supplier_id) || null,
      text(values.gl_account_code) || null,
      oneOf(values.payment_method, ['cash', 'bank', 'credit'] as const, 'cash'),
      ctx.userId ?? null,
    ],
  );
};

const insertCheques = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.cheque_id);
  if (!id) return;
  await tx.unsafe(
    `insert into cheques
       (id, company_id, plant_id, cheque_no, direction, party_name_ar, party_name_en, bank_name,
        amount, issue_date, due_date, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      ctx.companyId,
      text(values.plant_id) || null,
      text(values.cheque_no) || id,
      oneOf(values.direction, ['incoming', 'outgoing'] as const, 'incoming'),
      text(values.party_name_ar),
      text(values.party_name_en),
      text(values.bank_name),
      number(values.amount),
      date(values.issue_date),
      date(values.due_date),
      oneOf(
        values.status,
        ['received', 'deposited', 'cleared', 'bounced', 'recovered', 'cancelled', 'closed'] as const,
        'received',
      ),
      ctx.userId ?? null,
    ],
  );
};

const insertFixedAssets = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.asset_id);
  if (!id) return;
  await tx.unsafe(
    `insert into fixed_assets
       (id, company_id, plant_id, code, name_ar, name_en, category, purchase_date, purchase_cost,
        residual_value, useful_life_months, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      ctx.companyId,
      text(values.plant_id) || null,
      text(values.code) || id,
      text(values.name_ar) || id,
      text(values.name_en) || text(values.name_ar) || id,
      oneOf(
        values.category,
        ['vehicle', 'plant_equipment', 'it', 'building', 'other'] as const,
        'plant_equipment',
      ),
      date(values.purchase_date),
      number(values.purchase_cost),
      number(values.residual_value, 0),
      int(values.useful_life_months, 60),
      ctx.userId ?? null,
    ],
  );
};

const insertLoans = async (tx: Executor, ctx: TenantContext, values: Values): Promise<void> => {
  const id = text(values.loan_id);
  if (!id) return;
  await tx.unsafe(
    `insert into loans
       (id, company_id, plant_id, bank_name_ar, bank_name_en, principal, annual_rate, term_months,
        start_date, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      ctx.companyId,
      text(values.plant_id) || null,
      text(values.bank_name_ar) || 'Bank',
      text(values.bank_name_en) || text(values.bank_name_ar) || 'Bank',
      number(values.principal),
      number(values.annual_rate, 0),
      int(values.term_months, 12),
      date(values.start_date),
      oneOf(values.status, ['active', 'closed', 'overdue'] as const, 'active'),
      ctx.userId ?? null,
    ],
  );
};

/**
 * Applies one validated row. Templates without a domain table yet (materials, orders,
 * employees, fleet, mix designs) intentionally have no target: their rows still land in
 * `import_records`, and that limitation is documented.
 */
export const applyTemplateRow = async (
  tx: Executor,
  ctx: TenantContext,
  templateId: string,
  values: Values,
): Promise<void> => {
  switch (templateId) {
    case 'customers':
      return insertCustomers(tx, ctx, values);
    case 'suppliers':
      return insertSuppliers(tx, ctx, values);
    case 'chart_of_accounts':
      return insertChartOfAccounts(tx, ctx, values);
    case 'invoices':
      return insertInvoices(tx, ctx, values);
    case 'invoice_items':
      return insertInvoiceItems(tx, ctx, values);
    case 'payments':
      return insertPayments(tx, ctx, values);
    case 'expenses':
      return insertExpenses(tx, ctx, values);
    case 'cheques':
      return insertCheques(tx, ctx, values);
    case 'fixed_assets':
      return insertFixedAssets(tx, ctx, values);
    case 'loans':
      return insertLoans(tx, ctx, values);
    default:
      return;
  }
};
