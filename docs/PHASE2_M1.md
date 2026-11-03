# Phase 2 — M1 Accounting

Delivered in this iteration: the durable data layer, double-entry ledger, receivables,
payables, treasury, assets and loans, plus the M1 HTTP API. M2 (mix design), M3 (fleet)
and M4 (quality) were **not** started.

## Implemented

### Storage and security
- Explicit storage modes `demo` / `test` / `postgres` with hard failure, no fallback.
- 48 tables, 4 migrations, checksum-verified runner, seed/reset/status CLI.
- RLS forced on 52 tenant tables, tenant + plant policies, transaction-scoped context.
- Deferred-commit balance trigger, posted-entry and posted-line immutability.
- `numeric(18,2)` money everywhere; UUID/text identifiers; soft delete; `version` column;
  `created_at` / `updated_at` / `created_by` fields.

### Accounting (`server/services/m1.ts`)
- Chart of accounts (23 accounts per company) and dual demo companies for isolation.
- `POST /api/m1/journal`, `POST /api/m1/journal/:id/reverse`.
- Trial balance and general ledger (`/api/m1/trial-balance`, `/api/m1/ledger`).
- Reversal keeps history; posted rows are never edited or deleted.

### Receivables
- `POST /api/m1/invoices` (draft, server-computed subtotal/VAT/retention/deposit).
- `POST /api/m1/invoices/:id/post` with server-side credit-limit and customer-status checks.
- `POST /api/m1/payments` with deterministic FIFO allocation and unapplied remainder.
- `GET /api/m1/aging` — five buckets derived from invoices and allocations.

### Payables
- Purchase order → goods receipt → supplier bill → three-way match.
- Over-receipt, over-billing and price-variance detection; approval required for exceptions.
- Bill approval posts the AP journal entry (level 5 only).

### Treasury
- Cheques with a validated state machine (`received → deposited → cleared | bounced → recovered → closed`), bounce fee posting and movement history.
- Bank reconciliation sessions with reference → amount+date → manual matching, unmatched
  counts and a close guard.
- Cash daily closing with counted balance and variance.

### Assets and loans
- Straight-line depreciation with an exact final period, posted per month and idempotent.
- Annuity loan schedules with exact final installment, stored per installment.

## Not implemented (explicit)

- No M1 user interface; screens remain Phase 1.
- Login/logout still use the Phase 1 in-memory sessions; the durable `sessions` table is
  written by tests only.
- The Excel Integration Center still uses the Phase 1 in-memory staging; `staged_imports`
  exists in SQL but the upload flow does not write to it yet.
- Excel templates for invoices, payments, chart of accounts and expenses are not added;
  existing templates are bumped to schema version `1.1.0`.
- No PDF output, no email/SMS, no bank feeds, no e-invoicing, no multi-currency
  revaluation (currency columns exist, rates do not).
- Seed data is demo data only and is not production accounting.

## Tests

```bash
bun test                                  # unit + API + integration (skips DB when absent)
bun run typecheck
bun run build
.venv/bin/python -m pytest excel_generator/tests -q
ICONCRETE_RLS_URL=postgres://iconcrete_app:...@127.0.0.1:5432/iconcrete bun test tests/m1/postgres.integration.test.ts
```

The integration suite skips with an explicit reason when no database is configured; it
never reports a skipped test as passed.
