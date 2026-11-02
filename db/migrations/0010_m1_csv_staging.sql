-- ICONCRETE B2 — CSV staging with an explicit preview → commit lifecycle.
--
-- An upload is parsed once, stored with its checksum and validation result, and can be
-- rejected, edited and re-validated before anything reaches a business table. Committed
-- rows stay as evidence; the UI never writes to customers directly.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id plus a restrictive
-- plant_scope using app_plant_allowed(plant_id).

create table if not exists csv_staging (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text,
  upload_timestamp  timestamptz not null default now(),
  file_hash         text not null,
  json_payload      jsonb not null,
  status            text not null default 'pending'
                    check (status in ('pending', 'rejected', 'committed')),
  error_details     jsonb not null default '[]'::jsonb,
  committed_at      timestamptz,
  committed_summary jsonb,
  created_by        text,
  updated_at        timestamptz not null default now()
);

create index if not exists csv_staging_company_idx
  on csv_staging (company_id, upload_timestamp desc);
create index if not exists csv_staging_status_idx
  on csv_staging (company_id, status);

-- The same file may be uploaded again only after the open attempt was committed.
create unique index if not exists csv_staging_open_hash_idx
  on csv_staging (company_id, file_hash) where status <> 'committed';

alter table csv_staging enable row level security;
alter table csv_staging force row level security;

drop policy if exists tenant_isolation on csv_staging;
create policy tenant_isolation on csv_staging
  using (company_id = app_current_company())
  with check (company_id = app_current_company());

drop policy if exists plant_scope on csv_staging;
create policy plant_scope on csv_staging as restrictive
  using (app_plant_allowed(plant_id))
  with check (app_plant_allowed(plant_id));

drop trigger if exists trg_touch_csv_staging on csv_staging;
create trigger trg_touch_csv_staging before update on csv_staging
  for each row execute function touch_updated_at();

grant select, insert, update, delete on csv_staging to iconcrete_app;
