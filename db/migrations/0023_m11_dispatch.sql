-- ICONCRETE M11 — dispatch and trips operating module.
--
-- The fleet foundation (trucks, trips, drivers) already exists from 0016. This migration
-- extends those two tables in place instead of creating duplicate tables, so the live
-- dispatch rows and the existing fleet screens keep one source of truth. Every column is
-- nullable or has a server default, and no row, column or table is dropped.
--
-- A trip is one truck and one load. A queued trip may be created before a truck is assigned;
-- the truck is required before loading starts. Status changes are append-only evidence in
-- trip_events, and trips cannot be hard-deleted.

-- ------------------------------------------------------------- trips extensions
alter table trips alter column assignment_id drop not null;
alter table trips alter column truck_id drop not null;

alter table trips add column if not exists order_id      text references orders(id);
alter table trips add column if not exists customer_id   text references customers(id);
alter table trips add column if not exists driver_name   text;
alter table trips add column if not exists mix_design_id text references mix_designs(id);
alter table trips add column if not exists target_m3     numeric(10,3) check (target_m3 is null or target_m3 > 0);
alter table trips add column if not exists loaded_m3     numeric(10,3) check (loaded_m3 is null or loaded_m3 >= 0);
alter table trips add column if not exists departure_time     timestamptz;
alter table trips add column if not exists arrive_site_time   timestamptz;
alter table trips add column if not exists finish_unload_time timestamptz;
alter table trips add column if not exists return_time        timestamptz;
alter table trips add column if not exists wait_min_at_site  integer
  check (wait_min_at_site is null or wait_min_at_site >= 0);
alter table trips add column if not exists cancel_reason     text not null default '';
alter table trips add column if not exists trip_date         date not null default current_date;

-- Keep the M5 lifecycle values and add the M11 operating lifecycle.
alter table trips drop constraint if exists trips_status_check;
alter table trips add constraint trips_status_check
  check (status in (
    'planned', 'departed', 'arrived', 'returned', 'aborted',
    'queued', 'loading', 'loaded', 'traveling', 'unloading', 'unloaded', 'cancelled'
  ));

-- A truck on an open M11 trip cannot be assigned to a second trip. The partial index is
-- the database backstop; the service gives the readable rejection.
create unique index if not exists trips_m11_open_per_truck_idx
  on trips (company_id, truck_id)
  where truck_id is not null
    and status in ('queued', 'loading', 'loaded', 'traveling', 'unloading', 'unloaded');

create index if not exists trips_m11_board_idx
  on trips (company_id, plant_id, trip_date, status, created_at desc);

-- ------------------------------------------------------------- trucks extensions
alter table trucks add column if not exists active boolean not null default true;

alter table trucks drop constraint if exists trucks_status_check;
alter table trucks add constraint trucks_status_check
  check (status in (
    'available', 'assigned', 'loading', 'en_route', 'at_site', 'returning',
    'maintenance', 'retired', 'on_trip'
  ));

-- --------------------------------------------------------------- trip events
create table if not exists trip_events (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  plant_id    text not null references plants(id),
  trip_id     text not null references trips(id),
  event       text not null check (char_length(btrim(event)) between 1 and 64),
  actor       text not null check (char_length(btrim(actor)) between 1 and 128),
  reason      text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists trip_events_trip_idx
  on trip_events (company_id, trip_id, created_at, id);
create index if not exists trip_events_tenant_idx
  on trip_events (company_id, plant_id, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['trip_events'] loop
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

-- Every inserted or changed status is logged automatically; the actor is the signed-in
-- user configured for this transaction. Cancellation carries its mandatory reason.
create or replace function log_trip_status_event() returns trigger
language plpgsql
as $$
declare
  v_actor text;
begin
  v_actor := coalesce(
    nullif(current_setting('app.actor', true), ''),
    nullif(current_setting('app.user_id', true), ''),
    'system'
  );

  if tg_op = 'INSERT' then
    insert into trip_events (company_id, plant_id, trip_id, event, actor, reason, created_at)
    values (new.company_id, new.plant_id, new.id, new.status, v_actor,
            coalesce(new.cancel_reason, ''), now());
  elsif new.status is distinct from old.status then
    insert into trip_events (company_id, plant_id, trip_id, event, actor, reason, created_at)
    values (new.company_id, new.plant_id, new.id, new.status, v_actor,
            coalesce(new.cancel_reason, ''), now());
  end if;
  return new;
end $$;

drop trigger if exists trg_log_trip_status_event on trips;
create trigger trg_log_trip_status_event
  after insert or update of status on trips
  for each row execute function log_trip_status_event();

create or replace function trip_events_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception 'trip events are append-only' using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_trip_events_immutable on trip_events;
create trigger trg_trip_events_immutable
  before update or delete on trip_events
  for each row execute function trip_events_immutable();

create or replace function trip_no_hard_delete() returns trigger
language plpgsql
as $$
begin
  raise exception 'trips cannot be hard-deleted; cancel the trip instead'
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_trip_no_hard_delete on trips;
create trigger trg_trip_no_hard_delete
  before delete on trips
  for each row execute function trip_no_hard_delete();

-- ------------------------------------------------------------------ privileges
grant select, insert, update, delete on trips to iconcrete_app;
grant select, insert, update on trucks to iconcrete_app;
grant select, insert on trip_events to iconcrete_app;
grant usage, select on sequence trip_events_id_seq to iconcrete_app;
