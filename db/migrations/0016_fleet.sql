-- ICONCRETE M5 — fleet and dispatch (spec §fleet; ECP 203-2007 Code file not supplied, so no
-- clause number is attributed here and no limit is invented).
--
-- Lifecycles:
--   truck:      available -> assigned -> loading -> en_route -> at_site -> returning -> available
--               available|assigned -> maintenance -> available ; retired is terminal
--   assignment: proposed -> confirmed -> dispatched -> delivered -> closed ; cancelled
--   trip:       planned -> departed -> arrived -> returned ; aborted (reason required)
--
-- A second open trip for the same truck is refused by a partial unique index, and a manual GPS
-- correction is an authorized override that must carry an actor and a reason.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id plus a restrictive plant_scope
-- on every plant-scoped table.

create table if not exists trucks (
  id                   text primary key,
  company_id           text not null references companies(id),
  plant_id             text not null references plants(id),
  plate_no             text not null,
  capacity_m3          numeric(10,3) not null check (capacity_m3 > 0),
  mixer_type           text not null default 'drum'
                       check (mixer_type in ('drum', 'rear_discharge', 'front_discharge', 'other')),
  status               text not null default 'available'
                       check (status in ('available', 'assigned', 'loading', 'en_route', 'at_site',
                                         'returning', 'maintenance', 'retired')),
  odometer_km          numeric(12,1),
  ownership            text not null default 'owned' check (ownership in ('owned', 'rented', 'leased')),
  insurance_expires_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  created_by           text,
  updated_by           text,
  version              integer not null default 1
);

create unique index if not exists trucks_plate_idx
  on trucks (company_id, plate_no) where deleted_at is null;

create table if not exists drivers (
  id                 text primary key,
  company_id         text not null references companies(id),
  plant_id           text not null references plants(id),
  employee_ref       text,
  full_name          text not null,
  phone              text,
  licence_no         text not null,
  licence_class      text,
  licence_expires_at timestamptz,
  status             text not null default 'active' check (status in ('active', 'suspended', 'inactive')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  created_by         text,
  updated_by         text,
  version            integer not null default 1
);

create unique index if not exists drivers_licence_idx
  on drivers (company_id, licence_no) where deleted_at is null;

create table if not exists dispatch_assignments (
  id               text primary key,
  company_id       text not null references companies(id),
  plant_id         text not null references plants(id),
  order_id         text references orders(id),
  truck_id         text not null references trucks(id),
  driver_id        text not null references drivers(id),
  sequence_no      integer not null default 1,
  status           text not null default 'proposed'
                   check (status in ('proposed', 'confirmed', 'dispatched', 'delivered', 'closed', 'cancelled')),
  proposed_at      timestamptz not null default now(),
  confirmed_at     timestamptz,
  dispatched_at    timestamptz,
  closed_at        timestamptz,
  cancelled_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,
  updated_by       text,
  version          integer not null default 1
);

create index if not exists dispatch_assignments_tenant_idx
  on dispatch_assignments (company_id, plant_id, status, proposed_at desc);

create table if not exists trips (
  id                  text primary key,
  company_id          text not null references companies(id),
  plant_id            text not null references plants(id),
  assignment_id       text not null references dispatch_assignments(id) on delete cascade,
  truck_id            text not null references trucks(id),
  batch_id            text references batches(id),
  loaded_volume_m3    numeric(10,3),
  delivered_volume_m3 numeric(10,3),
  departed_at         timestamptz,
  arrived_at          timestamptz,
  returned_at         timestamptz,
  site_wait_minutes   integer,
  volume_diff_reason  text,
  status              text not null default 'planned'
                      check (status in ('planned', 'departed', 'arrived', 'returned', 'aborted')),
  aborted_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          text,
  updated_by          text,
  version             integer not null default 1
);

-- One open trip per truck: the second dispatch is refused by the database, not only the service.
create unique index if not exists trips_open_per_truck_idx
  on trips (company_id, truck_id) where status in ('planned', 'departed', 'arrived');

create index if not exists trips_tenant_idx on trips (company_id, plant_id, status, departed_at desc);

create table if not exists truck_maintenance (
  id               text primary key,
  company_id       text not null references companies(id),
  plant_id         text not null references plants(id),
  truck_id         text not null references trucks(id),
  maintenance_type text not null,
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  odometer_km      numeric(12,1),
  cost_amount      numeric(12,2),
  notes            text,
  status           text not null default 'open' check (status in ('open', 'closed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,
  updated_by       text,
  version          integer not null default 1
);

create index if not exists truck_maintenance_truck_idx
  on truck_maintenance (company_id, truck_id, status, opened_at desc);

create table if not exists gps_positions (
  id               text primary key,
  company_id       text not null references companies(id),
  plant_id         text not null references plants(id),
  truck_id         text not null references trucks(id),
  lat              numeric(9,6) not null,
  lng              numeric(9,6) not null,
  recorded_at      timestamptz not null default now(),
  source           text not null default 'mock' check (source in ('mock', 'manual', 'device')),
  correction_reason text,
  created_at       timestamptz not null default now(),
  created_by       text
);

create index if not exists gps_positions_truck_idx
  on gps_positions (company_id, truck_id, recorded_at desc);

-- Append-only evidence for dispatch decisions (volume band, manual GPS, drum age).
create table if not exists dispatch_overrides (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  rule_id     text not null references rule_definitions(id),
  rule_code   text not null,
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 64),
  entity_id   text not null check (char_length(btrim(entity_id)) between 1 and 128),
  actor       text not null check (char_length(btrim(actor)) between 1 and 128),
  reason      text not null check (char_length(btrim(reason)) >= 5),
  decision    text not null check (decision in ('approved', 'rejected')),
  decided_at  timestamptz not null default now()
);

create index if not exists dispatch_overrides_entity_idx
  on dispatch_overrides (company_id, entity_id, decided_at desc);

-- ------------------------------------------------------------- RLS policies
do $$
declare
  t text;
begin
  foreach t in array array[
    'trucks', 'drivers', 'dispatch_assignments', 'trips', 'truck_maintenance',
    'gps_positions', 'dispatch_overrides'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (company_id = app_current_company())
        with check (company_id = app_current_company())
    $f$, t);
  end loop;

  foreach t in array array[
    'trucks', 'drivers', 'dispatch_assignments', 'trips', 'truck_maintenance', 'gps_positions'
  ] loop
    execute format('drop policy if exists plant_scope on %I', t);
    execute format($f$
      create policy plant_scope on %I as restrictive
        using (app_plant_allowed(plant_id)) with check (app_plant_allowed(plant_id))
    $f$, t);
  end loop;

  execute format('drop policy if exists plant_scope on dispatch_overrides');
  execute format($f$
    create policy plant_scope on dispatch_overrides as restrictive
      using (app_plant_allowed(
              (select plant_id from dispatch_assignments a where a.id = dispatch_overrides.entity_id)))
      with check (app_plant_allowed(
              (select plant_id from dispatch_assignments a where a.id = dispatch_overrides.entity_id)))
  $f$);
end $$;

-- ------------------------------------------------------- retired is terminal
create or replace function truck_retired_terminal() returns trigger
language plpgsql
as $$
begin
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'retired truck % cannot return to service', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_truck_retired_terminal on trucks;
create trigger trg_truck_retired_terminal
  before update on trucks
  for each row execute function truck_retired_terminal();

drop trigger if exists trg_touch_trucks on trucks;
create trigger trg_touch_trucks before update on trucks
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_drivers on drivers;
create trigger trg_touch_drivers before update on drivers
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_dispatch on dispatch_assignments;
create trigger trg_touch_dispatch before update on dispatch_assignments
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_trips on trips;
create trigger trg_touch_trips before update on trips
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------- fleet rule catalogue
-- Same idempotent function as 0012-0015, extended with the four M5 rules. Every one is inserted
-- with no value and no source note: ECP 203-2007 does not define them in the supplied reference,
-- so each stays configurable and an unconfigured rule never passes.
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
      ('fleet.licence_grace_days',          'fleet',      'mandatory_failure',  'day')
    ) as v(code, module, classification, unit)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on function seed_rule_catalogue() from public;
grant execute on function seed_rule_catalogue() to iconcrete_app;

select seed_rule_catalogue();

-- ------------------------------------------------------------------ privileges
grant select, insert, update, delete on trucks to iconcrete_app;
grant select, insert, update, delete on drivers to iconcrete_app;
grant select, insert, update, delete on dispatch_assignments to iconcrete_app;
grant select, insert, update, delete on trips to iconcrete_app;
grant select, insert, update, delete on truck_maintenance to iconcrete_app;
grant select, insert, delete on gps_positions to iconcrete_app;
grant select, insert on dispatch_overrides to iconcrete_app;
grant usage, select on sequence dispatch_overrides_id_seq to iconcrete_app;
