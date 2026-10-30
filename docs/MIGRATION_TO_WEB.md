# Migrating Excel data into ICONCRETE

The web/database is the authoritative source of truth (Addendum B2). Excel is a starter
workbook, an import template and an export/report format — never a second database.

## Path A — starter workbook → web app

1. Open `excel_generator/output/IConcrete_<timestamp>.xlsx`, replace demo rows in the
   clearly marked editable areas with real data.
2. Do **not** rename sheets or header rows: the importer matches on the
   `labelAr | labelEn` header format produced by `templateHeaderRow()`.
3. In the app, open **مركز تكامل Excel / Excel Integration Center** and download the template
   for the entity you are migrating (customers, suppliers, materials, mix designs, orders,
   employees, fleet).
4. Copy your rows into the template, keeping the stable IDs (`CUS-0001`, `MAT-001`, …).
5. Upload the file. The app parses it, validates every row and shows a preview.
6. Review errors in both languages, download the error workbook, fix the source rows and
   re-upload. Nothing is written yet.
7. Press **commit** with explicit confirmation. Valid rows are written, invalid rows are
   skipped and reported, and an audit event records the file name, checksum, template
   version and row counts.

## Path B — existing customer spreadsheet (CSV/XLSX)

1. Map your columns to a template (see `docs/IMPORT_EXPORT_MAP.md`).
2. Keep one record per row and keep IDs stable across uploads — the importer rejects
   duplicates both inside a file and against existing records.
3. Upload as CSV or XLSX (max 2 MiB by default, `ICONCRETE_MAX_UPLOAD_BYTES`).
4. Iterate on the preview; only then commit.

## What the import guarantees

| Guarantee | How |
|---|---|
| No silent overwrite | a duplicate ID is an error row, never an update-in-place |
| Explicit commit | `confirm: true` is required or the API answers `400 confirmation_required` |
| Idempotency at the upload level | content checksum + template version are stored and audited |
| Macros never executed | the server only parses cell values; no macro, no formula evaluation |
| Formulas not trusted | formula-like content in text fields is neutralised/flagged |
| Audit trail | upload, validation, each rejected row (first 50), commit and error-download are logged |
| Bilingual errors | every issue carries `messageAr` and `messageEn` |

## What it does **not** do yet (be explicit with customers)

- The commit path still writes into the in-process adapter and the demo dataset; the
  `staged_imports` / `import_records` tables exist but are not written by the HTTP flow.
  A restart therefore loses an uncommitted staged upload, and imports are **not** yet
  durable. Use this flow for evaluation, not for production data entry.
- No partial-commit policy configuration: valid rows commit, invalid rows are skipped and
  reported (the summary lists both counts).
- No customer/supplier/invoice update workflow — imports only insert new records.
- No user-defined field mapping UI; mapping is by template shape.

## Migration checklist for a real plant

1. Export the current system to CSV as a snapshot.
2. Load masters in dependency order: plants → customers → suppliers → materials →
   employees → fleet → mix designs → orders.
3. Reconcile counts per sheet against the source file; the commit response returns
   `importedRows` and `skippedRows`.
4. Verify a sample of records in the app (customer outstanding, credit limit).
5. Keep the original upload file and its checksum from the audit log as evidence.
6. Only after a database-backed import commit exists should production data be entered.
