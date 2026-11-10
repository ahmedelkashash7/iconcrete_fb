# Build and deployment

Measured, reproducible instructions. Nothing here claims a deployment that did not happen:
no remote, no PaaS and no CI exist in this environment (see `docs/ISSUES_AND_GAPS.md`).

## Build (verified at the B3 tip)

```bash
bun install --frozen-lockfile
bun run typecheck          # tsc --noEmit
bun run build              # tsc --noEmit && vite build  → dist/
```

Measured output of `vite build` (819 → split):

| Asset | Raw | gzip |
|---|---|---|
| `index-*.js` (entry: React, router, i18n, shell) | 294.66 kB | 90.34 kB |
| `DashboardPage-*.js` (includes Recharts) | 393.71 kB | 112.42 kB |
| `ExcelCenterPage-*.js` | 20.06 kB | 4.74 kB |
| `DesignSystemPage-*.js` | 17.92 kB | 5.98 kB |
| `ui-*.js` (shared components) | 59.92 kB | 19.77 kB |
| `index-*.css` | 23.07 kB | 5.26 kB |

Before B3 the application shipped one 814.35 kB chunk (232.89 kB gzip) and Vite warned about
it on every build. Pages are now loaded with `React.lazy`, so the first paint no longer
carries the chart library; there is no chunk above 500 kB and the warning is gone.

## Runtime requirements

| Component | Requirement |
|---|---|
| API | Bun ≥ 1.2 (`bun run server/index.ts`) |
| Database | PostgreSQL 16, role `iconcrete_app` with RLS, migrations `0001`–`0011` |
| Web | static files from `dist/`, any static host, `/api` proxied to the API |
| Excel generator | Python 3.9+ with `openpyxl` (see `excel_generator/requirements.txt`) |

## Environment

Copy `.env.example` to `.env`; never commit `.env`. Production requires:

- `ICONCRETE_ENV=production`
- `ICONCRETE_STORAGE_MODE=postgres` (the API refuses memory in production)
- `DATABASE_URL` with a non-placeholder secret
- `ICONCRETE_DEMO_ADMIN_PASSWORD` of 12+ characters and not a demo/placeholder value

The server fails at startup on misconfiguration (`ConfigurationError` / `StorageModeError`).

## Database

```bash
bun run db:migrate     # applies db/migrations/*.sql in filename order, checksum-guarded
bun run db:seed        # idempotent demo dataset
bun run db:status      # applied / pending
bun run schema:docs    # regenerate docs/DATA_DICTIONARY.md from the live schema
```

Migrations are forward-only and checksum-verified: editing an applied migration is refused
(this happened in B3 and was resolved by adding `0011` instead of rewriting `0010`).

## Local production-shaped run

```bash
bun run build
ICONCRETE_STORAGE_MODE=postgres DATABASE_URL=... bun run server/index.ts   # :3001
# serve dist/ with any static server and proxy /api → :3001
```

Vite's dev server proxies `/api` to `ICONCRETE_API_URL` (default `http://127.0.0.1:3001`).
Cloud preview hostnames are supplied through `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`; no
hostname is written into tracked files and `allowedHosts: true` is never used.

## Deployment status

**NOT DEPLOYED.** No Git remote, no hosting credentials and no CI runner are configured.
`gh` is installed but unauthenticated, so repository creation and push are blocked. The
build and the verification gate run locally and are reproducible from the commands above.

## Post-deploy checklist (when a host exists)

1. `bash scripts/verify.sh` on the build machine (must end `pass=… fail=0 skip=0 … ok`).
2. Apply migrations before starting the API; never start on a partially migrated schema.
3. Check `GET /api/health` (200) and one authenticated read per role level.
4. Confirm the reverse proxy forwards `Authorization` and does not buffer `/api/export/*`.
5. Take one backup immediately and record its size in `docs/VERIFICATION_RECORD.md`.
