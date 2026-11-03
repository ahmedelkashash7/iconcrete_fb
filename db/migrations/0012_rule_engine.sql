-- ICONCRETE R1 — configurable rule engine (spec §26 rule classes, §68.A, §68.H).
--
-- One table holds the rules, one append-only stream holds every evaluation, one holds
-- every override. A rule with no value or no source note never passes: the pure engine in
-- src/core/rules.ts turns that state into `approval_required`. No numeric limit is seeded,
-- because the ECP 203-2007 Code file was not supplied; the seeded rows carry no value and
-- no source note on purpose.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id. Rules are company-wide
-- configuration, so there is no plant_scope policy here.

create table if not exists rule_definitions (
  id             text primary key,
  company_id     text not null references companies(id),
  code           text not null check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  module         text not null
                 check (module in ('mix_design', 'batching', 'quality', 'fleet')),
  classification text not null
                 check (classification in ('warning', 'mandatory_failure', 'approval_required',
                                           'engineering_hold', 'authorized_override')),
  value          numeric(14,4),
  unit           text not null default '',
  source_note    text not null default '',
  effective_from date not null default current_date,
  approved_by    text,
  status         text not null default 'active' check (status in ('active', 'retired')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  updated_by     text,
  version        integer not null default 1
);

create unique index if not exists rule_definitions_company_code_idx
  on rule_definitions (company_id, code);
create index if not exists rule_definitions_company_module_idx
  on rule_definitions (company_id, module, status);

-- Append-only: an evaluation is evidence of what the engine decided, never a draft.
create table if not exists rule_evaluations (
  id             bigserial primary key,
  company_id     text not null references companies(id),
  rule_id        text not null references rule_definitions(id),
  rule_code      text not null,
  entity_type    text not null check (char_length(btrim(entity_type)) between 1 and 64),
  entity_id      text not null check (char_length(btrim(entity_id)) between 1 and 128),
  input_snapshot jsonb not null default '{}'::jsonb,
  outcome        text not null
                 check (outcome in ('pass', 'warning', 'failure', 'approval_required',
                                    'engineering_hold', 'override_required')),
  evaluated_at   timestamptz not null default now(),
  evaluated_by   text
);

create index if not exists rule_evaluations_entity_idx
  on rule_evaluations (company_id, entity_type, entity_id, evaluated_at desc);

create table if not exists rule_overrides (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  rule_id     text not null references rule_definitions(id),
  rule_code   text not null,
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 64),
  entity_id   text not null check (char_length(btrim(entity_id)) between 1 and 128),
  actor       text not null check (char_length(btrim(actor)) between 1 and 128),
  reason      text not null check (char_length(btrim(reason)) >= 5),
  decided_at  timestamptz not null default now(),
  decision    text not null check (decision in ('approved', 'rejected'))
);

create index if not exists rule_overrides_entity_idx
  on rule_overrides (company_id, entity_type, entity_id, decided_at desc);

-- Re-runnable catalogue seeding: db:seed deletes the demo companies, so it calls this
-- function afterwards instead of duplicating the list in TypeScript.
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

-- -------------------------------------------------------- seeded catalogue
-- Values and source notes are deliberately empty: the reference was not supplied, so the
-- engine reports `approval_required` for every one of them until a level-5 user records a
-- value together with where it came from. Seeded before RLS is forced, because the owner
-- connection has no tenant context.
select seed_rule_catalogue();

-- ------------------------------------------------------------ RLS policies
do $$
declare
  t text;
begin
  foreach t in array array['rule_definitions', 'rule_evaluations', 'rule_overrides'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (company_id = app_current_company())
        with check (company_id = app_current_company())
    $f$, t);
  end loop;
end $$;

-- Append-only enforcement, independent of grants. The purge flag is set only by db:seed
-- (owner connection, maintenance); it is never set on a request connection.
create or replace function rule_stream_append_only() returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.rule_purge', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception '% is append-only', tg_table_name
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_rule_evaluations_append_only on rule_evaluations;
create trigger trg_rule_evaluations_append_only
  before update or delete on rule_evaluations
  for each row execute function rule_stream_append_only();

drop trigger if exists trg_rule_overrides_append_only on rule_overrides;
create trigger trg_rule_overrides_append_only
  before update or delete on rule_overrides
  for each row execute function rule_stream_append_only();

drop trigger if exists trg_touch_rule_definitions on rule_definitions;
create trigger trg_touch_rule_definitions before update on rule_definitions
  for each row execute function touch_updated_at();

-- -------------------------------------------------------------- privileges
grant select, insert, update on rule_definitions to iconcrete_app;
grant select, insert on rule_evaluations to iconcrete_app;
grant select, insert on rule_overrides to iconcrete_app;
grant usage, select on sequence rule_evaluations_id_seq to iconcrete_app;
grant usage, select on sequence rule_overrides_id_seq to iconcrete_app;
