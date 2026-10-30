# Implementation status

Status vocabulary (from the master specification §3): **IMPLEMENTED AND VERIFIED**,
**IMPLEMENTED BUT NOT FULLY VERIFIED**, **DEMO ONLY**, **TEMPLATE ONLY**,
**INTEGRATION READY**, **BLOCKED**, **NOT IMPLEMENTED**, **NOT TESTED**.

Evidence column names the file or command that supports the claim. "Verified" always means a
test or command that was actually executed at commit `5f90ccc`.

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
| Dashboard (derived KPIs, balance, alerts, charts) | IMPLEMENTED AND VERIFIED for the demo dataset | `src/core/metrics.ts`, `tests/seed.test.ts`; not database-backed |
| Reports (7 types, filters, print, xlsx) | IMPLEMENTED AND VERIFIED | `src/core/reports.ts`, `tests/seed.test.ts`, `tests/api.test.ts` |
| Excel Integration Center (upload→preview→validate→commit→audit) | IMPLEMENTED AND VERIFIED | `server/index.ts`, `src/core/validation.ts`, `tests/api.test.ts`, `tests/validation.test.ts` |
| Portable Excel generator (15 sheets, charts) | IMPLEMENTED AND VERIFIED | `excel_generator/`, 28 pytest tests, generation command exit 0 |

## Business modules (spec §2)

| # | Module | Status | Reality |
|---|---|---|---|
| 1 | Sales and CRM | NOT IMPLEMENTED | no leads/opportunities/quotations tables or screens |
| 2 | Customers and projects | IMPLEMENTED (customers) / NOT IMPLEMENTED (projects) | `customers` table + API + Excel template; no `projects` table |
| 3 | Quotations and contracts | NOT IMPLEMENTED | — |
| 4 | Orders and scheduling | TEMPLATE ONLY | `orders` import template validates credit/volume; no order table, no scheduling |
| 5 | Mix designs | TEMPLATE ONLY | template + workbook sheet with yield/W-C checks; no mix tables |
| 6 | Production and batching | DEMO ONLY | demo dataset batches feed dashboard KPIs; no tables, no batching |
| 7 | Quality and laboratory | DEMO ONLY | demo quality tests in dashboard summary; no lab tables |
| 8 | Materials and inventory | TEMPLATE ONLY (+ demo dataset) | import of materials + opening balances; balances still demo-side |
| 9 | Procurement and suppliers | IMPLEMENTED AND VERIFIED | PO/GRN/bill/three-way match tables + service + PostgreSQL tests |
| 10 | Fleet and dispatch | TEMPLATE ONLY | `fleet` import template + demo trucks; no fleet tables |
| 11 | Drivers and trips | DEMO ONLY | demo trips drive on-time KPI; no tables |
| 12 | Delivery tickets / POD | NOT IMPLEMENTED | — |
| 13 | Pumps and pumping jobs | NOT IMPLEMENTED | — |
| 14 | Maintenance and spare parts | DEMO ONLY | demo maintenance orders appear in balance; no tables |
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

## Phase 1 acceptance gate (spec §57)

| # | Criterion | Status |
|---|---|---|
| 1 | Implemented routes load without runtime errors | IMPLEMENTED BUT NOT FULLY VERIFIED (no browser automation available; covered by build + API tests) |
| 2 | Active navigation leads to valid destinations | IMPLEMENTED AND VERIFIED (unit-tested page keys, no dead menu entries) |
| 3 | Visible actions work or are disabled with an explanation | IMPLEMENTED AND VERIFIED for Phase 1 actions; later-module buttons are absent rather than fake |
| 4 | Consistent customer data model | IMPLEMENTED AND VERIFIED |
| 5 | Lists/details/reports share one source | IMPLEMENTED AND VERIFIED for the demo dataset (`createDemoDataset`) |
| 6 | Creating/editing a customer updates all views | PARTIAL — customer creation only via Excel import commit (demo adapter); no edit screen |
| 7 | Dashboard metrics derived from data | IMPLEMENTED AND VERIFIED (`tests/seed.test.ts`) |
| 8 | Synthetic demo data clearly identified | IMPLEMENTED AND VERIFIED |
| 9 | CSV import with validation and preview | IMPLEMENTED AND VERIFIED |
| 10 | Imports do not silently overwrite/duplicate | IMPLEMENTED AND VERIFIED (duplicate detection + explicit commit) |
| 11 | Excel generator creates a genuine XLSX | IMPLEMENTED AND VERIFIED |
| 12 | Unsupported features documented | this file + `docs/ISSUES_AND_GAPS.md` |
| 13 | Tests executed and recorded | 140 TS + 28 Python executed at `5f90ccc` |
| 14 | Known issues documented | `docs/ISSUES_AND_GAPS.md` |
| 15 | No later-phase feature presented as operational | enforced by this matrix |
