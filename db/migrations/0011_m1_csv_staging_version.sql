-- ICONCRETE B2 — csv_staging adopts the shared version bookkeeping.
--
-- 0010 installs the standard touch_updated_at() trigger, which also bumps `version`.
-- The staging table gains that column so an edited upload keeps the same optimistic
-- concurrency contract as every other M1 table.

alter table csv_staging add column if not exists version integer not null default 1;
