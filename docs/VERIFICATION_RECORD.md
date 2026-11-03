# Verification record — 2026-10-30

Produced by real commands in this environment. Nothing below is estimated.

## Environment

| Item | Value |
|---|---|
| Kernel | Linux 6.1.102 x86_64 |
| Bun / Node / Python | 1.3.14 / v24.21.0 / 3.12.3 |
| PostgreSQL | 16.2, provisioned per run by `pgserver` inside `.verify/` (throwaway, trust auth, not a project dependency) |
| Browser automation | none available |

## `bash scripts/verify.sh` — workspace run

| Step | Result |
|---|---|
| `bun install --frozen-lockfile` | 258 installs, no changes |
| migrations | 8 applied (`0001`–`0008`) |
| seed | 2 companies, 3 plants, 6 users, 46 accounts, 26 customers, 57 invoices, 34 payments, 92 journal entries, 14 cheques, 10 assets, 3 loans |
| typecheck | PASS |
| `bun test` | **150 pass, 0 fail, 0 skip** — 15 files, 2016 `expect()` calls |
| build | PASS (existing >500 kB chunk warning) |
| pytest | **28 passed** |
| generator | exit 0 — 15 RTL sheets, 3 charts, 12/12 seeded scenarios, 53,710 bytes |

Script summary line: `pass=150 fail=0 skip=0 typecheck/build/pytest/generator=ok`.

The script fails when the skip count is non-zero **and** requires the markers
`durable staged imports`, `database-backed read models` and `postgres adapter` in the output,
so a vanished suite cannot masquerade as "zero skips".

## Clean extraction (independent of this workspace)

1. `git bundle verify` → "The bundle records a complete history."
2. `git clone <bundle> /tmp/iconcrete-restore/repo` → HEAD `9acf09c`.
3. Confirmed no `node_modules`, `.venv`, `.verify` or `dist` in the clone.
4. `bash scripts/verify.sh` → same counts: **150 pass, 0 fail, 0 skip**, build PASS,
   pytest 28 passed, generator 12/12; exit code 0.
5. `git archive` extraction: 123 tracked files in the commit, 123 files extracted.

## Generated data dictionary

`bun run schema:docs` → `docs/DATA_DICTIONARY.md`:

- **1,370 lines**
- **46 base tables**, **644 columns**, **257 constraints** (primary key, unique, foreign key, check)
- one section per table with type, nullability and default for every column

`tests/m1/data-dictionary.test.ts` re-renders the schema and compares the whole file, so a
schema change without regeneration fails the suite.

## Artifacts

`artifacts/IConcrete-<commit>.bundle` and `artifacts/IConcrete-<commit>.tar.gz` are generated
from the final commit; hashes are in `artifacts/SHA256SUMS` (untracked, never committed) and
are reported in the conversation. The clean-extraction run above used the bundle of the
preceding commit `9acf09c`, whose code is identical — this record adds documentation only.

## NOT TESTED

- Visual Arabic/RTL rendering, fonts, bidi in tables, print preview, mobile layout (no browser).
- PostgreSQL `pg_dump`/restore drill and any recovery-time measurement.
- GitHub push (no authenticated remote).
- Modules M2–M4; no phase beyond M1 was started.

## M1 gap closure run — 2026-11-02

Command: `bash scripts/verify.sh` (provisions PostgreSQL 16 on port 55440, migrates, seeds).

```
test counts: pass=178 fail=0 skip=0
=== verify summary ===
pass=178 fail=0 skip=0 typecheck/build/pytest/generator=ok
```

- typecheck PASS, build PASS (771.53 kB chunk warning unchanged), pytest 28 passed,
  generator 15 sheets / 3 charts / 12 of 12 scenarios.
- Database suites executed (0 skips): organisation isolation, Excel audit, durable imports,
  read models, Excel template end-to-end, accounting vertical slice, durable auth.
- `bash scripts/backup-restore-drill.sh` → `DRILL PASSED: 46 tables, 42 RLS tables, 6 users,
  1 audit rows restored and verified.` All 13 checks ok, including RLS as `iconcrete_app`.
- Template workbooks: all 15 templates produce a real xlsx (`tests/excelWorkbooks.test.ts`).

### NOT TESTED in this run

Visual Arabic/RTL rendering, browser navigation, print layout, and any interaction that needs a
real browser. No deployment, no push (GitHub unauthenticated).

## Phase 1 closure pass — 2026-11-02 (Part A)

Command: `bash scripts/verify.sh` (fresh PostgreSQL 16 on port 55440, migrate + seed).

```
pass=184 fail=0 skip=0 typecheck/build/pytest/generator=ok
```

New coverage added in this pass:

- `tests/routes.smoke.test.ts` — 5 tests: page→component→router branch, settings fallback, nav
  completeness in both directions, ar/en nav labels, role levels.
- `tests/m1/audit.excel.test.ts` — legacy array payload and new object payload read through one
  normaliser, tagged `schema_version` 1 and 2.
- `tests/m1/vertical.slice.test.ts` — per-customer AR control-account tie-out replaces the
  earlier weak assertion, plus ledger completeness against every posted 1100 line.
- `tests/kpi.availability.test.ts` — unchanged; the dashboard consumes the same states.

### Tests per module (B11)

| Area | Tests |
|---|---|
| Core accounting / decimal / allocation / credit | 20 (tests/m1/core.test.ts) |
| Organisation isolation | 6 |
| Excel audit | 5 |
| Durable imports | 4 |
| Vertical slice | 5 |
| Excel templates / workbooks / schema | 15 |
| Routes and nav | 5 |
| API and reports | see `tests/api.test.ts` |
| RBAC / i18n / seed / validation / storage | 12 files, broad assertions |
| **No domain coverage** | mix designs, orders, employees, fleet, materials (records-only templates) |

### NOT TESTED

Browser rendering, Arabic shaping, print layout, accessibility, live GPS/PLC/weighbridge,
message delivery, WAL/PITR restore, and any paid infrastructure.

---

# Verification record — B3 tip, 2026-11-02

Produced by real commands in this runner after the B3 changes. Earlier records above are
kept as written; this section supersedes their counts.

| Step | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | 0 errors |
| Unit/API/DB tests | `bun test` | **220 pass, 0 fail, 0 skip**, 26 files, 3,307 expectations |
| Palette/contrast | `bun test tests/design.tokens.test.ts` | 13 pass — 17/17 declared pairs meet target |
| Accessibility audit | `bun run scripts/a11y-audit.ts` | mechanical PASS, 17/17 contrast, 0 unlabelled controls, 0 missing button types, 4 breakpoints |
| Build | `bun run build` | success; entry 294.66 kB (90.34 kB gzip), largest chunk 393.71 kB (112.42 kB gzip), no size warning |
| Excel tests | `.venv/bin/python -m pytest excel_generator/tests -q` | **31 passed, 1 skipped** (LibreOffice absent) |
| Schema docs | `bun run scripts/schema-docs.ts` | `docs/DATA_DICTIONARY.md` regenerated from the live schema |
| Full gate | `bash scripts/verify.sh` | `pass=220 fail=0 skip=0 typecheck/build/pytest/generator=ok` |
| Restore drill | `bash scripts/backup-restore-drill.sh` | `DRILL PASSED: 49 tables, 45 RLS tables, 6 users, 1 audit rows restored and verified` |

Not executed: browser/E2E, screen reader, LibreOffice recalculation, any deployment, any push.

---

# Verification record — G2 closure (2026-11-02)

| Step | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | 0 errors |
| Unit/API/DB tests | `bun test` | **225 pass, 0 fail, 0 skip**, 27 files, 3,326 expectations |
| New read-model HTTP tests | `bun test tests/m1/readmodel.http.test.ts` | 5 pass — postgres source declared, DB-only invoice moves `overdueReceivables` by exactly 1000, statement row present, customer total equals table count, second tenant sees nothing |
| Build | `bun run build` | success; entry 294.66 kB (90.34 kB gzip), no size warning |
| Accessibility audit | `bun run scripts/a11y-audit.ts` | mechanical PASS, unchanged |
| Full gate | `bash scripts/verify.sh` | `pass=225 fail=0 skip=0 typecheck/build/pytest/generator=ok` |
| Restore drill | not re-run in this commit | schema unchanged since the B3 drill (49 tables, 45 RLS, 6 users, 1 audit row) |

Not executed here: browser/E2E, screen reader, LibreOffice recalculation, deployment, push.

---

# Verification record — R1 rule engine (2026-11-03)

| Step | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | 0 errors |
| Unit/API/DB tests | `bun test` | **254 pass, 0 fail, 0 skip**, 30 files, 3,454 expectations |
| New rule tests | `bun test tests/rules.test.ts tests/m1/rules.db.test.ts tests/m1/rules.http.test.ts` | 29 pass — all five classes, missing value/source → `approval_required`, level-5 guard, audited value change, override with all five fields, override without reason refused, append-only, tenant isolation |
| Migration | `bun run db:migrate` on a fresh database | `applied: 0012_rule_engine.sql`; catalogue 10 rows per company |
| Seed idempotency | `bun run db:seed` twice | succeeds; `seed_rule_catalogue()` re-populates after the per-company delete |
| Schema docs | `bun run schema:docs` | `docs/DATA_DICTIONARY.md` regenerated (52 tables) |
| Full gate | `bash scripts/verify.sh` | `pass=254 fail=0 skip=0 typecheck/build/pytest/generator=ok` |
| Restore drill | `bash scripts/backup-restore-drill.sh` | `DRILL PASSED: 52 tables, 48 RLS tables, 6 users, 1 audit rows restored and verified.` |

ECP 203-2007 reference: no Code file exists in this repository, so `rule_definitions`
carries no value and no source note from it; every seeded rule therefore evaluates to
`approval_required` until a level-5 user records a value and its source. No clause number
was invented anywhere in the change.

Not executed here: browser/E2E, screen reader, deployment, push.

---

# Verification record — M2 mix design (2026-11-03)

| Step | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | 0 errors |
| Unit/API/DB tests | `bun test` | **280 pass, 0 fail, 0 skip**, 33 files, 3,787 expectations |
| New M2 tests | `bun test tests/mixDesign.test.ts tests/m2/mixDesign.db.test.ts tests/m2/mixDesign.http.test.ts` | 26 pass — every check classification, missing source/class → `approval_required`, lifecycle transitions, service and SQL immutability, override with all five fields, override without reason refused, level guards 1/4/5, tenant isolation |
| Migration | `bun run db:migrate` on a fresh database | `applied: 0013_mix_design.sql`; 56 tables, 52 with RLS |
| Seed idempotency | `bun run db:seed` (via gate) | succeeds after reordering company cleanup so mix rows are deleted before the plants they reference |
| Schema docs | `bun run schema:docs` | `docs/DATA_DICTIONARY.md` regenerated (1,650 lines) |
| Build | `bun run build` | success; entry 304.13 kB (93.48 kB gzip) |
| Full gate | `bash scripts/verify.sh` | `pass=280 fail=0 skip=0 typecheck/build/pytest/generator=ok` |
| Restore drill | `bash scripts/backup-restore-drill.sh` | `DRILL PASSED: 56 tables, 52 RLS tables, 6 users, 1 audit rows restored and verified.` |

ECP 203-2007 values remain **not specified in the supplied reference**: every seeded mix rule
still evaluates unconfigured and is marked configurable in the UI, so no clause or number was
invented. `tests/rbac.test.ts` now expects `mixDesigns` for a level-1 viewer, because the M2
scope sets read at level 1 while writes stay at 4 and approval at 5.

Not executed here: browser/E2E, screen reader, LibreOffice recalculation, deployment, push.

---

# Verification record — M3 batching (2026-11-03)

| Step | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | 0 errors |
| Migration on a fresh database | `bun run db:migrate` against a newly created database | `applied: 0001_m1_organization.sql … 0014_batching.sql`; `skipped: none` |
| Seed | `bun run db:seed` | succeeds; the batching catalogue is inserted per company |
| Unit/API/DB tests | `bun test` | **295 pass, 0 fail**, 34 files |
| New M3 tests | `bun test tests/m3/batching.test.ts` | 15 pass — lifecycle transitions, configurable moisture window, band boundary, override evidence, completed-row immutability, concurrent completion, tenant isolation |
| Data dictionary | `bun run schema:docs` | regenerated from the live schema, 1,765 lines |
| Build | `bun run build` | success; `BatchListPage` chunk 24.85 kB (5.60 kB gzip), entry 315.25 kB |

The unique index `batches_plant_day_no_idx` is built on the immutable helper
`batch_plant_day(plant_id, produced_at)`, so the migration applies without the
`functions in index expression must be marked IMMUTABLE` failure.

ECP 203-2007 values remain **not specified in the supplied reference**: the four measured
batching rules (cement/water deviation, aggregate deviation, yield tolerance, scale-calibration
interval) are seeded with no value and no source note, so each evaluates to
`approval_required` until a level-5 user records both. No limit was invented and nothing
auto-passes; `batch_plant_day` and `batch_generate` are app-owned helpers that assert no ECP
format.

Not executed here: browser/E2E, screen reader, LibreOffice recalculation, deployment, push.

---

# Verification record — M4 quality and laboratory (2026-11-03)

| Step | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | 0 errors |
| Migration on a fresh database | `bun run db:migrate` against a newly created database | `applied: 0001_m1_organization.sql … 0015_quality.sql`; `skipped: none` |
| Seed | `bun run db:seed` | succeeds; the quality catalogue is inserted per company |
| New M4 tests | `bun test tests/m4/quality.test.ts` | 13 pass — lapsed calibration holds a result until recalibration, one NCR per failed result, certificate refusals and immutability, CAPA effectiveness gate, missing limits, specimen warning, tenant isolation |
| Unit/API/DB tests | `bun test` (with `DATABASE_URL` and `ICONCRETE_RLS_URL`) | **308 pass, 0 fail**, 35 files |
| Data dictionary | `bun run schema:docs` | regenerated from the live schema, 2,013 lines |
| Build | `bun run build` | success; entry 327.08 kB (99.02 kB gzip) |

The quality module adds eight tables (`lab_equipment`, `equipment_calibrations`, `trial_batches`,
`quality_tests`, `specimens`, `ncr`, `capa`, `certificates`) with tenant RLS and restrictive plant
policies. A partial unique index on `ncr (company_id, test_id)` keeps one live NCR per failed
test, and a trigger freezes an issued certificate's content while allowing revocation with a
reason.

ECP 203-2007 values remain **not specified in the supplied reference**: acceptance limits come
from each test's own `spec_min`/`spec_max` plus a source note, required test ages and the
slump/temperature bands are catalogue rules seeded with no value, and an unconfigured rule is
`approval_required` — never a pass. No clause number or limit was invented.

Not executed here: browser/E2E, screen reader, LibreOffice recalculation, deployment, push.

---

# Verification record — M5 fleet and dispatch (2026-11-03)

| Step | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | 0 errors |
| Migration on a fresh database | `bun run db:migrate` against a newly created database | `applied: 0001_m1_organization.sql … 0016_fleet.sql`; `skipped: none` |
| Seed | `bun run db:seed` | succeeds; the fleet catalogue is inserted per company |
| New M5 tests | `bun test tests/m5/fleet.test.ts` | 15 pass — 6 pure rules/lifecycles + 9 database scenarios (maintenance block, second open trip, licence renewal, over-capacity and soft-limit warning, volume band override, one-transaction cancel, retired truck, cross-plant, tenant/plant isolation) |
| Unit/API/DB tests | `bun test` (with `DATABASE_URL` and `ICONCRETE_RLS_URL`) | **324 pass, 0 fail**, 36 files |
| Data dictionary | `bun run schema:docs` | regenerated from the live schema, 2,233 lines |
| Build | `bun run build` | success; entry 339.25 kB (101.98 kB gzip), `DispatchBoardPage` 15.20 kB |

M5 adds seven tables (`trucks`, `drivers`, `dispatch_assignments`, `trips`, `truck_maintenance`,
`gps_positions`, `dispatch_overrides`) with tenant RLS and restrictive plant policies on every
plant-scoped table. `trips_open_per_truck_idx` is a partial unique index on
`(company_id, truck_id)` for `planned|departed|arrived`, so a second open trip is refused by
PostgreSQL and not only by the service; `truck_retired_terminal()` makes `retired` terminal.
Cancelling an assignment aborts its open trip and releases the truck in one transaction, and
recording a return closes the assignment and returns the truck to `available` in the same call.

Capacity, serviceability, licence validity, plant scope and the single-open-trip rule are
`mandatory_failure`; a delivered-versus-loaded difference beyond the configured band is
`approval_required` and is only released by a `dispatch_overrides` row carrying rule, entity,
actor, reason and decision. Soft load, drum age and site wait are `warning`: each is evaluated
only when its catalogue entry has both a value and a source note, and the warning is written to
the audit row rather than blocking the dispatch. A manual GPS correction requires an actor and a
reason (`authorized_override`).

ECP 203-2007 values remain **not specified in the supplied reference**: `fleet.volume_difference_band`,
`fleet.load_soft_limit_pct`, `fleet.site_wait_threshold`, `fleet.drum_age_minutes` and
`fleet.licence_grace_days` are seeded with no value and no source note. An unconfigured volume
band never passes (`approval_required`), the licence grace period has no default, and the three
warning rules are skipped until configured — no limit was invented and nothing auto-passes.

Access is enforced by role level: read 1, propose/confirm/dispatch/trip updates 3, driver records
3 (personal data; no export endpoint exists yet), cancel/maintenance/override 4, retire 5.

Not executed here: browser/E2E, screen reader, LibreOffice recalculation, deployment, push.
