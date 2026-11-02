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
