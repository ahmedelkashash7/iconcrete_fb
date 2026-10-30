# Entity relationships (implemented)

Cardinalities below are the ones the migrations and services actually enforce. Anything not
listed is `NOT IMPLEMENTED` — see `docs/IMPLEMENTATION_STATUS.md`.

```
companies 1 ── * plants
companies 1 ── * users
companies 1 ── * customers
companies 1 ── * suppliers
companies 1 ── * gl_accounts
companies 1 ── * roles ── * permissions        (through role_permissions)
users     * ── * roles                          (through user_roles, company scoped)
users     1 ── * sessions
companies 1 ── * audit_log                      (company_id nullable for pre-login events)
```

## Accounting

```
customers 1 ── * invoices
invoices  1 ── * invoice_items
invoices  1 ── 0..1 journal_entries             (journal_entry_id, set on post)
invoices  1 ── * payment_allocations
payments  1 ── * payment_allocations
customers 1 ── 1 customer_credit_limits         (current implementation: one active limit row)
customers 1 ── * deposits
customers 1 ── * retentions
journal_entries 1 ── 2..* journal_entry_lines   (deferred trigger enforces ≥ 2 and balance)
journal_entries 1 ── 0..1 journal_entries       (reversal_of / reversed_by, single link)
gl_accounts 1 ── * journal_entry_lines
```

`invoices` do **not** require exactly one payment: partial payments are normal, and a
payment may span several invoices through `payment_allocations`.

## Treasury

```
cash_accounts  1 ── * cash_transactions
cash_accounts  1 ── * cash_closings            (one per business date/account)
bank_accounts  1 ── * bank_transactions
bank_accounts  1 ── * bank_reconciliations
bank_reconciliations 1 ── * bank_reconciliation_items
cheques        1 ── * cheque_movements
cheques        * ── 0..1 bank_transactions     (cleared/deposited linkage by reference)
```

## Assets, loans, procurement

```
fixed_assets 1 ── * depreciation_schedules     (one row per period; posted_journal_entry_id)
loans        1 ── * loan_installments          (annuity schedule, closes to exactly 0)
suppliers    1 ── * purchase_orders
purchase_orders 1 ── * purchase_order_lines
purchase_orders 1 ── * goods_receipts
goods_receipts  1 ── * goods_receipt_lines
suppliers       1 ── * supplier_bills
supplier_bills  1 ── * supplier_bill_lines
purchase_orders 1 ── * supplier_bills
three_way_match_results * ── 1 purchase_order, 1 goods_receipt, 1 supplier_bill
supplier_bills 1 ── 0..1 journal_entries       (after approved match)
```

## Tenant and plant scoping rules

| Entity | Scoped by |
|---|---|
| companies | root |
| plants, users, roles, customers, suppliers, accounts, journal, invoices, payments, treasury, assets, loans, procurement | `company_id` (RLS) |
| plant-specific rows (invoices, transactions, assets, receipts …) | additionally `plant_id` (restrictive RLS policy) |
| audit_log | `company_id` when known, plus `plant_id` when scoped |
| permissions | global catalogue (no tenant) |

A user with an empty `assigned_plant_ids` is company-wide. A non-empty list restricts them to
those plants at the database policy level, not only in the UI.

## Deliberately not modelled yet

Order → batch → truck → trip → delivery ticket cardinalities are described in the master
specification but have **no tables**. Phase 1 keeps `Order`/`Batch`/`Trip` only as demo
dataset rows for dashboard calculations, and `orders` only as an Excel import template.
Designing those relationships without the operational tables would be speculative.
