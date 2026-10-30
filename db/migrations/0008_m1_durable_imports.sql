-- ICONCRETE M1 — durable Excel import lifecycle.
--
-- staged_imports already stores the parsed validation result and the file checksum per
-- company. This migration adds the explicit discard step so an uncommitted upload can be
-- closed (and audited) without deleting the evidence row.

alter table staged_imports add column if not exists discarded_at timestamptz;
alter table staged_imports add column if not exists discarded_by text;

create index if not exists staged_imports_open_idx
  on staged_imports (company_id, created_at desc)
  where discarded_at is null;
