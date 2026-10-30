# Validation rules (implemented)

Three layers exist, deliberately duplicating the critical invariants:

1. **Client preview / server import** — `src/core/validation.ts` (pure, same code both sides).
2. **Domain services** — `src/core/accounting.ts`, `invoicing.ts`, `allocation.ts`,
   `cheques.ts`, `assets.ts`, `loans.ts`, `threeway.ts`, `reconciliation.ts`.
3. **Database** — `CHECK` constraints, deferred balance trigger, immutability triggers, RLS.

## Import engine — issue codes

| Code | Severity | Meaning |
|---|---|---|
| `MISSING_REQUIRED` | error | required column empty |
| `INVALID_NUMBER` / `INVALID_INTEGER` | error | not parseable (Arabic-Indic digits and thousands separators accepted) |
| `INVALID_DATE` | error | not `YYYY-MM-DD` or invalid calendar date |
| `INVALID_EMAIL` / `INVALID_PHONE` | error | format mismatch (`+` prefix is valid for phones) |
| `INVALID_ENUM` | error | value outside the declared list |
| `INVALID_ID` | error | identifier does not match `^[A-Za-z]{2,4}-[A-Za-z0-9-]{1,24}$` |
| `OUT_OF_RANGE` | error | outside the template's `min`/`max` |
| `TOO_LONG` | (catalogue) | text is truncated to `maxLength` before storage; the code exists for future strict mode |
| `DUPLICATE_IN_FILE` | error | same unique key twice in one upload |
| `DUPLICATE_EXISTING` | error | identifier already stored |
| `BROKEN_REFERENCE` | error | referenced id not in the allowed reference set |
| `SUSPICIOUS_FORMULA` | warning | value starts with `= + - @ tab CR` in a non-numeric/non-phone column; content is neutralised or flagged |
| `YIELD_OUT_OF_RANGE` | error | computed 1 m³ yield outside 0.98–1.02 m³ |
| `WC_TOO_HIGH` | error | water/cement ratio above the exposure-class limit |
| `CREDIT_LIMIT_EXCEEDED` | error | order value + outstanding above the customer limit |
| `CUSTOMER_NOT_ACTIVE` | error | order for a suspended/archived customer |
| `VOLUME_TOO_LARGE` | warning | single order above 12 m³ batch capacity |

Sanitisation strips control characters and zero-width characters, collapses whitespace and
truncates length. Formula-neutralisation applies to any exported/imported user text
(`escapeForSpreadsheet`).

## Accounting and money

| Rule | Layer |
|---|---|
| at least two lines | service + deferred trigger |
| total debit = total credit | service + deferred trigger |
| a line cannot be debit and credit | `CHECK` constraint |
| amounts must be > 0 | `CHECK` constraint |
| posted entries immutable (reversal only) | triggers (`0003`, `0004`, `0007`) |
| unposting is not allowed; reversal creates a mirror entry | service |
| tax rounded half-up once, then totals derived | `src/core/invoicing.ts` + tests |
| payment allocation cannot exceed the unapplied amount | `src/core/allocation.ts` |
| FIFO allocation is deterministic (due date, then id) | `src/core/allocation.ts` |
| credit limit enforced server-side before issue | `src/core/allocation.ts` in the M1 service |
| cheque transitions restricted to the declared lifecycle | `src/core/cheques.ts` + service |
| straight-line depreciation never exceeds cost − residual | `src/core/assets.ts` + tests |
| annuity schedule closes to exactly zero | `src/core/loans.ts` + tests |
| three-way match flags over-receipt, over-billing, price variance and requires approval | `src/core/threeway.ts` + tests |

## Engineering rules — source status

The following are **demo defaults**, not verified code requirements. They are configurable
in code but have **NOT** been verified against the Egyptian Code or a project specification
in this repository:

| Rule | Value in code | Status |
|---|---|---|
| 1 m³ yield tolerance | 0.98–1.02 m³ | DEMO ASSUMPTION |
| W/C limits by exposure class | XC1 0.60, XC4 0.45, XS2 0.45, XS3 0.40 | DEMO ASSUMPTION — NOT VERIFIED AGAINST SOURCE |
| Single batch volume | 12 m³ warning threshold | DEMO ASSUMPTION |
| Concrete age thresholds | 90 / 110 / 120 minutes | DEMO ASSUMPTION |
| VAT | 14 % default on new invoices | DEMO ASSUMPTION (configurable per invoice) |
| Credit days | per customer, demo values | CONFIGURED DATA |

No clause number, edition or authority is attributed to any of these values anywhere in the
codebase. Replacing them requires a citable source and an approval record
(see `docs/ASSUMPTIONS.md`).

## What is not validated yet

- No server-side schema validation library (Zod-like) on request bodies; each handler parses
  and validates explicitly.
- No rate limiting beyond the failure counter/CAPTCHA and durable lockout.
- No validation of uploaded `.xlsx` internals beyond size, extension and parse success; macros
  are never executed and formulas are never trusted.
