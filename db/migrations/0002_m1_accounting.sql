-- ICONCRETE M1 — accounting, receivables, payables, treasury, assets, loans.
-- Money is always numeric(18,2); never floating point.

-- ------------------------------------------------------------- chart of accounts
create table if not exists gl_accounts (
  id            text primary key,
  company_id    text not null references companies(id),
  code          text not null,
  name_ar       text not null,
  name_en       text not null,
  account_type  text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  normal_side   text not null check (normal_side in ('debit','credit')),
  parent_id     text references gl_accounts(id),
  is_postable   boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1
);
create unique index if not exists gl_accounts_company_code_idx
  on gl_accounts (company_id, code) where deleted_at is null;

-- ------------------------------------------------------------------- customers
create table if not exists customers (
  id               text primary key,
  company_id       text not null references companies(id),
  plant_id         text references plants(id),
  name_ar          text not null,
  name_en          text not null default '',
  tax_id           text not null default '',
  phone            text not null default '',
  email            text not null default '',
  address          text not null default '',
  priority_tier    char(1) not null default 'A' check (priority_tier in ('A','B','C')),
  credit_days      integer not null default 0 check (credit_days between 0 and 365),
  status           text not null default 'active' check (status in ('active','suspended','archived')),
  data_source      text not null default 'manual' check (data_source in ('demo','import','manual')),
  receivable_account_id text references gl_accounts(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  created_by       text,
  updated_by       text,
  version          integer not null default 1
);
create index if not exists customers_company_idx on customers (company_id);
create index if not exists customers_plant_idx on customers (company_id, plant_id);

-- Credit limits live in their own table so history is preserved.
create table if not exists customer_credit_limits (
  id          text primary key,
  company_id  text not null references companies(id),
  customer_id text not null references customers(id) on delete cascade,
  credit_limit numeric(18,2) not null check (credit_limit >= 0),
  currency    char(3) not null default 'EGP',
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  created_at  timestamptz not null default now(),
  created_by  text,
  version     integer not null default 1
);
create index if not exists credit_limits_customer_idx on customer_credit_limits (customer_id, effective_from desc);

-- ------------------------------------------------------------------- suppliers
create table if not exists suppliers (
  id          text primary key,
  company_id  text not null references companies(id),
  name_ar     text not null,
  name_en     text not null default '',
  phone       text not null default '',
  category    text not null default 'services'
              check (category in ('cement','aggregate','admixture','fuel','spare_parts','services')),
  status      text not null default 'active' check (status in ('active','suspended')),
  data_source text not null default 'manual' check (data_source in ('demo','import','manual')),
  payable_account_id text references gl_accounts(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  text,
  updated_by  text,
  version     integer not null default 1
);
create index if not exists suppliers_company_idx on suppliers (company_id);

-- ---------------------------------------------------------- journal entries
create table if not exists journal_entries (
  id            bigserial primary key,
  company_id    text not null references companies(id),
  plant_id      text,
  entry_no      text not null,
  entry_date    date not null,
  memo_ar       text not null default '',
  memo_en       text not null default '',
  source_type   text not null default 'manual',
  source_id     text,
  status        text not null default 'draft' check (status in ('draft','posted','reversed')),
  currency      char(3) not null default 'EGP',
  reversal_of   bigint references journal_entries(id),
  reversed_by   bigint references journal_entries(id),
  posted_at     timestamptz,
  posted_by     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1
);
create unique index if not exists journal_entries_no_idx on journal_entries (company_id, entry_no);
create index if not exists journal_entries_date_idx on journal_entries (company_id, entry_date desc);
create index if not exists journal_entries_source_idx on journal_entries (company_id, source_type, source_id);

create table if not exists journal_entry_lines (
  id           bigserial primary key,
  company_id   text not null references companies(id),
  entry_id     bigint not null references journal_entries(id) on delete cascade,
  account_id   text not null references gl_accounts(id),
  line_no      integer not null,
  description_ar text not null default '',
  description_en text not null default '',
  debit        numeric(18,2) not null default 0 check (debit >= 0),
  credit       numeric(18,2) not null default 0 check (credit >= 0),
  currency     char(3) not null default 'EGP',
  plant_id     text,
  created_at   timestamptz not null default now(),
  constraint journal_line_one_sided check (not (debit > 0 and credit > 0)),
  constraint journal_line_positive check (debit > 0 or credit > 0),
  unique (entry_id, line_no)
);
create index if not exists journal_lines_entry_idx on journal_entry_lines (entry_id);
create index if not exists journal_lines_account_idx on journal_entry_lines (company_id, account_id);

-- --------------------------------------------------------------- invoices
create table if not exists invoices (
  id              text primary key,
  company_id      text not null references companies(id),
  plant_id        text references plants(id),
  customer_id     text not null references customers(id),
  invoice_no      text not null,
  issue_date      date not null,
  due_date        date not null,
  currency        char(3) not null default 'EGP',
  subtotal        numeric(18,2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0),
  tax_percent     numeric(6,3) not null default 14 check (tax_percent >= 0 and tax_percent <= 100),
  tax_amount      numeric(18,2) not null default 0 check (tax_amount >= 0),
  retention_percent numeric(6,3) not null default 0 check (retention_percent >= 0 and retention_percent <= 100),
  retention_amount  numeric(18,2) not null default 0 check (retention_amount >= 0),
  deposit_amount  numeric(18,2) not null default 0 check (deposit_amount >= 0),
  grand_total     numeric(18,2) not null default 0 check (grand_total >= 0),
  status          text not null default 'draft'
                  check (status in ('draft','issued','partially_paid','paid','overdue','void')),
  journal_entry_id bigint references journal_entries(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  created_by      text,
  updated_by      text,
  version         integer not null default 1
);
create unique index if not exists invoices_no_idx on invoices (company_id, invoice_no);
create index if not exists invoices_customer_idx on invoices (company_id, customer_id, issue_date desc);
create index if not exists invoices_plant_idx on invoices (company_id, plant_id);
create index if not exists invoices_due_idx on invoices (company_id, due_date);

create table if not exists invoice_items (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  invoice_id  text not null references invoices(id) on delete cascade,
  line_no     integer not null,
  description_ar text not null default '',
  description_en text not null default '',
  quantity    numeric(18,3) not null check (quantity > 0),
  unit_price  numeric(18,2) not null check (unit_price >= 0),
  line_total  numeric(18,2) not null check (line_total >= 0),
  tax_amount  numeric(18,2) not null default 0,
  created_at  timestamptz not null default now(),
  unique (invoice_id, line_no)
);

-- --------------------------------------------------------------- payments
create table if not exists payments (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text,
  payment_no   text not null,
  customer_id  text references customers(id),
  supplier_id  text references suppliers(id),
  direction    text not null check (direction in ('receipt','disbursement')),
  method       text not null check (method in ('cash','bank','cheque')),
  account_id   text,
  cheque_id    text,
  amount       numeric(18,2) not null check (amount > 0),
  unapplied_amount numeric(18,2) not null default 0 check (unapplied_amount >= 0),
  currency     char(3) not null default 'EGP',
  payment_date date not null,
  reference    text not null default '',
  status       text not null default 'posted' check (status in ('draft','posted','reversed')),
  journal_entry_id bigint references journal_entries(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  updated_by   text,
  version      integer not null default 1,
  constraint payment_party check (customer_id is not null or supplier_id is not null)
);
create unique index if not exists payments_no_idx on payments (company_id, payment_no);
create index if not exists payments_customer_idx on payments (company_id, customer_id);

create table if not exists payment_allocations (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  payment_id  text not null references payments(id) on delete cascade,
  invoice_id  text not null references invoices(id),
  amount      numeric(18,2) not null check (amount > 0),
  allocated_at timestamptz not null default now(),
  sequence    integer not null default 1,
  created_by  text,
  unique (payment_id, invoice_id)
);
create index if not exists payment_allocations_invoice_idx on payment_allocations (invoice_id);

-- --------------------------------------------------------- deposits / retentions
create table if not exists deposits (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text,
  customer_id    text references customers(id),
  invoice_id     text references invoices(id),
  amount         numeric(18,2) not null check (amount > 0),
  currency       char(3) not null default 'EGP',
  received_on    date not null,
  refunded_on    date,
  status         text not null default 'held' check (status in ('held','applied','refunded')),
  journal_entry_id bigint references journal_entries(id),
  created_at     timestamptz not null default now(),
  created_by     text,
  version        integer not null default 1
);

create table if not exists retentions (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text,
  customer_id    text references customers(id),
  invoice_id     text references invoices(id),
  percent        numeric(6,3) not null check (percent >= 0 and percent <= 100),
  amount         numeric(18,2) not null check (amount > 0),
  currency       char(3) not null default 'EGP',
  due_date       date,
  released_on    date,
  status         text not null default 'held' check (status in ('held','released','written_off')),
  journal_entry_id bigint references journal_entries(id),
  created_at     timestamptz not null default now(),
  created_by     text,
  version        integer not null default 1
);

-- -------------------------------------------------------------- cash / bank
create table if not exists cash_accounts (
  id          text primary key,
  company_id  text not null references companies(id),
  plant_id    text references plants(id),
  code        text not null,
  name_ar     text not null,
  name_en     text not null,
  currency    char(3) not null default 'EGP',
  gl_account_id text references gl_accounts(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);
create unique index if not exists cash_accounts_code_idx on cash_accounts (company_id, code);

create table if not exists cash_transactions (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text references plants(id),
  account_id   text not null references cash_accounts(id),
  txn_date     date not null,
  direction    text not null check (direction in ('in','out')),
  amount       numeric(18,2) not null check (amount > 0),
  currency     char(3) not null default 'EGP',
  reference    text not null default '',
  description_ar text not null default '',
  description_en text not null default '',
  closing_id   text,
  journal_entry_id bigint references journal_entries(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  version      integer not null default 1
);
create index if not exists cash_txn_company_date_idx on cash_transactions (company_id, txn_date desc);

create table if not exists cash_closings (
  id          text primary key,
  company_id  text not null references companies(id),
  plant_id    text,
  account_id  text not null references cash_accounts(id),
  closing_date date not null,
  opening_balance numeric(18,2) not null default 0,
  total_in    numeric(18,2) not null default 0,
  total_out   numeric(18,2) not null default 0,
  closing_balance numeric(18,2) not null default 0,
  counted_balance numeric(18,2),
  variance    numeric(18,2),
  closed_by   text,
  created_at  timestamptz not null default now(),
  unique (account_id, closing_date)
);

create table if not exists bank_accounts (
  id          text primary key,
  company_id  text not null references companies(id),
  plant_id    text references plants(id),
  code        text not null,
  bank_name_ar text not null,
  bank_name_en text not null,
  iban_last4  char(4) not null default '',
  currency    char(3) not null default 'EGP',
  opening_balance numeric(18,2) not null default 0,
  gl_account_id text references gl_accounts(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);
create unique index if not exists bank_accounts_code_idx on bank_accounts (company_id, code);

create table if not exists bank_transactions (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text,
  account_id   text not null references bank_accounts(id),
  txn_date     date not null,
  direction    text not null check (direction in ('in','out')),
  amount       numeric(18,2) not null check (amount > 0),
  currency     char(3) not null default 'EGP',
  reference    text not null default '',
  description_ar text not null default '',
  description_en text not null default '',
  external_ref text,
  reconciliation_id text,
  matched      boolean not null default false,
  journal_entry_id bigint references journal_entries(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  version      integer not null default 1
);
create index if not exists bank_txn_company_idx on bank_transactions (company_id, account_id, txn_date desc);

create table if not exists bank_reconciliations (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text,
  account_id   text not null references bank_accounts(id),
  period_start date not null,
  period_end   date not null,
  statement_balance numeric(18,2) not null,
  book_balance      numeric(18,2) not null,
  matched_count     integer not null default 0,
  unmatched_count   integer not null default 0,
  variance          numeric(18,2) not null default 0,
  status       text not null default 'open' check (status in ('open','balanced','closed')),
  closed_at    timestamptz,
  closed_by    text,
  created_at   timestamptz not null default now(),
  created_by   text,
  version      integer not null default 1
);
create index if not exists bank_recon_company_idx on bank_reconciliations (company_id, account_id, period_end desc);

create table if not exists bank_reconciliation_items (
  id                bigserial primary key,
  company_id        text not null references companies(id),
  reconciliation_id text not null references bank_reconciliations(id) on delete cascade,
  bank_transaction_id text references bank_transactions(id),
  amount            numeric(18,2) not null,
  match_type        text not null default 'exact'
                    check (match_type in ('exact','reference','amount_date','manual','unmatched')),
  created_at        timestamptz not null default now()
);

-- ------------------------------------------------------------------ cheques
create table if not exists cheques (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text,
  cheque_no    text not null,
  direction    text not null check (direction in ('incoming','outgoing')),
  customer_id  text references customers(id),
  supplier_id  text references suppliers(id),
  party_name_ar text not null default '',
  party_name_en text not null default '',
  bank_name    text not null default '',
  amount       numeric(18,2) not null check (amount > 0),
  currency     char(3) not null default 'EGP',
  issue_date   date not null,
  due_date     date not null,
  status       text not null default 'received'
               check (status in ('received','deposited','cleared','bounced','recovered','cancelled','closed')),
  bounce_fee   numeric(18,2) not null default 0 check (bounce_fee >= 0),
  account_id   text references bank_accounts(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  updated_by   text,
  version      integer not null default 1
);
create unique index if not exists cheques_no_idx on cheques (company_id, cheque_no);
create index if not exists cheques_status_idx on cheques (company_id, status, due_date);

create table if not exists cheque_movements (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  cheque_id   text not null references cheques(id) on delete cascade,
  from_status text,
  to_status   text not null,
  amount      numeric(18,2) not null default 0,
  note        text not null default '',
  actor       text,
  created_at  timestamptz not null default now()
);
create index if not exists cheque_movements_cheque_idx on cheque_movements (cheque_id, created_at);

-- ------------------------------------------------------- fixed assets
create table if not exists fixed_assets (
  id              text primary key,
  company_id      text not null references companies(id),
  plant_id        text,
  code            text not null,
  name_ar         text not null,
  name_en         text not null default '',
  category        text not null default 'plant_equipment'
                  check (category in ('vehicle','plant_equipment','it','building','other')),
  purchase_date   date not null,
  purchase_cost   numeric(18,2) not null check (purchase_cost > 0),
  residual_value  numeric(18,2) not null default 0 check (residual_value >= 0),
  useful_life_months integer not null check (useful_life_months > 0),
  accumulated_depreciation numeric(18,2) not null default 0,
  impairment_amount numeric(18,2) not null default 0,
  status          text not null default 'active' check (status in ('active','disposed','fully_depreciated')),
  disposal_date   date,
  disposal_proceeds numeric(18,2),
  currency        char(3) not null default 'EGP',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  created_by      text,
  version         integer not null default 1,
  constraint asset_residual_lte_cost check (residual_value <= purchase_cost)
);
create unique index if not exists fixed_assets_code_idx on fixed_assets (company_id, code);

create table if not exists depreciation_schedules (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  asset_id    text not null references fixed_assets(id) on delete cascade,
  period      date not null,
  amount      numeric(18,2) not null check (amount >= 0),
  accumulated numeric(18,2) not null,
  book_value  numeric(18,2) not null,
  posted_journal_entry_id bigint references journal_entries(id),
  created_at  timestamptz not null default now(),
  unique (asset_id, period)
);

-- -------------------------------------------------------------------- loans
create table if not exists loans (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text,
  bank_name_ar   text not null,
  bank_name_en   text not null default '',
  principal      numeric(18,2) not null check (principal > 0),
  annual_rate    numeric(6,4) not null check (annual_rate >= 0),
  term_months    integer not null check (term_months > 0),
  frequency      text not null default 'monthly' check (frequency in ('monthly','quarterly')),
  start_date     date not null,
  currency       char(3) not null default 'EGP',
  status         text not null default 'active' check (status in ('active','closed','overdue')),
  early_settlement_allowed boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  created_by     text,
  version        integer not null default 1
);

create table if not exists loan_installments (
  id             bigserial primary key,
  company_id     text not null references companies(id),
  loan_id        text not null references loans(id) on delete cascade,
  installment_no integer not null,
  due_date       date not null,
  payment        numeric(18,2) not null check (payment > 0),
  principal_part numeric(18,2) not null check (principal_part >= 0),
  interest_part  numeric(18,2) not null check (interest_part >= 0),
  remaining      numeric(18,2) not null,
  paid_at        timestamptz,
  journal_entry_id bigint references journal_entries(id),
  created_at     timestamptz not null default now(),
  unique (loan_id, installment_no)
);

-- --------------------------------------------------- expenses and budgets
create table if not exists expenses (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text,
  expense_date date not null,
  category     text not null default 'operations',
  description_ar text not null default '',
  description_en text not null default '',
  amount       numeric(18,2) not null check (amount > 0),
  currency     char(3) not null default 'EGP',
  supplier_id  text references suppliers(id),
  gl_account_id text references gl_accounts(id),
  payment_method text not null default 'cash' check (payment_method in ('cash','bank','credit')),
  journal_entry_id bigint references journal_entries(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  version      integer not null default 1
);
create index if not exists expenses_company_date_idx on expenses (company_id, expense_date desc);

create table if not exists budgets (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text,
  fiscal_year  integer not null check (fiscal_year between 2000 and 2100),
  period_month integer check (period_month between 1 and 12),
  gl_account_id text references gl_accounts(id),
  category     text not null default 'operations',
  planned_amount numeric(18,2) not null check (planned_amount >= 0),
  actual_amount  numeric(18,2) not null default 0,
  currency     char(3) not null default 'EGP',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   text,
  version      integer not null default 1
);
create index if not exists budgets_company_idx on budgets (company_id, fiscal_year);

-- --------------------------------------------------------------- procurement
create table if not exists purchase_orders (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text references plants(id),
  po_no        text not null,
  supplier_id  text not null references suppliers(id),
  order_date   date not null,
  expected_date date,
  currency     char(3) not null default 'EGP',
  subtotal     numeric(18,2) not null default 0 check (subtotal >= 0),
  tax_amount   numeric(18,2) not null default 0,
  total        numeric(18,2) not null default 0 check (total >= 0),
  status       text not null default 'draft'
               check (status in ('draft','approved','partially_received','received','closed','cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  version      integer not null default 1
);
create unique index if not exists po_no_idx on purchase_orders (company_id, po_no);

create table if not exists purchase_order_lines (
  id            bigserial primary key,
  company_id    text not null references companies(id),
  purchase_order_id text not null references purchase_orders(id) on delete cascade,
  line_no       integer not null,
  description_ar text not null default '',
  description_en text not null default '',
  material_code text not null default '',
  quantity      numeric(18,3) not null check (quantity > 0),
  unit_price    numeric(18,2) not null check (unit_price >= 0),
  line_total    numeric(18,2) not null check (line_total >= 0),
  received_quantity numeric(18,3) not null default 0,
  unique (purchase_order_id, line_no)
);

create table if not exists goods_receipts (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text references plants(id),
  receipt_no   text not null,
  purchase_order_id text not null references purchase_orders(id),
  received_on  date not null,
  received_by  text,
  total_value  numeric(18,2) not null default 0,
  currency     char(3) not null default 'EGP',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  version      integer not null default 1
);
create unique index if not exists grn_no_idx on goods_receipts (company_id, receipt_no);

create table if not exists goods_receipt_lines (
  id                bigserial primary key,
  company_id        text not null references companies(id),
  goods_receipt_id  text not null references goods_receipts(id) on delete cascade,
  purchase_order_line_id bigint references purchase_order_lines(id),
  line_no           integer not null,
  quantity          numeric(18,3) not null check (quantity > 0),
  unit_price        numeric(18,2) not null default 0,
  line_total        numeric(18,2) not null default 0,
  unique (goods_receipt_id, line_no)
);

create table if not exists supplier_bills (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text references plants(id),
  supplier_id  text not null references suppliers(id),
  purchase_order_id text references purchase_orders(id),
  bill_no      text not null,
  bill_date    date not null,
  due_date     date not null,
  currency     char(3) not null default 'EGP',
  subtotal     numeric(18,2) not null default 0 check (subtotal >= 0),
  tax_amount   numeric(18,2) not null default 0,
  total        numeric(18,2) not null default 0 check (total >= 0),
  paid_amount  numeric(18,2) not null default 0 check (paid_amount >= 0),
  status       text not null default 'open'
               check (status in ('open','pending_match','matched','approved','disputed','partially_paid','paid','void')),
  approved_by  text,
  approved_at  timestamptz,
  journal_entry_id bigint references journal_entries(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  version      integer not null default 1
);
create unique index if not exists supplier_bill_no_idx on supplier_bills (company_id, bill_no);

create table if not exists supplier_bill_lines (
  id            bigserial primary key,
  company_id    text not null references companies(id),
  supplier_bill_id text not null references supplier_bills(id) on delete cascade,
  purchase_order_line_id bigint references purchase_order_lines(id),
  line_no       integer not null,
  description_ar text not null default '',
  description_en text not null default '',
  quantity      numeric(18,3) not null check (quantity > 0),
  unit_price    numeric(18,2) not null check (unit_price >= 0),
  line_total    numeric(18,2) not null check (line_total >= 0),
  unique (supplier_bill_id, line_no)
);

create table if not exists three_way_match_results (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text,
  purchase_order_id text not null references purchase_orders(id),
  goods_receipt_id  text references goods_receipts(id),
  supplier_bill_id  text not null references supplier_bills(id),
  status         text not null check (status in ('matched','quantity_variance','price_variance','amount_variance','over_receipt','over_billing','exception')),
  over_receipt_qty numeric(18,3) not null default 0,
  over_billed_qty  numeric(18,3) not null default 0,
  price_variance   numeric(18,2) not null default 0,
  amount_variance  numeric(18,2) not null default 0,
  details        jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default false,
  approved_by    text,
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  created_by     text
);
create index if not exists three_way_bill_idx on three_way_match_results (supplier_bill_id, created_at desc);
