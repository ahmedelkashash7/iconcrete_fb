# Issues and gaps

Open items at the B3 tip (2026-11-02). The original table was written at `5f90ccc`; rows whose
status changed are marked in the "Status at the B3 tip" section at the end. Severity is about
risk to real operations, not about how hard the fix is. Nothing here is hidden from the phase
reports.

## High

| # | Gap | Impact | Next action |
|---|---|---|---|
| G1 | Staged Excel imports are process-memory only; `staged_imports` is not written | an uncommitted upload is lost on restart; imports are not durable | write staged rows + import records in the postgres path |
| G2 | Phase 1 read models (dashboard, reports, customers/plants/users) still read the demo dataset in postgres mode | a second tenant sees `403` instead of its own data | repository-backed read models + tests |
| G3 | No accounting UI | M1 is an API/service layer only; a user cannot post or invoice from screens | Accounting screens (invoices, payments, statements, GL, trial balance) |
| G4 | M1 Excel templates missing (chart of accounts, suppliers, invoices, invoice items, payments, expenses, cheques, fixed assets, loans) | migration of accounting data is not possible via template | add schemas + generator sheets + tests |
| G5 | No backup/restore verification | disaster recovery is unproven | documented dump/restore drill with a measured restore |

## Medium

| # | Gap | Impact | Next action |
|---|---|---|---|
| G6 | No browser/E2E automation in the environment | RTL rendering and click-through are unverified at browser level | run Playwright in an environment that has a browser |
| G7 | No GitHub remote | no off-machine copy or CI | authenticate `gh`, create `IConcrete_freebuff`, push (see final report) |
| G8 | Audit retention is documented only | unbounded growth; no pruning | scheduled purge job with an explicit policy |
| G9 | No CSRF protection; bearer-only auth | fine today, unsafe if cookie sessions are added | CSRF token + `SameSite` before any cookie session |
| G10 | No 2FA, password reset or session-management UI | operational security depends on password hygiene | TOTP + reset flow |
| G11 | Import validation lacks a schema-version compatibility gate | a future template change could be silently accepted | compare declared version against a supported range |
| G12 | Engineering thresholds unverified (A1–A4) | wrong defaults could mislead operators | source-verified configuration + approval workflow |

## Low

| # | Gap | Impact | Next action |
|---|---|---|---|
| G13 | `TOO_LONG` code is defined but values are truncated instead of rejected | silent truncation of overly long text | strict mode per template |
| G14 | Single JS bundle > 500 kB (build warning) | slower first load | route-level code splitting |
| G15 | No rate limiting beyond lockout/CAPTCHA (in-process per instance) | distributed abuse not covered | edge/WAF or shared counter |
| G16 | Demo dataset has one company for read models | isolation tested only through the 403 guard | multi-tenant fixtures per read model |

## Explicit non-claims

- Egyptian Code compliance, 2FA, live GPS, PLC/SCADA, weighbridge, WhatsApp/SMS delivery,
  predictive AI, offline sync and commercial multi-tenant hosting are **NOT IMPLEMENTED**.
- No deployment has been performed, so no availability, latency or recovery target is claimed.

## Status update after the verification revision

The table above is the historical record; this section states what changed and what did not.

- **G1 (durable staged imports): CLOSED.** Staged results, checksums and lifecycle now live
  in `staged_imports`; committed rows in `import_records`; discard is explicit and audited;
  another tenant cannot read or commit a staged id. Covered by `tests/m1/import.durable.test.ts`.
- **G2 (database read models): PARTIALLY CLOSED.** `/api/dashboard`, `/api/reports/*`,
  `/api/export/*`, `/api/customers` and `/api/customers.xlsx` now read PostgreSQL under RLS.
  `/api/users` and `/api/plants` still serve the demo dataset and keep the
  `403 tenant_data_unavailable` guard for other tenants.
- **G17 (new):** postgres-mode read models return empty arrays for modules without tables
  (batches, trips, quality, inventory, payroll, rentals, utilities, maintenance), so those
  dashboard cards read zero rather than demo numbers.
- **G18 (new):** import commit writes domain rows only for `customers` (plus its credit
  limit); the other six templates persist to `import_records` and wait for their tables.
- **G5 (backup/restore):** the repository now has a tested bundle/archive/restore procedure
  (`docs/BACKUP_AND_RESTORE.md`). A database dump/restore drill is still missing.
- **G6 (no browser) and G7 (no remote) are unchanged.**

## Update — 2026-11-02 (M1 gap closure)

- **G1 — CLOSED.** Users and plants are read from PostgreSQL under RLS with company and plant
  scope; the demo read model is used only in demo/test mode. Verified by
  `tests/m1/org.readmodel.test.ts`.
- **G2 — CLOSED.** Excel audit events are durable and read back from `audit_log`; in-memory audit
  is no longer returned in postgres mode. `tests/m1/audit.excel.test.ts`.
- **G3 — PARTIALLY CLOSED.** The API now distinguishes `available`, `real_zero`, `no_records`,
  `not_implemented` and `unavailable`, and returns 503 instead of zeros when the read fails. The
  dashboard UI does not surface the indicator yet (**G19**) and reports lack a source block (**G20**).
- **G4 — CLOSED.** Executable `pg_dump`/`pg_restore` drill with 13 checks; dumps stay in
  `.verify/` and are never committed. No PITR/encryption claim is made.
- **G5 — IMPLEMENTED, VISUAL VERIFICATION PENDING.** Invoices, receipts, statement and ledger
  screens call the real API. The service and routes are tested; browser rendering is NOT TESTED.
- **G6 — CLOSED for nine accounting templates.** Chart of accounts, suppliers, invoices, invoice
  items, payments, expenses, cheques, fixed assets and loans validate, stage, commit to domain
  tables and audit. **G18 remains open** for materials, orders, employees, fleet and mix designs,
  which still persist only to `import_records`.
- **G17 — PARTIALLY CLOSED.** Modules without tables are now labelled `not_implemented` at the
  API instead of being rendered as zero; the UI still shows the raw number (G19).
- **G22 — audit details encoding.** `auth_audit` was concatenating a JSON *string* parameter with
  the result object, producing an array instead of an object. Fixed by casting through text;
  rows written before the fix keep the old shape.

---

## Status at the B3 tip (2026-11-02)

Superseding notes for the table above; the original rows are kept so history stays visible.

| Item | Status now | Evidence |
|---|---|---|
| G1 staged imports in memory | **CLOSED** | `staged_imports` is written in postgres mode; verify.sh requires the "durable staged imports" test marker, and `tests/m1/b2.csv.staging.test.ts` covers durable CSV staging |
| G5 no backup/restore verification | **CLOSED** | `scripts/backup-restore-drill.sh` passes: 49 tables, 45 RLS tables, 6 users, 1 audit row restored and verified |
| G4 M1 Excel templates | OPEN (unchanged) | accounting sheets absent; see `docs/B3_REPORT.md` item 9 |
| G6 no browser | OPEN (unchanged) | static audit only, `docs/ACCESSIBILITY_AUDIT.md` lists the unverified items |
| G7 no GitHub remote | OPEN (unchanged) | `gh` still unauthenticated |

### New at B3

| # | Gap | Impact | Next action |
|---|---|---|---|
| G12 | No LibreOffice/Excel recalculation run in this environment | formula results are proven structurally (`fullCalcOnLoad`, no stale cache, independent Python calc) but not by a spreadsheet engine | run `pytest -k libreoffice` where an office binary exists |
| G13 | Design-system page is role level 5 only | viewers cannot see the reference page | expose read-only at level 1 after a sign-off on support cost |
| G14 | Contrast is asserted from tokens, not measured on a physical panel | panel/gamut differences are unverified | spot check on a workstation |
| G15 | No automated axe/Playwright accessibility run | ARIA mistakes outside the static rules can slip through | add Playwright + axe when a browser image exists |

---

## G2 closure (this commit)

| Item | Status | Evidence |
|---|---|---|
| **G2** read models demo-backed in postgres mode | **CLOSED** | `server/db/datasetRepo.ts` builds the dataset from tenant tables inside `withTenant`; `/api/dashboard`, `/api/reports/*`, `/api/customers` call it whenever a database is configured. Proved over HTTP by `tests/m1/readmodel.http.test.ts`: an invoice written only to PostgreSQL moves `overdueReceivables` by exactly its amount, and the customers list total equals `select count(*)` for the tenant. |
| **G16** one demo company for read models | **CLOSED for the read path** | same HTTP test logs in as `admin2` (CMP-0002): the CMP-0001 fixture is absent from the customer list and from a statement filtered by its id. `tests/m1/dataset.readmodel.test.ts` proves RLS isolation with the restricted role. |

Defect found and fixed while closing G2: `customer_statement` fell back to the tenant's **first**
customer when the requested `customerId` was unknown or belonged to another tenant, so a
cross-tenant request returned another party's statement under that id. It now returns an empty
statement with the requested id in `meta.extra`. Covered by the second-tenant test.

## Update — 2026-11-03 (M3 batching)

- **G17 narrowed.** `batches`, `batch_components`, `moisture_readings` and `batch_overrides`
  now exist, so the dashboard's batch figure reads real tenant rows instead of a hard zero.
- **Rules are catalogue-driven.** Cement/water deviation, aggregate deviation, yield tolerance
  and the scale-calibration interval all evaluate through the R1 engine. Every one is seeded
  with no value and no source note, so a completion is refused as `approval_required` until a
  level-5 user records the value and its reference in the catalogue. This is deliberate: no
  ECP 203-2007 limit was invented and nothing auto-passes.
- **Lifecycle is enforced in two places.** The service checks the transition table and the SQL
  update is a compare-and-set on the current status, so two concurrent completions produce one
  winner; a trigger refuses any edit to a completed row or its children.
- Still open: the batch screens pass the route/nav/label tests but were **not rendered in a
  browser** (G6). The R1 rule-value editor remains an API/service surface with no screen, so a
  level-5 user configures values over the API for now.

## Update — 2026-11-03 (M4 quality and laboratory)

- **Quality tables exist now.** `lab_equipment`, `equipment_calibrations`, `trial_batches`,
  `quality_tests`, `specimens`, `ncr`, `capa` and `certificates` are migrated with tenant and
  plant RLS, so the dashboard's quality figure reads tenant rows instead of a hard zero.
- **Acceptance limits are never assumed.** They live on the test row with their source note; a
  test without both bounds is refused with `approval_required`. Required test ages and the
  slump/temperature bands are catalogue rules seeded unconfigured, so a level-5 user must record
  the value and its reference before those checks can pass.
- **Evidence is enforced by the database.** A partial unique index allows one live NCR per
  failed test, and a trigger freezes an issued certificate's content: only revocation with a
  reason is permitted, and a revoked certificate is terminal.
- Still open: the quality screens pass the route/nav/label tests but were **not rendered in a
  browser** (G6). Equipment calibration is recorded through the API; there is no calibration
  screen. The R1 rule-value editor and the ITP schedules from the plan are not implemented.

## Update — 2026-11-03 (M5 fleet and dispatch)

- **Fleet tables exist now.** `trucks`, `drivers`, `dispatch_assignments`, `trips`,
  `truck_maintenance`, `gps_positions` and `dispatch_overrides` are migrated with tenant and
  plant RLS, so the dashboard's dispatch figures can read tenant rows instead of a hard zero.
- **One open trip per truck is a database rule.** `trips_open_per_truck_idx` is partial on
  `planned|departed|arrived`, so a duplicate dispatch is refused even if the service is bypassed.
  `truck_retired_terminal()` refuses any status change away from `retired`.
- **Rule values stay configurable.** The volume band, soft-load limit, site-wait threshold, drum
  age and licence grace are catalogue entries seeded with no value and no source note. An
  unconfigured volume band is `approval_required`; the grace period has no default; the three
  warning rules are skipped (`warning` only once configured) rather than blocking dispatch.
- **Evidence for a difference is a row, not a flag.** A delivery outside the band needs a
  `dispatch_overrides` record with rule, entity, actor, reason and decision; the trip stores the
  human reason as well.
- Still open: the fleet and dispatch screens pass the route/nav/label tests but were **not
  rendered in a browser** (G6). Truck and driver master data are created through
  `POST /api/fleet/trucks` and `POST /api/fleet/drivers`; the screens list, filter, renew a
  licence and retire, but do not offer a create form. Driver personal-data export (level 4) and
  a GPS position map are not implemented. The R1 rule-value editor and ITP schedules remain
  unbuilt.

## Update — 2026-11-04 (M6 inventory)

- **Inventory tables exist now.** `materials`, `supplier_contacts`, `purchase_requests`, `po_items`,
  `receipt_items`, `stock_movements`, `inventory_snapshots`, `inventory_exceptions` and
  `cost_layers` are migrated with tenant and plant RLS. `suppliers`, `purchase_orders` and
  `goods_receipts` already existed from 0002 and were extended forward-only rather than recreated,
  so M1 procurement rows remain valid and the M6 lifecycle adds `confirmed`/`fully_received` and
  the confirmed/voided receipt states.
- **Balances are derived, never stored.** Every read sums the append-only movement ledger, and a
  trigger refuses update or delete on `stock_movements`. A snapshot is a dated copy that reports
  whether it agrees with the ledger; it is never the source of truth.
- **Valuation is explicit per material.** A bulk material is weighted-average only; FIFO is allowed
  for non-bulk stock and consumes the oldest open cost layer. No method means no posting
  (`approval_required`), and the method is locked after the first movement.
- **A negative balance is evidence, not a silent value.** The movement is refused; a level-4
  override with a reason writes an `inventory_exceptions` row, its audit event, and a suggested
  missing document (an open PO line or a draft receipt). An over-receipt is the same pattern.
- **Deviations from the M6 plan.** The plan's `stores`, `material_lots`, `stock_transfers`,
  `reorder_policies` and `purchase_suggestions` entities are **not implemented**; this build follows
  the execution scope (materials are plant-scoped, lots are recorded as `lot_no` on receipt items
  and movements, and transfers/suggestions remain future work). The plan's lot `hold`/`rejected`
  quality gate therefore has no screen or table yet; quality status lives with the lot number, not
  an inventory row. Reorder and safety stock are per material, not per store.
- Still open: the four inventory and procurement screens pass the typecheck, route/nav/label tests
  and build, but were **not rendered in a browser** (G6). Purchase-order creation and receipt
  entry are available on screen; supplier master creation is API-only. There is no transfer screen,
  no material-lot quality screen, and no reorder-policy screen. The R1 rule-value editor remains an
  API surface, so a level-5 user configures `inventory.*` values over the API for now.

## Update — 2026-11-05 (M7 orders and distribution)

- **Sales entities exist now.** `quotations`, `quotation_items`, `quotation_versions`,
  `contracts`, `contract_versions`, `sales_order_items`, `delivery_tickets` and
  `delivery_ticket_batches` are migrated with tenant and plant RLS. `customers`, `projects` and
  `orders` already existed and were extended forward-only (customer code/contact/addresses/credit
  limit/blacklist, project site contact, order quotation/contract/total/credit/hold/cancel fields)
  rather than recreated.
- **Versions are evidence.** The app role has only select/insert on the version tables, and a
  trigger refuses update/delete as a second line. There is no edit path in the repository. A
  revision starts a new draft and the next approval appends the next version.
- **A signed contract is pinned.** `contracts.quotation_version_id` names one approved version and
  is never updated by a newer quotation. Contract signature and void append a contract version.
- **Credit is derived.** Exposure is posted receivables plus open orders; 100%/110% are fixed by
  the execution specification, not configuration. The effective limit falls back to the latest
  `customer_credit_limits` row when `customers.credit_limit` is null, so existing M1 customers keep
  their historical limit.
- **Deviations from the plan / execution scope.** The execution scope names `customer_projects`
  and `sales_orders`; this build uses the existing `projects` and `orders` headers to avoid a
  duplicate master, with the project code and order number remaining the unique business keys, and
  adds `sales_order_items` for the lines. `quotation_versions` has no per-version `status` column:
  the status is inside the immutable snapshot and the quotation header carries the live status.
  The plan's leads, opportunities, price lists, seasonal prices, volume commitments, discount
  approval rows, proof of delivery, returned loads, diversions and credit-check rows are **not
  implemented**; the discount gate records its reason in the audit event, not a separate approval
  table. These remain future work (M8 scope and later).
- Still open: the customer, quotation, contract, order and ticket screens pass the typecheck,
  route/nav/label tests and build, but were **not rendered in a browser** (G6). Delivery-ticket
  creation is offered for confirmed/scheduled/in-production orders; the trip list comes from
  dispatch assignments and the batch selector from the batching API. There is no price-list or
  discount-approval screen, and the R1 rule-value editor remains an API surface, so a level-5 user
  configures `sales.*` values over the API for now.
