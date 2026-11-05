-- ICONCRETE M7 — orders and distribution: customers, quotations, contracts, sales orders,
-- delivery tickets.
--
-- Lifecycles:
--   quotation        draft -> submitted -> approved -> superseded | expired ; cancelled
--   quotation version immutable and append-only: a revision appends the next version
--   contract         draft -> signed -> active -> expired ; void (reason required)
--   contract version immutable and append-only
--   sales order      draft -> confirmed -> scheduled -> in_production -> delivered -> invoiced
--                    -> closed ; draft|confirmed|scheduled -> cancelled ;
--                    confirmed|scheduled|in_production -> on_hold -> resume
--   delivery ticket  draft -> confirmed -> delivered ; draft|confirmed -> voided (reason)
--
-- `customers`, `projects` and `orders` already exist (0002 and 0009); they are extended
-- forward-only with the M7 fields instead of being recreated, so existing rows keep their
-- history. `sales_order_items` is the item table for the existing `orders` header.
--
-- Configurable limits stay "not specified in the supplied reference": the sales rules are
-- inserted with no value and no source note, so an unconfigured rule never passes. The credit
-- bands (100% warning, 110% approval) and the zero-tolerance volume check are fixed by the
-- execution specification, not invented here.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id plus a restrictive
-- plant_scope on every plant-scoped table.

-- ------------------------------------------------------------ customers (extended)
alter table customers add column if not exists customer_code    text;
alter table customers add column if not exists contact_person   text not null default '';
alter table customers add column if not exists billing_address  text not null default '';
alter table customers add column if not exists shipping_address text not null default '';
alter table customers add column if not exists credit_limit     numeric(18,2);
alter table customers add column if not exists currency         char(3) not null default 'EGP';
alter table customers add column if not exists blacklisted      boolean not null default false;
alter table customers add column if not exists blacklisted_at   timestamptz;
alter table customers add column if not exists blacklist_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_credit_limit_check') then
    alter table customers
      add constraint customers_credit_limit_check
      check (credit_limit is null or credit_limit >= 0);
  end if;
end $$;

create unique index if not exists customers_code_idx
  on customers (company_id, lower(customer_code))
  where customer_code is not null and deleted_at is null;

-- ------------------------------------------------------------- projects (extended)
-- A customer project is the B1 `projects` row; M7 adds the site contact. The project code is
-- already unique per company and remains the `project_id` the execution scope names.
alter table projects add column if not exists contact_person text not null default '';
alter table projects add column if not exists contact_phone  text not null default '';

-- ------------------------------------------------------------------- quotations
create table if not exists quotations (
  id                 text primary key,
  company_id         text not null references companies(id),
  plant_id           text not null references plants(id),
  quotation_no       text not null check (char_length(btrim(quotation_no)) between 1 and 48),
  customer_id        text not null references customers(id),
  project_id         text references projects(id),
  total_amount       numeric(18,2) not null default 0 check (total_amount >= 0),
  currency           char(3) not null default 'EGP',
  valid_until        date not null,
  status             text not null default 'draft'
                     check (status in ('draft', 'submitted', 'approved', 'superseded', 'expired',
                                       'cancelled')),
  quoted_by          text not null default '',
  current_version_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  created_by         text,
  updated_by         text,
  version            integer not null default 1
);

create unique index if not exists quotations_no_idx
  on quotations (company_id, lower(quotation_no)) where deleted_at is null;
create index if not exists quotations_tenant_idx
  on quotations (company_id, plant_id, status, valid_until);
create index if not exists quotations_customer_idx
  on quotations (company_id, customer_id) where deleted_at is null;

create table if not exists quotation_items (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text not null references plants(id),
  quotation_id text not null references quotations(id) on delete cascade,
  line_no      integer not null default 1,
  material_id  text references materials(id),
  description  text not null default '',
  quantity     numeric(14,3) not null check (quantity > 0),
  unit_price   numeric(14,2) not null check (unit_price > 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate     numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  line_total   numeric(18,2) not null default 0 check (line_total >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  updated_by   text,
  version      integer not null default 1
);

create index if not exists quotation_items_quote_idx
  on quotation_items (company_id, quotation_id) where deleted_at is null;

create table if not exists quotation_versions (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text not null references plants(id),
  quotation_id text not null references quotations(id),
  version_no   integer not null check (version_no > 0),
  snapshot_json jsonb not null,
  reason       text not null default '',
  created_at   timestamptz not null default now(),
  created_by   text
);

create unique index if not exists quotation_versions_no_idx
  on quotation_versions (quotation_id, version_no);

-- ---------------------------------------------------------------- contracts
create table if not exists contracts (
  id                   text primary key,
  company_id           text not null references companies(id),
  plant_id             text not null references plants(id),
  contract_no          text not null check (char_length(btrim(contract_no)) between 1 and 48),
  customer_id          text not null references customers(id),
  project_id           text references projects(id),
  quotation_version_id text not null references quotation_versions(id),
  start_date           date,
  end_date             date,
  terms                text not null default '',
  status               text not null default 'draft'
                       check (status in ('draft', 'signed', 'active', 'expired', 'void')),
  signed_at            timestamptz,
  signed_by            text,
  void_reason          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  created_by           text,
  updated_by           text,
  version              integer not null default 1
);

create unique index if not exists contracts_no_idx
  on contracts (company_id, lower(contract_no)) where deleted_at is null;
create index if not exists contracts_customer_idx
  on contracts (company_id, customer_id) where deleted_at is null;
create index if not exists contracts_version_idx
  on contracts (quotation_version_id);

create table if not exists contract_versions (
  id          text primary key,
  company_id  text not null references companies(id),
  plant_id    text not null references plants(id),
  contract_id text not null references contracts(id),
  version_no  integer not null check (version_no > 0),
  snapshot_json jsonb not null,
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  created_by  text
);

create unique index if not exists contract_versions_no_idx
  on contract_versions (contract_id, version_no);

-- --------------------------------------------------------------- orders (extended)
alter table orders add column if not exists order_date       date;
alter table orders add column if not exists quotation_id     text references quotations(id);
alter table orders add column if not exists contract_id      text references contracts(id);
alter table orders add column if not exists total_amount     numeric(18,2);
alter table orders add column if not exists credit_status    text;
alter table orders add column if not exists hold_reason      text;
alter table orders add column if not exists held_from_status text;
alter table orders add column if not exists cancelled_at     timestamptz;
alter table orders add column if not exists cancelled_by     text;
alter table orders add column if not exists cancel_reason    text;

update orders
   set order_date = coalesce(order_date, created_at::date),
       total_amount = coalesce(total_amount, (quantity_m3 * unit_price)::numeric(18,2))
 where order_date is null or total_amount is null;

alter table orders drop constraint if exists orders_status_check;
alter table orders
  add constraint orders_status_check
  check (status in ('draft', 'confirmed', 'scheduled', 'in_production', 'delivered', 'invoiced',
                    'closed', 'on_hold', 'cancelled'));

create index if not exists orders_contract_idx
  on orders (company_id, contract_id) where contract_id is not null;
create index if not exists orders_quotation_idx
  on orders (company_id, quotation_id) where quotation_id is not null;

create table if not exists sales_order_items (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text not null references plants(id),
  order_id     text not null references orders(id) on delete cascade,
  line_no      integer not null default 1,
  material_id  text references materials(id),
  description  text not null default '',
  quantity     numeric(14,3) not null check (quantity > 0),
  unit_price   numeric(14,2) not null check (unit_price > 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate     numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  line_total   numeric(18,2) not null default 0 check (line_total >= 0),
  delivered_qty numeric(14,3) not null default 0 check (delivered_qty >= 0),
  invoiced_qty numeric(14,3) not null default 0 check (invoiced_qty >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  updated_by   text,
  version      integer not null default 1
);

create index if not exists sales_order_items_order_idx
  on sales_order_items (company_id, order_id) where deleted_at is null;

-- --------------------------------------------------------- delivery tickets
create table if not exists delivery_tickets (
  id            text primary key,
  company_id    text not null references companies(id),
  plant_id      text not null references plants(id),
  ticket_no     text not null check (char_length(btrim(ticket_no)) between 1 and 48),
  order_id      text not null references orders(id),
  trip_id       text not null references trips(id),
  truck_id      text not null references trucks(id),
  driver_id     text references drivers(id),
  ticket_date   date not null,
  ticket_time   time,
  loaded_vol    numeric(10,3) not null check (loaded_vol > 0),
  delivered_vol numeric(10,3) not null default 0 check (delivered_vol >= 0),
  status        text not null default 'draft'
                check (status in ('draft', 'confirmed', 'delivered', 'voided')),
  void_reason   text,
  confirmed_at  timestamptz,
  confirmed_by  text,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1
);

create unique index if not exists delivery_tickets_no_idx
  on delivery_tickets (company_id, lower(ticket_no)) where deleted_at is null;
create index if not exists delivery_tickets_order_idx
  on delivery_tickets (company_id, order_id, status);
create index if not exists delivery_tickets_trip_idx
  on delivery_tickets (company_id, trip_id);

create table if not exists delivery_ticket_batches (
  id            text primary key,
  company_id    text not null references companies(id),
  plant_id      text not null references plants(id),
  ticket_id     text not null references delivery_tickets(id) on delete cascade,
  batch_id      text references batches(id),
  volume_m3     numeric(10,3) not null check (volume_m3 > 0),
  price_per_m3  numeric(14,2) not null default 0 check (price_per_m3 >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1
);

create index if not exists delivery_ticket_batches_ticket_idx
  on delivery_ticket_batches (company_id, ticket_id) where deleted_at is null;

-- -------------------------------------------------------------- RLS policies
do $$
declare
  t text;
begin
  foreach t in array array[
    'quotations', 'quotation_items', 'quotation_versions', 'contracts', 'contract_versions',
    'sales_order_items', 'delivery_tickets', 'delivery_ticket_batches'
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

-- ------------------------------------------------------ immutable versions
-- An approved version is evidence. Neither it nor its snapshot can be edited or deleted; a
-- correction appends the next version with a reason.
create or replace function sales_version_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception '% % is append-only: append the next version instead',
    tg_table_name, old.id
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_quotation_version_append_only on quotation_versions;
create trigger trg_quotation_version_append_only
  before update or delete on quotation_versions
  for each row execute function sales_version_append_only();

drop trigger if exists trg_contract_version_append_only on contract_versions;
create trigger trg_contract_version_append_only
  before update or delete on contract_versions
  for each row execute function sales_version_append_only();

-- ------------------------------------------------------------ touch triggers
drop trigger if exists trg_touch_quotations on quotations;
create trigger trg_touch_quotations before update on quotations
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_quotation_items on quotation_items;
create trigger trg_touch_quotation_items before update on quotation_items
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_contracts on contracts;
create trigger trg_touch_contracts before update on contracts
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_sales_order_items on sales_order_items;
create trigger trg_touch_sales_order_items before update on sales_order_items
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_delivery_tickets on delivery_tickets;
create trigger trg_touch_delivery_tickets before update on delivery_tickets
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_delivery_ticket_batches on delivery_ticket_batches;
create trigger trg_touch_delivery_ticket_batches before update on delivery_ticket_batches
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_orders on orders;
create trigger trg_touch_orders before update on orders
  for each row execute function touch_updated_at();

-- --------------------------------------------------- sales rule catalogue
alter table rule_definitions drop constraint if exists rule_definitions_module_check;
alter table rule_definitions
  add constraint rule_definitions_module_check
  check (module in ('mix_design', 'batching', 'quality', 'fleet', 'inventory', 'sales'));

create or replace function seed_sales_rule_catalogue() returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted integer;
begin
  insert into public.rule_definitions (id, company_id, code, module, classification, unit,
                                       created_by, updated_by)
  select 'RUL-' || c.id || '-' || replace(v.code, '.', '_'),
         c.id, v.code, v.module, v.classification, v.unit, 'seed', 'seed'
    from public.companies c
    cross join (values
      ('sales.discount_approval_pct', 'sales', 'approval_required', '%'),
      ('sales.discount_max_pct',      'sales', 'mandatory_failure', '%')
    ) as v(code, module, classification, unit)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on function seed_sales_rule_catalogue() from public;
grant execute on function seed_sales_rule_catalogue() to iconcrete_app;

select seed_sales_rule_catalogue();

-- --------------------------------------------------------------- privileges
grant select, insert, update, delete on quotations to iconcrete_app;
grant select, insert, update, delete on quotation_items to iconcrete_app;
grant select, insert on quotation_versions to iconcrete_app;
grant select, insert, update, delete on contracts to iconcrete_app;
grant select, insert on contract_versions to iconcrete_app;
grant select, insert, update, delete on sales_order_items to iconcrete_app;
grant select, insert, update, delete on delivery_tickets to iconcrete_app;
grant select, insert, update, delete on delivery_ticket_batches to iconcrete_app;
