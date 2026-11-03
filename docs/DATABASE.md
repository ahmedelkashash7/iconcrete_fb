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

No migration file contains a password. The application role gets its secret from the
environment only, and production refuses to start without a real one.

```bash
# 1. a database and the restricted application role (no password in SQL)
createdb iconcrete
psql iconcrete -c "create role iconcrete_app login"

# 2. give the role a local password from the environment (value is never printed)
ICONCRETE_APP_PASSWORD="$(openssl rand -base64 24)" bun run db:role

# 3. schema + demo data (run as an owner/superuser role)
export DATABASE_URL=postgres://postgres@127.0.0.1:5432/iconcrete
bun run db:migrate
bun run db:seed
bun run db:status

# 4. run the application as the restricted role so RLS applies
export ICONCRETE_STORAGE_MODE=postgres
export DATABASE_URL=postgres://iconcrete_app@127.0.0.1:5432/iconcrete
bun run api

# production: refuses demo storage and placeholder connection strings
ICONCRETE_ENV=production ICONCRETE_STORAGE_MODE=postgres DATABASE_URL=… bun run api
```

| Setting | Required in production | Behaviour when missing |
|---|---|---|
| `DATABASE_URL` | yes | `database_secret_missing` — process refuses to start |
| `ICONCRETE_STORAGE_MODE=postgres` | yes | `production_requires_postgres` |
| real (non-placeholder) secret | yes | `database_secret_placeholder` |
| `ICONCRETE_APP_PASSWORD` | only for `bun run db:role` | command exits 5 with instructions |

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
| `0005_m1_remove_embedded_role_password.sql` | clears any password literal left on `iconcrete_app` by earlier development builds |
| `0006_m1_durable_auth.sql` | durable login/session/audit functions (SECURITY DEFINER), append-only audit trigger |
| `0007_m1_seed_maintenance.sql` | transaction-scoped `app.seed_reset` bypass so `db:seed` can reset posted demo entries |

## Row level security

- Enabled **and forced** on 48 tenant tables, including the three rule-engine tables.
- `rule_evaluations` and `rule_overrides` are append-only for every connection; only
  `db:seed` may purge its own demo evidence, through the transaction-scoped
  `app.rule_purge` flag that request connections never set.
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
  `tests/m1/postgres.integration.test.ts` and `tests/m1/auth.durable.test.ts`.

## Durable authentication surface

No tenant context exists before login, so `users`, `sessions` and `audit_log` cannot be
queried directly by `iconcrete_app`. Migration `0006` exposes a deliberately small set of
`SECURITY DEFINER` functions instead:

| Function | Purpose |
|---|---|
| `auth_find_company(text)` | company identity for login (migration 0003) |
| `auth_find_user(company, username)` | one company-scoped user row, including the argon2id hash |
| `auth_login_failed(user, max, minutes)` | increments the failure counter and locks when the limit is hit |
| `auth_login_succeeded(user)` | resets counters, stamps `last_login_at` |
| `auth_create_session(...)` | inserts a session row; validates the user + 64-char token hash |
| `auth_resolve_session(hash, idle)` | returns the session + safe user, slides idle expiry; refuses revoked/expired/inactive |
| `auth_revoke_session(hash)` | logout / explicit revocation |
| `auth_expire_session(hash)` | closes an already-expired session so the event is auditable |
| `auth_audit(...)` | append-only audit insert usable before a tenant context exists |
| `auth_list_audit(company, limit)` | company-scoped audit read for `/api/audit` |

Controls applied to every function: `search_path = pg_catalog, public` with fully
schema-qualified objects (no hijackable names), `EXECUTE` revoked from `PUBLIC` and
granted only to `iconcrete_app`, explicit input validation, and no password/token values
in any audit parameter. Only the SHA-256 session token hash is stored; the raw token
exists only in the client response and in memory during the request.

The audit table is append-only for the application connection (`trg_audit_append_only`).
The `app.audit_purge` / `app.seed_reset` maintenance flags are set only by `db:seed`,
never by a request connection.

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

- In `postgres` mode login, logout, session validation and audit go through the durable
  tables above. Dashboard, reports and Excel-import endpoints are still served by the
  Phase 1 demo dataset; a session from any other company receives
  `403 tenant_data_unavailable` rather than another tenant's rows.
- Staged Excel imports are still held in process memory (the `staged_imports` table
exists but the commit path does not use it yet).
- The API is token-authenticated with an `Authorization: Bearer` header and stores no
  cookies, so there is no cookie-based CSRF surface today. Introducing cookie sessions
  later requires a CSRF token or a `SameSite=Strict` design first.
- M1 API endpoints return `503 postgres_required` in `demo`/`test` mode.
- The UI still renders Phase 1 screens only; M1 has no screens yet.
- Integration tests need a running PostgreSQL; otherwise they are reported as skipped
  with the exact reason.
- The `iconcrete_app` role is created without a password; local clusters set one with
  `bun run db:role`, production injects it through the deployment secret store.
