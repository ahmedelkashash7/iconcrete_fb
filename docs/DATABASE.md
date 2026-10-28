# ICONCRETE — Database (M1)

PostgreSQL 16 is the durable store for accounting, receivables, payables, treasury,
assets and loans. The in-memory adapter remains the default for demo and tests.

## Storage modes

| `ICONCRETE_STORAGE_MODE` | Adapter | Durability | Used by |
|---|---|---|---|
| `demo` (default) | seeded memory | none | Phase 1 demo, UI, Excel Center |
| `test` | empty memory | none | unit tests |
| `postgres` | `server/db/client.ts` | full | M1 accounting API |

Rules enforced by `server/db/mode.ts` and `server/db/client.ts`:

- `postgres` without `DATABASE_URL` throws `database_url_missing`.
- `postgres` with an unreachable server throws `database_unreachable`.
- There is **no** silent fallback: a failure stops the request/process.
- `GET /api/health` reports `storage.mode`, `storage.adapter`, `storage.durable`,
  `storage.database.connected` and the server version.

## Setup

```bash
# 1. a database and the restricted application role
createdb iconcrete
psql iconcrete -c "create role iconcrete_app login password 'change-me'"

# 2. schema + demo data (run as an owner/superuser role)
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/iconcrete
bun run db:migrate
bun run db:seed
bun run db:status

# 3. run the application as the restricted role so RLS applies
export ICONCRETE_STORAGE_MODE=postgres
export DATABASE_URL=postgres://iconcrete_app:change-me@127.0.0.1:5432/iconcrete
bun run api
```

`DATABASE_ADMIN_URL` is used by `db:migrate` / `db:seed` when it is set, so the
application can keep connecting as the non-owner role.

Development reset (refuses to run unless explicitly allowed):

```bash
ICONCRETE_ALLOW_DESTRUCTIVE=1 bun run db:reset
```

## Migrations

Applied in filename order, each in its own transaction, with a SHA-256 checksum
recorded in `schema_migrations`. Editing an applied migration is rejected as
checksum drift — add a new file instead.

| File | Contents |
|---|---|
| `0001_m1_organization.sql` | companies, plants, users, roles, permissions, sessions, audit_log, staged imports |
| `0002_m1_accounting.sql` | chart of accounts, journal, customers, credit limits, invoices, payments, allocations, deposits, retentions, cash, banks, cheques, assets, loans, expenses, budgets, procurement, three-way match |
| `0003_m1_security.sql` | RLS policies, balanced-post trigger, immutability triggers, `updated_at` triggers, `iconcrete_app` role, `auth_find_company()` |
| `0004_m1_reversal_permitted.sql` | allows the single `posted → reversed` link while keeping the rest immutable |

## Row level security

- Enabled **and forced** on 42 tenant tables.
- Tenant policy: `company_id = current_setting('app.company_id')`.
- Plant policy (restrictive, only on tables that have `plant_id`):
  `plant_id is null or plant_id = any(current_setting('app.plant_ids'))`.
- Context is set per transaction by `Db.withTenant()` using `set_config(..., true)`
  (`SET LOCAL`), so a pooled connection cannot leak one tenant into another request.
- The application **must** connect as `iconcrete_app` (non-owner). PostgreSQL bypasses
  RLS for table owners and superusers, which is why the integration tests connect with
  the restricted role.
- `auth_find_company(text)` is `SECURITY DEFINER` and only exposes company identity so
  login can resolve the tenant before a company context exists.
- Cross-company and cross-plant reads and writes are asserted in
  `tests/m1/postgres.integration.test.ts`.

## Double-entry enforcement

Application validation (`src/core/accounting.ts`) gives fast, bilingual errors.
The database is authoritative:

- `CHECK` constraints: one-sided lines only, positive amounts, no negative money.
- Deferred constraint trigger `trg_journal_balanced` re-checks at `COMMIT` that a posted
  entry has ≥ 2 lines and `sum(debit) = sum(credit) > 0`.
- `protect_posted_entry` / `protect_posted_lines` make posted entries and their lines
  immutable; corrections are reversing entries (`reversal_of`, `reversed_by`).
- Posting runs in a single transaction: entry, lines, status change and audit row.

PostgreSQL `numeric(18,2)` is used for every monetary column. No `float`/`double` exists
in the schema.

## Sessions and audit retention

`sessions` stores only a SHA-256 token hash, IP, device, `expires_at` and `revoked_at`.
`audit_log` stores actor, company/plant, action, table, record, IP, user agent, request
id, JSON details and UTC timestamp; passwords and tokens are never written.

Retention policy (documented, not yet automated): audit rows are kept for 24 months for
financial events and 12 months for authentication events; implement pruning with a
scheduled `delete from audit_log where created_at < now() - interval ...` once the
production deployment defines its regulator requirement. No automatic deletion exists
today.

## Known limits

- The HTTP auth flow still reads/writes the Phase 1 in-memory store; the durable
  `sessions`/`audit_log` tables are written by the M1 services and by tests, but login
  does not yet go through them.
- M1 API endpoints return `503 postgres_required` in `demo`/`test` mode.
- The UI still renders Phase 1 screens only; M1 has no screens yet.
- Integration tests need a running PostgreSQL; otherwise they are reported as skipped
  with the exact reason.
