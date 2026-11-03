# ICONCRETE security model (Phase 2 · M1)

This document states what is actually implemented and tested, and what is not. It is
deliberately conservative: nothing here is claimed unless a test or command in this
repository exercises it.

## Storage modes

| Mode | Auth persistence | Data | Notes |
|---|---|---|---|
| `demo` | process memory | seeded demo dataset | development/demo only |
| `test` | process memory | empty | unit tests |
| `postgres` | PostgreSQL (`sessions`, `users`, `audit_log`) | M1 accounting tables | never falls back to memory |

`ICONCRETE_ENV=production` additionally requires `ICONCRETE_STORAGE_MODE=postgres`, a
non-placeholder `DATABASE_URL`, and a non-demo `ICONCRETE_DEMO_ADMIN_PASSWORD` of at least
12 characters. Misconfiguration is a startup error (`ConfigurationError` /
`StorageModeError`), never a warning followed by a weaker mode.

## Authentication flow (postgres mode)

1. `POST /api/auth/login` resolves the company with `auth_find_company(text)`.
2. The user row is loaded through `auth_find_user(company, username)`; the argon2id hash is
   verified with `Bun.password.verify`.
3. Failure counters and lockouts are persisted (`users.failed_login_attempts`,
   `users.locked_until`) through `auth_login_failed`, so a restart cannot reset them.
4. On success a fresh opaque token (`ic_` + two UUIDs) is generated, and only its SHA-256
   hash is stored by `auth_create_session`. The raw token is returned once to the client.
5. Every protected request resolves through `auth_resolve_session(hash, idle)`, which
   refuses revoked, expired, inactive and cross-company sessions and slides the idle
   expiry inside the same transaction.
6. `POST /api/auth/logout` revokes the durable row (`auth_revoke_session`) and writes both
   `auth.logout` and `auth.session.revoked`.

Messages are generic (`invalid_credentials`, `unauthorized`) so a caller cannot enumerate
users, and password verification failures never surface as 500s.

## Audit events

Persisted in `audit_log` with actor, company/plant, action, table, record id, IP, user
agent, request id, result, UTC timestamp and JSON details:

- `auth.login.success`
- `auth.login.failure`
- `auth.logout`
- `auth.session.revoked`
- `auth.session.expired`
- `auth.lockout`
- `accounting.journal_posted`, `accounting.journal_reversed`, invoice/payment/cheque/asset/
  loan/procurement events written by the M1 services
- `excel.validate`, `excel.commit`, `excel.row_rejected`, `excel.template_download`,
  `excel.error_report_download`
- `report.export`

No audit event may contain a password, a session token or a secret; the durable-auth tests
assert that no login attempt writes the submitted password material.

`audit_log` is append-only for the application connection: `trg_audit_append_only` raises on
`UPDATE`/`DELETE`, and RLS hides rows without a tenant context. Demo seeding opts into a
transaction-scoped `app.audit_purge` flag that request connections never set.

## Authorization

- Every route declares a minimum role level; the API returns `401` for an unauthenticated
  request and `403` for an authenticated one below the level. The UI is not the control.
- M1 writes run inside `withTenant()`, so PostgreSQL RLS (enabled **and forced** on 48
  tables) applies to the statement, not to a client-supplied filter.
- Routes still served by the Phase 1 demo dataset answer `403 tenant_data_unavailable` for
  sessions from any other company, so a second tenant cannot read the demo company's
  customers, plants, users, reports or exports.

## Session and secret handling

- Session idle timeout: 30 minutes by default (configurable 1–1440), sliding on each
  request; logout is immediate server-side.
- Session identifier is regenerated on every login; no fixation window exists because the
  token is minted at authentication and never accepted before it.
- Secrets live only in environment variables / the deployment secret store. No migration
  contains a password; the application role is created without one and `bun run db:role`
  sets a local value from `ICONCRETE_APP_PASSWORD` (never printed).
- CSRF: the API uses `Authorization: Bearer` tokens and sets no cookies, so there is no
  cookie-based CSRF surface today. Any future cookie session must add CSRF protection and
  `SameSite`/`Secure` policy first.

## Limitations (not implemented)

- Staged Excel imports remain in process memory; `staged_imports` is not written yet, so a
  restart loses an uncommitted staged upload.
- Dashboard, reports and Excel-import reads/writes still use the Phase 1 demo dataset in
  postgres mode (other tenants are refused rather than served).
- No 2FA, no SSO, no password-reset flow, no per-device session management UI.
- No automated audit retention job; retention is documented in `docs/DATABASE.md`.
- No rate limiting beyond the in-process failure counter/CAPTCHA; the durable lockout is the
  authoritative control.
- Integration and durable-auth tests require a real PostgreSQL; without `DATABASE_URL` they
  are reported as skipped with the exact reason and must not be counted as passes.

## Security status — 2026-11-02 (honest)

| Control | Status | Evidence |
|---|---|---|
| Password hashing | IMPLEMENTED AND VERIFIED | argon2id; login and lockout tests exercise real hashes |
| Session expiry | IMPLEMENTED AND VERIFIED | 30-minute sliding idle expiry; "expired sessions are rejected server-side and audited" |
| Session revocation | IMPLEMENTED AND VERIFIED | logout revokes the durable session and the revocation survives a restart |
| Failed-login protection | IMPLEMENTED AND VERIFIED | lockout after five failures, audited across a restart |
| Rate limiting | NOT IMPLEMENTED | no request-rate limiter exists |
| Password reset | NOT IMPLEMENTED | no reset flow |
| CSRF protection | NOT APPLICABLE / NOT IMPLEMENTED | the API uses bearer tokens from sessionStorage, not cookies; there is no cookie-authenticated state-changing route. If cookies are introduced, CSRF protection becomes required |
| Secure cookie configuration | NOT APPLICABLE | no cookies are issued |
| TOTP 2FA | NOT IMPLEMENTED | login screen says so; settings entry is a placeholder |
| Upload handling | IMPLEMENTED AND VERIFIED | extension/size limits, `.xlsm` rejection, formula neutralisation, staged commit with explicit confirmation |
| Output encoding | IMPLEMENTED (framework) | React escapes rendered values; no explicit audit of every sink has been performed |

These are also recorded in `docs/ISSUES_AND_GAPS.md`. Nothing here is claimed beyond the test
names quoted.

---

## B3 update — design system, uploads and audit surface

Nothing in B3 weakened the model; it added a read-only reference page and stricter checks.

- **Palette and contrast.** `tests/design.tokens.test.ts` fails if the §1 palette drifts or a
  text pair drops below its WCAG target. Success (3.30:1), warning (2.15:1) and secondary
  (4.23:1) are therefore restricted to tinted backgrounds, markers and large text; they are
  never body text on white.
- **Design-system page.** Registered at role level 5 alongside settings; it renders static
  samples only, performs no API call and exposes no tenant data.
- **Focus and motion.** `:focus-visible` rings and a `prefers-reduced-motion` clamp are
  global; keyboard users no longer lose the caret outline.
- **Dialog semantics.** The reference dialog sets `role="dialog"`, `aria-modal="true"` and an
  `aria-labelledby` title; there is still no focus trap test (G15).
- **Uploads.** Unchanged from B2: 2 MB cap, `.csv` only, sha256 checksum, no macro execution,
  uploaded formulas never trusted, errors returned bilingually.
- **Audit.** CSV staging writes `csv.staged`, `csv.rejected`, `csv.edited`,
  `csv.row_committed`, `csv.committed`; `audit_log` remains append-only at the database level.

Still absent: CSRF protection (safe only while sessions stay bearer-only), 2FA, password
reset, session-management UI, edge rate limiting, audit retention policy.

### G2 closure (this commit)

- Dashboard, report and customer reads now come from tenant tables under RLS in postgres mode.
  The demo dataset is used only in demo/test mode and is labelled in the response
  (`dataSource.mode`/`adapter`, `storageMode`, per-KPI `source`).
- Fixed in the same change: `customer_statement` used to fall back to the tenant's first
  customer when the requested `customerId` was not visible, which answered a cross-tenant
  request with another party's statement. A non-visible explicit id now yields an empty
  statement; the fallback remains only for requests that omit `customerId`.
- No new endpoint, no new secret, no change to sessions, RBAC levels or upload limits.
