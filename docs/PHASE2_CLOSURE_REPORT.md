# Phase 2 completion report (master specification §63)

**Phase:** 2 — core operations, modules M2 Mix Design, M3 Batching, M4 Quality/Lab and M5
Fleet & Dispatch.
**Tip reported:** `978c7d1` (M5) plus this closure commit.
**Status:** Phase 2 core **CLOSED**; no module below is deployed and no Phase 3 work has started.
**Reference position:** ECP 203-2007 remains **not supplied**. No clause number, limit, tolerance,
test age or acceptance band is attributed to it anywhere in Phase 2; every such rule is a
catalogue entry seeded with no value and no source note, and an unconfigured rule never passes.
The ECP catalogue screen added in this closure commit displays exactly that state.

This report follows the twenty items §63 requires, in order, then re-evaluates the fifteen §57
criteria at the new tip. Every "verified" claim names a command that was executed; nothing is
reported as passed, deployed or synchronised that was not.

## 1. Files created

Database and server:

- `db/migrations/0013_mix_design.sql`, `0014_batching.sql`, `0015_quality.sql`, `0016_fleet.sql`
- `server/services/mixDesign.ts`, `batching.ts`, `quality.ts`, `fleet.ts`
- `server/api/mixDesigns.ts`, `batches.ts`, `quality.ts`, `fleet.ts`

Pure domain rules and engine bindings:

- `src/core/mixDesign.ts`, `src/core/batching.ts`, `src/core/quality.ts`, `src/core/fleet.ts`

Screens and components:

- `src/pages/MixDesignsPage.tsx`, `BatchListPage.tsx`, `BatchDetailPage.tsx`,
  `QualityListPage.tsx`, `QualityTestDetailPage.tsx`, `NcrDetailPage.tsx`,
  `FleetListPage.tsx`, `DispatchBoardPage.tsx`, `TripDetailPage.tsx`,
  `RuleCataloguePage.tsx` (closure commit)
- `src/components/MoistureInputModal.tsx`, `OverrideModal.tsx`, `CertificateIssueModal.tsx`,
  `MaintenanceModal.tsx`

Tests:

- `tests/mixDesign.test.ts`, `tests/m2/mixDesign.db.test.ts`, `tests/m2/mixDesign.http.test.ts`,
  `tests/m3/batching.test.ts`, `tests/m4/quality.test.ts`, `tests/m5/fleet.test.ts`

Documentation:

- `docs/PHASE2_CLOSURE_REPORT.md` (this file)

## 2. Files modified

- `server/index.ts` — mounts `/api/mix-designs`, `/api/batches`, `/api/quality`, `/api/fleet`
- `server/db/seed.ts` — seeds the catalogue per company
- `src/App.tsx`, `src/components/AppShell.tsx`, `src/core/rbac.ts` — page registry, routes, nav
- `src/i18n/locales/ar.ts`, `src/i18n/locales/en.ts` — every new label in both languages
- `tests/rbac.test.ts`, `tests/routes.smoke.test.ts` — page, nav and role-level assertions
- `docs/VERIFICATION_RECORD.md`, `docs/ISSUES_AND_GAPS.md`, `docs/DATA_DICTIONARY.md`,
  `docs/IMPLEMENTATION_STATUS.md`, `docs/DATABASE.md`, `docs/DATA_MODEL.md`,
  `docs/ARCHITECTURE_DECISIONS.md`, `docs/SECURITY.md`, `CHANGELOG.md`
- `.gitignore` — `tmp/`

## 3. Features implemented

| Module | Implemented |
|---|---|
| M2 Mix design | designs, immutable approved versions, components with explicit moisture basis, target values with source notes; draft → submitted → approved → superseded/withdrawn; approval level 5; approved-version edits refused |
| M3 Batching | batch lifecycle (`planned → in_progress → completed`, `held`, `cancelled`), components with target/actual, moisture readings with validity, approved-version requirement, completion immutability trigger, batch overrides, scale calibration hold |
| M4 Quality/lab | equipment and calibration register, tests and specimens, result entry against explicit `spec_min`/`spec_max` plus source, verification, automatic single NCR on failure, CAPA with effectiveness check, certificate issue/immutability/revocation |
| M5 Fleet/dispatch | trucks, drivers, assignments, trips, maintenance, GPS positions, dispatch overrides; the documented truck, assignment and trip lifecycles; one open trip per truck enforced by index; retire terminal by trigger |
| R1 catalogue UI (closure commit) | rule register with module/status filters, "not specified in the supplied reference" display, missing-source display, level-5 value/source editing |
| Cross-cutting | tenant + restricted plant RLS on every new table, soft delete, UTC timestamps, audit row per write, EN/AR labels, RBAC-gated screens and endpoints |

## 4. Features verified

- Mix design approval, immutability of approved versions, batch reference stability, yield
  warning and override evidence, level-4 approval denial, tenant and plant isolation.
- Batch completion refusals (unapproved version, stale moisture, deviation band), completed-row
  immutability, concurrent completion single winner, duplicate batch number, RLS.
- Calibration hold and release, one NCR per failed test on double submit, certificate refusals
  and frozen issued content, CAPA gate, missing acceptance limits, specimen warning, RLS.
- Fleet: maintenance blocks dispatch with the assignment left `proposed`; second open trip
  refused by `trips_open_per_truck_idx`; expired licence blocked then allowed after audited
  renewal; over-capacity failure and soft-load warning recorded; volume band requires an
  override row with rule, entity, actor, reason and decision; cancel releases the truck and
  aborts the trip in one transaction; retired truck blocked; cross-plant blocked; RLS isolation.
- Route/nav/label smoke: every registered page has a component export and router branch, every
  nav item is registered, every label exists in both locales, every fleet/rule route is mounted
  above the M1 fallback.

## 5. Features not implemented

- Mix-design **version editor UI** — still deferred; the API and service exist, the screen does not.
- Driver personal-data **export** (level 4) — read is implemented, export is not.
- Truck/driver **create forms** — creation is API-only; the fleet screen lists, filters, renews
  licences and retires.
- GPS position **map or track view** — positions are accepted and stored, not displayed.
- **ITP schedules** (`itp_schedules`) from the M4 plan.
- Delivery tickets/POD, pumps and pumping jobs, weighbridge, customer/driver portals,
  notifications, forecasting/AI, offline sync.
- Excel import templates for batching, quality and trips (see items 8–9).
- Browser/E2E, visual RTL, print and mobile verification.
- Deployment of any kind.

## 6. Environment limitations

- No browser or browser automation is available, so no route was visually loaded, no RTL or
  print layout was inspected, and no interaction was driven end to end.
- No ECP 203-2007 Code file exists in the environment; all numeric rules stay unconfigured.
- No authenticated GitHub remote or hosting account was used; no push and no deployment.
- PostgreSQL is the throwaway local build used by the test suite, not a managed service.
- Python generator tests were last executed in Phase 1 and were not re-run by this closure.

## 7. Database changes

Migrations `0013`–`0016` are forward-only and additive. They add **23 tables**, all with
`company_id`, soft delete and UTC timestamps, and all with forced RLS (`tenant_isolation` plus a
restrictive plant policy where plant-scoped):

| Migration | Tables |
|---|---|
| `0013_mix_design.sql` | `mix_designs`, `mix_design_versions`, `mix_components`, `mix_strength_tests` |
| `0014_batching.sql` | `batches`, `batch_components`, `moisture_readings`, `batch_overrides` |
| `0015_quality.sql` | `lab_equipment`, `equipment_calibrations`, `trial_batches`, `quality_tests`, `specimens`, `ncr`, `capa`, `certificates` |
| `0016_fleet.sql` | `trucks`, `drivers`, `dispatch_assignments`, `trips`, `truck_maintenance`, `gps_positions`, `dispatch_overrides` |

Measured at the tip: **75 tables in `public`, 71 with row-level security enabled**.

Notable database-enforced rules: one live NCR per failed test (`ncr` partial unique index); a
frozen issued certificate; one open trip per truck (`trips_open_per_truck_idx`); `retired` is
terminal (`truck_retired_terminal()`); completed batches cannot be edited; terminal retired
trucks cannot change status. `seed_rule_catalogue()` is extended idempotently with the M2–M5
codes and invents no values.

## 8. Excel worksheets created

**None in Phase 2.** The portable generator remains the Phase 1 set of **15 sheets**
(`excel_generator/`), and the import template registry remains the Phase 1 set of **15
templates** (`src/core/excelSchema.ts`), including `mix_designs` and `fleet` from Phase 1.
Phase 2 added no worksheet, no template and no schema-version bump.

## 9. Excel worksheets missing

- Batching/production (batches, components, moisture readings)
- Quality/lab (tests, specimens, NCR, CAPA, certificates, equipment calibration)
- Dispatch and trips (assignments, trips, maintenance, GPS)
- Rule catalogue / configured values export

These are documented as missing rather than simulated.

## 10. Validation rules implemented

All measured rules run through the single R1 engine (`src/core/rules.ts`, `evaluateRule`) and are
stored in `rule_definitions` per company. The catalogue holds **24 codes**: 4 mix design, 7
batching, 6 quality, 7 fleet. Each is seeded with **no value and no source note**.

| Class | Rules |
|---|---|
| Mandatory failure | component quantities; approved-version batch completion; duplicate identifiers; cross-plant references; truck capacity; second open trip; expired licence; maintenance/retired dispatch; failed test needs NCR; certificate eligibility; chronology; required source on overrides |
| Approval required | missing spec limits or source; water/cement and cement content; cement/water deviation; required test ages; volume difference band; unconfigured rules of any class |
| Engineering hold | lapsed calibration (quality), lapsed scale calibration (batching) |
| Warning | yield, aggregate deviation, specimen shortfall, soft load, drum age, site wait |
| Authorized override | manual GPS correction; batch, quality and dispatch overrides with actor and reason |

The override evidence contract is five fields — rule, entity, actor, reason, decision — and is
enforced by `validateOverride` and by database checks. A rule without both a value and a source
note evaluates to `approval_required`; there is no branch that turns it into a pass.

## 11. Tests executed

| Suite | Tests | Result |
|---|---|---|
| `tests/m2` (mix design pure, DB, HTTP) | 17 | pass |
| `tests/m3/batching.test.ts` | 15 | pass |
| `tests/m4/quality.test.ts` | 13 | pass |
| `tests/m5/fleet.test.ts` | 15 | pass |
| Full `bun test` (36 files) | 324 | **324 pass, 0 fail, 0 skip** |
| TypeScript | — | `tsc --noEmit`: 0 errors |
| Production build | — | `vite build`: success |

## 12. Exact commands executed

```bash
# throwaway PostgreSQL 16 (local pgserver build), port 55440
createdb iconcrete_m5
DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:55440/iconcrete_m5 \
  ICONCRETE_STORAGE_MODE=postgres bun run scripts/db.ts migrate
DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:55440/iconcrete_m5 \
  ICONCRETE_STORAGE_MODE=postgres bun run scripts/db.ts seed
bun run typecheck
DATABASE_URL=postgres://postgres@127.0.0.1:55440/iconcrete_m5 \
  ICONCRETE_RLS_URL=postgres://iconcrete_app@127.0.0.1:55440/iconcrete_m5 \
  bun test tests/m5/fleet.test.ts
DATABASE_URL=... ICONCRETE_RLS_URL=... bun test
DATABASE_ADMIN_URL=... ICONCRETE_STORAGE_MODE=postgres bun run schema:docs
bun run build
```

## 13. Actual test results

- Fresh database: applied `0001_m1_organization.sql … 0016_fleet.sql`; **skipped: none**.
- Seed: succeeds; catalogue inserted per company.
- M2: **17 pass, 0 fail**; M3: **15 pass, 0 fail**; M4: **13 pass, 0 fail**;
  M5: **15 pass, 0 fail**.
- Full suite: **324 pass, 0 fail, 0 skip**, 36 files, 4,754 assertions.
- `tsc --noEmit`: **0 errors**.
- `schema:docs`: regenerated `docs/DATA_DICTIONARY.md` from the live schema (**2,233 lines**).
- Build: success; entry `index-*.js` **342.50 kB (102.73 kB gzip)**, `DashboardPage`
  393.71 kB (112.42 kB gzip), `DispatchBoardPage` 15.20 kB, `FleetListPage` 14.83 kB;
  every page is a lazy chunk and no chunk exceeds 500 kB.

No test was skipped to obtain these numbers: the database suites ran against the migrated
database, not in `skip` mode.

## 14. Known issues

- Browser rendering, RTL typography, print layout and interaction are **NOT TESTED** (no browser).
- Version editor UI for mix designs is **BLOCKED/deferred**; approved versions are immutable in
  the service, but drafts are edited through the API.
- Fleet master data (trucks, drivers) is created through the API only; the screens do not offer
  a create form.
- Driver personal-data export (level 4), GPS map, ITP schedules, delivery tickets/POD, pumps,
  weighbridge, portals, notifications and offline sync are not implemented.
- No Excel worksheet or import template was added for batching, quality or trips.
- `docs/PHASE2_PLAN.md` still opens with "PLAN FOR APPROVAL"; the outcome is recorded in this
  report and `VERIFICATION_RECORD.md` rather than rewritten into the approved plan.

## 15. Security limitations

From `docs/SECURITY.md` and the executed tests: RLS is forced and tenant isolation is tested for
every Phase 2 table; sessions are opaque, hashed at rest, rotated at login, and audit rows never
carry secrets. Not implemented: request-rate limiting, password reset, TOTP 2FA, CSRF protection
(not applicable while bearer tokens are used instead of cookies), managed secret rotation, and
edge/WAF controls. The demo login is labelled as a demo. No penetration test or dependency audit
was run in Phase 2.

## 16. Performance limitations

No load, concurrency or query-plan benchmark was executed in Phase 2. The measured frontend
cost is the chunk table above (entry 342.50 kB, dashboard 393.71 kB with Recharts). RLS predicate
overhead, index behaviour at volume, and the cost of the new partial indexes are unmeasured.
The app runs as a single Bun process against one PostgreSQL instance; no horizontal scaling,
connection pooling benchmark or caching layer exists.

## 17. Free-tier limitations

No hosting, managed database, object storage, email, SMS, AI or monitoring service is
provisioned. `docs/FREE_TOOLING_AND_COSTS.md` records that the zero-cost public deployment is
**not done** because no hosting account or authenticated deployment path was available. Managed
PostgreSQL free tiers often expire or cap storage, so the backup/restore drill remains the
portable exit path. The Excel generator runs locally with open-source dependencies only.

## 18. Deployment status

**NOT DEPLOYED.** No production or preview environment exists, no CI pipeline was run, and no
push to a remote was performed. `bun run build` produces a local `dist/` bundle; that is a build
result, not a deployment. Synchronisation between web and Excel has not been claimed or tested.

## 19. Rollback instructions

Follow `docs/ROLLBACK.md`:

1. **Code:** `git switch -c rollback/<date> 978c7d1` (or `git revert` on a shared branch), then
   `bun install --frozen-lockfile && bun run build && bash scripts/verify.sh`.
2. **Schema:** migrations are forward-only and checksum-guarded; never edit an applied file.
   Write a new reversing migration, apply it with `bun run db:migrate`, then `bun run schema:docs`.
3. **Data:** `pg_dump --format=custom`, restore into a fresh database, and run
   `bash scripts/backup-restore-drill.sh`; the drill verifies schema, RLS, users, audit and row
   counts before it reports `DRILL PASSED`.

`audit_log` is append-only; a restore is the only supported way to change history.

## 20. Recommended next phase

**Phase 3 — delivery and field operations:** delivery tickets/POD, pumps and pumping jobs,
weighbridge adapter boundary, driver portal, notifications with a provider decision, Excel
templates for batching/quality/trips, and the deferred mix-design version editor. In parallel:
managed deployment with a real preview environment, CI on every commit, and browser E2E plus
visual RTL/print verification so §57.1 moves from PARTIAL to PASS. Phase 2 core should not be
extended further until that verification exists.

---

# §57 criteria re-evaluated at the closure tip

| # | Criterion | Status | Evidence / reason |
|---|---|---|---|
| 1 | Implemented routes load without runtime errors | **PARTIAL** | `bun run build` succeeds and `tests/routes.smoke.test.ts` proves every page resolves to a component export and router branch; no browser exists, so no route was visually loaded |
| 2 | Active navigation leads to valid destinations | **PASS** | every nav item is a registered page, every page appears in nav, labels exist in ar+en (`tests/routes.smoke.test.ts`) |
| 3 | Every visible action works or is explicitly disabled | **PASS** | Phase 2 actions call real endpoints with loading/error/forbidden states; unavailable actions are absent, not fake; RBAC gates hide disallowed controls |
| 4 | Customer records use a consistent data model | **PASS** | one `customers` table read through `datasetRepo` and the M1 API; Excel import commits into the same table |
| 5 | Lists, details and reports share one source | **PASS** | postgres read models under RLS (G2 closed); `tests/m1/dataset.readmodel.test.ts`, `tests/m1/readmodel.http.test.ts` |
| 6 | Creating/editing a customer updates all views | **PARTIAL** | creation through the Excel import lifecycle updates the read models; no customer create/edit screen |
| 7 | Dashboard metrics are derived from underlying data | **PASS** | `tests/seed.test.ts`, `tests/m1/dataset.readmodel.test.ts`; Phase 2 tables now feed the batch/quality/dispatch figures |
| 8 | Synthetic demo data is clearly identified | **PASS** | demo mode banner/labels and `Synthetic` flags in the dataset |
| 9 | CSV import includes validation and preview | **PASS** | staged CSV lifecycle (`tests/m1/b2.csv.staging.test.ts`) |
| 10 | Imports do not silently overwrite or duplicate | **PASS** | duplicate checksum rejection and explicit commit (`import.durable.test.ts`, `b2.csv.staging.test.ts`) |
| 11 | Excel generator creates a genuine XLSX | **PASS** | `excel_generator/` and 28 pytest tests executed in Phase 1; not re-run in Phase 2 |
| 12 | Unsupported features are documented honestly | **PASS** | this report, `IMPLEMENTATION_STATUS.md`, `ISSUES_AND_GAPS.md` |
| 13 | Tests are actually executed and results recorded | **PASS** | 324 pass / 0 fail / 0 skip at this tip; `VERIFICATION_RECORD.md` records each module |
| 14 | Known issues are documented | **PASS** | `docs/ISSUES_AND_GAPS.md`, item 14 above |
| 15 | No later-phase feature is presented as operational | **PASS** | status matrix distinguishes implemented, deferred, blocked and not tested; Phase 3 modules remain NOT IMPLEMENTED |

Criterion 1 stays PARTIAL until a real browser loads the routes. It is not reported as PASS on
the strength of build output alone.

## Optional deferred item closed in this commit

The **ECP rule catalogue UI** is implemented (`src/pages/RuleCataloguePage.tsx`, `/rules`,
level 2 read, level-5 edit): it lists every rule with its classification, value and source note,
shows "not specified in the supplied reference" for a missing value and "no source note
recorded" for a missing source, and refuses to save a value without a source note. This was
chosen over the mix-design version editor because the catalogue is the visible contract behind
every Phase 2 rule and is the smaller, safer surface.
