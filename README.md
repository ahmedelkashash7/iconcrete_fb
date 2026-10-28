# ICONCRETE — Concrete Management Solutions

**IConcrete-fp** — a ready-mix concrete plant management system.
Brand: **ICONCRETE**, tagline **Concrete Management Solutions**.
Arabic (RTL) is the default language; English is the second language.
Licence: MIT.

> **Phase 1 is a demo prototype.** It delivers authentication, RBAC structure, the dashboard
> and reports structure, the customers/plants/users data foundation, and the Excel Integration
> Center, plus a portable Python Excel generator. Operational modules (M1–M19) are **not**
> built yet and nothing here claims they are.

---

## Quick start

Requirements: [Bun](https://bun.sh) 1.2+ (tested on 1.3.14), Python 3.9+ for the Excel generator.

```bash
bun install

# runs the Bun API (port 3001) and the Vite dev server (port 3000) together
bun run dev
```

Open <http://localhost:3000>. Arabic RTL loads first; switch to English from the login screen
or the header. The UI proxies `/api` to the Bun server.

### Demo accounts (demo data only — never reuse in production)

| Username | Role | Level | Sees |
|---|---|---|---|
| `admin` | Owner / Administrator | 5 | Everything |
| `manager` | Plant Manager | 4 | Dashboard, reports, customers, Excel center |
| `dispatcher` | Dispatcher | 3 | Dashboard, reports |
| `operator` | Operator | 2 | Dashboard, reports |
| `viewer` | Viewer | 1 | Dashboard (no financial balance), reports (no export) |

Company: `ICONCRETE Demo Company` (or `شركة آي كونكريت التجريبية`)
Password for every demo account: `Demo@2026` (override the admin password with
`ICONCRETE_DEMO_ADMIN_PASSWORD` before any non-demo use).

Demo company/plant: شركة آي كونكريت التجريبية / IConcrete Demo Company —
محطة آي كونكريت التجريبية - القاهرة / IConcrete Demo Plant - Cairo. Currency EGP, timezone Africa/Cairo.

### Scripts

| Command | What it does |
|---|---|
| `bun run dev` | API + Vite dev server together |
| `bun run dev:web` | Vite only (needs `bun run api` separately) |
| `bun run api` | Bun API on `API_PORT` (default 3001) |
| `bun run typecheck` | `tsc --noEmit` (strict) |
| `bun test` | Unit + API integration tests |
| `bun run build` | Typecheck then Vite production build |
| `bun run excel` | Generate the standalone Excel workbook |
| `bun run test:excel` | Python test suite for the generator |

Copy `.env.example` to `.env` to change the demo password, session idle minutes, lockout
threshold or upload limit. `.env` is ignored by Git.

---

## What Phase 1 actually contains

**Authentication & RBAC**
- Arabic-first login with company, username, password and language switch before login.
- Locked ICONCRETE branding and tagline; purple-to-blue flat identity (`#6D28D9` primary).
- Five role levels enforced **server-side** (`403`), not just hidden in the UI.
- Sessions expire after 30 idle minutes (sliding), stored as SHA-256 token hashes.
- Account lockout after 5 failed attempts; a local math CAPTCHA is required from the third
  failure onward (no external service, works offline).
- 2FA (TOTP) is **not implemented** — the login screen says so and the settings entry is a
  placeholder for a later phase.
- Every login attempt, lockout, logout, import, export and rejected row is written to an
  in-memory audit log (durable storage arrives with M1/PostgreSQL).

**Dashboard (structure, real derived numbers)**
- General balance: cash, bank, cheques under collection, receivables, inventory value at
  weighted cost, fixed-asset book value vs. loans, supplier payables, salaries, rent,
  utilities, maintenance — every figure derived from source arrays, never typed.
- Net position with profit/loss colouring, KPI grid, bar/line/doughnut charts (Recharts),
  urgent alerts (cheques due, overdue loan, low stock, overdue invoices) and a 7-day
  quality summary.
- Viewer role gets the balance masked (server returns `null`) — the "limited dashboard".

**Reports (one filter drives one table)**
- Seven report types: general balance, customer statement, supplier statement, sales period,
  cash movement, inventory, production period.
- Date range + dynamic customer filter, totals row, print view (browser "Save as PDF"),
  and real `.xlsx` export generated server-side with ExcelJS (viewer export → 403).

**Data foundation**
- 24 customers, 2 plants, 5 users/roles, 6 suppliers, 6 materials, 12 trucks, invoices,
  cash/bank/cheques, loans, payroll, rentals, utilities, maintenance, batches, trips and
  quality tests — deterministic demo data, all marked `demo`.
- Customers are read-only in Phase 1 (create/edit is M1); outstanding and available credit
  are always derived from invoices.

**Excel Integration Center**
- Seven downloadable `.xlsx` templates (customers, suppliers, materials opening balances,
  mix designs, orders, employees, fleet) with bilingual headers, dropdowns, frozen headers
  and an instructions + fields sheet.
- Upload `.xlsx`/`.csv` (max 2 MB) → server-side parse → validation preview → row-level
  bilingual errors → downloadable error workbook → explicit confirmation → commit.
- Rejects macros/`.xlsm`/`.xlsb`, unsupported types, oversized files; sanitises control
  characters and neutralises formula-like content; keeps the upload checksum and template
  version; never overwrites silently (duplicate IDs are rejected); audit entry for every
  step, including up to 50 rejected rows per upload.
- Committed customers and materials land in the demo store; other templates land in an
  import buffer until their module tables exist (documented, not hidden).

**Portable Excel generator** — see the section below.

---

## Architecture

```
server/                  Bun HTTP API (no framework)
  index.ts               routing, RBAC guards, staged import/commit, audit
  auth.ts                password hashing, lockout, sessions, token hashing
  store.ts               seeded in-memory store (PostgreSQL/RLS is Phase 2)
  excel.ts               template + error workbooks (ExcelJS), upload parsing
  export.ts              report/customer .xlsx exports
  csv.ts                 RFC-4180 CSV reader
src/
  core/                  pure domain logic (balance, credit, validation, reports, RBAC, money)
  seed/demo.ts           deterministic demo dataset
  i18n/                  ar + en resources (key parity enforced by tests)
  pages/                 Login, Dashboard, Reports, Customers, Excel Center, structure pages
  components/            shell, UI kit, charts, brand
excel_generator/         standalone Python generator + notebook + tests + sample inputs
tests/                   bun test suites (unit + API integration)
docs/                    Phase 1 report and Excel generator changelog
```

Money and derived values always run through `src/core/*`; the API never trusts client-side
totals. All timestamps are ISO-8601 UTC.

---

## Excel generator (portable, standalone)

Located in [`excel_generator/`](excel_generator). It produces a real `.xlsx` workbook with
15 sheets, Arabic RTL by default, Excel tables, formulas, dropdown validations, conditional
formatting, protected formula cells and three dashboard charts.

```bash
python3 -m venv .venv
.venv/bin/pip install -r excel_generator/requirements.txt
python3 excel_generator/generate_workbook.py            # -> excel_generator/output/IConcrete_<timestamp>.xlsx
python3 -m pytest excel_generator/tests -q              # 28 automated tests
```

Google Colab: open [`excel_generator/IConcrete_Generator.ipynb`](excel_generator/IConcrete_Generator.ipynb)
and run cells 1–9. No API keys, AI Studio, backend, Excel Desktop or source edits required.

Documentation: [Arabic](excel_generator/README_AR.md) · [English](excel_generator/README_EN.md) ·
[Changelog](docs/EXCEL_GENERATOR_CHANGELOG.md).

### Excel is not a second database

Once a database is connected it is the single source of truth. Excel is used only as a
starter/offline workbook, an import template, an export/report format and a controlled
data-entry template. Uploads are validated before commit, never silently overwrite records,
and are always audited.

---

## Testing

```bash
bun test             # unit + API integration (auth, RBAC, reports, import/commit, audit)
bun run typecheck    # strict TypeScript
bun run build        # typecheck + production bundle
bun run test:excel   # Python generator suite
```

See [`docs/PHASE1.md`](docs/PHASE1.md) for the exact commands, results, implemented features,
known limitations and the Phase 2 continuation prompt.

---

## Known limitations (Phase 1, stated honestly)

- **No database.** The Bun store is in-memory and seeded at startup; imports are lost on
  restart. PostgreSQL + Row-Level Security, migrations and backup/restore are Phase 2 (M1).
- **No offline sync.** The SQLite/indexed write queue from M17 does not exist yet.
- **No 2FA, no real RBAC on a database.** Roles are enforced in the API but not by RLS.
- **No operational modules** (accounting M1, batching M2, fleet M3, quality M4, … M19).
  Dashboard/report figures come from demo data shaped like those modules.
- **Excel cannot provide** live cloud sync, RLS, real 2FA, GPS/SCADA/IoT connectivity,
  WhatsApp/SMS delivery, Power Query/Data Model/Power Pivot/DAX or server-side API auth.
  The workbook documents this and uses placeholders instead of false claims.
- **In-memory audit log** is a demo; durable, tamper-evident auditing arrives with M1.
- **PDF** uses the browser print dialog rather than a server-side PDF renderer.

## Roadmap

Phase 1 (this delivery) → Phase 2: M1 Accounting, M2 Batching, M3 Fleet, M4 Quality →
Phase 3: M5 Inventory, M6 Orders/Dispatch, M7 Sales, M8 Procurement → Phase 4: M9 HR/Payroll,
M10 Pumps, M11 Weighbridge, M12 Predictive maintenance → Phase 5: M13 Forecasting,
M14 Recycling, M15 Environment, M16 Notifications → Phase 6: M17 Offline, M18 Multi-plant,
M19 Customer portal & apps.

## Licence

MIT — see [LICENSE](LICENSE).
