-- Reversals must be able to mark the original entry as 'reversed'.
-- The original row itself is still never edited: only its status and reversed_by link
-- may move from posted -> reversed, and only once.

create or replace function protect_posted_entry() returns trigger
language plpgsql as $$
begin
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
