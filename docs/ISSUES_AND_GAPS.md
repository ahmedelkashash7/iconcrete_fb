# Issues and gaps

Open items at commit `5f90ccc`. Severity is about risk to real operations, not about how hard
the fix is. Nothing here is hidden from the phase reports.

## High

| # | Gap | Impact | Next action |
|---|---|---|---|
| G1 | Staged Excel imports are process-memory only; `staged_imports` is not written | an uncommitted upload is lost on restart; imports are not durable | write staged rows + import records in the postgres path |
| G2 | Phase 1 read models (dashboard, reports, customers/plants/users) still read the demo dataset in postgres mode | a second tenant sees `403` instead of its own data | repository-backed read models + tests |
| G3 | No accounting UI | M1 is an API/service layer only; a user cannot post or invoice from screens | Accounting screens (invoices, payments, statements, GL, trial balance) |
| G4 | M1 Excel templates missing (chart of accounts, suppliers, invoices, invoice items, payments, expenses, cheques, fixed assets, loans) | migration of accounting data is not possible via template | add schemas + generator sheets + tests |
| G5 | No backup/restore verification | disaster recovery is unproven | documented dump/restore drill with a measured restore |

## Medium

| # | Gap | Impact | Next action |
|---|---|---|---|
| G6 | No browser/E2E automation in the environment | RTL rendering and click-through are unverified at browser level | run Playwright in an environment that has a browser |
| G7 | No GitHub remote | no off-machine copy or CI | authenticate `gh`, create `IConcrete_freebuff`, push (see final report) |
| G8 | Audit retention is documented only | unbounded growth; no pruning | scheduled purge job with an explicit policy |
| G9 | No CSRF protection; bearer-only auth | fine today, unsafe if cookie sessions are added | CSRF token + `SameSite` before any cookie session |
| G10 | No 2FA, password reset or session-management UI | operational security depends on password hygiene | TOTP + reset flow |
| G11 | Import validation lacks a schema-version compatibility gate | a future template change could be silently accepted | compare declared version against a supported range |
| G12 | Engineering thresholds unverified (A1–A4) | wrong defaults could mislead operators | source-verified configuration + approval workflow |

## Low

| # | Gap | Impact | Next action |
|---|---|---|---|
| G13 | `TOO_LONG` code is defined but values are truncated instead of rejected | silent truncation of overly long text | strict mode per template |
| G14 | Single JS bundle > 500 kB (build warning) | slower first load | route-level code splitting |
| G15 | No rate limiting beyond lockout/CAPTCHA (in-process per instance) | distributed abuse not covered | edge/WAF or shared counter |
| G16 | Demo dataset has one company for read models | isolation tested only through the 403 guard | multi-tenant fixtures per read model |

## Explicit non-claims

- Egyptian Code compliance, 2FA, live GPS, PLC/SCADA, weighbridge, WhatsApp/SMS delivery,
  predictive AI, offline sync and commercial multi-tenant hosting are **NOT IMPLEMENTED**.
- No deployment has been performed, so no availability, latency or recovery target is claimed.
