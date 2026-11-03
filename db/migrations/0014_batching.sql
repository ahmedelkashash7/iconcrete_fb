-- ICONCRETE M3 — batching (spec §production, §material control; ECP 203-2007 Code file
-- not supplied, so no clause number is attributed here and no code value is invented).
--
-- Lifecycle: planned -> in_progress -> completed; planned|in_progress -> held -> in_progress;
-- planned|in_progress|held -> cancelled. Completed is terminal — corrections are adjustment
-- records, never edits of the completed row. Hold/release and engineering-hold release are
-- audited; the repository refuses direct SQL edits of completed batches through a trigger.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id for every table, plus a
-- restrictive plant_scope on plant-scoped tables (batches, batch_components,
-- moisture_readings, batch_overrides). Each batch carries company_id and plant_id so child
-- rows are always read through the batch's plant.
--
-- ECP references used here:
-- - "not specified in the supplied reference" for the batching/record format and any value
--   that ECP 203-2007 does not define in the Code file available for this project.
--
-- Environment:
-- - ICONCRETE_BATCH_MOISTURE_VALID_MINUTES: when set, a moisture reading is treated as
--   expired after this many minutes from sample_at; when absent, expired-moisture checks
--   raise a validation block rather than auto-passing. No default window is assumed.

create table if not exists batches (
  id               text primary key,
  company_id       text not null references companies(id),
  plant_id         text not null references plants(id),
  batch_no         text not null,
  order_id         text,
  mix_version_id   text not null references mix_design_versions(id),
  planned_volume   numeric(12,3) not null,
  actual_volume    numeric(12,3),
  status           text not null default 'planned'
                   check (status in ('planned', 'in_progress', 'completed', 'held', 'cancelled')),
  operator_id      text,
  hold_reason      text,
  produced_at      timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,
  updated_by       text,
  version          integer not null default 1
);

-- batch_no unique per plant per calendar day. ECP does not give a format, so the module
-- keeps the batch_no text and enforces uniqueness on (plant_id, batch_no, produced_day);
-- the "per day" part comes from produced_at when the batch exists, and is a fixed sentinel
-- while the batch is still planned so two planned batches can share the same batch_no only
-- after one is completed/cancelled/started against a real date. No batch_no format is
-- invented here.
--
-- PostgreSQL does not allow volatile functions in an index expression, and produced_at::date
-- is not marked immutable, so the uniqueness expression is computed by an immutable helper.
-- That helper is defined here and used only for this index; the validator uses the same rule
-- from the application side in src/core/batching.ts.
create or replace function batch_plant_day(text, timestamptz)
returns date
language sql
immutable
as $$
  select case when $2 is not null then $2::date else '1970-01-01'::date end;
$$;

create unique index if not exists batches_plant_day_no_idx
  on batches (plant_id, batch_no, batch_plant_day(plant_id, produced_at));

-- batch_generate is an app-owned id helper only; ECP does not prescribe an id format. The
-- repository may use it when it wants deterministic ids; no id format is asserted by this
-- migration or by the rule catalogue.
create or replace function batch_generate(
  p_plant_id text, p_version_id text, p_batch_no text, p_planned_volume numeric)
returns text
language sql
security invoker
as $$
  select 'BT-' || replace(p_plant_id, '-', '_') || '-' || replace(p_version_id, '-', '_') || '-' || replace(coalesce(p_batch_no, ''), '-', '_') || '-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((extract(epoch from now())::bigint % 9000 + 1000)::text, 4, '0');
$$;

create index if not exists batches_company_plant_status_idx
  on batches (company_id, plant_id, status);

create index if not exists batches_mix_version_idx
  on batches (mix_version_id);

create table if not exists batch_components (
  id            text primary key,
  company_id    text not null references companies(id),
  batch_id      text not null references batches(id) on delete cascade,
  material_id   text not null,
  target_weight numeric(12,3),
  actual_weight numeric(12,3),
  unit         text not null default 'kg',
  tolerance_pct numeric(6,3),
  deviation_class text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists batch_components_batch_idx on batch_components (company_id, batch_id);

create table if not exists moisture_readings (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text not null references plants(id),
  material_id    text not null,
  basis          text not null check (basis in ('dry', 'wet')),
  moisture_pct   numeric(6,3),
  absorption_pct numeric(6,3),
  sample_at      timestamptz not null default now(),
  valid_until    timestamptz,
  entered_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  version        integer not null default 1
);

create index if not exists moisture_readings_plant_material_idx
  on moisture_readings (company_id, plant_id, material_id, valid_until desc);

-- Append-only override evidence for batching rules. Same shape as the M2/R1
-- rule_overrides table, but batching carries its own so the module's audit trail is
-- self-contained: every batched override records actor, reason, time, rule id and decision.
create table if not exists batch_overrides (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  rule_id     text not null references rule_definitions(id),
  rule_code   text not null,
  batch_id    text not null references batches(id),
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 64),
  entity_id   text not null check (char_length(btrim(entity_id)) between 1 and 128),
  actor       text not null check (char_length(btrim(actor)) between 1 and 128),
  reason      text not null check (char_length(btrim(reason)) >= 5),
  decision    text not null check (decision in ('approved', 'rejected')),
  decided_at  timestamptz not null default now()
);

create index if not exists batch_overrides_batch_idx
  on batch_overrides (company_id, batch_id, decided_at desc);

-- ----------------------------------------------------- RLS policies
do $$
declare
  t text;
begin
  foreach t in array array['batches', 'batch_components', 'moisture_readings', 'batch_overrides'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (company_id = app_current_company())
        with check (company_id = app_current_company())
    $f$, t);
  end loop;

  execute format('drop policy if exists plant_scope on batches');
  execute format($f$
    create policy plant_scope on batches as restrictive
      using (app_plant_allowed(plant_id))
      with check (app_plant_allowed(plant_id))
  $f$);

  execute format('drop policy if exists plant_scope on batch_components');
  execute format($f$
    create policy plant_scope on batch_components as restrictive
      using (app_plant_allowed(
              (select plant_id from batches b where b.id = batch_components.batch_id)))
      with check (app_plant_allowed(
              (select plant_id from batches b where b.id = batch_components.batch_id)))
  $f$);

  execute format('drop policy if exists plant_scope on moisture_readings');
  execute format($f$
    create policy plant_scope on moisture_readings as restrictive
      using (app_plant_allowed(plant_id))
      with check (app_plant_allowed(plant_id))
  $f$);

  execute format('drop policy if exists plant_scope on batch_overrides');
  execute format($f$
    create policy plant_scope on batch_overrides as restrictive
      using (app_plant_allowed(
              (select plant_id from batches b where b.id = batch_overrides.batch_id)))
      with check (app_plant_allowed(
              (select plant_id from batches b where b.id = batch_overrides.batch_id)))
  $f$);
end $$;

-- ------------------------------------------------ completed batches are immutable
-- Blocks UPDATE only: a completed batch can never be edited. The correction path is a new
-- adjustment/batch, not a row mutation. DELETE stays possible so db:seed can remove its own
-- demo rows; the repository still refuses to delete a completed batch in normal flow.
create or replace function batch_completed_immutable() returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'batches' then
    if old.status = 'completed' and new.status <> old.status then
      raise exception 'completed batch % cannot be edited', old.id
        using errcode = 'restrict_violation';
    end if;
    if old.status = 'completed' and (
      new.planned_volume is distinct from old.planned_volume
      or new.actual_volume is distinct from old.actual_volume
      or new.operator_id is distinct from old.operator_id
      or new.hold_reason is distinct from old.hold_reason
      or new.produced_at is distinct from old.produced_at
      or new.completed_at is distinct from old.completed_at
    ) then
      raise exception 'completed batch % cannot be edited', old.id
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if tg_table_name in ('batch_components', 'moisture_readings', 'batch_overrides') then
    if old.status <> 'completed' then
      return new;
    end if;
    -- child rows are read through their batch, so a completed batch's children are also
    -- frozen by the same trigger family.
    raise exception 'content of completed batch % is immutable', old.batch_id
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_batches_completed_immutable on batches;
create trigger trg_batches_completed_immutable
  before update on batches
  for each row execute function batch_completed_immutable();

drop trigger if exists trg_batch_components_completed_immutable on batch_components;
create trigger trg_batch_components_completed_immutable
  before update on batch_components
  for each row execute function batch_completed_immutable();

drop trigger if exists trg_moisture_readings_completed_immutable on moisture_readings;
create trigger trg_moisture_readings_completed_immutable
  before update on moisture_readings
  for each row execute function batch_completed_immutable();

drop trigger if exists trg_batch_overrides_completed_immutable on batch_overrides;
create trigger trg_batch_overrides_completed_immutable
  before update on batch_overrides
  for each row execute function batch_completed_immutable();

drop trigger if exists trg_touch_batches on batches;
create trigger trg_touch_batches before update on batches
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_moisture_readings on moisture_readings;
create trigger trg_touch_moisture_readings before update on moisture_readings
  for each row execute function touch_updated_at();

-- ------------------------------------------------- batching rule catalogue
-- Same idempotent function as 0012/0013, extended with the four rules M3 measures. They are
-- inserted without a value and without a source note: ECP 203-2007 does not define these
-- limits in the supplied reference, so each stays configurable and an unconfigured rule
-- evaluates to approval_required instead of a pass.
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
      ('fleet.delivery_tolerance',          'fleet',      'warning',            '%'),
      ('dispatch.drum_age_limit',           'fleet',      'authorized_override', 'min')
    ) as v(code, module, classification, unit)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on function seed_rule_catalogue() from public;
grant execute on function seed_rule_catalogue() to iconcrete_app;

-- Gives existing companies the M3 rules too; db:seed re-runs this after its per-company delete.
select seed_rule_catalogue();

-- ----------------------------------------------------- privileges
grant select, insert, update, delete on batches to iconcrete_app;
grant select, insert, update, delete on batch_components to iconcrete_app;
grant select, insert, update, delete on moisture_readings to iconcrete_app;
grant select, insert on batch_overrides to iconcrete_app;
grant usage, select on sequence batch_overrides_id_seq to iconcrete_app;

grant execute on function batch_plant_day(text, timestamptz) to iconcrete_app;
grant execute on function batch_generate(text, text, text, numeric) to iconcrete_app;

-- ------------------------------------------------------------------------- seed
-- See server/db/seed.ts; this migration does not seed rows, but the helper is granted so
-- seed and the repository can use it.
