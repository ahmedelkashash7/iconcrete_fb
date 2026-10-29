-- ICONCRETE M1 — maintenance bypass for the demo seed / local reset.
--
-- The immutability triggers from 0003 are correct for the application connection: a
-- posted entry and its lines can never be edited or deleted. They also (correctly)
-- blocked `db:seed` from resetting a database that already contained posted entries.
--
-- Seeding is a maintenance operation, not an API request. It opts in per transaction
-- with `set_config('app.seed_reset', 'on', true)`. The flag is transaction-scoped, is
-- never set by a request connection, and the application role cannot set it for a
-- request because only server/db/seed.ts and scripts/db.ts issue it. Everything else
-- keeps the original behaviour.

-- Same rules as 0004 (posted -> reversed link only) plus the maintenance bypass.
create or replace function protect_posted_entry() returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.seed_reset', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status in ('posted', 'reversed') then
      raise exception 'posted journal entry % cannot be deleted', old.entry_no
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status = 'reversed' then
    raise exception 'journal entry % is already reversed and immutable', old.entry_no
      using errcode = 'restrict_violation';
  end if;

  if old.status = 'posted' then
    -- The only tolerated change is the single posted -> reversed link.
    if new.status = 'reversed'
       and new.reversed_by is not null
       and new.entry_no = old.entry_no
       and new.entry_date = old.entry_date
       and new.memo_ar = old.memo_ar
       and new.memo_en = old.memo_en
       and new.source_type = old.source_type
       and new.source_id is not distinct from old.source_id then
      return new;
    end if;

    raise exception 'posted journal entry % is immutable; create a reversal instead', old.entry_no
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

create or replace function protect_posted_lines() returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_entry bigint;
begin
  if coalesce(current_setting('app.seed_reset', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  v_entry := coalesce(new.entry_id, old.entry_id);
  select status into v_status from journal_entries where id = v_entry;
  if v_status = 'posted' then
    raise exception 'lines of posted journal entry % are immutable', v_entry
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end $$;
