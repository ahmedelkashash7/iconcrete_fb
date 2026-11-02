# Phase 1 closure and gate verification — 2026-11-02

## Scope statement

The **master specification is not present in this repository**. Only `docs/PHASE1.md` (a
delivery report), `docs/PHASE2_M1.md` and the directive text are available, so section 57's
fifteen criteria and section 63's twenty report items cannot be quoted verbatim. That is itself
a gate finding: criteria are reported against what the repository and directive actually state,
and anything requiring the missing specification is marked **BLOCKED — specification
unavailable**, not guessed.

## Part A — blocking defects

| Item | Status | Evidence |
|---|---|---|
| A1 legacy audit payload shape | IMPLEMENTED AND VERIFIED | Option (b): tolerant reader tags legacy arrays as `schema_version: 1`, new object payloads as `2`; writer emits `schema_version: 2`. The audit table stays append-only (no historical UPDATE). `bun test` — "normalises legacy array-shaped details and new object details through one reader" |
| A2 account 1100 tie-out | IMPLEMENTED AND VERIFIED | Finding: 1100 is the company-wide AR control account by design (`services/m1.ts` debits 1100 per posted invoice, credits it per receipt). The statement is per customer, so the old company-wide assertion was wrong and was **removed**, not accommodated. New proof: posted 1100 debits from this customer's invoices minus 1100 credits from its receipts equals `invoiced − paid`, and the ledger query equals every posted 1100 line. `tests/m1/vertical.slice.test.ts` |
| A3 route/nav smoke | IMPLEMENTED BUT NOT FULLY VERIFIED | `tests/routes.smoke.test.ts`: every registered page has a real component export and an explicit router branch, settings is the fallback, every nav item is a registered page, every page appears in nav, every nav label exists in ar+en, every page has a role level. Browser rendering NOT TESTED (no browser in this environment) |
| A4 dashboard honesty | IMPLEMENTED AND VERIFIED | Dashboard renders a state card: source, last refresh, and one badge per KPI with `available` / `real_zero` / `no_records` / `not_implemented` / `unavailable`, plus record count or "no source table". State→label and state→tone maps are unit-tested as distinct |
| A5 reports data source | IMPLEMENTED BUT NOT FULLY VERIFIED | `/api/reports/*` returns `dataSource` (mode, adapter, tables, report, filters) and `generatedAt`; the Reports page displays it. No dedicated HTTP assertion yet — covered by typecheck and the existing report tests only |
| A6 KPI derivation audit | IMPLEMENTED AND VERIFIED (documented) | `docs/KPI_DERIVATION.md` lists all ten KPIs with source, derivation and verdict: 7 not implemented in postgres, 1 correct, 1 approximate, 1 wrong label |
| A7 single-copy risk | IMPLEMENTED | `backups/iconcrete-freebuff.bundle` is a full branch bundle committed to the repository; it contains every commit reachable from the branch. GitHub remains unauthenticated |

## Part B — Phase 1 gate

| Item | Status |
|---|---|
| B1 projects and orders foundation | NOT DONE in this pass |
| B2 reports foundation (shell, date/plant filters, sourced reports) | NOT DONE in this pass (only the `dataSource` contract landed) |
| B3 CSV import lifecycle | NOT DONE in this pass (XLSX path exists; CSV parsing exists server-side, but no preview/commit lifecycle for CSV) |
| B4 design system preview page | NOT DONE in this pass |
| B5 accessibility and responsive audit | NOT TESTED — needs a browser and a human review |
| B6 documentation set | PARTIAL: all twelve documents exist; `ISSUES_AND_GAPS.md`, `IMPLEMENTATION_STATUS.md`, `VERIFICATION_RECORD.md` updated. PostgreSQL version: 16 (pgserver build) used by the drill |
| B7 generator repository structure | EXISTS as reported in Phase 1 (`IConcrete_Generator.ipynb`, both READMEs, `sample_input/`, `output/.gitkeep`, `tests/test_workbook.py`); formula recalculation not re-verified in this pass |
| B8 repository hygiene | PRESENT: `.gitignore`, `.env.example`, MIT `LICENSE`, READMEs; no secrets or generated workbooks committed |
| B9 security status honesty | DOCUMENTED in `SECURITY.md`; several controls remain NOT IMPLEMENTED (see that table) |
| B10 bundle size | DOCUMENTED as a known limitation; the 771 kB chunk is unchanged and no device measurement exists |
| B11 test depth | PARTIAL: counts per module recorded in `VERIFICATION_RECORD.md`; materials/orders/employees/fleet/mix-designs remain without domain coverage |

Because B1–B5 are not complete, the Phase 1 acceptance gate is **not closed** and Part C was
deliberately not started. No Phase 2 plan is offered yet.
