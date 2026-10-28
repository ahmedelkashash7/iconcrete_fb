# ICONCRETE — Portable Excel Generator

**ICONCRETE — Concrete Management Solutions**

A standalone Python package that generates a real `.xlsx` workbook for ready-mix
concrete plant management. It runs locally and in Google Colab, with no backend,
no API keys, no paid services, no Microsoft Excel Desktop and no manual source edits
for ordinary configuration.

- Arabic RTL is the default; every sheet carries Arabic labels with English translations.
- Brand identity is locked: **ICONCRETE** with the tagline **Concrete Management Solutions**.
- Output files are timestamped (`IConcrete_YYYYMMDD_HHMMSS.xlsx`) and never overwrite an earlier file.

## Requirements

- Python 3.9+ (tested with 3.12)
- `openpyxl` 3.1.x, `pytest` 8.x for the tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r excel_generator/requirements.txt
```

## Generate a workbook

```bash
python3 excel_generator/generate_workbook.py
```

Output goes to `excel_generator/output/IConcrete_<timestamp>.xlsx` (ignored by Git).

Options:

```bash
python3 excel_generator/generate_workbook.py \
  --output-dir ./output \
  --from 2026-05-01 --to 2026-10-28 \
  --no-protection            # leave sheets unprotected
  --no-charts                # skip dashboard charts
  --empty                    # generate without demo rows
```

## Configure

Edit the defaults in `excel_generator/config.py` (or pass a `GeneratorConfig` from
Python / the notebook): company and plant identity, currency, language, timezone,
report period, output directory, VAT rate, protection and demo-data flags.
All brand values come from Addendum A1 and must not be changed for the product.

## Google Colab

1. Upload the `excel_generator` folder to Colab (or clone the repository).
2. Open `IConcrete_Generator.ipynb`.
3. Run cells 1 → 9. Only cell 4 (configuration) normally needs review.

The notebook installs dependencies, optionally mounts Drive, optionally uploads files,
generates the workbook, runs the automated checks, prints a log and downloads the file.
It needs no AI Studio, GitHub credentials, API keys or Excel installation.

## What the workbook contains (Phase 1)

| Sheet | Purpose |
|---|---|
| `Login` | Cover/login area with locked brand text; states that real authentication lives in the web app |
| `README` | Arabic guide with a concise English section and documented limitations |
| `Dashboard` | KPIs by formula, monthly revenue/volume charts, stock-value doughnut |
| `Validation_Report` | 13 live formula checks + 12 seeded error scenarios showing detection works |
| `Data_Dictionary` | Every sheet/field, type, required flag, allowed values |
| `Settings` | Identity, report period, palette, dropdown source lists, named ranges |
| `Customers` | Credit limits, derived outstanding/available, status dropdowns |
| `Suppliers` | Supplier list by category |
| `Materials` | Opening/received/issued/closing stock with weighted value |
| `Mix_Designs` | 1 m³ yield and W/C checks with correction factor |
| `Orders` | Pricing, VAT, grand total, credit-limit check |
| `Employees` | Salary structure with net pay formula |
| `Fleet` | Trucks, licence expiry and renewal alerts |
| `Migration_to_Web_App` | Step-by-step move to the web application |
| `Demo_Data` | Demo separation rules and demo-row counts |

Workbook features: real Excel tables, formulas (no hard-coded totals), frozen panes,
dropdown data validation, conditional formatting, protected formula cells, editable
input cells in a distinct yellow fill, full RTL, named ranges and dashboard charts.
Sheet protection is an accidental-edit guard, **not** a security boundary.

## Validation rules implemented

| Rule | Where |
|---|---|
| Mix yield 0.98–1.02 m³ | `Mix_Designs` formula + `Validation_Report` |
| W/C limits (XC1 0.60, XC4 0.45, XS2 0.45, XS3 0.40) | `Mix_Designs` formula + report |
| Customer credit limit | `Orders.CreditCheck` + report |
| Negative stock / volume / credit | report |
| Duplicate IDs, unknown references, invalid statuses | report |
| Licence expiry ≤ 30 days | `Fleet` + report |

`calc.py` contains the same rules as pure functions (yield, moisture correction, water
conservation, W/C, credit, weighted average cost, order totals, quality and age rules,
depreciation, loan annuity). The workbook formulas mirror them and the tests cover both.

## Tests

```bash
python3 -m pytest excel_generator/tests -q
```

The suite verifies: the file is created; the workbook opens with openpyxl; all expected
sheets exist; tables/headers/formulas/named ranges/validations/dropdowns exist; three
dashboard charts exist; every sheet is RTL; the locked brand text is on the Login sheet;
formula cells are protected while input cells are editable; seeded invalid scenarios are
detected; demo data is clean; output filenames never overwrite; and the calculation rules
match the master specification reference values.

## Documented limitations (honest, no false claims)

The workbook does **not** provide live cloud synchronisation, PostgreSQL RLS enforcement,
real 2FA, live GPS/SCADA/IoT connectivity, actual WhatsApp/SMS delivery, native Power
Query/Data Model/Power Pivot/DAX, or server-side API authorisation. Those are represented
only by configuration placeholders, import/export templates and the documented migration
path. Every demo row is marked `DEMO`; delete those rows before real use.

## Relationship to the web application

The web app is the source of truth once a database is connected. Excel is used only as a
starter/offline workbook, an import template, an export/report format and a controlled
data-entry template. The Excel Integration Center validates every uploaded row, produces
an error report, never silently overwrites records, and writes an audit entry for every
upload, validation, import, export and rejected row.

See `docs/EXCEL_GENERATOR_CHANGELOG.md` for the change history.
