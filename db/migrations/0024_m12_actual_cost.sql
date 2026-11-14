-- ICONCRETE M12 — actual cost per delivered m³.
--
-- One source of truth per input:
--   batch_components.actual_weight  -> material quantity (kg, or L converted to kg for water)
--   moisture_readings               -> aggregate surface moisture (no duplicate QC table)
--   purchase_invoice_items          -> material unit price history, normalised to kg/L
--   trips / trucks / drivers        -> transport distance, load, fuel, wait and assets
--   monthly_overheads               -> rent, administration and insurance
--
-- Every cost table is plant-scoped with the same tenant + restrictive plant policy used by
-- M3/M11. Money is numeric and converted to 2 decimals only at the API boundary; quantities
-- stay at their stored precision so the arithmetic is reproducible.

-- ------------------------------------------------------------- master-data extensions
alter table mix_design_versions
  add column if not exists density_kg_per_m3 numeric(10,3) not null default 2400
  check (density_kg_per_m3 > 0);

alter table trips
  add column if not exists distance_km numeric(10,2)
  check (distance_km is null or distance_km >= 0);

alter table trucks
  add column if not exists fuel_l_per_km numeric(10,4)
  check (fuel_l_per_km is null or fuel_l_per_km >= 0);
alter table trucks
  add column if not exists asset_cost numeric(18,2)
  check (asset_cost is null or asset_cost >= 0);
alter table trucks
  add column if not exists useful_life_months integer
  check (useful_life_months is null or useful_life_months > 0);
alter table trucks
  add column if not exists maintenance_cost_per_km numeric(12,4)
  check (maintenance_cost_per_km is null or maintenance_cost_per_km >= 0);

alter table drivers
  add column if not exists monthly_salary numeric(18,2)
  check (monthly_salary is null or monthly_salary >= 0);

-- --------------------------------------------------------------- cost settings
-- Effective-dated so a tariff change never rewrites history. A plant manager's read is
-- limited by plant_scope; only the latest effective row on/before the requested date is used.
create table if not exists cost_settings (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text not null references plants(id),
  setting_key    text not null check (char_length(btrim(setting_key)) between 1 and 64),
  value          numeric(18,6) not null check (value >= 0),
  unit           text not null default '' check (char_length(unit) <= 24),
  effective_from date not null default current_date,
  is_demo        boolean not null default false,
  note_ar        text not null default '',
  note_en        text not null default '',
  created_at     timestamptz not null default now(),
  created_by     text,
  unique (company_id, plant_id, setting_key, effective_from)
);

create index if not exists cost_settings_lookup_idx
  on cost_settings (company_id, plant_id, setting_key, effective_from desc);

-- ----------------------------------------------------------- material price history
-- price_per_unit is always EGP per base unit (kg for solids, L for liquids). The invoice
-- may price in tons or m³; source_unit keeps the original document unit for traceability.
create table if not exists material_prices (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text not null references plants(id),
  material_id       text not null references materials(id),
  price_per_unit    numeric(18,6) not null check (price_per_unit >= 0),
  base_unit         text not null check (base_unit in ('kg', 'L')),
  source_unit       text not null default 'kg',
  source_invoice_id text references purchase_invoices(id),
  effective_from    date not null default current_date,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  created_by        text
);

create unique index if not exists material_prices_source_idx
  on material_prices (company_id, plant_id, material_id, effective_from, source_invoice_id)
  where source_invoice_id is not null;
create index if not exists material_prices_lookup_idx
  on material_prices (company_id, plant_id, material_id, effective_from desc);

-- ---------------------------------------------------------------- monthly overhead
create table if not exists monthly_overheads (
  id          text primary key,
  company_id  text not null references companies(id),
  plant_id    text not null references plants(id),
  month_start date not null,
  rent        numeric(18,2) not null default 0 check (rent >= 0),
  admin       numeric(18,2) not null default 0 check (admin >= 0),
  insurance   numeric(18,2) not null default 0 check (insurance >= 0),
  other       numeric(18,2) not null default 0 check (other >= 0),
  is_demo     boolean not null default false,
  note_ar     text not null default '',
  note_en     text not null default '',
  created_at  timestamptz not null default now(),
  created_by  text,
  unique (company_id, plant_id, month_start),
  check (month_start = date_trunc('month', month_start)::date)
);

-- ------------------------------------------------------------------ batch totals
create table if not exists batch_costs (
  batch_id             text primary key references batches(id) on delete cascade,
  company_id           text not null references companies(id),
  plant_id             text not null references plants(id),
  order_id             text references orders(id),
  mix_version_id       text references mix_design_versions(id),
  billed_m3            numeric(12,3) not null default 0 check (billed_m3 >= 0),
  total_weight_kg      numeric(18,3) not null default 0 check (total_weight_kg >= 0),
  density_kg_per_m3    numeric(10,3) not null default 2400 check (density_kg_per_m3 > 0),
  yield_m3             numeric(12,3) not null default 0 check (yield_m3 >= 0),
  yield_variance_pct   numeric(10,4),
  material_cost        numeric(18,2) not null default 0,
  moisture_adjustment  numeric(18,2) not null default 0,
  production_cost      numeric(18,2) not null default 0,
  overhead_cost        numeric(18,2) not null default 0,
  total_cost           numeric(18,2) not null default 0,
  cost_per_m3          numeric(18,4),
  revenue              numeric(18,2) not null default 0,
  revenue_per_m3       numeric(18,4),
  margin_per_m3        numeric(18,4),
  status               text not null default 'incomplete'
                       check (status in ('complete', 'incomplete')),
  missing_fields       jsonb not null default '[]'::jsonb,
  computed_at          timestamptz not null default now()
);

create index if not exists batch_costs_tenant_idx
  on batch_costs (company_id, plant_id, computed_at desc);
create index if not exists batch_costs_order_idx on batch_costs (company_id, order_id);

create table if not exists batch_cost_lines (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text not null references plants(id),
  batch_id          text not null references batches(id) on delete cascade,
  line_type         text not null
                    check (line_type in ('material', 'moisture', 'electricity', 'fuel_loader',
                                         'labor', 'maintenance', 'depreciation')),
  material_id       text references materials(id),
  measured_qty      numeric(18,3),
  theoretical_qty   numeric(18,3),
  actual_qty        numeric(18,3),
  unit              text not null default 'kg',
  unit_price        numeric(18,6),
  cost_egp          numeric(18,2) not null default 0,
  moisture_pct      numeric(6,3) not null default 0,
  variance_pct      numeric(10,4),
  is_incomplete     boolean not null default false,
  missing_reason    text not null default '',
  created_at        timestamptz not null default now(),
  unique (batch_id, line_type, material_id)
);

create index if not exists batch_cost_lines_batch_idx
  on batch_cost_lines (company_id, batch_id);

-- --------------------------------------------------------------- trip cost lines
create table if not exists trip_cost_lines (
  trip_id                 text primary key references trips(id) on delete cascade,
  company_id              text not null references companies(id),
  plant_id                text not null references plants(id),
  order_id                text references orders(id),
  distance_km             numeric(10,2) not null default 0 check (distance_km >= 0),
  load_m3                 numeric(10,3) not null default 0 check (load_m3 >= 0),
  fuel_cost               numeric(18,2) not null default 0,
  driver_cost             numeric(18,2) not null default 0,
  depreciation_cost       numeric(18,2) not null default 0,
  maintenance_cost        numeric(18,2) not null default 0,
  waiting_cost            numeric(18,2) not null default 0,
  waiting_minutes         integer not null default 0 check (waiting_minutes >= 0),
  waiting_flagged         boolean not null default false,
  total_cost              numeric(18,2) not null default 0,
  cost_per_m3             numeric(18,4),
  status                  text not null default 'incomplete'
                          check (status in ('complete', 'incomplete')),
  missing_fields          jsonb not null default '[]'::jsonb,
  computed_at             timestamptz not null default now()
);

create index if not exists trip_cost_lines_tenant_idx
  on trip_cost_lines (company_id, plant_id, computed_at desc);

-- -------------------------------------------------------------------- rollups
-- dimension = order | customer | mix | plant | month. The source rows are always the
-- order snapshots, so a customer rollup cannot disagree with its orders.
create table if not exists cost_snapshots (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text not null references plants(id),
  dimension    text not null check (dimension in ('order', 'customer', 'mix', 'plant', 'month')),
  dimension_id text not null,
  period_start date not null,
  customer_id  text references customers(id),
  mix_id       text references mix_designs(id),
  revenue      numeric(18,2) not null default 0,
  cost         numeric(18,2) not null default 0,
  m3           numeric(14,3) not null default 0,
  margin       numeric(18,2) not null default 0,
  margin_pct   numeric(10,4),
  status       text not null default 'incomplete'
               check (status in ('complete', 'incomplete')),
  computed_at  timestamptz not null default now(),
  unique (company_id, plant_id, dimension, dimension_id, period_start)
);

create index if not exists cost_snapshots_report_idx
  on cost_snapshots (company_id, plant_id, dimension, period_start, margin);

-- -------------------------------------------------------------------- RLS + grants
do $$
declare
  t text;
begin
  foreach t in array array[
    'cost_settings', 'material_prices', 'monthly_overheads', 'batch_costs',
    'batch_cost_lines', 'trip_cost_lines', 'cost_snapshots'
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
    execute format('grant select, insert, update, delete on %I to iconcrete_app', t);
  end loop;
end $$;
