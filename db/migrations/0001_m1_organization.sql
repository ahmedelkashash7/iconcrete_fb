-- ICONCRETE M1 — organization, identity, sessions and audit.
-- All timestamps are UTC (timestamptz). All tenant tables carry company_id.
-- Business rules that must survive any client are enforced here, not in TypeScript.

-- gen_random_uuid() is built into PostgreSQL 13+; no extension is required.

-- ---------------------------------------------------------------- companies
create table if not exists companies (
  id            text primary key,
  name_ar       text not null,
  name_en       text not null,
  tax_id        text not null default '',
  currency      char(3) not null default 'EGP',
  timezone      text not null default 'Africa/Cairo',
  logo_doc_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1
);

-- ------------------------------------------------------------------- plants
create table if not exists plants (
  id                  text primary key,
  company_id          text not null references companies(id),
  name_ar             text not null,
  name_en             text not null,
  city                text not null default '',
  capacity_m3_per_hour numeric(10,2) not null default 0,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  created_by          text,
  updated_by          text,
  version             integer not null default 1
);
create index if not exists plants_company_idx on plants (company_id);

-- -------------------------------------------------------------------- users
create table if not exists users (
  id                    text primary key,
  company_id            text not null references companies(id),
  username              text not null,
  password_hash         text not null,
  full_name_ar          text not null,
  full_name_en          text not null,
  email                 text not null default '',
  phone                 text not null default '',
  role_level            integer not null check (role_level between 1 and 5),
  assigned_plant_ids    text[] not null default '{}',
  is_active             boolean not null default true,
  last_login_at         timestamptz,
  failed_login_attempts integer not null default 0,
  locked_until          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  created_by            text,
  updated_by            text,
  version               integer not null default 1
);
create unique index if not exists users_company_username_idx
  on users (company_id, lower(username)) where deleted_at is null;
create index if not exists users_company_idx on users (company_id);

-- ------------------------------------------------------ roles / permissions
create table if not exists roles (
  id          text primary key,
  company_id  text references companies(id),
  code        text not null,
  name_ar     text not null,
  name_en     text not null,
  role_level  integer not null check (role_level between 1 and 5),
  is_system   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  text,
  updated_by  text,
  version     integer not null default 1
);
create unique index if not exists roles_company_code_idx on roles (company_id, code);

create table if not exists permissions (
  id          text primary key,
  code        text not null unique,
  name_ar     text not null,
  name_en     text not null,
  module      text not null default 'core',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists user_roles (
  user_id     text not null references users(id) on delete cascade,
  role_id     text not null references roles(id) on delete cascade,
  company_id  text not null references companies(id),
  created_at  timestamptz not null default now(),
  created_by  text,
  primary key (user_id, role_id)
);
create index if not exists user_roles_company_idx on user_roles (company_id);

create table if not exists role_permissions (
  role_id       text not null references roles(id) on delete cascade,
  permission_id text not null references permissions(id) on delete cascade,
  company_id    text references companies(id),
  created_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- ----------------------------------------------------------------- sessions
create table if not exists sessions (
  id           text primary key,
  company_id   text not null references companies(id),
  user_id      text not null references users(id) on delete cascade,
  token_hash   text not null unique,
  ip_address   text not null default '',
  device_info  text not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

-- ---------------------------------------------------------------- audit_log
create table if not exists audit_log (
  id             bigserial primary key,
  company_id     text references companies(id),
  plant_id       text,
  user_id        text,
  username       text,
  action         text not null,
  table_name     text not null default '',
  record_id      text,
  ip_address     text,
  user_agent     text,
  request_id     text,
  before_data    jsonb,
  after_data     jsonb,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists audit_company_created_idx on audit_log (company_id, created_at desc);
create index if not exists audit_action_idx on audit_log (action);

-- --------------------------------------------------- staged Excel imports
create table if not exists staged_imports (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text,
  template_id       text not null,
  template_version  text not null,
  schema_version    text not null default '1.1.0',
  file_name         text not null,
  checksum          text not null,
  byte_size         integer not null,
  result            jsonb not null,
  committed         boolean not null default false,
  imported_rows     integer not null default 0,
  created_at        timestamptz not null default now(),
  created_by        text,
  updated_at        timestamptz not null default now(),
  version           integer not null default 1
);
create index if not exists staged_imports_company_idx on staged_imports (company_id, created_at desc);
create unique index if not exists staged_imports_checksum_idx
  on staged_imports (company_id, template_id, checksum);

create table if not exists import_records (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text,
  staged_id    text references staged_imports(id),
  template_id  text not null,
  values       jsonb not null,
  imported_by  text,
  imported_at  timestamptz not null default now()
);
create index if not exists import_records_company_idx on import_records (company_id, template_id);
