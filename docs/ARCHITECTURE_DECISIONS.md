# Architecture decision records

Each record states the decision that is **actually in the code at commit `5f90ccc`**, the
context that forced it, and what it costs. Superseding a decision requires a new record;
records are not edited to look better in hindsight.

---

## ADR-001 — Bun + TypeScript (strict) + React 19 + Vite

**Context.** The runner provides Bun 1.3.14 and Node 24; Phase 1 needed one toolchain for
dev server, API and tests without extra infrastructure.
**Decision.** Bun as runtime/package manager/test runner, TypeScript strict, React 19 with
Vite 8, one `tsconfig` used by both `tsc --noEmit` and the Vite build.
**Consequences.** `bun test` runs unit, API and PostgreSQL integration tests in one
command. Bun-specific APIs (`Bun.password`, `Bun.CryptoHasher`, `Bun.SQL`) tie the server
to Bun; that is documented rather than abstracted away.

## ADR-002 — No ORM, explicit SQL through a thin adapter

**Context.** Tenant isolation must be provable at the database level, and a query builder
would hide the SQL that RLS is evaluated against.
**Decision.** `Db`/`Executor` interfaces in `server/db/client.ts` over `Bun.SQL`, with
hand-written SQL and typed row interfaces in `server/services/m1.ts` and
`server/db/authRepo.ts`.
**Consequences.** RLS, triggers and deferred constraints are visible in the code path; every
query is parameterised. Cost: more boilerplate, no automatic migrations generator.

## ADR-003 — PostgreSQL is required only in `postgres` mode

**Context.** The environment has no PostgreSQL, but the product must run a demo without one
and must never silently degrade.
**Decision.** Three explicit modes (`demo`, `test`, `postgres`). `createDb` returns `null`
for demo/test and throws `StorageModeError` when postgres is unreachable.
**Consequences.** Demo works with zero services; production misconfiguration is a startup
failure, not a fallback. Cost: two adapters to keep behaviourally aligned (auth especially).

## ADR-004 — Row Level Security as the tenant boundary

**Context.** Spec §7/§49 require isolation that survives application bugs.
**Decision.** RLS **enabled and forced** on 42 tenant tables; company policy plus a
restrictive plant policy; context set with `SET LOCAL` inside `withTenant()`. Tests connect
as the restricted `iconcrete_app` role, because owners and superusers bypass RLS.
**Consequences.** A forgotten `WHERE company_id` cannot leak data through the app role.
Cost: connections must be the non-owner role in production, and every new tenant table must
be added to the policy loop.

## ADR-005 — SECURITY DEFINER functions for pre-login access

**Context.** Login happens before any tenant context exists, and `users`/`sessions` are RLS
protected.
**Decision.** A small, audited function surface (`auth_find_user`, `auth_login_failed`,
`auth_create_session`, `auth_resolve_session`, `auth_revoke_session`, `auth_expire_session`,
`auth_audit`, `auth_list_audit`) with pinned `search_path`, schema-qualified objects,
`EXECUTE` revoked from `PUBLIC`, and input validation.
**Consequences.** The application role cannot read the whole `users` table, only the row it
names. Cost: the hash for one company+username is readable by the app role — a deliberate,
documented trade-off.

## ADR-006 — Bearer tokens, no cookies (no CSRF surface yet)

**Decision.** Sessions are opaque 75-character tokens returned once and sent as
`Authorization: Bearer`; only the SHA-256 hash is stored.
**Consequences.** No cookie-based CSRF exists today. Any future cookie session must add a
CSRF token and `SameSite`/`Secure` policy first (`docs/SECURITY.md`).

## ADR-007 — Decimal-safe money in application code

**Decision.** `src/core/decimal.ts` (string-backed, half-up rounding) and PostgreSQL
`numeric(18,2)` for persisted money; floats are never used for monetary storage and are
converted explicitly at the boundary.
**Consequences.** Tax, allocation and depreciation totals are reproducible and tested
(`tests/m1/core.test.ts`). Cost: `Number` appears only at the display/serialisation edge,
which reviewers must watch.

## ADR-008 — ExcelJS in the web app, openpyxl in the generator

**Context.** Spec §51 requires a genuinely generated workbook; the web app also exports
report/customer workbooks.
**Decision.** `exceljs` for server-side generation in the app; a separate portable Python
package (`excel_generator/`) using `openpyxl` for the 15-sheet starter workbook.
**Consequences.** Two implementations, deliberately not shared, each covered by its own
tests (140 TS tests + 28 pytest tests). Cost: feature parity must be maintained manually.

## ADR-009 — Pure calculation modules shared by UI, API and tests

**Decision.** Accounting, invoicing, allocation, cheques, assets, loans, three-way match and
reconciliation live in `src/core/*` as pure functions; `server/services/m1.ts` orchestrates
them inside transactions.
**Consequences.** Same rules on client preview and server enforcement; unit tests need no
database. Cost: DB-level triggers duplicate the critical invariants on purpose.

## ADR-010 — Demo dataset is not a second database

**Context.** Addendum B2 forbids Excel or demo state becoming an alternative source of truth.
**Decision.** In `postgres` mode, accounting reads/writes go to the database; Phase 1 read
models still use the seeded demo dataset but **refuse** sessions from another company with
`403 tenant_data_unavailable`.
**Consequences.** No cross-tenant disclosure through demo-backed pages, and the gap is
explicit instead of silent. Cost: a second tenant sees no dashboard until those read models
are database-backed.

## ADR-011 — No mandatory paid service

**Decision.** Core development, tests and demo run with local open-source tools only. No
hosting, email, SMS, AI or payment provider is wired in; every such capability is a labelled
placeholder (see `docs/FREE_TOOLING_AND_COSTS.md`).
**Consequences.** The product is portable and free to run; commercial integrations remain
unimplemented and are not claimed.

## ADR-012 — Status honesty is enforced by documentation and tests

**Decision.** Every module has an explicit status (`docs/IMPLEMENTATION_STATUS.md`);
engineering thresholds that are not traced to a citable source are marked
`NOT VERIFIED AGAINST SOURCE` rather than presented as code requirements.
**Consequences.** Reports can be audited against the repository. Cost: some documents are
less flattering than a marketing page would be.
