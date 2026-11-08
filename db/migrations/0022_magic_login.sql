-- ICONCRETE — one-time magic login tokens (fallback for sandboxed previews).
-- Tokens are stored as SHA-256 hashes only and are consumed exactly once. The
-- application role has no table privileges; issuance and consumption go through
-- SECURITY DEFINER functions with a pinned search_path.

create table if not exists magic_login_tokens (
  token_hash  text primary key,
  user_id     text not null references users(id) on delete cascade,
  company_id  text not null references companies(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists magic_login_tokens_user_idx on magic_login_tokens (user_id, created_at desc);
create index if not exists magic_login_tokens_expiry_idx on magic_login_tokens (expires_at);

-- No tenant context exists before login, so the table is protected by RLS without
-- policies. The definer functions below are the only allowed access path.
alter table magic_login_tokens enable row level security;
revoke all on magic_login_tokens from iconcrete_app;

create or replace function auth_magic_issue(
  p_username text,
  p_token_hash text,
  p_company_hint text,
  p_ttl_minutes integer
)
returns table (user_id text, company_id text, username text, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user public.users%rowtype;
  v_count integer;
  v_expires timestamptz := now() + make_interval(mins => greatest(1, least(coalesce(p_ttl_minutes, 5), 60)));
begin
  if char_length(coalesce(p_token_hash, '')) <> 64 or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'magic token hash must be a sha256 hex digest'
      using errcode = 'invalid_parameter_value';
  end if;
  if nullif(trim(coalesce(p_username, '')), '') is null
     or char_length(p_username) > 128 then
    return;
  end if;

  select count(*) into v_count
    from public.users u
    join public.companies c on c.id = u.company_id and c.deleted_at is null
   where u.deleted_at is null
     and u.is_active
     and lower(u.username) = lower(trim(p_username))
     and (
       nullif(trim(coalesce(p_company_hint, '')), '') is null
       or c.id = trim(p_company_hint)
       or auth_company_key(c.name_ar) = auth_company_key(p_company_hint)
       or auth_company_key(c.name_en) = auth_company_key(p_company_hint)
     );

  if v_count <> 1 then
    return;
  end if;

  select u.* into v_user
    from public.users u
    join public.companies c on c.id = u.company_id and c.deleted_at is null
   where u.deleted_at is null
     and u.is_active
     and lower(u.username) = lower(trim(p_username))
     and (
       nullif(trim(coalesce(p_company_hint, '')), '') is null
       or c.id = trim(p_company_hint)
       or auth_company_key(c.name_ar) = auth_company_key(p_company_hint)
       or auth_company_key(c.name_en) = auth_company_key(p_company_hint)
     )
   limit 1;

  insert into magic_login_tokens (token_hash, user_id, company_id, created_at, expires_at, used_at)
  values (p_token_hash, v_user.id, v_user.company_id, now(), v_expires, null);

  return query select v_user.id, v_user.company_id, v_user.username, v_expires;
end $$;

create or replace function auth_magic_consume(
  p_magic_hash text,
  p_session_id text,
  p_session_hash text,
  p_ip text,
  p_device text,
  p_idle_minutes integer
)
returns table (
  session_id text,
  expires_at timestamptz,
  id text,
  username text,
  full_name_ar text,
  full_name_en text,
  email text,
  phone text,
  role_level integer,
  company_id text,
  assigned_plant_ids text[],
  is_active boolean,
  last_login_at timestamptz,
  company_name_ar text,
  company_name_en text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_magic public.magic_login_tokens%rowtype;
  v_user public.users%rowtype;
  v_company public.companies%rowtype;
  v_expires timestamptz;
  v_minutes integer := greatest(1, least(coalesce(p_idle_minutes, 30), 1440));
begin
  if char_length(coalesce(p_magic_hash, '')) <> 64 or p_magic_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  if char_length(coalesce(p_session_hash, '')) <> 64 or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'session token hash must be a sha256 hex digest'
      using errcode = 'invalid_parameter_value';
  end if;
  if nullif(trim(coalesce(p_session_id, '')), '') is null then
    raise exception 'session id is required' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_magic
    from public.magic_login_tokens t
   where t.token_hash = p_magic_hash
     and t.used_at is null
     and t.expires_at > now()
   for update;

  if not found then
    return;
  end if;

  select * into v_user
    from public.users u
   where u.id = v_magic.user_id
     and u.company_id = v_magic.company_id
     and u.deleted_at is null
     and u.is_active
   limit 1;

  if not found then
    update public.magic_login_tokens set used_at = now() where token_hash = p_magic_hash;
    return;
  end if;

  select * into v_company
    from public.companies c
   where c.id = v_magic.company_id and c.deleted_at is null;

  if not found then
    update public.magic_login_tokens set used_at = now() where token_hash = p_magic_hash;
    return;
  end if;

  update public.magic_login_tokens
     set used_at = now()
   where token_hash = p_magic_hash;

  v_expires := now() + make_interval(mins => v_minutes);

  insert into public.sessions (
    id, company_id, user_id, token_hash, ip_address, device_info,
    created_at, last_seen_at, expires_at, revoked_at
  ) values (
    p_session_id, v_user.company_id, v_user.id, p_session_hash,
    left(coalesce(p_ip, ''), 64), left(coalesce(p_device, ''), 256),
    now(), now(), v_expires, null
  );

  update public.users u
     set failed_login_attempts = 0, locked_until = null, last_login_at = now()
   where u.id = v_user.id;

  return query select
    p_session_id,
    v_expires,
    v_user.id,
    v_user.username,
    v_user.full_name_ar,
    v_user.full_name_en,
    v_user.email,
    v_user.phone,
    v_user.role_level,
    v_user.company_id,
    v_user.assigned_plant_ids,
    v_user.is_active,
    now(),
    v_company.name_ar,
    v_company.name_en;
end $$;

revoke all on function auth_magic_issue(text, text, text, integer) from public;
grant execute on function auth_magic_issue(text, text, text, integer) to iconcrete_app;
revoke all on function auth_magic_consume(text, text, text, text, text, integer) from public;
grant execute on function auth_magic_consume(text, text, text, text, text, integer) to iconcrete_app;
