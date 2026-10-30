# Import / export map

Only rows marked **implemented** exist in code. Everything else is listed so it is clear what
would still have to be built.

## Import templates (version `1.1.0`, implemented)

| Template | Sheet | Unique key | References | Server destination today |
|---|---|---|---|---|
| `customers` | `Customers` | `customer_id` | `plants` | `store.dataset.customers` (demo adapter) |
| `suppliers` | `Suppliers` | `supplier_id` | — | staged only (no commit branch yet) |
| `materials` | `Materials` | `balance_id` | `plants` | `store.dataset.materials` + `inventory` |
| `mix_designs` | `Mix_Designs` | `mix_id`, `code` | — | staged only |
| `orders` | `Orders` | `order_id` | `customers`, `plants` | staged only |
| `employees` | `Employees` | `employee_id` | `plants` | staged only |
| `fleet` | `Fleet` | `truck_id` | — | staged only |

"Staged only" means: upload, validation, preview, error workbook, explicit commit and audit
all work, but the committed rows are stored in the in-process `imports` landing buffer because
the target tables do not exist yet. They are **not** durable.

Each template is downloadable as a real `.xlsx` with the bilingual header row, an example row
and dropdown validation for enum columns (`server/excel.ts` → `buildTemplateWorkbook`).

## API exports (implemented)

| Endpoint | Format | Source | Permission |
|---|---|---|---|
| `GET /api/export/reports/:type(.xlsx)` | XLSX | `src/core/reports.ts` report | level ≥ 2, audited |
| `GET /api/export/customers.xlsx` | XLSX | customer rows + derived outstanding | level ≥ 4, audited |
| `GET /api/excel/templates/:id.xlsx` | XLSX | template schema | level ≥ 4, audited |
| `GET /api/excel/errors/:stagedId.xlsx` | XLSX | staged validation result | level ≥ 4, audited |
| `GET /api/m1/journal`, `/trial-balance`, `/ledger`, `/aging` | JSON (not XLSX yet) | PostgreSQL | level ≥ 2 |

Report export respects the caller's filters and is refused for the viewer role with `403`.

## Starter workbook ↔ web app

| Workbook sheet | Web/app counterpart | Status |
|---|---|---|
| `Customers` | customers template / `customers` table | aligned |
| `Suppliers` | suppliers template / `suppliers` table | aligned |
| `Materials`, `Inventory_Snapshot` | materials template | aligned |
| `Mix_Designs` | mix design template + validation | aligned |
| `Concrete_Orders` | orders template | aligned |
| `Employees` | employees template | aligned |
| `Trucks` / fleet | fleet template | aligned |
| `Invoices`, `Journal_Entries`, `GL_Accounts`, `Cheques`, `Fixed_Assets`, `Loans` | M1 accounting services | **workbook-only**; no import template or export endpoint yet |
| `Validation_Report`, `README`, `Data_Dictionary`, `Migration_to_Web_App` | this documentation | documented, not auto-generated into the app |

## Not implemented

- Import templates for: chart of accounts, suppliers' bills, invoices, invoice items,
  payments, expenses, cheques, fixed assets, loans, journal entries (the M1 closure list).
- XLSX export of M1 accounting reports (JSON only today).
- Field-mapping UI for arbitrary spreadsheets.
- Partial-commit policy configuration.
- Durable staging (`staged_imports` writes) and restart-safe import sessions.
