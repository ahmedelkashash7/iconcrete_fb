# Changelog

All notable changes to ICONCRETE (IConcrete-fp). Format based on Keep a Changelog;
versions follow Semantic Versioning.

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
