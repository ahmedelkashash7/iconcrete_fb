# Implementation status

Status vocabulary (from the master specification §3): **IMPLEMENTED AND VERIFIED**,
**IMPLEMENTED BUT NOT FULLY VERIFIED**, **DEMO ONLY**, **TEMPLATE ONLY**,
**INTEGRATION READY**, **BLOCKED**, **NOT IMPLEMENTED**, **NOT TESTED**.

Evidence column names the file or command that supports the claim. "Verified" always means a
test or command that was actually executed at the Phase 2 closure tip `978c7d1` (plus the
closure commit that added the rule catalogue screen).

## Platform

| Capability | Status | Evidence |
|---|---|---|
| Arabic RTL default, English LTR switch | IMPLEMENTED AND VERIFIED | `src/i18n/*`, `tests/i18n.test.ts` (key parity, no empty values) |
| Locked brand, palette, tagline | IMPLEMENTED AND VERIFIED | `src/brand.ts`, `tests/seed.test.ts`, health endpoint |
| Application shell, navigation, RBAC gates | IMPLEMENTED AND VERIFIED | `src/core/rbac.ts`, `tests/rbac.test.ts`, API 401/403 tests |
| Login (demo adapter) | IMPLEMENTED AND VERIFIED | `server/auth.ts`, `tests/api.test.ts` |
| Login/session/audit (postgres adapter) | IMPLEMENTED AND VERIFIED | `server/auth.ts`, `db/migrations/0006`, `tests/m1/auth.durable.test.ts` |
| Tenant isolation (RLS) | IMPLEMENTED AND VERIFIED | `db/migrations/0003`, `tests/m1/postgres.integration.test.ts` |
| Durable audit + append-only | IMPLEMENTED AND VERIFIED | `0006`, `auth.durable.test.ts` |
| Dashboard (derived KPIs, balance, alerts, charts) | IMPLEMENTED AND VERIFIED | database-backed under RLS in postgres mode (`server/db/datasetRepo.ts`), demo dataset in demo/test mode; `tests/m1/dataset.readmodel.test.ts` |
| Reports (7 types, filters, print, xlsx) | IMPLEMENTED AND VERIFIED | `src/core/reports.ts`; database-backed read model in postgres mode; `tests/seed.test.ts`, `tests/api.test.ts`, `tests/m1/dataset.readmodel.test.ts` |
| Excel Integration Center (upload→preview→validate→commit→discard→audit) | IMPLEMENTED AND VERIFIED | `server/index.ts`, `server/db/importRepo.ts`, `src/core/validation.ts`; durable staging tested in `tests/m1/import.durable.test.ts` |
| Portable Excel generator (15 sheets, charts) | IMPLEMENTED AND VERIFIED | `excel_generator/`, 28 pytest tests, generation command exit 0 |

## Business modules (spec §2)

| # | Module | Status | Reality |
|---|---|---|---|
| 1 | Sales and CRM | NOT IMPLEMENTED | no leads/opportunities/quotations tables or screens |
| 2 | Customers and projects | IMPLEMENTED AND VERIFIED | `customers` table + API + Excel template; `projects` table, service, API and screen (`tests/m1/b1.projects.orders.test.ts`) |
| 3 | Quotations and contracts | NOT IMPLEMENTED | — |
| 4 | Orders and scheduling | IMPLEMENTED AND VERIFIED | `orders` table, service, API and screen with lifecycle transitions; scheduling is order-level only, no plant calendar |
| 5 | Mix designs | IMPLEMENTED AND VERIFIED | migration `0013`, versioned designs, approved-version immutability, `src/core/mixDesign.ts`, API, screen, `tests/m2/*`, `tests/mixDesign.test.ts` |
| 6 | Production and batching | IMPLEMENTED AND VERIFIED | migration `0014`, batch lifecycle, components, moisture validity, completion immutability, overrides, API, screen, `tests/m3/batching.test.ts` |
| 7 | Quality and laboratory | IMPLEMENTED AND VERIFIED | migration `0015`, tests/specimens/NCR/CAPA/certificates, calibration hold, API, screens, `tests/m4/quality.test.ts` |
| 8 | Materials and inventory | TEMPLATE ONLY (+ demo dataset) | import of materials + opening balances; balances still demo-side |
| 9 | Procurement and suppliers | IMPLEMENTED AND VERIFIED | PO/GRN/bill/three-way match tables + service + PostgreSQL tests |
| 10 | Fleet and dispatch | IMPLEMENTED AND VERIFIED | migration `0016`, trucks/drivers/assignments/trips/maintenance/GPS/overrides, one-open-trip index, API, screens, `tests/m5/fleet.test.ts` |
| 11 | Drivers and trips | IMPLEMENTED AND VERIFIED | `drivers` and `trips` tables with lifecycle, licence gate, volumes, site wait and difference reason; `tests/m5/fleet.test.ts` |
| 12 | Delivery tickets / POD | NOT IMPLEMENTED | — |
| 13 | Pumps and pumping jobs | NOT IMPLEMENTED | — |
| 14 | Maintenance and spare parts | IMPLEMENTED (truck maintenance) / NOT IMPLEMENTED (spare parts) | `truck_maintenance` open/close with odometer and cost, status gate tested; no parts inventory or work orders |
| 15 | Weighbridge | NOT IMPLEMENTED | no adapter, no hardware path |
| 16 | Accounting and finance | IMPLEMENTED AND VERIFIED (backend) / NOT IMPLEMENTED (screens) | journal, trial balance, AR/AP, treasury, assets, loans, procurement services with PostgreSQL tests; **no accounting UI** |
| 17 | HR and payroll | TEMPLATE ONLY | `employees` template; payroll not implemented |
| 18 | Assets and depreciation | IMPLEMENTED AND VERIFIED | `src/core/assets.ts`, DB schedule + posting tests |
| 19 | Environmental and recycling | NOT IMPLEMENTED | — |
| 20 | Reports and analytics | IMPLEMENTED AND VERIFIED | 7 Phase 1 report types + xlsx export; accounting report set partially (general balance, GL, trial balance in M1 API) |
| 21 | Offline operations | NOT IMPLEMENTED | no service worker, no sync queue |
| 22 | Multi-plant management | IMPLEMENTED (isolation) / NOT IMPLEMENTED (consolidation) | RLS plant policy tested; no consolidated cross-plant reporting |
| 23 | Excel generation and integration | IMPLEMENTED AND VERIFIED | generator + templates + import/export flow |
| 24 | Customer and driver portals | NOT IMPLEMENTED | — |
| 25 | Notifications | NOT IMPLEMENTED | no provider, no queue |
| 26 | Forecasting and governed AI | NOT IMPLEMENTED | no model, no forecast data |

## Phase 2 core (M2–M5) — status at the closure tip

| Item | Status | Evidence |
|---|---|---|
| M1 accounting service layer | IMPLEMENTED AND VERIFIED | migrations `0002`–`0011`, `server/services/m1.ts`, `/api/m1/*`, PostgreSQL tests; screens for invoices/payments/statement/ledger |
| M2 Mix Design | IMPLEMENTED AND VERIFIED | `0013`, `src/core/mixDesign.ts`, API, `MixDesignsPage`, 17 tests in `tests/m2` + `tests/mixDesign.test.ts` |
| M3 Batching | IMPLEMENTED AND VERIFIED | `0014`, `src/core/batching.ts`, API, `BatchListPage`/`BatchDetailPage`, 15 tests |
| M4 Quality/Lab | IMPLEMENTED AND VERIFIED | `0015`, `src/core/quality.ts`, API, quality/NCR screens, 13 tests |
| M5 Fleet/Dispatch | IMPLEMENTED AND VERIFIED | `0016`, `src/core/fleet.ts`, API, fleet/dispatch/trip screens, 15 tests |
| Mix-design version editor UI | BLOCKED (deferred) | service/API support exists; no screen for editing a draft version |
| ECP catalogue UI | IMPLEMENTED AND VERIFIED | `src/pages/RuleCataloguePage.tsx`, `/api/rules`; shows missing value/source, level-5 edit requires a source note; route/nav/label tests |
| Browser/rendering tests | NOT TESTED | no browser or automation in this environment |
| GitHub remote | NOT TESTED | no authenticated remote or push was used |

## Phase 1 acceptance gate (spec §57)

| # | Criterion | Status |
|---|---|---|
| 1 | Implemented routes load without runtime errors | **PARTIAL** — build and route smoke tests pass; no browser exists to load a route |
| 2 | Active navigation leads to valid destinations | **PASS** — every nav item is a registered page and every page is in nav (`tests/routes.smoke.test.ts`) |
| 3 | Visible actions work or are disabled with an explanation | **PASS** — actions call real endpoints; unavailable actions are absent; RBAC hides disallowed controls |
| 4 | Consistent customer data model | **PASS** — one `customers` table for API, import and read models |
| 5 | Lists/details/reports share one source | **PASS** — postgres read models under RLS; `tests/m1/dataset.readmodel.test.ts`, `tests/m1/readmodel.http.test.ts` |
| 6 | Creating/editing a customer updates all views | **PARTIAL** — creation via Excel import updates all read models; no create/edit screen |
| 7 | Dashboard metrics derived from data | **PASS** — `tests/seed.test.ts`, `tests/m1/dataset.readmodel.test.ts`; Phase 2 tables feed batch/quality/dispatch figures |
| 8 | Synthetic demo data clearly identified | **PASS** — demo mode banner and synthetic flags |
| 9 | CSV import with validation and preview | **PASS** — `tests/m1/b2.csv.staging.test.ts` |
| 10 | Imports do not silently overwrite/duplicate | **PASS** — checksum duplicate rejection and explicit commit |
| 11 | Excel generator creates a genuine XLSX | **PASS** — 28 Python tests executed in Phase 1; not re-run in Phase 2 |
| 12 | Unsupported features documented | **PASS** — this file, `ISSUES_AND_GAPS.md`, `PHASE2_CLOSURE_REPORT.md` |
| 13 | Tests executed and recorded | **PASS** — 324 pass / 0 fail / 0 skip at the closure tip |
| 14 | Known issues documented | **PASS** — `ISSUES_AND_GAPS.md`, closure report item 14 |
| 15 | No later-phase feature presented as operational | **PASS** — status matrix separates implemented, deferred, blocked and not tested |

## Gap closure (revision after review)

| Item | Status | Evidence |
|---|---|---|
| G1 durable staged imports | IMPLEMENTED AND VERIFIED | `db/migrations/0008_m1_durable_imports.sql`, `server/db/importRepo.ts`, `tests/m1/import.durable.test.ts`: survives a new connection, commits into `import_records` + `customers` + credit limit, refuses a second commit, discards explicitly, denies another tenant |
| G2 database-backed dashboard/reports | IMPLEMENTED AND VERIFIED for dashboard, all reports, customer list and both exports | `server/db/datasetRepo.ts` wired in `server/index.ts`; `tests/m1/dataset.readmodel.test.ts` proves company and plant isolation against the restricted role |
| G2 remainder (plants, users, excel-audit feed) | NOT IMPLEMENTED — still demo read models behind the 403 guard | recorded in `docs/ISSUES_AND_GAPS.md` |
| Data dictionary generated from schema | IMPLEMENTED AND VERIFIED | `scripts/schema-docs.ts`; `tests/m1/data-dictionary.test.ts` renders the schema again and fails on any drift |
| Reproducible verification | IMPLEMENTED AND VERIFIED | `scripts/verify.sh`: own PostgreSQL, migrations, seed, 0 skips enforced, build, pytest, generator |

Database-backed read models currently cover: company, plants, customers + credit limits,
suppliers, invoices + payment allocations, supplier bills, cash, bank accounts and
transactions, cheques, fixed assets, loans and installment schedules.

Still empty in postgres mode because no tables exist: materials/inventory, spare parts, salary
payments, rentals, utilities and pumps. Mix designs, batches, moisture readings, quality tests,
trucks, drivers, trips and truck maintenance now exist and are read under RLS; KPI cards that
depend on the missing tables still show an explicit state rather than demo numbers.

## UI verification limits

| Claim | Verified how | Not verified |
|---|---|---|
| Arabic is the default language | i18n tests, API `lang` handling, `dir` attribute in source | rendered Arabic typography |
| RTL direction is applied | `dir="rtl"` in the shell and `[dir]` CSS rules | bidi ordering inside tables, mixed Arabic/Latin numerals |
| Bilingual key parity | `tests/i18n.test.ts` | truncation of long Arabic labels |
| Report export layout | XLSX generation tests + HTTP 200 | print preview, pagination |
| Responsive layout | CSS review only | any viewport |

No browser automation exists in this environment, so **no visual RTL, font, print or mobile
check has been performed**. The honest status for "visual RTL rendering" is NOT TESTED.

## M1 gap closure — 2026-11-02

Status vocabulary: IMPLEMENTED AND VERIFIED / IMPLEMENTED BUT NOT FULLY VERIFIED / DEMO ONLY /
TEMPLATE ONLY / INTEGRATION READY / BLOCKED / NOT IMPLEMENTED / NOT TESTED.

| # | Gap | Status | Evidence |
|---|---|---|---|
| G1 | Database-backed users and plants | IMPLEMENTED AND VERIFIED | `server/db/orgRepo.ts`; `/api/users` and `/api/plants` read tenant tables under RLS; `tests/m1/org.readmodel.test.ts` proves company A/B isolation, plant scope, no demo rows, restart stability, real company name |
| G2 | Excel audit read model | IMPLEMENTED AND VERIFIED | Eight lifecycle events persisted through `auth_audit`; `/api/excel/audit` reads `audit_log` under RLS (`PgAuthRepository.listExcelAudit`); duplicates now return `409 duplicate_import`; `tests/m1/audit.excel.test.ts` |
| G3 | Honest KPI states | IMPLEMENTED BUT NOT FULLY VERIFIED | `src/core/availability.ts` + `kpiStates`/`dataSource` in `/api/dashboard`; 503 `data_source_unavailable` instead of zeros. Contract tested (`tests/kpi.availability.test.ts`); **the dashboard UI does not yet render the indicator** (G19) |
| G4 | Backup and restore drill | IMPLEMENTED AND VERIFIED | `scripts/backup-restore-drill.sh`: `pg_dump -Fc`, fresh DB, role re-creation, `pg_restore`, grants, 13 checks (schema, RLS, forced RLS, auth session, imports, ledger balance, audit, row counts, tenant isolation); see `docs/BACKUP_RESTORE_DRILL.md` |
| G5 | Monthly accounting vertical slice | IMPLEMENTED BUT NOT FULLY VERIFIED | Screens Invoices, Payments, Statement, Ledger (+ existing Customers); real `/api/m1/*` calls, no fake success, loading/empty/error/forbidden states. Service + API read models and full flow tested (`tests/m1/vertical.slice.test.ts`); **visual RTL/browser rendering NOT TESTED** |
| G6 | Accounting Excel templates | IMPLEMENTED AND VERIFIED | Nine templates with schema version, bilingual field dictionary endpoint, required/allowed/date/number checks, duplicate and broken-reference errors, durable staging/commit, audit, no overwrite: chart_of_accounts, suppliers, invoices, invoice_items, payments, expenses, cheques, fixed_assets, loans. `tests/m1/excel.templates.test.ts`, `tests/excelWorkbooks.test.ts` |

### Deliberate behaviour changes

- A repeated upload with an identical checksum for the same tenant and template is now rejected
  with `409 duplicate_import` and an `excel.duplicate_rejected` event; it previously returned the
  existing staged record quietly.
- `/api/users` no longer answers `403 tenant_data_unavailable` for a second company; it returns
  that company's own users. A plant-scoped caller only sees users assigned to its plants.

### Known limitations after this pass

- G19: dashboard/reports UI does not display the new availability indicator yet (API only).
- G20: `/api/reports/*` does not return a `dataSource` block yet.
- G21: no browser automation, so Arabic shaping, bidi tables and print layout remain NOT TESTED.
- G13: `pg_dump` drill covers logical backup/restore only — no WAL/PITR, no encryption at rest.
