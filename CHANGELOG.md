# Changelog

All notable changes to ICONCRETE (IConcrete-fp). Format based on Keep a Changelog;
versions follow Semantic Versioning.

## [M2 — mix design] — 2026-11-03

### Added

- Migration `0013_mix_design.sql`: `mix_designs` (unique code per company, plant scoped),
  `mix_design_versions` (draft → submitted → approved → superseded, `immutable` derived from
  status), `mix_components` and `mix_strength_tests`. Content of an approved or superseded
  version cannot change: the repository refuses it and a trigger refuses it to direct SQL.
- Pure engine `src/core/mixDesign.ts`: the five M2 checks with their §26 classifications
  (positive qty → mandatory_failure, unknown strength class → approval_required, missing
  source note → approval_required, duplicate code → mandatory_failure, editing an approved
  version → mandatory_failure) plus the lifecycle transition table. No database, no IO.
- Repository and API: reads from level 1, draft writes and submission at level 4, approval
  and supersede at level 5. Superseding an approved version records the override of
  `mix.approved_version_edit` in `rule_overrides` with actor, reason, decision, rule id and
  time, and audits `mix.version_superseded`.
- UI: bilingual mix design screens (catalogue list, detail/create) with draft-only editing,
  rule checks with classifications, the mix rules card that keeps showing
  "not specified in the supplied reference" and marks unconfigured values configurable,
  and an approve button disabled below level 5.

### Tests

- `tests/mixDesign.test.ts` (pure), `tests/m2/mixDesign.db.test.ts` and
  `tests/m2/mixDesign.http.test.ts`: every check classification, missing value/source →
  approval_required (never pass), lifecycle transitions, version immutability at both the
  service and SQL level, override with all five fields, override without a reason refused,
  level guards (1/4/5) and tenant isolation.

## [R1 — configurable rule engine] — 2026-11-03

### Added

- Migration `0012_rule_engine.sql`: `rule_definitions` (per company, with `value`, `unit`,
  `source_note`, `approved_by`, `effective_from`), plus append-only `rule_evaluations` and
  `rule_overrides`. `seed_rule_catalogue()` seeds ten unconfigured rules per company for
  both demo tenants; no numeric limit is invented, because the ECP 203-2007 Code file is
  not in the repository.
- Pure rule engine `src/core/rules.ts`: the §26 classes (`warning`, `mandatory_failure`,
  `approval_required`, `engineering_hold`, `authorized_override`), `evaluateRule` and
  `validateOverride` with no DB, no IO and no clock.
- Behaviour contract: a rule with no value or no source note evaluates to
  `approval_required` — never a pass, never a silent default; the engine never rewrites a
  measured value; an override needs actor, reason, rule id and decision before any row
  exists.
- Rule API `server/api/rules.ts`: `GET /api/rules` catalogue (level 2) reporting
  `not specified in the supplied reference` where no value exists, `GET /api/rules/:code`,
  `PUT/PATCH /api/rules/:code` (level 5 only, audited `rule.value_changed`) and
  `POST /api/rules/:code/override` (level 4, audited `rule.overridden`).

### Tests

- `tests/rules.test.ts` (pure) and `tests/m1/rules.db.test.ts` / `tests/m1/rules.http.test.ts`
  (postgres): every classification outcome, missing value/source → `approval_required`,
  level-5 guard with audited before/after, override row with all five fields, override
  without a reason refused, append-only enforcement, tenant isolation.

## [Phase 2 — M1 security remediation] — 2026-10-29

### Added

- Durable authentication in `postgres` mode: company/user lookup, session creation,
  sliding validation, revocation and expiry, all through `SECURITY DEFINER` functions in
  `db/migrations/0006_m1_durable_auth.sql`. Only the SHA-256 token hash is stored; failure
  counters and lockouts persist across restarts.
- Audit events `auth.login.success`, `auth.login.failure`, `auth.logout`,
  `auth.session.revoked`, `auth.session.expired` and `auth.lockout`, plus an append-only
  trigger and RLS-backed reads on `/api/audit`.
- Production configuration enforcement: `ICONCRETE_ENV=production` requires postgres
  storage, a non-placeholder `DATABASE_URL` and a non-demo admin secret of 12+ characters.
  Numeric settings are validated instead of silently clamped.
- Cross-tenant guard: routes still served by the demo dataset answer
  `403 tenant_data_unavailable` for other companies.
- `docs/SECURITY.md`, `tests/m1/auth.durable.test.ts` and a cross-plant write RLS test.

### Fixed

- `bun run db:seed` is idempotent again: links to journal entries are released before the
  entries are removed, roles are deleted before companies, and the seed opts into
  transaction-scoped maintenance flags (`app.seed_reset`, `app.audit_purge`) that request
  connections never set.

## [0.1.0] — 2026-10-28 — Phase 1

### Added — web application

- Bun + TypeScript (strict) + React 19 + Vite foundation with Arabic RTL default and English
  second language; locked ICONCRETE brand and purple-blue palette.
- Authentication: company-scoped login, argon2id password hashes, sessions with SHA-256 token
  hashes and 30-minute sliding idle expiry, lockout after 5 failures, local CAPTCHA after 3,
  audit records for login/failure/lockout/logout.
- RBAC with five role levels enforced at the API (401/403) and in navigation, including a
  masked financial balance and blocked Excel export for the viewer role.
- Dashboard: derived general balance (debit/credit/net), KPI grid, alerts, quality summary,
  six-month revenue series and interactive Recharts donut/line/bar charts.
- Reports: seven report types generated from one filter, totals, print view and real `.xlsx`
  export (ExcelJS) with Arabic RTL when the UI language is Arabic.
- Customers, Plants, Users and Audit screens backed by the demo dataset; derived outstanding
  and available credit; credit-limit badges.
- Excel Integration Center: seven downloadable templates, `.xlsx`/`.csv` upload with size and
  type checks, staged validation preview, bilingual row errors, downloadable error workbook,
  explicit confirm-to-commit, checksum + template version capture, and an audit trail covering
  uploads, validations, imports, exports and rejected rows.
- Deterministic demo dataset: 24 customers, 2 plants, 5 users, 6 suppliers, 6 materials,
  invoices, cash/bank/cheques, loans, payroll, rentals, utilities, maintenance, batches,
  trips and quality tests — all demo-marked.

### Added — portable Excel generator

- `excel_generator/` package: `generate_workbook.py`, `config.py`, `calc.py`,
  `requirements.txt`, `IConcrete_Generator.ipynb`, `README_AR.md`, `README_EN.md`,
  `tests/test_workbook.py`, `sample_input/` demo CSVs and `output/` with `.gitkeep`.
- 15-sheet RTL workbook with Excel tables, formula-driven totals, frozen panes, dropdown
  validation, conditional formatting, protected formulas with editable input cells, named
  ranges, and three dashboard charts.
- `Validation_Report` with 13 live formula checks and 12 seeded invalid scenarios proving
  detection; `README` and `Data_Dictionary` sheets in Arabic with English sections.
- Google Colab notebook (9 cells) with optional Drive mount and upload disabled by default,
  dependency install, configuration, generation, automated checks, log and download.

### Added — project

- Root README, MIT LICENSE, `.env.example`, `.gitignore`, `docs/PHASE1.md`,
  `docs/EXCEL_GENERATOR_CHANGELOG.md`.
- 67 web tests (unit + API integration) and 28 Python generator tests.

### Notes / limitations

- In-memory demo store only; no PostgreSQL/RLS, offline sync, 2FA or operational modules yet.
- The specification's 0.9627 mix correction factor is truncated; the exact value is 0.9628
  after the generator's 4-decimal rounding, and tests assert that.

## [Phase 2 — M1] Accounting core (durable)

### Added
- PostgreSQL adapter with explicit `demo` / `test` / `postgres` storage modes, hard
  failure instead of silent fallback, and storage reporting in `/api/health`.
- Four checksum-verified migrations: 48 tables, `numeric(18,2)` money, soft delete,
  optimistic `version`, tenant/plant columns.
- Row level security forced on 42 tables, with transaction-scoped tenant and plant
  context and a restricted `iconcrete_app` role.
- Deferred-commit balance trigger, posted-entry and posted-line immutability triggers.
- Decimal-safe money core (bigint minor units), invoice/VAT/retention maths, FIFO
  allocation, aging, straight-line depreciation, annuity loans, three-way match, bank
  reconciliation and cheque state machine.
- M1 service + API: journal posting/reversal, trial balance, general ledger, invoices,
  payments, cheques, assets, loans, procurement and treasury.
- `bun run db:migrate | db:seed | db:reset | db:status`.
- Unit tests for every M1 calculation and PostgreSQL integration tests for migrations,
  RLS isolation, triggers, sessions, audit and service flows.

### Changed
- Excel import templates bumped to schema version `1.1.0`.
- `/api/health` reports `phase: 2`, `module: "M1"` and a `storage` block.

### Known limitations
- Login still uses the Phase 1 in-memory session store; durable `sessions` rows are not
  written by the HTTP auth flow yet.
- Excel uploads still stage in memory; `staged_imports` is not wired to the uploader.
- No M1 screens yet.

## B3 — design system, accessibility audit, docs and hygiene (2026-11-02)

- Added `src/lib/designTokens.ts` (locked §1 palette + declared WCAG targets),
  `src/lib/contrast.ts` (WCAG 2.1 maths) and `tests/design.tokens.test.ts`.
- Added `src/pages/DesignSystemPage.tsx` at `#/designSystem` (role level 5): palette with live
  contrast, typography, buttons, inputs, tables, cards, badges, alerts, dialog, loading/empty/
  error states, focus rings, RTL and LTR.
- Added `scripts/a11y-audit.ts` and `docs/ACCESSIBILITY_AUDIT.md` separating mechanically
  verified checks from browser/screen-reader items that remain NOT TESTED.
- `src/index.css`: global `:focus-visible`, `prefers-reduced-motion`, dialog and mobile styles.
- Code splitting: `src/App.tsx` loads pages with `React.lazy`; entry chunk 814.35 kB → 294.66 kB.
- Excel generator sets `workbook.calculation.fullCalcOnLoad = True`; added
  `excel_generator/tests/test_recalculation.py` (31 passed, 1 skipped without LibreOffice).
- Repository hygiene: `README_AR.md`, `docs/BUILD_AND_DEPLOY.md`, `docs/ROLLBACK.md`, refreshed
  `.gitignore`, refreshed ISSUES_AND_GAPS / SECURITY / VERIFICATION_RECORD / ENVIRONMENT_AUDIT /
  ARCHITECTURE_DECISIONS (ADR-013…016) / FREE_TOOLING_AND_COSTS / DATA_MODEL /
  ENTITY_RELATIONSHIPS / ASSUMPTIONS (A16…A19) / regenerated DATA_DICTIONARY.
- B2 gap check: none — CSV lifecycle complete, wizard mounted, Reports UI wired.

## G2 closure — dashboard/report reads are repository-backed (2026-11-02)

- `/api/dashboard`, `/api/reports/*` and `/api/customers` read tenant tables under RLS whenever
  a database is configured; the demo dataset is used only in demo/test mode and is labelled.
- Added `tests/m1/readmodel.http.test.ts`: an invoice written only to PostgreSQL moves the
  dashboard's `overdueReceivables` by exactly its amount, the customer total equals the table
  count, and a second tenant sees neither the fixture customer nor its statement.
- Fixed `customer_statement`: an explicit `customerId` that is unknown or belongs to another
  tenant no longer falls back to the tenant's first customer; it returns an empty statement.
- §57.5 and §57.7 flipped to PASS in `docs/B3_REPORT.md`; G2 and G16 closed in
  `docs/ISSUES_AND_GAPS.md`; A12 retired in `docs/ASSUMPTIONS.md`.
- Added `docs/PHASE2_PLAN.md` (M2 mix design, M3 batching, M4 quality/lab, M5 fleet/dispatch)
  for approval only. The ECP 203-2007 Code file was not supplied, so no clause number and no
  numeric limit is attributed to it anywhere in the plan.
