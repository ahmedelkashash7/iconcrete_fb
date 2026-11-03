# Assumptions register

Unresolved or externally-sourced assumptions are recorded here instead of being buried in
code. Each entry names the assumption, where it is used, and what would remove it.

| # | Assumption | Used in | Status | Removed by |
|---|---|---|---|---|
| A1 | 1 m³ mix yield must land within 0.98–1.02 m³ | `src/core/validation.ts` (mix designs) | DEMO ASSUMPTION | approved mix-design procedure / plant tolerance |
| A2 | W/C limits XC1 0.60, XC4 0.45, XS2 0.45, XS3 0.40 | `src/core/validation.ts` | NOT VERIFIED AGAINST SOURCE | citable code clause or project specification |
| A3 | A single order above 12 m³ triggers a capacity warning | orders template | DEMO ASSUMPTION | plant batch-size configuration |
| A4 | Concrete age 90/110/120 minutes thresholds | demo dataset, dashboard | DEMO ASSUMPTION | project/standard requirement |
| A5 | VAT default 14 % | new invoices | DEMO ASSUMPTION | tax configuration with effective dates |
| A6 | Currency EGP, timezone Africa/Cairo | company seed, UI | LOCKED PRODUCT DECISION | — |
| A7 | Arabic is the default language and RTL is the default direction | app shell, login | LOCKED PRODUCT DECISION | — |
| A8 | Demo company/plant names are the locked A1 values | seed data | LOCKED PRODUCT DECISION | — |
| A9 | Demo dataset is synthetic; it contains no real customer, supplier or employee data | `src/seed/demo.ts` | VERIFIED BY REVIEW | — |
| A10 | FIFO is the default payment-allocation order (due date, then id) | `src/core/allocation.ts` | IMPLEMENTED AND TESTED; contractual choice | per-customer allocation policy |
| A11 | Straight-line depreciation is the only method implemented | `src/core/assets.ts` | IMPLEMENTED; declining balance absent | additional method + tests |
| A12 | ~~Phase 1 read models (dashboard, reports, customers) still use the demo dataset in postgres mode~~ **CLOSED** — reads are repository-backed under RLS | `server/db/datasetRepo.ts` | IMPLEMENTED AND TESTED (`tests/m1/dataset.readmodel.test.ts`, `tests/m1/readmodel.http.test.ts`) | G2 closure commit |
| A13 | Staged Excel imports live in process memory | `server/index.ts` | KNOWN GAP | writing `staged_imports` / `import_records` |
| A14 | No provider free-tier limits are asserted | `docs/FREE_TOOLING_AND_COSTS.md` | NOT VERIFIED | verify each vendor’s current terms and date the entry |
| A15 | Egyptian Code compliance is not claimed anywhere | whole repository | EXPLICIT NON-CLAIM | source-verified rules + approval record |

## How to change an assumption

1. Cite the source (jurisdiction, standard, edition, clause/page, effective date) or the
   approved internal procedure.
2. Add a test that encodes the new value and its boundary.
3. Update `docs/VALIDATION_RULES.md` and this register in the same commit.
4. Record the approval actor and date in the commit message.

## B3 additions

| # | Assumption | Used in | Status | Removed by |
|---|---|---|---|---|
| A16 | WCAG 2.1 AA is the accessibility target (4.5:1 text, 3:1 large/UI) | `src/lib/designTokens.ts`, `tests/design.tokens.test.ts` | LOCKED FOR PHASE 1 | a formal accessibility policy naming another level |
| A17 | Success/warning/secondary stay tint-only because their on-white ratios are 3.30/2.15/4.23 | design system, badges | IMPLEMENTED AND TESTED | darker token variants with a new palette decision |
| A18 | Static source checks are an acceptable proxy where no browser exists | `scripts/a11y-audit.ts` | KNOWN LIMITATION | a browser/assistive-technology pass |
| A19 | The design-system reference is an internal, level-5 page | `src/core/rbac.ts` | PRODUCT DECISION | sign-off to expose it read-only to all roles |
