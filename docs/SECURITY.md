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
- M1 writes run inside `withTenant()`, so PostgreSQL RLS (enabled **and forced** on 42
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
