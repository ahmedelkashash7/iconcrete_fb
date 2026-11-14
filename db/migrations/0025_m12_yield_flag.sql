-- M12 follow-up: a yield outside the investigation band is a flag, not an incomplete cost.
-- Keeping it separate lets a complete, fully priced batch still show the investigation trigger.

alter table batch_costs
  add column if not exists yield_flagged boolean not null default false;

create index if not exists batch_costs_yield_flagged_idx
  on batch_costs (company_id, plant_id, computed_at desc)
  where yield_flagged;
