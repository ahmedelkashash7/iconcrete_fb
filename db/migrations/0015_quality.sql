-- ICONCRETE M4 — quality and laboratory (spec §quality; ECP 203-2007 Code file not supplied,
-- so no clause number is attributed here and no acceptance value is invented).
--
-- Lifecycles:
--   quality_tests: sampled -> testing -> passed | failed | inconclusive
--   ncr:           open -> investigation -> capa_open -> verification -> closed, or void
--   certificates:  draft -> issued -> revoked (revocation carries a reason)
--   equipment:     active -> out_of_service -> retired
--
-- A calibration that lapses puts its equipment out of service and raises an engineering hold on
-- any acceptance decision that depends on it; only a level-5 user releases that hold.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id everywhere plus a restrictive
-- plant_scope on plant-scoped tables. Child tables are read through their parent row.

create table if not exists lab_equipment (
  id                        text primary key,
  company_id                text not null references companies(id),
  plant_id                  text not null references plants(id),
  equipment_code            text not null,
  name                      text not null,
  serial                    text,
  status                    text not null default 'active'
                            check (status in ('active', 'out_of_service', 'retired')),
  calibration_interval_days integer,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  created_by                text,
  updated_by                text,
  version                   integer not null default 1
);

create unique index if not exists lab_equipment_code_idx
  on lab_equipment (company_id, equipment_code) where deleted_at is null;

create table if not exists equipment_calibrations (
  id              text primary key,
  company_id      text not null references companies(id),
  equipment_id    text not null references lab_equipment(id) on delete cascade,
  provider        text,
  calibrated_at   timestamptz not null,
  expires_at      timestamptz not null,
  certificate_ref text,
  result          text not null default 'pass' check (result in ('pass', 'fail')),
  status          text not null default 'valid' check (status in ('valid', 'expired', 'revoked')),
  created_at      timestamptz not null default now(),
  created_by      text
);

create index if not exists equipment_calibrations_equipment_idx
  on equipment_calibrations (company_id, equipment_id, expires_at desc);

create table if not exists trial_batches (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text not null references plants(id),
  mix_version_id text not null references mix_design_versions(id),
  batch_id       text references batches(id),
  purpose        text,
  result_summary text,
  status         text not null default 'planned'
                 check (status in ('planned', 'produced', 'tested', 'closed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  created_by     text,
  updated_by     text,
  version        integer not null default 1
);

create table if not exists quality_tests (
  id                      text primary key,
  company_id              text not null references companies(id),
  plant_id                text not null references plants(id),
  batch_id                text references batches(id),
  mix_version_id          text references mix_design_versions(id),
  test_type               text not null
                          check (test_type in ('slump', 'cube_strength', 'temperature', 'density', 'other')),
  sampled_at              timestamptz not null,
  tested_at               timestamptz,
  age_days                integer,
  result_value            numeric(12,3),
  result_unit             text,
  spec_min                numeric(12,3),
  spec_max                numeric(12,3),
  spec_source_note        text,
  required_specimen_count integer,
  equipment_id            text references lab_equipment(id),
  technician_id           text,
  verified_by             text,
  verified_at             timestamptz,
  status                  text not null default 'sampled'
                          check (status in ('sampled', 'testing', 'passed', 'failed', 'inconclusive')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  created_by              text,
  updated_by              text,
  version                 integer not null default 1
);

create index if not exists quality_tests_tenant_idx
  on quality_tests (company_id, plant_id, status, sampled_at desc);
create index if not exists quality_tests_batch_idx on quality_tests (company_id, batch_id);

create table if not exists specimens (
  id           text primary key,
  company_id   text not null references companies(id),
  test_id      text not null references quality_tests(id) on delete cascade,
  specimen_no  integer not null,
  cast_at      timestamptz,
  cured_until  timestamptz,
  result_value numeric(12,3),
  disposition  text not null default 'retained'
               check (disposition in ('retained', 'tested', 'discarded')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists specimens_no_idx on specimens (company_id, test_id, specimen_no);

create table if not exists ncr (
  id          text primary key,
  company_id  text not null references companies(id),
  plant_id    text not null references plants(id),
  test_id     text references quality_tests(id),
  batch_id    text references batches(id),
  severity    text not null check (severity in ('minor', 'major', 'critical')),
  description text not null check (char_length(btrim(description)) >= 10),
  containment text,
  root_cause  text,
  status      text not null default 'open'
              check (status in ('open', 'investigation', 'capa_open', 'verification', 'closed', 'void')),
  opened_by   text not null,
  opened_at   timestamptz not null default now(),
  closed_by   text,
  closed_at   timestamptz,
  void_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  version     integer not null default 1
);

-- One live NCR per test: a double-submitted failed result cannot open a second one.
create unique index if not exists ncr_one_per_test_idx
  on ncr (company_id, test_id) where test_id is not null and status <> 'void';

create index if not exists ncr_tenant_idx on ncr (company_id, plant_id, status, opened_at desc);

create table if not exists capa (
  id                  text primary key,
  company_id          text not null references companies(id),
  ncr_id              text not null references ncr(id) on delete cascade,
  action_type         text not null check (action_type in ('corrective', 'preventive')),
  description         text not null,
  owner_id            text,
  due_date            date,
  effectiveness_check text,
  verified_by         text,
  verified_at         timestamptz,
  status              text not null default 'open'
                      check (status in ('open', 'in_progress', 'done', 'verified')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          text,
  updated_by          text,
  version             integer not null default 1
);

create index if not exists capa_ncr_idx on capa (company_id, ncr_id, status);

create table if not exists certificates (
  id              text primary key,
  company_id      text not null references companies(id),
  plant_id        text not null references plants(id),
  test_id         text not null references quality_tests(id),
  certificate_no  text not null,
  issued_by       text not null,
  issued_at       timestamptz not null default now(),
  status          text not null default 'draft' check (status in ('draft', 'issued', 'revoked')),
  revoked_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text,
  version         integer not null default 1
);

create unique index if not exists certificates_no_idx on certificates (company_id, certificate_no);
create unique index if not exists certificates_live_test_idx
  on certificates (company_id, test_id) where status <> 'revoked';

-- ------------------------------------------------------------- RLS policies
do $$
declare
  t text;
begin
  foreach t in array array[
    'lab_equipment', 'equipment_calibrations', 'trial_batches', 'quality_tests',
    'specimens', 'ncr', 'capa', 'certificates'
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

  execute format('drop policy if exists plant_scope on lab_equipment');
  execute format($f$
    create policy plant_scope on lab_equipment as restrictive
      using (app_plant_allowed(plant_id)) with check (app_plant_allowed(plant_id))
  $f$);
  execute format('drop policy if exists plant_scope on trial_batches');
  execute format($f$
    create policy plant_scope on trial_batches as restrictive
      using (app_plant_allowed(plant_id)) with check (app_plant_allowed(plant_id))
  $f$);
  execute format('drop policy if exists plant_scope on quality_tests');
  execute format($f$
    create policy plant_scope on quality_tests as restrictive
      using (app_plant_allowed(plant_id)) with check (app_plant_allowed(plant_id))
  $f$);
  execute format('drop policy if exists plant_scope on ncr');
  execute format($f$
    create policy plant_scope on ncr as restrictive
      using (app_plant_allowed(plant_id)) with check (app_plant_allowed(plant_id))
  $f$);
  execute format('drop policy if exists plant_scope on certificates');
  execute format($f$
    create policy plant_scope on certificates as restrictive
      using (app_plant_allowed(plant_id)) with check (app_plant_allowed(plant_id))
  $f$);

  execute format('drop policy if exists plant_scope on specimens');
  execute format($f$
    create policy plant_scope on specimens as restrictive
      using (app_plant_allowed(
              (select plant_id from quality_tests q where q.id = specimens.test_id)))
      with check (app_plant_allowed(
              (select plant_id from quality_tests q where q.id = specimens.test_id)))
  $f$);
  execute format('drop policy if exists plant_scope on equipment_calibrations');
  execute format($f$
    create policy plant_scope on equipment_calibrations as restrictive
      using (app_plant_allowed(
              (select plant_id from lab_equipment e where e.id = equipment_calibrations.equipment_id)))
      with check (app_plant_allowed(
              (select plant_id from lab_equipment e where e.id = equipment_calibrations.equipment_id)))
  $f$);
  execute format('drop policy if exists plant_scope on capa');
  execute format($f$
    create policy plant_scope on capa as restrictive
      using (app_plant_allowed(
              (select plant_id from ncr n where n.id = capa.ncr_id)))
      with check (app_plant_allowed(
              (select plant_id from ncr n where n.id = capa.ncr_id)))
  $f$);
end $$;

-- ------------------------------------------- issued certificates are read-only
-- Content is frozen once issued. The only permitted change is revocation, and revocation
-- must carry a reason. A revoked certificate is terminal.
create or replace function quality_certificate_immutable() returns trigger
language plpgsql
as $$
begin
  if old.status = 'revoked' then
    raise exception 'revoked certificate % cannot be changed', old.id
      using errcode = 'restrict_violation';
  end if;

  if old.status = 'issued' then
    if new.status = 'draft' then
      raise exception 'issued certificate % cannot return to draft', old.id
        using errcode = 'restrict_violation';
    end if;
    if new.test_id is distinct from old.test_id
      or new.certificate_no is distinct from old.certificate_no
      or new.issued_by is distinct from old.issued_by
      or new.issued_at is distinct from old.issued_at then
      raise exception 'issued certificate % content is immutable', old.id
        using errcode = 'restrict_violation';
    end if;
    if new.status = 'revoked' and coalesce(btrim(new.revoked_reason), '') = '' then
      raise exception 'revoking certificate % requires a reason', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_quality_certificate_immutable on certificates;
create trigger trg_quality_certificate_immutable
  before update on certificates
  for each row execute function quality_certificate_immutable();

drop trigger if exists trg_touch_quality_tests on quality_tests;
create trigger trg_touch_quality_tests before update on quality_tests
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_ncr on ncr;
create trigger trg_touch_ncr before update on ncr
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_capa on capa;
create trigger trg_touch_capa before update on capa
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_lab_equipment on lab_equipment;
create trigger trg_touch_lab_equipment before update on lab_equipment
  for each row execute function touch_updated_at();

-- ------------------------------------------------------- quality rule catalogue
-- Same idempotent function as 0012-0014, extended with the four M4 rules. Every one is inserted
-- with no value and no source note: ECP 203-2007 does not define these limits in the supplied
-- reference, so each stays configurable and an unconfigured rule never passes.
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
      ('dispatch.drum_age_limit',           'fleet',      'authorized_override', 'min')
    ) as v(code, module, classification, unit)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on function seed_rule_catalogue() from public;
grant execute on function seed_rule_catalogue() to iconcrete_app;

select seed_rule_catalogue();

-- ---------------------------------------------------------------- privileges
grant select, insert, update, delete on lab_equipment to iconcrete_app;
grant select, insert, update, delete on equipment_calibrations to iconcrete_app;
grant select, insert, update, delete on trial_batches to iconcrete_app;
grant select, insert, update, delete on quality_tests to iconcrete_app;
grant select, insert, update, delete on specimens to iconcrete_app;
grant select, insert, update, delete on ncr to iconcrete_app;
grant select, insert, update, delete on capa to iconcrete_app;
grant select, insert, update on certificates to iconcrete_app;

grant execute on function quality_certificate_immutable() to iconcrete_app;
