# KPI derivation audit (gap A6)

Availability labelling is not correctness. Every dashboard KPI is listed with the collection
that backs it, the derivation, and a verdict. `computeKpis` is the single implementation
(`src/core/metrics.ts`); `KPI_SPECS` in `src/core/availability.ts` decides whether a table
exists in postgres mode.

| KPI | Source | Derivation | Verdict |
|---|---|---|---|
| `producedTodayM3` | `batches.volume_m3` | sum of batches whose `produced_at` day equals today (UTC) | NOT IMPLEMENTED in postgres — no `batches` table; demo only, labelled `not_implemented` |
| `rejectedTodayM3` | `batches.reject_m3` | sum of rejects for today's batches | NOT IMPLEMENTED in postgres, same reason |
| `activeTrucks` / `totalTrucks` | `trucks.status` | count of `active`; total rows | NOT IMPLEMENTED in postgres — no `trucks` table |
| `onTimeDeliveryPct` | `trips.status`, `trips.on_time` | completed trips on time / completed trips | NOT IMPLEMENTED in postgres — no `trips` table |
| `avg7dStrengthMpa` | `qualityTests.tested_at`, `strength_7d_mpa` | mean 7-day strength over the last 7 days | NOT IMPLEMENTED in postgres — no `quality_tests` table |
| `overdueReceivables` | `invoices.outstanding_amount`, `status`, `due_date` | sum of outstanding where status is overdue and due date is before today | CORRECT for posted invoices; seeded invoices are not posted to the GL, which is why the GL control account is not the statement |
| `lowStockCount` | `inventory.quantity`, `materials.reorder_level` | count of stock rows at or below reorder level | NOT IMPLEMENTED in postgres — no inventory tables |
| `creditUtilizationPct` | `customers.credit_limit_egp`, `invoices.outstanding_amount` | total outstanding / total credit limit | APPROXIMATE: it is a portfolio ratio, not a per-customer capped exposure; a customer over limit and another under it offset each other |
| `pendingBatches` | `batches.produced_at` | count of today's batches (label says "pending", derivation counts produced) | WRONG LABEL — the number is today's batch count, not pending work |

## Actions taken

- `creditUtilizationPct` keeps its arithmetic (the portfolio ratio is meaningful) but is
  documented as approximate; it is not presented as per-customer headroom.
- `pendingBatches` is surfaced with the same value but its screen label is an existing
  translation key; correcting the label belongs to the batching module (Part C scope) and is
  recorded here rather than silently renamed.
- Every KPI without a backing table reports `not_implemented` in postgres mode, so no zero is
  invented. The dashboard now renders those states (gap A4).
