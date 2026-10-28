# ⚠️ Sample input — DEMO ONLY

Every file in this folder is **synthetic demo input** for the ICONCRETE Excel
generator and the Excel Integration Center. Nothing here is real company,
customer, employee or financial data.

| File | Purpose | Matching template |
|---|---|---|
| `customers_demo.csv` | Example customers with credit limits | Customers |
| `suppliers_demo.csv` | Example suppliers by category | Suppliers |
| `materials_opening_balances_demo.csv` | Opening stock balances per plant | Materials |

## Rules

- Keep the header names exactly as they are (they match `excel_generator/config.py`
  and `src/core/excelSchema.ts`).
- Do **not** place real data in this folder; it is committed to Git.
- Before using real data, copy a file elsewhere, replace the demo rows, and import
  it through the web app's Excel Integration Center — where every row is validated
  before it is committed and the action is written to the audit log.
- The web app never executes macros and never trusts formulas from uploaded files.

Demo company: شركة آي كونكريت التجريبية / IConcrete Demo Company
Demo plant: محطة آي كونكريت التجريبية - القاهرة / IConcrete Demo Plant - Cairo
