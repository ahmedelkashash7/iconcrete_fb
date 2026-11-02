# Free tooling and cost position

Charter: the user has no software budget today. This file records what is actually used,
what it costs, and what is explicitly **not** claimed.

## What the project uses today (all zero-cost, all local)

| Capability | Tool actually used | Cost | Notes |
|---|---|---|---|
| Runtime / package manager / tests | Bun 1.3.14 | free | one binary for dev, API, tests |
| UI | React 19 + Vite 8 | free (MIT) | no UI framework subscription |
| Charts | Recharts 3 | free (MIT) | dashboard and reports |
| i18n | i18next + react-i18next | free (MIT) | Arabic default, English second |
| Server-side spreadsheets | ExcelJS 4 | free (MIT) | report/customer/error workbooks |
| Portable workbook generator | Python 3 + openpyxl + pytest | free (BSD/MIT) | runs in Colab or locally |
| Database | PostgreSQL 16 (self-hosted) | free (PostgreSQL licence) | not installed on the host image; provisioned per run |
| Version control | Git | free | no remote configured in this environment |
| Documentation | Markdown in `docs/` | free | — |

No paid dependency is required to build, test, seed, run the demo or generate the workbook.

## What is deliberately absent

- No hosted database, no managed auth, no email/SMS/WhatsApp provider, no payment provider,
  no AI/LLM key, no monitoring SaaS, no object storage.
- No browser automation dependency is installed in the project.
- No CI service is configured (there is no authenticated remote to run it against).

Every such capability appears in code only as an explicitly labelled placeholder or as
`NOT IMPLEMENTED` (`docs/IMPLEMENTATION_STATUS.md`).

## Maturity levels — current classification

| Level | Definition | ICONCRETE status |
|---|---|---|
| A. Zero-cost local prototype | runs on a developer machine, no hosting | **yes** — demo mode, no services needed |
| B. Zero-cost demonstration deployment | publicly reachable, free tier, no reliability promise | **not done** — no hosting account or authenticated deployment path available here |
| C. Limited free-tier pilot | one plant, defined limits, no SLA | **not done** — requires a hosting plan decision and a database add-on |
| D. Production with defined reliability | backups verified, monitoring, RPO/RTO | **not done** — no backup/restore test exists yet |
| E. Scalable commercial deployment | multi-tenant ops, support, billing | **not done** |

Levels A–C must not be described as production readiness.

## Free-tier claims that are NOT made here

No provider free-tier limit (storage, execution time, sleep behaviour, bandwidth, row counts,
retention) is asserted in this repository. Those numbers change and were not verified from
each vendor's current documentation in this environment. Before any deployment decision,
verify the provider's current terms directly and record them in this file with a date and
source URL.

## Cost risks to design against

1. **Managed PostgreSQL free tiers** often expire or cap storage; the app must export its
   data (`xlsx` reports, `db:status`) so a migration is possible.
2. **Serverless sleep** would break long imports; the import flow is already staged and
   bounded (2 MiB default upload limit).
3. **Egress/backup charges** are the usual hidden cost once a pilot grows; backups are not
   automated yet, so nothing is silently billed.
4. **Provider lock-in** is limited by keeping SQL portable (plain PostgreSQL, no proprietary
   extensions) and business logic in `src/core/*`.

---

## B3 measurement (no new dependency, no new cost)

- No package was added or upgraded for B3; the palette, contrast maths and audit script use
  the existing Bun/React/Vite toolchain and `node:fs`.
- Build without any new dependency: 814.35 kB single chunk (232.89 kB gzip) →
  294.66 kB entry (90.34 kB gzip) + per-page chunks, largest 393.71 kB (112.42 kB gzip).
- `pytest` gained one skipped test because LibreOffice is not installed; installing an office
  suite is **not** required to generate or validate the workbook, and no paid licence is used.
- Still zero-cost: Bun, React, Vite, Recharts, i18next, ExcelJS, openpyxl, PostgreSQL, Git,
  Markdown. No hosted database, auth, email/SMS, payments, monitoring or AI key is used.
