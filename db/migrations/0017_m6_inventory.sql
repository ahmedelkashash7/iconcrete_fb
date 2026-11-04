-- ICONCRETE M6 — inventory: material master, procurement documents, stock movements, valuation.
--
-- Lifecycles:
--   material:        active -> inactive (never deleted; soft delete keeps history)
--   purchase request draft -> submitted -> approved -> converted_to_po | rejected
--   purchase order   draft -> confirmed -> partially_received -> fully_received -> closed
--                    draft|confirmed|partially_received -> cancelled
--   goods receipt    draft -> confirmed ; confirmed -> voided (reason required)
--   exception        open -> investigation -> resolved | escalated ; open|investigation -> voided
--
-- Balances are never stored: a balance is always the sum of the append-only stock_movements.
-- Weighted-average materials keep one moving-average cost per plant and material; FIFO
-- materials consume cost_layers oldest first. A layer is never edited after posting, and a
-- posted movement is never edited or deleted — a correction is a reversal that names it.
--
-- Every numeric limit stays "not specified in the supplied reference": the inventory rules are
-- seeded with no value and no source note, so an unconfigured rule never passes.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id plus a restrictive
-- plant_scope on every plant-scoped table. `suppliers` already exists from 0002, so it is
-- extended forward-only instead of recreated.

create table if not exists materials (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text not null references plants(id),
  material_code     text not null check (char_length(btrim(material_code)) between 1 and 32),
  name_ar           text not null,
  name_en           text not null default '',
  category          text not null
                    check (category in ('cement', 'scm', 'aggregate', 'water', 'admixture',
                                        'fuel', 'spare_part', 'other')),
  unit_of_measure   text not null check (char_length(btrim(unit_of_measure)) between 1 and 16),
  is_bulk           boolean not null,
  -- Null means "not chosen yet": the first movement is refused as approval_required.
  valuation_method  text check (valuation_method in ('weighted_average', 'fifo')),
  min_stock_level   numeric(14,3) check (min_stock_level is null or min_stock_level >= 0),
  max_stock_level   numeric(14,3) check (max_stock_level is null or max_stock_level >= 0),
  reorder_point     numeric(14,3) check (reorder_point is null or reorder_point >= 0),
  status            text not null default 'active' check (status in ('active', 'inactive')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  created_by        text,
  updated_by        text,
  version           integer not null default 1
);

create unique index if not exists materials_code_idx
  on materials (company_id, material_code) where deleted_at is null;
create index if not exists materials_plant_idx
  on materials (company_id, plant_id, category) where deleted_at is null;

-- --------------------------------------------------------- suppliers (extended)
alter table suppliers add column if not exists supplier_code text;
alter table suppliers add column if not exists contact       text not null default '';
alter table suppliers add column if not exists payment_terms text not null default '';
alter table suppliers add column if not exists credit_days   integer;
alter table suppliers add column if not exists rating        numeric(3,2);
alter table suppliers add column if not exists plant_id      text references plants(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'suppliers_credit_days_check'
  ) then
    alter table suppliers
      add constraint suppliers_credit_days_check
      check (credit_days is null or credit_days >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'suppliers_rating_check'
  ) then
    alter table suppliers
      add constraint suppliers_rating_check
      check (rating is null or (rating >= 0 and rating <= 5));
  end if;
end $$;

create unique index if not exists suppliers_code_idx
  on suppliers (company_id, supplier_code)
  where supplier_code is not null and deleted_at is null;

create table if not exists supplier_contacts (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text not null references plants(id),
  supplier_id  text not null references suppliers(id),
  contact_name text not null,
  role         text not null default '',
  email        text not null default '',
  phone        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  updated_by   text,
  version      integer not null default 1
);

create index if not exists supplier_contacts_supplier_idx
  on supplier_contacts (company_id, supplier_id) where deleted_at is null;

-- ------------------------------------------------------------ purchase requests
create table if not exists purchase_requests (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text not null references plants(id),
  pr_no             text not null,
  material_id       text not null references materials(id),
  quantity_requested numeric(14,3) not null check (quantity_requested > 0),
  reason            text not null default '',
  requested_by      text not null,
  requested_at      timestamptz not null default now(),
  status            text not null default 'draft'
                    check (status in ('draft', 'submitted', 'approved', 'converted_to_po', 'rejected')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  created_by        text,
  updated_by        text,
  version           integer not null default 1
);

create unique index if not exists purchase_requests_no_idx
  on purchase_requests (company_id, pr_no) where deleted_at is null;

-- ------------------------------------------------------------- purchase orders
-- `purchase_orders` and `goods_receipts` already exist from 0002 (M1 procurement). They are
-- extended forward-only: the M1 columns and rows stay valid, and the M6 lifecycle adds the
-- confirmed/fully_received states and the request link.
alter table purchase_orders add column if not exists pr_id text references purchase_requests(id);
alter table purchase_orders add column if not exists discount_amount numeric(16,2) not null default 0;
alter table purchase_orders add column if not exists ordered_by text;
alter table purchase_orders add column if not exists ordered_at timestamptz;
alter table purchase_orders add column if not exists expected_delivery_at timestamptz;
alter table purchase_orders add column if not exists cancelled_reason text;
alter table purchase_orders add column if not exists updated_by text;
alter table purchase_orders alter column order_date set default current_date;

alter table purchase_orders drop constraint if exists purchase_orders_status_check;
alter table purchase_orders
  add constraint purchase_orders_status_check
  check (status in ('draft', 'confirmed', 'approved', 'partially_received', 'received',
                    'fully_received', 'closed', 'cancelled'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_discount_check') then
    alter table purchase_orders
      add constraint purchase_orders_discount_check check (discount_amount >= 0);
  end if;
end $$;

create table if not exists po_items (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text not null references plants(id),
  po_id             text not null references purchase_orders(id),
  material_id       text not null references materials(id),
  unit_price        numeric(16,4) not null check (unit_price >= 0),
  quantity_ordered  numeric(14,3) not null check (quantity_ordered > 0),
  quantity_received numeric(14,3) not null default 0 check (quantity_received >= 0),
  tax_rate          numeric(6,3) not null default 0 check (tax_rate >= 0),
  discount_pct      numeric(6,3) not null default 0 check (discount_pct between 0 and 100),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text,
  updated_by        text,
  version           integer not null default 1
);

create index if not exists po_items_po_idx on po_items (company_id, po_id);

-- -------------------------------------------------------------- goods receipts
-- The M1 table keeps `purchase_order_id`, `received_on` and `total_value`; M6 adds the
-- confirmation/void lifecycle and a timestamp for the stock posting.
alter table goods_receipts add column if not exists received_at timestamptz not null default now();
alter table goods_receipts add column if not exists status text not null default 'draft';
alter table goods_receipts add column if not exists confirmed_at timestamptz;
alter table goods_receipts add column if not exists confirmed_by text;
alter table goods_receipts add column if not exists voided_at timestamptz;
alter table goods_receipts add column if not exists void_reason text;
alter table goods_receipts add column if not exists updated_by text;
alter table goods_receipts alter column received_on set default current_date;

alter table goods_receipts drop constraint if exists goods_receipts_status_check;
alter table goods_receipts
  add constraint goods_receipts_status_check
  check (status in ('draft', 'confirmed', 'voided'));

create index if not exists goods_receipts_po_idx
  on goods_receipts (company_id, purchase_order_id);

create table if not exists receipt_items (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text not null references plants(id),
  receipt_id        text not null references goods_receipts(id),
  po_item_id        text not null references po_items(id),
  quantity_received numeric(14,3) not null check (quantity_received > 0),
  unit_cost         numeric(16,4) not null check (unit_cost >= 0),
  lot_no            text not null default '',
  expiry_date       date,
  weight_in_kg      numeric(14,3) check (weight_in_kg is null or weight_in_kg >= 0),
  created_at        timestamptz not null default now()
);

create index if not exists receipt_items_receipt_idx on receipt_items (company_id, receipt_id);

-- -------------------------------------------------------------- stock movements
-- Append-only ledger: posted rows are never edited or deleted. `unit_cost` is supplied by a
-- receipt or an adjustment; issues are valued from the material's method.
create table if not exists stock_movements (
  movement_id        text primary key,
  company_id         text not null references companies(id),
  plant_id           text not null references plants(id),
  material_id        text not null references materials(id),
  quantity           numeric(14,3) not null check (quantity > 0),
  unit               text not null,
  unit_cost          numeric(16,4),
  total_cost         numeric(16,4),
  movement_type      text not null
                     check (movement_type in ('receipt', 'issue', 'consumption', 'return',
                                              'adjustment', 'transfer_out', 'transfer_in', 'reversal')),
  reference_type     text not null default '',
  reference_id       text,
  batch_id           text,
  moisture_reading_id text,
  lot_no             text not null default '',
  reason             text not null default '',
  correction_of      text references stock_movements(movement_id),
  occurred_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  created_by         text not null
);

create index if not exists stock_movements_balance_idx
  on stock_movements (company_id, plant_id, material_id, occurred_at);
create index if not exists stock_movements_reference_idx
  on stock_movements (company_id, reference_type, reference_id);

-- --------------------------------------------------------------- inventory snapshots
create table if not exists inventory_snapshots (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text not null references plants(id),
  material_id    text not null references materials(id),
  snapshot_date  date not null,
  opening_qty    numeric(14,3) not null default 0,
  receipts       numeric(14,3) not null default 0,
  issues         numeric(14,3) not null default 0,
  closing_qty    numeric(14,3) not null default 0,
  avg_cost       numeric(16,4) not null default 0,
  closing_value  numeric(16,4) not null default 0,
  generated_at   timestamptz not null default now(),
  created_by     text
);

create unique index if not exists inventory_snapshots_day_idx
  on inventory_snapshots (company_id, plant_id, material_id, snapshot_date);

-- ------------------------------------------------------------ inventory exceptions
create table if not exists inventory_exceptions (
  exception_id        text primary key,
  company_id          text not null references companies(id),
  plant_id            text not null references plants(id),
  material_id         text not null references materials(id),
  movement_id         text references stock_movements(movement_id),
  exception_type      text not null default 'negative_stock'
                      check (exception_type in ('negative_stock', 'over_issue', 'lot_quality')),
  quantity            numeric(14,3) not null,
  available_quantity  numeric(14,3) not null,
  reason              text not null check (char_length(btrim(reason)) >= 5),
  severity            text not null default 'high' check (severity in ('low', 'medium', 'high')),
  status              text not null default 'open'
                      check (status in ('open', 'investigation', 'resolved', 'escalated', 'voided')),
  suggested_source_type text not null default 'none'
                      check (suggested_source_type in ('goods_receipt', 'purchase_order',
                                                       'adjustment', 'none')),
  suggested_source_id text,
  suggestion_note     text not null default '',
  opened_by           text not null,
  opened_at           timestamptz not null default now(),
  closed_by           text,
  closed_at           timestamptz,
  decision            text check (decision in ('approved', 'rejected')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1
);

create index if not exists inventory_exceptions_open_idx
  on inventory_exceptions (company_id, plant_id, status, opened_at desc);

-- -------------------------------------------------------------------- cost layers
create table if not exists cost_layers (
  layer_id             text primary key,
  company_id           text not null references companies(id),
  plant_id             text not null references plants(id),
  material_id          text not null references materials(id),
  quantity_received    numeric(14,3) not null check (quantity_received > 0),
  quantity_remaining   numeric(14,3) not null check (quantity_remaining >= 0),
  unit_cost            numeric(16,4) not null check (unit_cost >= 0),
  received_at          timestamptz not null default now(),
  expiry_date          date,
  linked_receipt_id    text references goods_receipts(id),
  source_movement_id   text references stock_movements(movement_id),
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  created_by           text
);

create index if not exists cost_layers_fifo_idx
  on cost_layers (company_id, plant_id, material_id, received_at)
  where quantity_remaining > 0;

-- ------------------------------------------------------------- RLS policies
do $$
declare
  t text;
begin
  foreach t in array array[
    'materials', 'supplier_contacts', 'purchase_requests', 'purchase_orders', 'po_items',
    'goods_receipts', 'receipt_items', 'stock_movements', 'inventory_snapshots',
    'inventory_exceptions', 'cost_layers'
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

-- --------------------------------------------------------- append-only ledger
create or replace function stock_movement_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'stock movement % is append-only: post a reversal instead', old.movement_id
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_stock_movement_append_only on stock_movements;
create trigger trg_stock_movement_append_only
  before update or delete on stock_movements
  for each row execute function stock_movement_append_only();

create or replace function material_inactive_not_deleted() returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    raise exception 'material % cannot be deleted: set status to inactive', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_material_inactive_not_deleted on materials;
create trigger trg_material_inactive_not_deleted
  before update on materials
  for each row execute function material_inactive_not_deleted();

-- ------------------------------------------------------------ touch triggers
drop trigger if exists trg_touch_materials on materials;
create trigger trg_touch_materials before update on materials
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_supplier_contacts on supplier_contacts;
create trigger trg_touch_supplier_contacts before update on supplier_contacts
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_purchase_requests on purchase_requests;
create trigger trg_touch_purchase_requests before update on purchase_requests
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_purchase_orders on purchase_orders;
create trigger trg_touch_purchase_orders before update on purchase_orders
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_po_items on po_items;
create trigger trg_touch_po_items before update on po_items
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_goods_receipts on goods_receipts;
create trigger trg_touch_goods_receipts before update on goods_receipts
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_inventory_exceptions on inventory_exceptions;
create trigger trg_touch_inventory_exceptions before update on inventory_exceptions
  for each row execute function touch_updated_at();

-- ------------------------------------------------- inventory rule catalogue
-- The module check is widened for the new rules. Every inventory rule is inserted with no
-- value and no source note: the limits are not specified in the supplied reference.
alter table rule_definitions drop constraint if exists rule_definitions_module_check;
alter table rule_definitions
  add constraint rule_definitions_module_check
  check (module in ('mix_design', 'batching', 'quality', 'fleet', 'inventory'));

create or replace function seed_rule_catalogue() returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted integer;
begin
  insert into public.rule_definitions (id, company_id, code, module, classification, unit, created_by, updated_by)
  select 'RUL-' || c.id || '-' || replace(v.code, '.', '_'),
         c.id, v.code, v.module, v.classification, v.unit, 'seed', 'seed'
    from public.companies c
    cross join (values
      ('mix.cementitious_min',              'mix_design', 'mandatory_failure',  'kg/m3'),
      ('mix.water_cement_ratio_max',        'mix_design', 'approval_required',  'ratio'),
      ('mix.yield_tolerance',               'mix_design', 'warning',            '%'),
      ('mix.approved_version_edit',         'mix_design', 'mandatory_failure',  ''),
      ('batch.water_ratio_max',             'batching',   'approval_required',  'ratio'),
      ('batch.moisture_window_hours',       'batching',   'mandatory_failure',  'h'),
      ('batch.scale_calibration',           'batching',   'engineering_hold',   ''),
      ('batch.cement_water_deviation',      'batching',   'approval_required',  '%'),
      ('batch.aggregate_deviation',         'batching',   'warning',            '%'),
      ('batch.yield_tolerance',             'batching',   'warning',            '%'),
      ('batch.scale_calibration_interval',  'batching',   'engineering_hold',   'h'),
      ('quality.strength_acceptance',       'quality',    'mandatory_failure',  'MPa'),
      ('quality.specimen_age_days',         'quality',    'approval_required',  'day'),
      ('quality.specimen_count',            'quality',    'warning',            'count'),
      ('quality.slump_acceptance',          'quality',    'approval_required',  'mm'),
      ('quality.temperature_acceptance',    'quality',    'approval_required',  'C'),
      ('quality.calibration_validity',      'quality',    'engineering_hold',   'h'),
      ('fleet.delivery_tolerance',          'fleet',      'warning',            '%'),
      ('dispatch.drum_age_limit',           'fleet',      'authorized_override', 'min'),
      ('fleet.volume_difference_band',      'fleet',      'approval_required',  '%'),
      ('fleet.site_wait_threshold',         'fleet',      'warning',            'min'),
      ('fleet.load_soft_limit_pct',         'fleet',      'warning',            '%'),
      ('fleet.drum_age_minutes',            'fleet',      'warning',            'min'),
      ('fleet.licence_grace_days',          'fleet',      'mandatory_failure',  'day'),
      ('inventory.reorder_level',           'inventory',  'warning',            'base unit'),
      ('inventory.safety_stock',            'inventory',  'warning',            'base unit'),
      ('inventory.unit_cost_band',          'inventory',  'approval_required',  '%'),
      ('inventory.moisture_window_hours',   'inventory',  'approval_required',  'h')
    ) as v(code, module, classification, unit)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on function seed_rule_catalogue() from public;
grant execute on function seed_rule_catalogue() to iconcrete_app;

select seed_rule_catalogue();

-- -------------------------------------------------------------------- privileges
grant select, insert, update, delete on materials to iconcrete_app;
grant select, insert, update, delete on supplier_contacts to iconcrete_app;
grant select, insert, update, delete on purchase_requests to iconcrete_app;
grant select, insert, update, delete on purchase_orders to iconcrete_app;
grant select, insert, update, delete on po_items to iconcrete_app;
grant select, insert, update, delete on goods_receipts to iconcrete_app;
grant select, insert, update, delete on receipt_items to iconcrete_app;
grant select, insert on stock_movements to iconcrete_app;
grant select, insert, update on inventory_snapshots to iconcrete_app;
grant select, insert, update on inventory_exceptions to iconcrete_app;
grant select, insert, update on cost_layers to iconcrete_app;
