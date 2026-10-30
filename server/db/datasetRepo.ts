/**
 * Database-backed read models (gap G2).
 *
 * The dashboard and reports used to read the in-memory demo dataset even in postgres mode,
 * which meant a real tenant saw either demo numbers or a 403. This loader builds the same
 * DemoDataset shape from tenant tables inside `withTenant`, so RLS (company + plant scope)
 * decides what is visible.
 *
 * Modules that have no tables yet (batches, trips, quality tests, materials/inventory,
 * payroll, rentals, utilities, maintenance, trucks) are returned as empty arrays. That is
 * intentional and documented: the UI then shows truthful zeros instead of demo numbers.
 */
import type { Db, TenantContext } from './client';
import type {
  BankAccount,
  CashTransaction,
  Cheque,
  ChequeStatus,
  Company,
  Customer,
  DemoDataset,
  FixedAsset,
  Invoice,
  Loan,
  Plant,
  PriorityTier,
  Supplier,
  SupplierBill,
} from '../../src/types';

type Row = Record<string, unknown>;

const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stamp = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

const day = (value: unknown): string => stamp(value).slice(0, 10);

const chequeStatus = (value: string): ChequeStatus => {
  switch (value) {
    case 'deposited':
      return 'under_collection';
    case 'cleared':
      return 'cleared';
    case 'bounced':
      return 'bounced';
    case 'cancelled':
    case 'closed':
      return 'cancelled';
    default:
      return 'received';
  }
};

const billStatus = (value: string): SupplierBill['status'] => {
  if (value === 'paid') return 'paid';
  if (value === 'partially_paid') return 'partially_paid';
  if (value === 'disputed') return 'disputed';
  return 'open';
};

const assetCategory = (value: string): FixedAsset['category'] =>
  value === 'vehicle' || value === 'it' || value === 'building' ? value : 'plant_equipment';

const tier = (value: string): PriorityTier =>
  value === 'B' || value === 'C' ? value : 'A';

export const loadDatasetForTenant = async (db: Db, ctx: TenantContext): Promise<DemoDataset> => {
  const raw = await db.withTenant(ctx, async (tx) => {
    const company = await tx.unsafe<Row>(
      `select id, name_ar, name_en, tax_id, logo_doc_id, created_at
         from companies where id = $1 and deleted_at is null`,
      [ctx.companyId],
    );
    // RLS already filters; the explicit predicate keeps the query honest when an owner
    // role (which bypasses RLS) is used for diagnostics.
    const plants = await tx.unsafe<Row>(
      `select id, company_id, name_ar, name_en, city, capacity_m3_per_hour, is_active
         from plants where company_id = $1 and deleted_at is null order by id`,
      [ctx.companyId],
    );
    const customers = await tx.unsafe<Row>(
      `select c.id, c.company_id, c.plant_id, c.name_ar, c.name_en, c.tax_id, c.phone,
              c.email, c.address, c.priority_tier, c.credit_days, c.status, c.data_source,
              c.created_at,
              coalesce((
                select cl.credit_limit from customer_credit_limits cl
                 where cl.customer_id = c.id and cl.effective_to is null
                 order by cl.effective_from desc limit 1
              ), 0) as credit_limit
         from customers c
        where c.company_id = $1 and c.deleted_at is null
        order by c.id`,
      [ctx.companyId],
    );
    const suppliers = await tx.unsafe<Row>(
      `select id, company_id, name_ar, name_en, phone, category, status, data_source
         from suppliers where company_id = $1 and deleted_at is null order by id`,
      [ctx.companyId],
    );
    const invoices = await tx.unsafe<Row>(
      `select i.id, i.invoice_no, i.customer_id, i.plant_id, i.issue_date, i.due_date,
              i.subtotal, i.tax_percent, i.grand_total, i.status,
              coalesce((
                select sum(pa.amount) from payment_allocations pa where pa.invoice_id = i.id
              ), 0) as paid_amount
         from invoices i
        where i.company_id = $1 and i.deleted_at is null
        order by i.issue_date, i.id`,
      [ctx.companyId],
    );
    const bills = await tx.unsafe<Row>(
      `select id, supplier_id, bill_no, bill_date, due_date, total, paid_amount, status
         from supplier_bills where company_id = $1 and deleted_at is null order by id`,
      [ctx.companyId],
    );
    const cash = await tx.unsafe<Row>(
      `select id, plant_id, txn_date, direction, amount, reference, description_ar, description_en
         from cash_transactions where company_id = $1 and deleted_at is null order by txn_date, id`,
      [ctx.companyId],
    );
    const banks = await tx.unsafe<Row>(
      `select b.id, b.plant_id, b.bank_name_ar, b.bank_name_en, b.iban_last4, b.opening_balance,
              coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0) as movement
         from bank_accounts b
         left join bank_transactions t on t.account_id = b.id and t.deleted_at is null
        where b.company_id = $1 and b.is_active
        group by b.id
        order by b.id`,
      [ctx.companyId],
    );
    const cheques = await tx.unsafe<Row>(
      `select id, cheque_no, direction, party_name_ar, party_name_en, amount, due_date, status
         from cheques where company_id = $1 and deleted_at is null order by due_date, id`,
      [ctx.companyId],
    );
    const assets = await tx.unsafe<Row>(
      `select id, name_ar, name_en, category, purchase_date, purchase_cost,
              accumulated_depreciation, impairment_amount
         from fixed_assets where company_id = $1 and deleted_at is null order by id`,
      [ctx.companyId],
    );
    const loans = await tx.unsafe<Row>(
      `select l.id, l.bank_name_ar, l.bank_name_en, l.principal, l.status, l.start_date,
              coalesce((
                select li.remaining from loan_installments li
                 where li.loan_id = l.id order by li.installment_no desc limit 1
              ), l.principal) as outstanding_principal,
              coalesce((
                select min(li.due_date) from loan_installments li
                 where li.loan_id = l.id and li.paid_at is null
              ), l.start_date) as next_due
         from loans l where l.company_id = $1 and l.deleted_at is null order by l.id`,
      [ctx.companyId],
    );

    return { company, plants, customers, suppliers, invoices, bills, cash, banks, cheques, assets, loans };
  });

  const companyRow = raw.company[0];
  if (!companyRow) throw new Error(`company ${ctx.companyId} was not found or is not visible`);

  const company: Company = {
    id: str(companyRow.id),
    name_ar: str(companyRow.name_ar),
    name_en: str(companyRow.name_en),
    tax_id: str(companyRow.tax_id),
    logo_doc_id: companyRow.logo_doc_id ? str(companyRow.logo_doc_id) : null,
    created_at: stamp(companyRow.created_at),
  };

  const plants: Plant[] = raw.plants.map((row) => ({
    id: str(row.id),
    company_id: str(row.company_id),
    name_ar: str(row.name_ar),
    name_en: str(row.name_en),
    city: str(row.city),
    capacity_m3_per_hour: num(row.capacity_m3_per_hour),
    is_active: row.is_active !== false,
  }));

  const customers: Customer[] = raw.customers.map((row) => ({
    id: str(row.id),
    company_id: str(row.company_id),
    plant_id: str(row.plant_id) ?? '',
    name_ar: str(row.name_ar),
    name_en: str(row.name_en),
    tax_id: str(row.tax_id),
    phone: str(row.phone),
    email: str(row.email),
    address: str(row.address),
    priority_tier: tier(str(row.priority_tier)),
    credit_limit_egp: num(row.credit_limit),
    credit_days: num(row.credit_days),
    status: (['active', 'suspended', 'archived'].includes(str(row.status))
      ? str(row.status)
      : 'active') as Customer['status'],
    data_source: (['demo', 'import', 'manual'].includes(str(row.data_source))
      ? str(row.data_source)
      : 'manual') as Customer['data_source'],
    created_at: stamp(row.created_at),
  }));

  const suppliers: Supplier[] = raw.suppliers.map((row) => ({
    id: str(row.id),
    company_id: str(row.company_id),
    name_ar: str(row.name_ar),
    name_en: str(row.name_en),
    phone: str(row.phone),
    category: (['cement', 'aggregate', 'admixture', 'fuel', 'spare_parts', 'services'].includes(
      str(row.category),
    )
      ? str(row.category)
      : 'services') as Supplier['category'],
    status: str(row.status) === 'suspended' ? 'suspended' : 'active',
    data_source: (['demo', 'import', 'manual'].includes(str(row.data_source))
      ? str(row.data_source)
      : 'manual') as Supplier['data_source'],
  }));

  const invoices: Invoice[] = raw.invoices.map((row) => {
    const grand = num(row.grand_total);
    const paid = num(row.paid_amount);
    return {
      id: str(row.id),
      invoice_no: str(row.invoice_no),
      customer_id: str(row.customer_id),
      plant_id: str(row.plant_id),
      issue_date: day(row.issue_date),
      due_date: day(row.due_date),
      subtotal: num(row.subtotal),
      vat_percent: num(row.tax_percent),
      grand_total: grand,
      paid_amount: paid,
      outstanding_amount: Math.round((grand - paid) * 100) / 100,
      status: (['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'].includes(
        str(row.status),
      )
        ? str(row.status)
        : 'issued') as Invoice['status'],
    };
  });

  const supplierBills: SupplierBill[] = raw.bills.map((row) => {
    const total = num(row.total);
    const paid = num(row.paid_amount);
    return {
      id: str(row.id),
      supplier_id: str(row.supplier_id),
      bill_no: str(row.bill_no),
      bill_date: day(row.bill_date),
      due_date: day(row.due_date),
      total,
      paid_amount: paid,
      outstanding_amount: Math.round((total - paid) * 100) / 100,
      status: billStatus(str(row.status)),
    };
  });

  const cashTransactions: CashTransaction[] = raw.cash.map((row) => ({
    id: str(row.id),
    plant_id: str(row.plant_id),
    txn_date: day(row.txn_date),
    direction: str(row.direction) === 'out' ? 'out' : 'in',
    amount: num(row.amount),
    reference: str(row.reference),
    description_ar: str(row.description_ar),
    description_en: str(row.description_en),
  }));

  const bankAccounts: BankAccount[] = raw.banks.map((row) => ({
    id: str(row.id),
    plant_id: str(row.plant_id),
    bank_name_ar: str(row.bank_name_ar),
    bank_name_en: str(row.bank_name_en),
    iban_last4: str(row.iban_last4),
    current_balance: Math.round((num(row.opening_balance) + num(row.movement)) * 100) / 100,
  }));

  const cheques: Cheque[] = raw.cheques.map((row) => ({
    id: str(row.id),
    cheque_no: str(row.cheque_no),
    direction: str(row.direction) === 'outgoing' ? 'outgoing' : 'incoming',
    party_name_ar: str(row.party_name_ar),
    party_name_en: str(row.party_name_en),
    amount: num(row.amount),
    due_date: day(row.due_date),
    status: chequeStatus(str(row.status)),
  }));

  const fixedAssets: FixedAsset[] = raw.assets.map((row) => ({
    id: str(row.id),
    name_ar: str(row.name_ar),
    name_en: str(row.name_en),
    category: assetCategory(str(row.category)),
    purchase_date: day(row.purchase_date),
    purchase_cost: num(row.purchase_cost),
    current_book_value:
      Math.round(
        (num(row.purchase_cost) - num(row.accumulated_depreciation) - num(row.impairment_amount)) *
          100,
      ) / 100,
  }));

  const loans: Loan[] = raw.loans.map((row) => ({
    id: str(row.id),
    bank_name_ar: str(row.bank_name_ar),
    bank_name_en: str(row.bank_name_en),
    principal: num(row.principal),
    outstanding_principal: num(row.outstanding_principal),
    next_installment_date: day(row.next_due),
    status: (['active', 'closed', 'overdue'].includes(str(row.status))
      ? str(row.status)
      : 'active') as Loan['status'],
  }));

  return {
    company,
    plants,
    users: [],
    customers,
    suppliers,
    invoices,
    supplierBills,
    cashTransactions,
    bankAccounts,
    cheques,
    materials: [],
    inventory: [],
    fixedAssets,
    loans,
    salaryPayments: [],
    rentals: [],
    utilityBills: [],
    maintenanceOrders: [],
    batches: [],
    trucks: [],
    trips: [],
    qualityTests: [],
    auditLog: [],
  };
};
