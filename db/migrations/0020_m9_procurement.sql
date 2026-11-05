-- ICONCRETE M9 — procurement, supplier standing and payables.
--
-- Lifecycles:
--   supplier evaluation  draft -> published ; superseded
--   supplier document    pending -> verified -> expired | rejected
--   supplier contract    draft -> signed -> active -> expired ; void (reason required)
--   purchase invoice     received -> verified -> approved -> paid | disputed ; voided
--   payment voucher      draft -> approved -> paid ; cancelled (reason required)
--
-- A supplier whose published evaluation has any score below the configured D threshold, or
-- whose mandatory document is expired/rejected, becomes grade D and is suspended. A grade D
-- supplier can never receive a new purchase order.
--
-- The three-way tolerances are R1 data with NO value: an unconfigured tolerance can only
-- produce approval_required, never a match. They are deliberately not seeded here.
--
-- All tables are tenant and plant scoped, soft deleted and UTC.

-- The rule catalogue already accepts the five operational modules; procurement is the sixth.
alter table rule_definitions drop constraint if exists rule_definitions_module_check;
alter table rule_definitions add constraint rule_definitions_module_check
  check (module in ('mix_design','batching','quality','fleet','inventory','sales','procurement'));

-- --------------------------------------------------------- supplier evaluations
create table if not exists supplier_evaluations (
  id                          text primary key,
  company_id                  text not null references companies(id),
  plant_id                    text not null references plants(id),
  evaluation_no               text not null check (char_length(btrim(evaluation_no)) between 1 and 48),
  supplier_id                 text not null references suppliers(id),
  period_start                date not null,
  period_end                  date not null,
  quality_score_0_to_100      numeric(5,2) not null check (quality_score_0_to_100 between 0 and 100),
  delivery_score_0_to_100     numeric(5,2) not null check (delivery_score_0_to_100 between 0 and 100),
  price_score_0_to_100        numeric(5,2) not null check (price_score_0_to_100 between 0 and 100),
  responsiveness_score_0_to_100 numeric(5,2) not null
                              check (responsiveness_score_0_to_100 between 0 and 100),
  overall_grade               char(1) check (overall_grade in ('A','B','C','D')),
  evaluator_id                text not null,
  evaluated_at                timestamptz not null default now(),
  notes                       text not null default '',
  status                      text not null default 'draft'
                              check (status in ('draft','published','superseded')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  created_by                  text,
  updated_by                  text,
  version                     integer not null default 1,
  check (period_end >= period_start)
);

create unique index if not exists supplier_evaluations_no_idx
  on supplier_evaluations (company_id, lower(evaluation_no)) where deleted_at is null;
create index if not exists supplier_evaluations_supplier_idx
  on supplier_evaluations (company_id, supplier_id, status, period_end desc)
  where deleted_at is null;

-- ----------------------------------------------------------- supplier documents
create table if not exists supplier_documents (
  id            text primary key,
  company_id    text not null references companies(id),
  plant_id      text not null references plants(id),
  supplier_id   text not null references suppliers(id),
  doc_type      text not null
                check (doc_type in ('registration','insurance','licence','quality_certificate')),
  document_ref  text not null check (char_length(btrim(document_ref)) between 1 and 120),
  valid_from    date not null,
  valid_until   date,
  verified_by   text,
  verified_at   timestamptz,
  status        text not null default 'pending'
                check (status in ('pending','verified','expired','rejected')),
  reject_reason text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1,
  check (valid_until is null or valid_until >= valid_from)
);

create index if not exists supplier_documents_supplier_idx
  on supplier_documents (company_id, supplier_id, doc_type, status, valid_until)
  where deleted_at is null;

-- ----------------------------------------------------------- supplier contracts
create table if not exists supplier_contracts (
  id                       text primary key,
  company_id               text not null references companies(id),
  plant_id                 text not null references plants(id),
  contract_no              text not null check (char_length(btrim(contract_no)) between 1 and 48),
  supplier_id              text not null references suppliers(id),
  start_date               date not null,
  end_date                 date,
  payment_terms            text not null default '',
  price_adjustment_clause  text not null default '',
  status                   text not null default 'draft'
                           check (status in ('draft','signed','active','expired','void')),
  signed_at                timestamptz,
  signed_by                text,
  void_reason              text not null default '',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  created_by               text,
  updated_by               text,
  version                  integer not null default 1,
  check (end_date is null or end_date >= start_date)
);

create unique index if not exists supplier_contracts_no_idx
  on supplier_contracts (company_id, lower(contract_no)) where deleted_at is null;
create index if not exists supplier_contracts_supplier_idx
  on supplier_contracts (company_id, supplier_id, status, start_date, end_date)
  where deleted_at is null;

-- ------------------------------------------------------------ purchase invoices
create table if not exists purchase_invoices (
  id                 text primary key,
  company_id         text not null references companies(id),
  plant_id           text not null references plants(id),
  invoice_no         text not null check (char_length(btrim(invoice_no)) between 1 and 60),
  supplier_id        text not null references suppliers(id),
  po_id              text references purchase_orders(id),
  invoice_date       date not null,
  due_date           date,
  currency           char(3) not null default 'EGP',
  subtotal           numeric(18,2) not null default 0 check (subtotal >= 0),
  tax_amount         numeric(18,2) not null default 0 check (tax_amount >= 0),
  total_amount       numeric(18,2) not null default 0 check (total_amount >= 0),
  paid_amount        numeric(18,2) not null default 0 check (paid_amount >= 0),
  status             text not null default 'received'
                     check (status in ('received','verified','approved','paid','disputed','voided')),
  match_status       text not null default 'unmatched'
                     check (match_status in ('unmatched','approval_required','matched')),
  match_details      jsonb not null default '{}'::jsonb,
  verified_by        text,
  verified_at        timestamptz,
  approved_by        text,
  approved_at        timestamptz,
  void_reason        text not null default '',
  notes              text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  created_by         text,
  updated_by         text,
  version            integer not null default 1,
  check (due_date is null or due_date >= invoice_date),
  check (paid_amount <= total_amount)
);

create unique index if not exists purchase_invoices_no_idx
  on purchase_invoices (company_id, supplier_id, lower(invoice_no)) where deleted_at is null;
create index if not exists purchase_invoices_supplier_idx
  on purchase_invoices (company_id, supplier_id, status, invoice_date, due_date)
  where deleted_at is null;
create index if not exists purchase_invoices_po_idx
  on purchase_invoices (company_id, po_id) where deleted_at is null;

create table if not exists purchase_invoice_items (
  id            text primary key,
  company_id    text not null references companies(id),
  plant_id      text not null references plants(id),
  invoice_id    text not null references purchase_invoices(id) on delete cascade,
  line_no       integer not null,
  material_id   text not null references materials(id),
  quantity      numeric(14,3) not null check (quantity > 0),
  unit_price    numeric(16,4) not null check (unit_price >= 0),
  total         numeric(18,2) not null check (total >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1,
  unique (invoice_id, line_no)
);

create index if not exists purchase_invoice_items_idx
  on purchase_invoice_items (company_id, invoice_id, material_id) where deleted_at is null;

-- ------------------------------------------------------------ payment vouchers
create table if not exists payments_vouchers (
  id                  text primary key,
  company_id          text not null references companies(id),
  plant_id            text not null references plants(id),
  voucher_no          text not null check (char_length(btrim(voucher_no)) between 1 and 48),
  supplier_id         text references suppliers(id),
  customer_id         text references customers(id),
  purchase_invoice_id text references purchase_invoices(id),
  payment_type        text not null
                      check (payment_type in ('supplier_payment','customer_receipt','expense')),
  amount              numeric(18,2) not null check (amount > 0),
  currency            char(3) not null default 'EGP',
  method              text not null check (method in ('cash','bank_transfer','cheque')),
  cheque_no           text,
  cheque_due_date     date,
  paid_at             timestamptz,
  recorded_by         text not null,
  status              text not null default 'draft'
                      check (status in ('draft','approved','paid','cancelled')),
  approved_by         text,
  approved_at         timestamptz,
  cancelled_reason    text not null default '',
  exception_status    text not null default 'none'
                      check (exception_status in ('none','open','closed')),
  exception_reason    text not null default '',
  notes               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  created_by          text,
  updated_by          text,
  version             integer not null default 1,
  check (payment_type <> 'supplier_payment' or supplier_id is not null),
  check (payment_type <> 'customer_receipt' or customer_id is not null)
);

create unique index if not exists payments_vouchers_no_idx
  on payments_vouchers (company_id, lower(voucher_no)) where deleted_at is null;
create index if not exists payments_vouchers_party_idx
  on payments_vouchers (company_id, supplier_id, customer_id, status, paid_at)
  where deleted_at is null;

-- -------------------------------------------------------------- AP aging snapshot
create table if not exists ap_aging_snapshot (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text not null references plants(id),
  supplier_id    text not null references suppliers(id),
  snapshot_date  date not null,
  bucket_0_30    numeric(18,2) not null default 0 check (bucket_0_30 >= 0),
  bucket_31_60   numeric(18,2) not null default 0 check (bucket_31_60 >= 0),
  bucket_61_90   numeric(18,2) not null default 0 check (bucket_61_90 >= 0),
  bucket_90_plus numeric(18,2) not null default 0 check (bucket_90_plus >= 0),
  total_due      numeric(18,2) not null default 0 check (total_due >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  created_by     text,
  updated_by     text,
  version        integer not null default 1
);

create unique index if not exists ap_aging_snapshot_idx
  on ap_aging_snapshot (company_id, plant_id, supplier_id, snapshot_date)
  where deleted_at is null;

-- -------------------------------------------------------------- RLS policies
do $$
declare
  t text;
begin
  foreach t in array array[
    'supplier_evaluations', 'supplier_documents', 'supplier_contracts',
    'purchase_invoices', 'purchase_invoice_items', 'payments_vouchers', 'ap_aging_snapshot'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (company_id = app_current_company())
        with check (company_id = app_current_company())
    $f$, t);
    execute format('drop policy if exists plant_scope on %I', t);
    execute format($f$
      create policy plant_scope on %I as restrictive
        using (app_plant_allowed(plant_id)) with check (app_plant_allowed(plant_id))
    $f$, t);
  end loop;
end $$;

-- ------------------------------------------------------------ touch triggers
drop trigger if exists trg_touch_supplier_evaluations on supplier_evaluations;
create trigger trg_touch_supplier_evaluations before update on supplier_evaluations
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_supplier_documents on supplier_documents;
create trigger trg_touch_supplier_documents before update on supplier_documents
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_supplier_contracts on supplier_contracts;
create trigger trg_touch_supplier_contracts before update on supplier_contracts
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_purchase_invoices on purchase_invoices;
create trigger trg_touch_purchase_invoices before update on purchase_invoices
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_purchase_invoice_items on purchase_invoice_items;
create trigger trg_touch_purchase_invoice_items before update on purchase_invoice_items
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_payments_vouchers on payments_vouchers;
create trigger trg_touch_payments_vouchers before update on payments_vouchers
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_ap_aging_snapshot on ap_aging_snapshot;
create trigger trg_touch_ap_aging_snapshot before update on ap_aging_snapshot
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------- rule catalogue
create or replace function seed_m9_procurement_rules() returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted integer;
begin
  insert into public.rule_definitions (id, company_id, code, module, classification, value, unit,
                                       source_note, created_by, updated_by)
  select 'RUL-' || c.id || '-' || replace(v.code, '.', '_'),
         c.id, v.code, v.module, v.classification, v.value, v.unit, v.note, 'seed', 'seed'
    from public.companies c
    cross join (values
      ('procurement.match_qty_tolerance_pct', 'procurement', 'approval_required', null::numeric, '%',
       'D6: quantity tolerance is configurable and has no default; unconfigured is approval_required'),
      ('procurement.match_price_tolerance_pct', 'procurement', 'approval_required', null::numeric, '%',
       'D6: price tolerance is configurable and has no default; unconfigured is approval_required'),
      ('procurement.supplier_grade_d_threshold', 'procurement', 'mandatory_failure', 60::numeric, 'score',
       'M9 execution specification: a supplier score below this threshold is grade D')
    ) as v(code, module, classification, value, unit, note)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on function seed_m9_procurement_rules() from public;
grant execute on function seed_m9_procurement_rules() to iconcrete_app;

select seed_m9_procurement_rules();

-- --------------------------------------------------------------- privileges
grant select, insert, update, delete on supplier_evaluations to iconcrete_app;
grant select, insert, update, delete on supplier_documents to iconcrete_app;
grant select, insert, update, delete on supplier_contracts to iconcrete_app;
grant select, insert, update, delete on purchase_invoices to iconcrete_app;
grant select, insert, update, delete on purchase_invoice_items to iconcrete_app;
grant select, insert, update, delete on payments_vouchers to iconcrete_app;
grant select, insert, update, delete on ap_aging_snapshot to iconcrete_app;
grant update on suppliers to iconcrete_app;
