# ICONCRETE Excel Generator — Changelog

All notable changes to the portable `excel_generator` package.

## [0.1.0] — 2026-10-28 — Phase 1 foundation

### Added

- `generate_workbook.py`: real `.xlsx` generator (openpyxl) producing 15 sheets —
  `Login`, `README`, `Dashboard`, `Validation_Report`, `Data_Dictionary`, `Settings`,
  `Customers`, `Suppliers`, `Materials`, `Mix_Designs`, `Orders`, `Employees`, `Fleet`,
  `Migration_to_Web_App`, `Demo_Data`.
- `config.py`: locked ICONCRETE identity (Addendum A1), `GeneratorConfig` dataclass,
  deterministic DEMO dataset and data-dictionary metadata.
- `calc.py`: pure calculation rules — absolute volume, 1 m³ yield, correction factor,
  moisture correction, free water, water conservation, W/C limits, credit limit,
  weighted-average cost, order totals, slump/strength/temperature checks, concrete age,
  reclaimed water, depreciation and loan annuity.
- Excel features: 7 real Excel tables, formula columns (no hard-coded totals), frozen
  panes, dropdown data validation for statuses/units/ownership, decimal/date validation,
  conditional formatting (credit over limit, negative stock, yield/W-C failures,
  licence renewal, validation failures), protected formula cells with unlocked yellow
  input cells, full RTL, named ranges, and 3 dashboard charts (bar, line, doughnut).
- `Validation_Report`: 13 live formula checks plus 12 seeded invalid scenarios that prove
  detection works (duplicate IDs, unknown reference, invalid status, negative volume,
  negative credit limit, over-limit order, negative stock, yield failure, W/C failure,
  expired licence, missing name, negative net salary).
- `IConcrete_Generator.ipynb`: 9-cell Colab notebook (title/instructions, optional Drive
  mount disabled by default, dependency install, configuration, optional upload,
  generation, automated checks, log, download).
- `tests/test_workbook.py`: 28 tests covering file creation, openpyxl load, sheet list,
  tables/headers, formulas, named ranges, validations, charts, RTL, locked brand text,
  protection, seeded scenarios, clean demo data, unique filenames and the calculation
  rules against the master specification reference values.
- `sample_input/`: clearly marked demo-only CSV inputs for Customers, Suppliers and
  Materials opening balances, plus a README describing their role.
- `README_AR.md` / `README_EN.md`: usage, configuration, Colab flow, rules and honest
  limitation disclosure.
- `output/`: kept in Git through `.gitkeep`; generated workbooks are ignored.

### Notes

- The specification's correction factor `0.9627` for the overweight 1250 kg gravel mix is
  a truncated value; the exact factor is 0.962756, rounded to 0.9628 by the generator.
  Tests assert the exact value.
- Sheet protection is an accidental-edit guard, not a security boundary; this is stated
  inside the workbook and in both READMEs.
- Still out of scope for Excel (documented, not claimed): live cloud sync, PostgreSQL RLS,
  real 2FA, GPS/SCADA/IoT connectivity, WhatsApp/SMS delivery, Power Pivot/DAX and
  server-side API authorisation.
