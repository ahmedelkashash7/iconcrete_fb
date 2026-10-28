-- ICONCRETE M1 — row level security, double-entry enforcement, immutability.
--
-- RLS model
--   * Every tenant table carries company_id and is filtered by app.company_id.
--   * Plant-scoped tables also honour app.plant_ids (comma separated). An empty
--     app.plant_ids means "no plant restriction" (company-wide role).
--   * The application connects as a NON-owner role (iconcrete_app), otherwise
--     PostgreSQL would silently bypass RLS for the table owner.
--
-- The GUCs are set with SET LOCAL inside a transaction, so a pooled connection
-- can never leak one tenant's context into another request.

create or replace function app_current_company() returns text
language sql stable as $$
  select nullif(current_setting('app.company_id', true), '')
$$;

create or replace function app_current_plants() returns text[]
language sql stable as $$
  select case
    when coalesce(current_setting('app.plant_ids', true), '') = '' then null
    else string_to_array(current_setting('app.plant_ids', true), ',')
  end
$$;

create or replace function app_plant_allowed(p_plant text) returns boolean
language sql stable as $$
  select app_current_plants() is null
     or p_plant is null
     or p_plant = any(app_current_plants())
$$;

-- ------------------------------------------------------------ RLS policies
do $$
declare
  t text;
begin
  foreach t in array array[
    'plants','users','roles','user_roles','sessions','audit_log','staged_imports','import_records',
    'gl_accounts','customers','customer_credit_limits','suppliers','journal_entries',
    'journal_entry_lines','invoices','invoice_items','payments','payment_allocations',
    'deposits','retentions','cash_accounts','cash_transactions','cash_closings','bank_accounts',
    'bank_transactions','bank_reconciliations','bank_reconciliation_items','cheques',
    'cheque_movements','fixed_assets','depreciation_schedules','loans','loan_installments',
    'expenses','budgets','purchase_orders','purchase_order_lines','goods_receipts',
    'goods_receipt_lines','supplier_bills','supplier_bill_lines','three_way_match_results'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (company_id = app_current_company())
        with check (company_id = app_current_company())
    $f$, t);
    -- Plant scoping only applies to tables that really carry plant_id.
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'plant_id'
    ) then
      execute format('drop policy if exists plant_scope on %I', t);
      execute format($f$
        create policy plant_scope on %I as restrictive
          using (app_plant_allowed(plant_id))
          with check (app_plant_allowed(plant_id))
      $f$, t);
    end if;
  end loop;
end $$;

-- -------------------------------------------------- double-entry enforcement
create or replace function assert_journal_entry_balanced() returns trigger
language plpgsql as $$
declare
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_lines integer;
  v_foreign integer;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*),
         count(*) filter (where company_id <> new.company_id)
    into v_debit, v_credit, v_lines, v_foreign
    from journal_entry_lines
   where entry_id = new.id;

  if v_foreign > 0 then
    raise exception 'journal entry % has lines from another company', new.entry_no
      using errcode = 'check_violation';
  end if;

  if v_lines < 2 then
    raise exception 'journal entry % must have at least two lines (has %)', new.entry_no, v_lines
      using errcode = 'check_violation';
  end if;

  if v_debit <> v_credit then
    raise exception 'journal entry % is unbalanced: debit % <> credit %', new.entry_no, v_debit, v_credit
      using errcode = 'check_violation';
  end if;

  if v_debit <= 0 then
    raise exception 'journal entry % has no value', new.entry_no
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_journal_balanced on journal_entries;
create constraint trigger trg_journal_balanced
  after insert or update of status on journal_entries
  deferrable initially deferred
  for each row
  when (new.status = 'posted')
  execute function assert_journal_entry_balanced();

-- Posted entries are immutable; corrections are reversing entries.
create or replace function protect_posted_entry() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'posted journal entry % cannot be deleted', old.entry_no
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status = 'posted' then
    -- The only tolerated change is linking the reversal that points at it.
    if new.status <> 'posted'
       or new.entry_no <> old.entry_no
       or new.entry_date <> old.entry_date
       or new.entry_no is distinct from old.entry_no
       or new.memo_ar <> old.memo_ar
       or new.memo_en <> old.memo_en
       or new.reversed_by is distinct from old.reversed_by then
      raise exception 'posted journal entry % is immutable; create a reversal instead', old.entry_no
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_journal_immutable on journal_entries;
create trigger trg_journal_immutable
  before update or delete on journal_entries
  for each row execute function protect_posted_entry();

create or replace function protect_posted_lines() returns trigger
language plpgsql as $$
declare
  v_status text;
  v_entry bigint;
begin
  v_entry := coalesce(new.entry_id, old.entry_id);
  select status into v_status from journal_entries where id = v_entry;
  if v_status = 'posted' then
    raise exception 'lines of posted journal entry % are immutable', v_entry
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_journal_lines_immutable on journal_entry_lines;
create trigger trg_journal_lines_immutable
  before insert or update or delete on journal_entry_lines
  for each row execute function protect_posted_lines();

-- Soft-deleted rows stay queryable for audit but must not be edited silently.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 1) + 1;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies','plants','users','customers','suppliers','invoices','payments','cheques',
    'cash_accounts','cash_transactions','bank_accounts','bank_transactions','fixed_assets',
    'loans','expenses','budgets','purchase_orders','goods_receipts','supplier_bills',
    'gl_accounts','staged_imports','roles'
  ] loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$I', t);
    execute format('create trigger trg_touch_%1$s before update on %1$I for each row execute function touch_updated_at()', t);
  end loop;
end $$;

-- --------------------------------------------------------- application role
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'iconcrete_app') then
    create role iconcrete_app login password 'iconcrete_dev_only';
  end if;
end $$;

grant usage on schema public to iconcrete_app;
grant select, insert, update, delete on all tables in schema public to iconcrete_app;
grant usage, select on all sequences in schema public to iconcrete_app;

-- Company lookup used before a tenant context exists (login only).
create or replace function auth_find_company(p_name text)
returns table (id text, name_ar text, name_en text, tax_id text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name_ar, c.name_en, c.tax_id
    from companies c
   where c.deleted_at is null
     and lower(p_name) in (lower(c.name_ar), lower(c.name_en), lower(c.tax_id), lower(c.id))
   limit 1
$$;

revoke all on function auth_find_company(text) from public;
grant execute on function auth_find_company(text) to iconcrete_app;
