-- ICONCRETE M2 — mix designs (spec §14 mix design, §68.A, §68.H).
--
-- Lifecycle: draft → submitted → approved → superseded. An approved version is never
-- edited: the change path supersedes it and creates a new draft version, recording the
-- override in rule_overrides (R1) and in the audit log with actor, reason, time, rule id
-- and decision. The repository refuses edits, and a trigger refuses them to direct SQL too.
--
-- A non-positive quantity is a rule outcome (mandatory_failure), not a silent constraint:
-- the service reports the classification and nothing is corrected behind the user's back.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id for all four tables,
-- plus a restrictive plant_scope on mix_designs. Component, version and strength-test rows
-- are always read through their design, so the plant check stays in one place.

create table if not exists mix_designs (
  id              text primary key,
  company_id      text not null references companies(id),
  plant_id        text not null references plants(id),
  code            text not null,
  name_ar         text not null default '',
  name_en         text not null default '',
  -- The version the plant works from: the approved one when it exists, otherwise the
  -- newest draft. Maintained by the repository on approve and supersede.
  current_version integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text,
  updated_by      text,
  version         integer not null default 1
);

create unique index if not exists mix_designs_company_code_idx
  on mix_designs (company_id, lower(code));
create index if not exists mix_designs_company_plant_idx on mix_designs (company_id, plant_id);

create table if not exists mix_design_versions (
  id             text primary key,
  company_id     text not null references companies(id),
  mix_id         text not null references mix_designs(id) on delete cascade,
  version_no     integer not null check (version_no >= 1),
  status         text not null default 'draft'
                 check (status in ('draft', 'submitted', 'approved', 'superseded')),
  strength_class text not null default '',
  notes          text not null default '',
  approved_by    text,
  approved_at    timestamptz,
  -- Derived from status, so "approved means immutable" cannot drift from the lifecycle.
  immutable      boolean generated always as (status in ('approved', 'superseded')) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  updated_by     text,
  version        integer not null default 1
);

create unique index if not exists mix_design_versions_mix_no_idx
  on mix_design_versions (mix_id, version_no);
create index if not exists mix_design_versions_company_idx
  on mix_design_versions (company_id, status);

create table if not exists mix_components (
  id             text primary key,
  company_id     text not null references companies(id),
  version_id     text not null references mix_design_versions(id) on delete cascade,
  -- Reference to the materials module, which has no durable table yet; stored as text.
  material_id    text not null,
  role           text not null default '',
  qty_per_m3     numeric(12,3) not null,
  unit           text not null default 'kg',
  moisture_basis text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists mix_components_version_idx on mix_components (company_id, version_id);

create table if not exists mix_strength_tests (
  id             text primary key,
  company_id     text not null references companies(id),
  version_id     text not null references mix_design_versions(id) on delete cascade,
  age_days       integer not null,
  target_min_mpa numeric(8,2),
  source_note    text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists mix_strength_tests_version_idx
  on mix_strength_tests (company_id, version_id);

-- ------------------------------------------------------------ RLS policies
do $$
declare
  t text;
begin
  foreach t in array array['mix_designs', 'mix_design_versions', 'mix_components', 'mix_strength_tests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (company_id = app_current_company())
        with check (company_id = app_current_company())
    $f$, t);
  end loop;

  execute format('drop policy if exists plant_scope on mix_designs');
  execute format($f$
    create policy plant_scope on mix_designs as restrictive
      using (app_plant_allowed(plant_id))
      with check (app_plant_allowed(plant_id))
  $f$);
end $$;

-- --------------------------------------------------- approved versions are immutable
-- Blocks UPDATE only: content of an approved or superseded version can never change, and
-- the single lifecycle write (approved → superseded) may change nothing else. DELETE stays
-- possible so db:seed can remove its own demo data; the repository still refuses to delete
-- a design that carries an approved version.
create or replace function mix_version_immutable() returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'mix_design_versions' then
    if old.immutable then
      if not (
        old.status = 'approved'
        and new.status = 'superseded'
        and new.company_id = old.company_id
        and new.mix_id = old.mix_id
        and new.version_no = old.version_no
        and new.strength_class = old.strength_class
        and new.notes = old.notes
        and new.approved_by = old.approved_by
        and new.approved_at = old.approved_at
      ) then
        raise exception 'approved mix version % is immutable', old.id
          using errcode = 'restrict_violation';
      end if;
      return new;
    end if;
    return new;
  end if;

  if exists (
    select 1 from mix_design_versions v
     where v.id = old.version_id and v.status in ('approved', 'superseded')
  ) then
    raise exception 'content of mix version % is immutable', old.version_id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_mix_design_versions_immutable on mix_design_versions;
create trigger trg_mix_design_versions_immutable
  before update on mix_design_versions
  for each row execute function mix_version_immutable();

drop trigger if exists trg_mix_components_immutable on mix_components;
create trigger trg_mix_components_immutable
  before update on mix_components
  for each row execute function mix_version_immutable();

drop trigger if exists trg_mix_strength_tests_immutable on mix_strength_tests;
create trigger trg_mix_strength_tests_immutable
  before update on mix_strength_tests
  for each row execute function mix_version_immutable();

drop trigger if exists trg_touch_mix_designs on mix_designs;
create trigger trg_touch_mix_designs before update on mix_designs
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_mix_design_versions on mix_design_versions;
create trigger trg_touch_mix_design_versions before update on mix_design_versions
  for each row execute function touch_updated_at();

-- ---------------------------------------------------- catalogue rule for M2
-- Same idempotent function as 0012, redefined with the one rule M2 consumes: changing an
-- approved version is a mandatory_failure that a level-5 user may override, and the
-- override is recorded in rule_overrides with all five fields. No value and no source
-- note, like every other seeded rule: configurable until the reference is supplied.
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
      ('mix.cementitious_min',        'mix_design', 'mandatory_failure',  'kg/m3'),
      ('mix.water_cement_ratio_max',  'mix_design', 'approval_required',  'ratio'),
      ('mix.yield_tolerance',         'mix_design', 'warning',            '%'),
      ('mix.approved_version_edit',   'mix_design', 'mandatory_failure',  ''),
      ('batch.water_ratio_max',       'batching',   'approval_required',  'ratio'),
      ('batch.moisture_window_hours', 'batching',   'mandatory_failure',  'h'),
      ('batch.scale_calibration',     'batching',   'engineering_hold',   ''),
      ('quality.strength_acceptance', 'quality',    'mandatory_failure',  'MPa'),
      ('quality.specimen_age_days',   'quality',    'approval_required',  'day'),
      ('fleet.delivery_tolerance',    'fleet',      'warning',            '%'),
      ('dispatch.drum_age_limit',     'fleet',      'authorized_override', 'min')
    ) as v(code, module, classification, unit)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on function seed_rule_catalogue() from public;
grant execute on function seed_rule_catalogue() to iconcrete_app;

-- Reruns the catalogue so companies that already exist gain the M2 rule too.
select seed_rule_catalogue();

-- -------------------------------------------------------------- privileges
grant select, insert, update, delete on mix_designs to iconcrete_app;
grant select, insert, update, delete on mix_design_versions to iconcrete_app;
grant select, insert, update, delete on mix_components to iconcrete_app;
grant select, insert, update, delete on mix_strength_tests to iconcrete_app;
