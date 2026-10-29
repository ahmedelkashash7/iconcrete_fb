-- ICONCRETE M1 — durable authentication, sessions and audit (Checkpoint 3 + 4).
--
-- Authentication happens before any tenant context exists, so the application role
-- cannot read `users`, `sessions` or `audit_log` directly (they are protected by RLS).
-- Instead a small, explicit surface of SECURITY DEFINER functions is exposed:
--
--   * every function pins search_path to (pg_catalog, public) and schema-qualifies
--     every object, so a caller cannot shadow a table or function;
--   * EXECUTE is revoked from PUBLIC and granted only to iconcrete_app;
--   * inputs are validated (lengths, non-empty ids, numeric ranges) inside the function;
--   * only one-way session token hashes are stored — raw tokens never reach the database;
--   * audit rows never carry passwords or tokens (callers pass structured details and
--     the function strips nothing, so the repository never sends such fields).

-- --------------------------------------------------------------- user lookup
create or replace function auth_find_user(p_company_id text, p_username text)
returns table (
  id text,
  company_id text,
  username text,
  password_hash text,
  full_name_ar text,
  full_name_en text,
  email text,
  phone text,
  role_level integer,
  assigned_plant_ids text[],
  is_active boolean,
  last_login_at timestamptz,
  failed_login_attempts integer,
  locked_until timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select u.id, u.company_id, u.username, u.password_hash, u.full_name_ar, u.full_name_en,
         u.email, u.phone, u.role_level, u.assigned_plant_ids, u.is_active,
         u.last_login_at, u.failed_login_attempts, u.locked_until
    from public.users u
   where nullif(trim(p_company_id), '') is not null
     and char_length(p_company_id) <= 64
     and char_length(coalesce(p_username, '')) between 1 and 128
     and u.company_id = p_company_id
     and u.deleted_at is null
     and lower(u.username) = lower(trim(p_username))
   limit 1
$$;

-- ------------------------------------------------------- failed login / lockout
create or replace function auth_login_failed(
  p_user_id text,
  p_max_attempts integer,
  p_lockout_minutes integer
)
returns table (failed_attempts integer, locked_until timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempts integer;
  v_locked timestamptz;
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 5), 50));
  v_minutes integer := greatest(1, least(coalesce(p_lockout_minutes, 15), 1440));
begin
  update public.users
     set failed_login_attempts = failed_login_attempts + 1
   where id = p_user_id
  returning failed_login_attempts into v_attempts;

  if v_attempts is null then
    return query select 0, null::timestamptz;
    return;
  end if;

  if v_attempts >= v_max then
    v_locked := now() + make_interval(mins => v_minutes);
    update public.users
       set locked_until = v_locked, failed_login_attempts = 0
     where id = p_user_id;
    v_attempts := 0;
  end if;

  return query select v_attempts, v_locked;
end $$;

create or replace function auth_login_succeeded(p_user_id text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.users
     set failed_login_attempts = 0, locked_until = null, last_login_at = now()
   where id = p_user_id
$$;

-- ---------------------------------------------------------------- new session
create or replace function auth_create_session(
  p_id text,
  p_company_id text,
  p_user_id text,
  p_token_hash text,
  p_ip text,
  p_device text,
  p_idle_minutes integer
)
returns table (expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expires timestamptz;
  v_minutes integer := greatest(1, least(coalesce(p_idle_minutes, 30), 1440));
begin
  if nullif(trim(p_id), '') is null or nullif(trim(p_token_hash), '') is null then
    raise exception 'auth_create_session requires an id and a token hash'
      using errcode = 'invalid_parameter_value';
  end if;
  if char_length(p_token_hash) <> 64 then
    raise exception 'session token hash must be a sha256 hex digest'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (
    select 1 from public.users u
     where u.id = p_user_id and u.company_id = p_company_id and u.deleted_at is null and u.is_active
  ) then
    raise exception 'cannot open a session for an unknown or inactive user'
      using errcode = 'invalid_parameter_value';
  end if;

  v_expires := now() + make_interval(mins => v_minutes);

  insert into public.sessions (
    id, company_id, user_id, token_hash, ip_address, device_info,
    created_at, last_seen_at, expires_at, revoked_at
  ) values (
    p_id, p_company_id, p_user_id, p_token_hash,
    left(coalesce(p_ip, ''), 64), left(coalesce(p_device, ''), 256),
    now(), now(), v_expires, null
  );

  return query select v_expires;
end $$;

-- ------------------------------------------------------ session validation
-- Returns the session and the safe user payload, applies the sliding idle expiry,
-- and refuses revoked, expired, inactive or cross-company sessions.
create or replace function auth_resolve_session(p_token_hash text, p_idle_minutes integer)
returns table (
  session_id text,
  user_id text,
  company_id text,
  expires_at timestamptz,
  user_data jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_minutes integer := greatest(1, least(coalesce(p_idle_minutes, 30), 1440));
  v_session public.sessions%rowtype;
  v_user public.users%rowtype;
begin
  if p_token_hash is null or char_length(p_token_hash) <> 64 then
    return;
  end if;

  select * into v_session
    from public.sessions s
   where s.token_hash = p_token_hash
     and s.revoked_at is null
     and s.expires_at > now()
   limit 1;

  if not found then
    return;
  end if;

  select * into v_user
    from public.users u
   where u.id = v_session.user_id
     and u.company_id = v_session.company_id
     and u.deleted_at is null
     and u.is_active
   limit 1;

  if not found then
    return;
  end if;

  update public.sessions
     set last_seen_at = now(),
         expires_at = now() + make_interval(mins => v_minutes)
   where id = v_session.id;

  return query select
    v_session.id,
    v_user.id,
    v_user.company_id,
    now() + make_interval(mins => v_minutes),
    jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'full_name_ar', v_user.full_name_ar,
      'full_name_en', v_user.full_name_en,
      'email', v_user.email,
      'phone', v_user.phone,
      'role_level', v_user.role_level,
      'company_id', v_user.company_id,
      'assigned_plant_ids', to_jsonb(v_user.assigned_plant_ids),
      'is_active', v_user.is_active,
      'last_login_at', v_user.last_login_at
    );
end $$;

-- -------------------------------------------------------- revocation / expiry
create or replace function auth_revoke_session(p_token_hash text)
returns table (session_id text, user_id text, company_id text, username text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with revoked as (
    update public.sessions s
       set revoked_at = now()
     where s.token_hash = p_token_hash
       and s.revoked_at is null
    returning s.id, s.user_id, s.company_id
  )
  select r.id, r.user_id, r.company_id, u.username
    from revoked r
    join public.users u on u.id = r.user_id
$$;

-- Marks an already-expired session as closed so its audit trail is explicit.
create or replace function auth_expire_session(p_token_hash text)
returns table (session_id text, user_id text, company_id text, username text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with expired as (
    update public.sessions s
       set revoked_at = coalesce(s.revoked_at, now())
     where s.token_hash = p_token_hash
       and s.expires_at <= now()
    returning s.id, s.user_id, s.company_id
  )
  select e.id, e.user_id, e.company_id, u.username
    from expired e
    join public.users u on u.id = e.user_id
$$;

-- ------------------------------------------------------------------- audit
-- Written through a definer function so authentication events exist before (and
-- without) a tenant context. Passwords and session tokens are never parameters.
create or replace function auth_audit(
  p_company_id text,
  p_plant_id text,
  p_user_id text,
  p_username text,
  p_action text,
  p_table text,
  p_record_id text,
  p_ip text,
  p_user_agent text,
  p_request_id text,
  p_result text,
  p_details jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id bigint;
begin
  if nullif(trim(coalesce(p_action, '')), '') is null then
    raise exception 'audit action is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_action !~ '^[a-z][a-z0-9_.]{2,63}$' then
    raise exception 'audit action must be a lowercase dotted event name'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.audit_log (
    company_id, plant_id, user_id, username, action, table_name, record_id,
    ip_address, user_agent, request_id, details
  ) values (
    nullif(trim(coalesce(p_company_id, '')), ''),
    nullif(trim(coalesce(p_plant_id, '')), ''),
    nullif(trim(coalesce(p_user_id, '')), ''),
    left(coalesce(p_username, ''), 128),
    p_action,
    left(coalesce(p_table, ''), 64),
    left(coalesce(p_record_id, ''), 128),
    left(coalesce(p_ip, ''), 64),
    left(coalesce(p_user_agent, ''), 256),
    left(coalesce(p_request_id, ''), 128),
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('result', coalesce(p_result, 'success'))
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function auth_list_audit(p_company_id text, p_limit integer)
returns table (
  id text,
  created_at timestamptz,
  company_id text,
  plant_id text,
  user_id text,
  username text,
  action text,
  table_name text,
  record_id text,
  ip_address text,
  request_id text,
  details jsonb
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select a.id::text, a.created_at, a.company_id, a.plant_id, a.user_id, a.username,
         a.action, a.table_name, a.record_id, a.ip_address, a.request_id, a.details
    from public.audit_log a
   where nullif(trim(coalesce(p_company_id, '')), '') is not null
     and a.company_id = p_company_id
   order by a.created_at desc, a.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

-- -------------------------------------------------------------- privileges
do $$
declare
  f text;
begin
  foreach f in array array[
    'auth_find_user(text, text)',
    'auth_login_failed(text, integer, integer)',
    'auth_login_succeeded(text)',
    'auth_create_session(text, text, text, text, text, text, integer)',
    'auth_resolve_session(text, integer)',
    'auth_revoke_session(text)',
    'auth_expire_session(text)',
    'auth_audit(text, text, text, text, text, text, text, text, text, text, text, jsonb)',
    'auth_list_audit(text, integer)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to iconcrete_app', f);
  end loop;
end $$;

-- Audit rows must never be edited or deleted through the application connection.
-- Demo seeding / local maintenance may purge them by setting app.audit_purge for the
-- transaction, which is never set on a request connection.
-- (The application role is iconcrete_app; the purge flag is only set by db:seed.)
create or replace function protect_audit_log() returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.audit_purge', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'audit_log is append-only'
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_audit_append_only on audit_log;
create trigger trg_audit_append_only
  before update or delete on audit_log
  for each row execute function protect_audit_log();
