-- ICONCRETE B1 — projects and orders (spec §20, §22, §7).
--
-- Quantities and prices are numeric, never float. Order value is derived
-- (quantity_m3 * unit_price) wherever it is needed; it is not stored, so there is
-- no second copy of the same business fact (spec §68A).
--
-- RLS follows 0003_m1_security.sql exactly: tenant_isolation on company_id, plus a
-- restrictive plant_scope using app_plant_allowed(plant_id).

create table if not exists projects (
  id            text primary key,
  company_id    text not null references companies(id),
  plant_id      text,
  customer_id   text not null references customers(id),
  code          text not null,
  name_ar       text not null,
  name_en       text not null,
  site_location text not null default '',
  status        text not null default 'draft'
                check (status in ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date    date,
  end_date      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    text,
  updated_by    text,
  version       integer not null default 1
);

-- One project code per company; a customer may hold many projects (spec §20).
create unique index if not exists projects_company_code_idx
  on projects (company_id, lower(code)) where deleted_at is null;
create index if not exists projects_company_idx on projects (company_id, deleted_at);
create index if not exists projects_customer_idx on projects (company_id, customer_id);
create index if not exists projects_plant_idx on projects (company_id, plant_id);

create table if not exists orders (
  id                text primary key,
  company_id        text not null references companies(id),
  plant_id          text,
  customer_id       text not null references customers(id),
  project_id        text references projects(id),
  order_no          text not null,
  concrete_grade    text not null,
  quantity_m3       numeric(12,3) not null check (quantity_m3 > 0),
  unit_price        numeric(14,2) not null check (unit_price >= 0),
  delivery_date     date,
  pour_window_start time,
  pour_window_end   time,
  status            text not null default 'draft'
                    check (status in ('draft', 'confirmed', 'scheduled', 'in_production',
                                      'delivered', 'invoiced', 'closed')),
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  created_by        text,
  updated_by        text,
  version           integer not null default 1
);

create unique index if not exists orders_company_no_idx
  on orders (company_id, lower(order_no)) where deleted_at is null;
create index if not exists orders_company_idx on orders (company_id, deleted_at);
create index if not exists orders_customer_idx on orders (company_id, customer_id);
create index if not exists orders_project_idx on orders (company_id, project_id);
create index if not exists orders_plant_idx on orders (company_id, plant_id);
create index if not exists orders_status_idx on orders (company_id, status);

-- ------------------------------------------------------------ RLS policies
do $$
declare
  t text;
begin
  foreach t in array array['projects', 'orders'] loop
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
        using (app_plant_allowed(plant_id))
        with check (app_plant_allowed(plant_id))
    $f$, t);
  end loop;
end $$;

-- updated_at / version bookkeeping, same trigger function as 0003.
drop trigger if exists trg_touch_projects on projects;
create trigger trg_touch_projects before update on projects
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_orders on orders;
create trigger trg_touch_orders before update on orders
  for each row execute function touch_updated_at();

-- The application role was granted on the tables that existed when 0003 ran.
grant select, insert, update, delete on projects to iconcrete_app;
grant select, insert, update, delete on orders to iconcrete_app;
