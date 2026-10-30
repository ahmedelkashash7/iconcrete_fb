# Data dictionary (extract)

This is the working dictionary for the tables and templates that are **implemented**. Full
column lists live in `db/migrations/*.sql`; where this document and a migration disagree,
the migration wins and this file is wrong and must be corrected.

## Conventions

- Identifiers are stable text keys with a prefix (`CMP-0001`, `PLT-0001`, `CUS-0001`,
  `MIX-001`, `ORD-1001`). Names are never identifiers.
- Timestamps are `timestamptz` in UTC; the UI renders `Africa/Cairo`.
- Money is `numeric(18,2)` in EGP unless a currency column says otherwise.
- Enumerations are `text` with `CHECK` constraints, not database enums (easier migration).
- `deleted_at` is soft deletion; posted financial rows are never deleted.

## `companies`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | text PK | yes | `CMP-0001` demo |
| `name_ar` / `name_en` | text | yes | locked demo identity |
| `tax_id` | text | no | demo tax id |
| `currency` | char(3) | yes | default `EGP` |
| `timezone` | text | yes | default `Africa/Cairo` |
| `logo_doc_id` | text | no | reserved for an uploaded logo document |
| `version` | integer | yes | optimistic-lock counter, bumped by trigger |

## `users`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | text PK | yes | `USR-0001`… |
| `company_id` | text FK | yes | tenant scope |
| `username` | text | yes | unique per company, case-insensitive |
| `password_hash` | text | yes | argon2id via `Bun.password` |
| `role_level` | integer | yes | 1 viewer … 5 owner, `CHECK 1..5` |
| `assigned_plant_ids` | text[] | yes | empty = company-wide |
| `failed_login_attempts` / `locked_until` | integer / timestamptz | — | durable lockout |
| `is_active` | boolean | yes | inactive users cannot authenticate |

## `sessions`

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | `SES-…` |
| `token_hash` | text unique | SHA-256 of the bearer token; the raw token is never stored |
| `expires_at` / `revoked_at` / `last_seen_at` | timestamptz | sliding idle expiry, explicit revocation |

## `journal_entries` / `journal_entry_lines`

| Field | Type | Notes |
|---|---|---|
| `entry_no` | text | `JE-000001`, unique per company |
| `status` | text | `draft` \| `posted` \| `reversed` |
| `entry_date` | date | business date |
| `reversal_of` / `reversed_by` | bigint | one reversal per entry |
| `lines.debit` / `lines.credit` | numeric(18,2) | one side must be `0`, amount `> 0` |
| `lines.account_id` | text FK | `CMP-0001-ACC-1000` |

## `invoices` / `invoice_items` / `payments` / `payment_allocations`

| Field | Type | Notes |
|---|---|---|
| `subtotal`, `tax_percent`, `tax_amount`, `grand_total` | numeric | tax computed then rounded half-up once |
| `retention_amount`, `deposit_amount` | numeric | deductions tracked separately from tax |
| `status` | text | `draft` \| `issued` \| `partially_paid` \| `paid` \| `overdue` \| `void` |
| `journal_entry_id` | bigint | set when posted; `NULL` for drafts |
| `payments.unapplied_amount` | numeric | amount not yet allocated |
| `payment_allocations.sequence` | integer | deterministic FIFO order |

## `customer_credit_limits`

| Field | Type | Notes |
|---|---|---|
| `credit_limit` | numeric(18,2) | server-side check before an invoice/order is accepted |
| derived `outstanding` | — | computed from invoices/allocations, never stored as an editable balance |

## `cheques` / `cheque_movements`

`status` ∈ `received`, `deposited`, `cleared`, `bounced`, `recovered`, `cancelled`,
`closed`; transitions are validated in `src/core/cheques.ts` and audited per movement.

## Excel import template fields (version `1.1.0`)

| Template | Unique keys | Notes |
|---|---|---|
| `customers` | `customer_id` | credit limit, credit days, status, plant reference |
| `suppliers` | `supplier_id` | category enum |
| `materials` | `balance_id` | material + opening balance + unit cost |
| `mix_designs` | `mix_id`, `code` | 1 m³ yield and W/C checks |
| `orders` | `order_id` | customer reference + credit-limit check |
| `employees` | `employee_id` | salary is demo data only; no real personal data |
| `fleet` | `truck_id` | licence expiry, driver hours |

Every template declares bilingual headers (`labelAr | labelEn`), a `version`, required
fields, enum values, numeric ranges and reference targets.
