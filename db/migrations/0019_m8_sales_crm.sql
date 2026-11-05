-- ICONCRETE M8 — sales pricing, volume commitments, CRM and complaints.
--
-- Lifecycles:
--   price list        draft -> active -> expired | superseded
--   volume commitment draft -> active -> fulfilled | breached | expired ; cancelled
--   complaint         open -> investigating -> resolved -> closed ; rejected (reason required)
--   activity          open -> done | cancelled
--
-- Prices are resolved once, at order time, in the precedence order
-- contract > volume commitment > seasonal > price list. The resolution and the resulting unit
-- price are stored on the order item, so a later price change never rewrites an existing order.
-- Two sources at the same precedence, or no source at all, is approval_required — never a guess
-- and never zero.
--
-- The commitment warning and approval thresholds are named in the M8 execution specification
-- (95% and 100%), so they are seeded as rule values with that source note. They are still data:
-- changing them is a rule edit, not a code change, and removing the value makes the rule
-- approval_required instead of passing.
--
-- RLS follows 0003_m1_security.sql: tenant_isolation on company_id plus a restrictive
-- plant_scope on every plant-scoped table.

-- ------------------------------------------------------------------ price lists
create table if not exists price_lists (
  id          text primary key,
  company_id  text not null references companies(id),
  plant_id    text not null references plants(id),
  list_code   text not null check (char_length(btrim(list_code)) between 1 and 48),
  name        text not null check (char_length(btrim(name)) between 1 and 160),
  currency    char(3) not null default 'EGP',
  valid_from  date not null,
  valid_until date,
  status      text not null default 'draft'
              check (status in ('draft', 'active', 'expired', 'superseded')),
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  text,
  updated_by  text,
  version     integer not null default 1,
  check (valid_until is null or valid_until >= valid_from)
);

create unique index if not exists price_lists_code_idx
  on price_lists (company_id, lower(list_code)) where deleted_at is null;
create index if not exists price_lists_tenant_idx
  on price_lists (company_id, plant_id, status, valid_from, valid_until) where deleted_at is null;

create table if not exists price_list_items (
  id             text primary key,
  company_id     text not null references companies(id),
  plant_id       text not null references plants(id),
  price_list_id  text not null references price_lists(id) on delete cascade,
  material_id    text not null references materials(id),
  unit_price     numeric(14,2) not null check (unit_price > 0),
  min_quantity   numeric(14,3) not null default 0 check (min_quantity >= 0),
  discount_pct   numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  valid_from     date,
  valid_until    date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  created_by     text,
  updated_by     text,
  version        integer not null default 1,
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index if not exists price_list_items_list_idx
  on price_list_items (company_id, price_list_id, material_id) where deleted_at is null;

-- ------------------------------------------------------------ volume commitments
create table if not exists volume_commitments (
  id                     text primary key,
  company_id             text not null references companies(id),
  plant_id               text not null references plants(id),
  commitment_no          text not null check (char_length(btrim(commitment_no)) between 1 and 48),
  customer_id            text not null references customers(id),
  contract_id            text references contracts(id),
  material_id            text not null references materials(id),
  committed_quantity_m3  numeric(14,3) not null check (committed_quantity_m3 > 0),
  fulfilled_quantity_m3  numeric(14,3) not null default 0 check (fulfilled_quantity_m3 >= 0),
  period_start           date not null,
  period_end             date not null,
  special_price          numeric(14,2) not null check (special_price > 0),
  status                 text not null default 'draft'
                         check (status in ('draft', 'active', 'fulfilled', 'breached',
                                           'expired', 'cancelled')),
  notes                  text not null default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  created_by             text,
  updated_by             text,
  version                integer not null default 1,
  check (period_end >= period_start)
);

create unique index if not exists volume_commitments_no_idx
  on volume_commitments (company_id, lower(commitment_no)) where deleted_at is null;
create index if not exists volume_commitments_customer_idx
  on volume_commitments (company_id, customer_id, material_id, status, period_start, period_end)
  where deleted_at is null;

-- ---------------------------------------------------------------- seasonal prices
create table if not exists seasonal_prices (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text not null references plants(id),
  customer_id  text references customers(id),
  material_id  text not null references materials(id),
  season_start date not null,
  season_end   date not null,
  unit_price   numeric(14,2) not null check (unit_price > 0),
  status       text not null default 'active' check (status in ('active', 'inactive')),
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  updated_by   text,
  version      integer not null default 1,
  check (season_end >= season_start)
);

create index if not exists seasonal_prices_lookup_idx
  on seasonal_prices (company_id, plant_id, material_id, status, season_start, season_end)
  where deleted_at is null;

-- ----------------------------------------------------------------- CRM activities
create table if not exists customer_activities (
  id            text primary key,
  company_id    text not null references companies(id),
  plant_id      text not null references plants(id),
  activity_no   text not null check (char_length(btrim(activity_no)) between 1 and 48),
  customer_id   text not null references customers(id),
  activity_type text not null
                check (activity_type in ('call', 'visit', 'complaint', 'inquiry', 'follow_up')),
  subject       text not null check (char_length(btrim(subject)) between 1 and 200),
  description   text not null default '',
  occurred_at   timestamptz not null,
  due_at        timestamptz,
  assigned_to   text not null default '',
  status        text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  outcome       text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1
);

create unique index if not exists customer_activities_no_idx
  on customer_activities (company_id, lower(activity_no)) where deleted_at is null;
create index if not exists customer_activities_customer_idx
  on customer_activities (company_id, customer_id, activity_type, status) where deleted_at is null;

-- ------------------------------------------------------------------ CRM feedback
create table if not exists customer_feedback (
  id           text primary key,
  company_id   text not null references companies(id),
  plant_id     text not null references plants(id),
  customer_id  text not null references customers(id),
  source       text not null check (char_length(btrim(source)) between 1 and 80),
  rating_1_to_5 integer not null check (rating_1_to_5 between 1 and 5),
  category     text not null default '',
  comment      text not null default '',
  submitted_at timestamptz not null default now(),
  handled_by   text not null default '',
  resolution   text not null default '',
  status       text not null default 'open' check (status in ('open', 'handled', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   text,
  updated_by   text,
  version      integer not null default 1
);

create index if not exists customer_feedback_customer_idx
  on customer_feedback (company_id, customer_id, status, submitted_at desc) where deleted_at is null;

-- -------------------------------------------------------------------- complaints
create table if not exists complaints (
  id                 text primary key,
  company_id         text not null references companies(id),
  plant_id           text not null references plants(id),
  complaint_no       text not null check (char_length(btrim(complaint_no)) between 1 and 48),
  feedback_id        text references customer_feedback(id),
  customer_id        text not null references customers(id),
  order_id           text references orders(id),
  ticket_id          text references delivery_tickets(id),
  quality_related    boolean not null default false,
  ncr_id             text references ncr(id),
  severity           text not null default 'medium'
                     check (severity in ('low', 'medium', 'high', 'critical')),
  description        text not null check (char_length(btrim(description)) between 1 and 4000),
  opened_at          timestamptz not null default now(),
  opened_by          text not null default '',
  investigation_notes text not null default '',
  root_cause         text not null default '',
  status             text not null default 'open'
                     check (status in ('open', 'investigating', 'resolved', 'closed', 'rejected')),
  rejection_reason   text,
  closed_at          timestamptz,
  closed_by          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  created_by         text,
  updated_by         text,
  version            integer not null default 1,
  -- A complaint linked to a quality failure is evidence only with the NCR that recorded it.
  check (quality_related = false or ncr_id is not null),
  check (status <> 'rejected' or (rejection_reason is not null and btrim(rejection_reason) <> ''))
);

create unique index if not exists complaints_no_idx
  on complaints (company_id, lower(complaint_no)) where deleted_at is null;
create index if not exists complaints_customer_idx
  on complaints (company_id, customer_id, status, opened_at desc) where deleted_at is null;

-- ------------------------------------------------------------- price resolutions
create table if not exists price_resolutions (
  id              text primary key,
  company_id      text not null references companies(id),
  plant_id        text not null references plants(id),
  order_id        text not null references orders(id) on delete cascade,
  order_item_id   text references sales_order_items(id),
  line_no         integer not null default 1,
  material_id     text references materials(id),
  quantity_m3     numeric(14,3) not null default 0,
  source_type     text not null
                  check (source_type in ('price_list', 'contract', 'volume_commitment', 'seasonal')),
  source_id       text not null,
  resolved_price  numeric(14,2) not null check (resolved_price > 0),
  resolved_by_rule text not null default '',
  decided_by      text not null default '',
  decided_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  created_by      text,
  updated_by      text,
  version         integer not null default 1
);

create index if not exists price_resolutions_order_idx
  on price_resolutions (company_id, order_id) where deleted_at is null;
create index if not exists price_resolutions_source_idx
  on price_resolutions (company_id, source_type, source_id);

-- -------------------------------------------------------------- RLS policies
do $$
declare
  t text;
begin
  foreach t in array array[
    'price_lists', 'price_list_items', 'volume_commitments', 'seasonal_prices',
    'customer_activities', 'customer_feedback', 'complaints', 'price_resolutions'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (company_id = app_current_company())
        with check (company_id = app_current_company())
    $f$, t);
    execute format('drop policy if exists plant_scope on %I', t);
    execute format($f$
      create policy plant_scope on %I as restrictive
        using (app_plant_allowed(plant_id)) with check (app_plant_allowed(plant_id))
    $f$, t);
  end loop;
end $$;

-- ------------------------------------------------------------ touch triggers
drop trigger if exists trg_touch_price_lists on price_lists;
create trigger trg_touch_price_lists before update on price_lists
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_price_list_items on price_list_items;
create trigger trg_touch_price_list_items before update on price_list_items
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_volume_commitments on volume_commitments;
create trigger trg_touch_volume_commitments before update on volume_commitments
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_seasonal_prices on seasonal_prices;
create trigger trg_touch_seasonal_prices before update on seasonal_prices
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_customer_activities on customer_activities;
create trigger trg_touch_customer_activities before update on customer_activities
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_customer_feedback on customer_feedback;
create trigger trg_touch_customer_feedback before update on customer_feedback
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_complaints on complaints;
create trigger trg_touch_complaints before update on complaints
  for each row execute function touch_updated_at();

-- --------------------------------------------------- commitment rule catalogue
create or replace function seed_m8_sales_rules() returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted integer;
begin
  insert into public.rule_definitions (id, company_id, code, module, classification, value, unit,
                                       source_note, created_by, updated_by)
  select 'RUL-' || c.id || '-' || replace(v.code, '.', '_'),
         c.id, v.code, v.module, v.classification, v.value, v.unit, v.note, 'seed', 'seed'
    from public.companies c
    cross join (values
      ('sales.commitment_warn_pct', 'sales', 'warning', 95::numeric, '%',
       'M8 execution specification: warn above 95% of the committed volume'),
      ('sales.commitment_approval_pct', 'sales', 'approval_required', 100::numeric, '%',
       'M8 execution specification: approve beyond 100% of the committed volume')
    ) as v(code, module, classification, value, unit, note)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on function seed_m8_sales_rules() from public;
grant execute on function seed_m8_sales_rules() to iconcrete_app;

select seed_m8_sales_rules();

-- --------------------------------------------------------------- privileges
grant select, insert, update, delete on price_lists to iconcrete_app;
grant select, insert, update, delete on price_list_items to iconcrete_app;
grant select, insert, update, delete on volume_commitments to iconcrete_app;
grant select, insert, update, delete on seasonal_prices to iconcrete_app;
grant select, insert, update, delete on customer_activities to iconcrete_app;
grant select, insert, update, delete on customer_feedback to iconcrete_app;
grant select, insert, update, delete on complaints to iconcrete_app;
grant select, insert, update, delete on price_resolutions to iconcrete_app;
