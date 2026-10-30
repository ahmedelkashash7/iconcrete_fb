# Data model (as implemented)

Source of truth for the schema is `db/migrations/*.sql`. This file describes the model
those files actually create — 48 tables at migration `0007`. It does not describe planned
tables, except where explicitly marked `NOT IMPLEMENTED`.

## Organizational scope

| Table | Scope | Notes |
|---|---|---|
| `companies` | root | currency `EGP`, timezone `Africa/Cairo`, `logo_doc_id` reserved |
| `plants` | `company_id` | capacity `numeric(10,2)` m³/h |
| `users` | `company_id` | argon2id hash, role_level 1–5, `assigned_plant_ids text[]` |
| `roles` / `permissions` / `role_permissions` | company optional | RBAC catalogue |
| `user_roles` | `company_id` | many-to-many user↔role |
| `sessions` | `company_id` | SHA-256 `token_hash` only, `expires_at`, `revoked_at`, `last_seen_at` |
| `audit_log` | `company_id` nullable, `plant_id` nullable | append-only; actor, action, before/after, request id |
| `staged_imports` / `import_records` | `company_id` | table exists; the HTTP commit path still stages in memory (documented gap) |

Every tenant table carries `created_at`, `updated_at`, `deleted_at`, `created_by`,
`updated_by`, `version` where the migration defines them; `updated_at`/`version` are
maintained by `touch_updated_at()`.

## Accounting core

`gl_accounts`, `journal_entries` (bigint id, `entry_no`, draft/posted/reversed states,
`reversal_of`, `reversed_by`), `journal_entry_lines` (debit/credit `numeric(18,2)`,
one-sided check, `line_no`), `customers`, `customer_credit_limits`, `suppliers`, `invoices`,
`invoice_items`, `payments`, `payment_allocations` (FIFO `sequence`), `deposits`,
`retentions`, `expenses`, `budgets`.

## Treasury

`cash_accounts`, `cash_transactions`, `cash_closings`, `bank_accounts`,
`bank_transactions`, `bank_reconciliations`, `bank_reconciliation_items`, `cheques`,
`cheque_movements` (explicit status transitions).

## Assets, loans, procurement

`fixed_assets`, `depreciation_schedules` (straight line, `posted_journal_entry_id`), `loans`,
`loan_installments` (annuity split), `purchase_orders`, `purchase_order_lines`,
`goods_receipts`, `goods_receipt_lines`, `supplier_bills`, `supplier_bill_lines`,
`three_way_match_results`.

## Invariants enforced by the database

1. `trg_journal_balanced` (deferred constraint trigger) rejects a posted entry that has fewer
   than two lines, has lines from another company, is unbalanced, or is non-positive — at
   `COMMIT`.
2. `protect_posted_entry` / `protect_posted_lines` make posted entries immutable except the
   single `posted → reversed` link.
3. RLS (`tenant_isolation` + restrictive `plant_scope`) on 42 tables, forced.
4. `trg_audit_append_only` rejects `UPDATE`/`DELETE` on `audit_log` (maintenance bypass only).
5. Every monetary column is `numeric`; no floating-point money exists in the schema.

## Units and precision

| Domain | Storage | Unit |
|---|---|---|
| Money | `numeric(18,2)` | EGP (company currency column, default `EGP`) |
| Concrete volume | `numeric` (3 decimals where used) | m³ |
| Material quantity | `numeric` | tonnes / m³ / litres / kg as declared per material |
| Percent (tax, W/C inputs) | `numeric` | percentage points (e.g. `14.000`) |
| Timestamps | `timestamptz` | UTC storage, `Africa/Cairo` display |

## Deliberately absent (NOT IMPLEMENTED)

`orders`, `order_items`, `projects`, `mix_designs`, `batches`, `trips`, `quality_tests`,
`lab_equipment`, `trucks`, `drivers`, `pumps`, `maintenance_orders`, `employees`,
`attendance`, `payroll_runs`, `weighments`, `sensor_readings`, `demand_forecasts`,
`notification_log`. Phase 1 represents some of these only in the demo dataset, in the Excel
templates, or not at all — see `docs/IMPLEMENTATION_STATUS.md`.
