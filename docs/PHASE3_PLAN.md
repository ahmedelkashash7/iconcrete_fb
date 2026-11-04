# Phase 3 plan — M6 Inventory, M7 Sales & CRM, M8 Orders & Distribution, M9 Procurement, M10 Supplier Workflows

**Status: PLAN FOR APPROVAL. Nothing in this document is implemented, migrated, routed or tested.**
No table, endpoint, screen, rule code or test from this plan exists in the repository at this tip
(`239c9e9`). Phase 3 work starts only after this plan is approved and a separate execution brief
is issued.

## Reference position

The controlling reference for numeric limits remains **ECP 203-2007**, whose Code file is still
**not supplied**. Therefore:

- No clause number is attributed to ECP anywhere below.
- Every tolerance, threshold, discount band, approval limit, reorder point and matching tolerance
  is written as **“not specified in the supplied reference”**: configurable, seeded with no
  value, no default, and an unconfigured rule never passes. The only exceptions are the two credit
  percentages approved at review (D4), recorded as repository configuration and still configurable,
  never as ECP values.
- Repository demo assumptions (A1–A4) may be cited as repository values, never as ECP values.
- Supplier and price data from the user-supplied workbooks informed only the *shape* of the
  entities below. No workbook formula, value or column is treated as authoritative, and no
  workbook is imported into the repository.

## Module numbering and dependency order

Continuing from M5, Phase 3 is **M6–M10**. The order differs from the phase list in spec §62
only because of a documented dependency: price lists and quotation versions (M7) must exist
before orders can resolve a price (M8), and materials/lots (M6) must exist before receipts and
consumption can post.

| Module | Scope (spec §62) | Depends on | Why this position |
|---|---|---|---|
| **M6 Inventory** | materials, stores, receipts, issues, consumption, transfers, valuation, reorder | M2/M3 (moisture), M1 (suppliers) | every later module posts stock against materials and lots |
| **M7 Sales & CRM** | leads, opportunities, quotations/versions, price lists, contracts, discount approval | M1 customers, B1 projects | M8 needs a resolved price and an approved quotation/contract |
| **M8 Orders & Distribution** | order items, surcharges, credit check, delivery tickets, POD, returns, diversions | B1 orders, M5 trips/batches, M7 prices, M6 stock | extends the existing order foundation, does not replace it |
| **M9 Procurement** | purchase requests, approvals, RFQs/supplier quotations, PO approval, price history | M6 materials, M1 suppliers/PO | buys what M6 stores and prices |
| **M10 Supplier Workflows** | receipts into stock, bills, three-way match exceptions, scorecards, performance | M9, M6 | closes the procure-to-pay loop over M9's documents |

No required module is removed or silently folded into another.

---

# DECISIONS REQUIRING APPROVAL

| # | Decision | Options | Recommendation | Spec |
|---|---|---|---|---|
| D1 | Inventory valuation method | FIFO · weighted average · specific identification | **Weighted average for every bulk material** (`materials.is_bulk = true`), set once per company and immutable after that material's first posted movement; **FIFO is allowed for non-bulk materials** (spare parts, consumables) and is not deferred — it consumes open cost layers oldest first, chosen per material at creation. Specific identification is refused for bulk materials | §34 |
| D2 | Negative stock policy | Block outright · permit with authorization, explanation and audit | **Block below zero; a balance of exactly zero is valid and posts.** Any movement that would take the derived balance below zero is refused. A level-4 user may override with a mandatory reason, which creates an `inventory_exceptions` row and an audit event and **auto-suggests the missing receiving document** (an open PO line or an expected GRN for that material and store) for the user to confirm; stock never becomes silently negative | §34 |
| D3 | Order lifecycle reconciliation | Keep B1 chain · replace it · extend it | **Extend the existing chain**: `draft → confirmed → scheduled → in_production → delivered → invoiced → closed`, plus `cancelled` from `draft|confirmed|scheduled` and `on_hold` from `confirmed|scheduled|in_production` with resume. Partial delivery is derived from delivery tickets, not stored as a state. Existing statuses, API and screen stay; new states and guards are additive | §22 |
| D4 | Credit-limit enforcement | Block · warn · approval_required | **Warn above 100% of the effective limit; approval_required at level 4 above 110%**, recorded with limit, exposure, actor and reason. Exposure = posted AR + open orders + overdue invoices, each stored separately on the check. **Hard block only for `suspended` or `blacklisted` accounts** (and `archived`). The two percentages are review-approved repository configuration (`sales.credit_warn_pct` = 100, `sales.credit_approval_pct` = 110), not ECP values, and stay configurable per company; an unconfigured limit means no automatic pass — it needs approval | §20, §22 |
| D5 | Discount / price approval thresholds | Fixed percentage · per-company configurable · per-customer | **Per-company configurable rules** `sales.discount_approval_pct` and `sales.discount_max_pct`, both seeded **not specified in the supplied reference** with no default; above threshold → approval_required, above max → mandatory failure | §21 |
| D6 | Three-way match tolerance | Zero tolerance · fixed tolerance · configurable | **Configurable quantity and price tolerances** (`procurement.match_qty_tolerance_pct`, `procurement.match_price_tolerance_pct`), seeded with no value; a variance beyond an unconfigured tolerance is approval_required, never matched | §35 |
| D7 | Price precedence | Price list first · contract first · “latest wins” | **Contract price > volume commitment > seasonal price > price list**, with the resolution stored in `price_resolutions` (source type, source id, rule id, resolved price). No applicable price, or two sources at the same rank, → approval_required | §21 |
| D8 | Quotation revision vs signed contract | Mutate the quotation · version it · detach contract copy | **Immutable quotation versions.** An approved quotation can only be superseded by a new version; a contract pins `quotation_version_id` and a signed document reference, and changing contract price requires a level-5 change order. A new quotation version never alters an existing contract | §21 |
| D9 | Delivery ticket / POD shape | One ticket per order · one per trip · one per load | **One ticket per load**, attached to exactly one order and one trip, optionally covering several batches through `delivery_ticket_batches`; `proof_of_delivery` is a child of the ticket. One order may have many tickets, trips and batches | §19, §22 |
| D10 | Is §27 already satisfied by M2/M3? | New moisture entities · extend existing · reuse as-is | **Largely satisfied.** M2's explicit `moisture_basis` and M3's `moisture_readings` already model basis and validity. Phase 3 adds the material master, supplier lots and `stock_movements` with `wet_quantity`, `dry_equivalent_quantity` and `moisture_reading_id`; **no new moisture-reading entity** is created | §27 |

**Classification.** FIXED by the spec, no business choice: **D3, D7, D8, D10**. OPEN business
choices: **D1, D2, D4, D5, D6, D9**. At review, D3, D5, D6, D7, D8 and D9 were approved as
stated; D1, D2 and D4 were revised and carry the revised recommendations in the table above.

| Class | Decisions | Meaning |
|---|---|---|
| FIXED by spec | D3, D7, D8, D10 | the reference or an existing built artefact already determines the answer |
| OPEN | D1, D2, D4, D5, D6, D9 | a business choice the owner must make; recommendation is not a default |

---

# What already exists (do not rebuild)

| Foundation | Exists in | Consequence for Phase 3 |
|---|---|---|
| `customers`, `customer_credit_limits`, `suppliers` | migration `0002` | M7/M8 add contacts, locations, contracts and prices; no duplicate master tables |
| `projects`, `orders` | migration `0009` | M8 **extends** `orders`; it does not create a second order table |
| Order lifecycle | `src/core/orders.ts`, `/api/orders/:id/transition` | D3 extends this table and API; the existing forward chain and screen remain |
| PO, PO lines, goods receipts, supplier bills, three-way match tables | migration `0002` | M9/M10 extend statuses, approvals and evidence; the existing procurement service and endpoints stay |
| Procurement service | `server/services/m1.ts`, `/api/m1/purchase-orders`, `/supplier-bills/:id/match` | M9 adds PR/RFQ/limits and price history around it; matching evidence rules strengthen in M10 |
| Mix moisture basis and readings | migration `0013` (`mix_components.moisture_basis`), `0014` (`moisture_readings`) | D10 reuses them; M6 links consumption to a reading id |
| Dispatch, trips, batches | migrations `0014`, `0016` | M8 delivery tickets attach to existing trips and batches |
| Rule engine and catalogue | `0012`, `src/core/rules.ts`, `/api/rules` | every numeric rule below is a catalogue code, seeded unconfigured |

Not present at this tip: any `materials`, `stock_*`, `lead`, `opportunit*`, `quotation*`,
`contract*`, `price_*`, `delivery_ticket*`, `purchase_request*`, `supplier_quotation*` or
`supplier_scorecard*` table. Confirmed against the live 75-table schema.

---

# M6 — Inventory

## Entities

| Entity | Key fields |
|---|---|
| `materials` | `id`, `company_id`, `code` (unique per company), `name_ar`, `name_en`, `category` (`cement`,`scm`,`aggregate`,`water`,`admixture`,`fuel`,`spare_part`,`other`), `base_unit`, `specific_gravity`, `bulk_density`, `is_bulk`, `valuation_method` (`weighted_average`,`fifo`), `is_moisture_sensitive`, `status` (`active`,`suspended`,`archived`), soft delete |
| `material_lots` | `id`, `company_id`, `plant_id`, `material_id`, `supplier_id`, `lot_no`, `received_at`, `quantity_received`, `quantity_remaining`, `unit_cost`, `quality_status` (`pending`,`released`,`hold`,`rejected`), `certificate_ref`, `expires_at` |
| `stores` | `id`, `company_id`, `plant_id`, `code`, `name_ar`, `name_en`, `store_type` (`cement_silo`,`aggregate_bay`,`water_tank`,`admixture_tank`,`spare_parts`,`fuel`), `status` |
| `stock_movements` | `id`, `company_id`, `plant_id`, `store_id`, `material_id`, `lot_id`, `movement_type` (`receipt`,`issue`,`consumption`,`return`,`adjustment`,`transfer_out`,`transfer_in`,`reversal`), `quantity`, `unit`, `unit_cost`, `valuation_amount`, `wet_quantity`, `dry_equivalent_quantity`, `moisture_reading_id`, `occurred_at`, `source_type`, `source_id`, `correction_of`, `reason`, `posted_by` |
| `cost_layers` | `id`, `company_id`, `store_id`, `material_id`, `lot_id`, `received_at`, `quantity`, `remaining_quantity`, `unit_cost`, `source_movement_id`, `closed_at` |
| `stock_snapshots` | `id`, `company_id`, `plant_id`, `store_id`, `material_id`, `lot_id`, `snapshot_date`, `closing_quantity`, `closing_value`, `valuation_method`, `generated_at` |
| `reorder_policies` | `id`, `company_id`, `plant_id`, `store_id`, `material_id`, `reorder_level`, `safety_stock`, `review_period_days` |
| `inventory_exceptions` | `id`, `company_id`, `movement_id`, `exception_type` (`negative_stock`,`over_issue`,`lot_quality`), `requested_quantity`, `available_quantity`, `actor`, `reason`, `suggested_source_type` (`goods_receipt`,`purchase_order`,`adjustment`,`none`), `suggested_source_id`, `suggestion_note`, `decision` (`approved`,`rejected`), `decided_at` |
| `stock_transfers` | `id`, `company_id`, `plant_id`, `transfer_no`, `from_store_id`, `to_store_id`, `status` (`draft`,`approved`,`in_transit`,`received`,`cancelled`), `approved_by`, `lines` |
| `purchase_suggestions` | `id`, `company_id`, `plant_id`, `material_id`, `suggested_quantity`, `basis` (`reorder`,`shortfall`,`manual`), `status` (`open`,`converted`,`dismissed`), `rule_id` |

Balances are **derived** from `stock_movements` (sum by store/material/lot); `stock_snapshots`
are dated copies for reporting and reconciliation, never the source of truth. **Valuation:**
weighted-average materials keep one moving-average cost per store and material; FIFO materials
consume `cost_layers` oldest first, and a layer is never edited after posting.

## Relationships

`company 1─* materials 1─* material_lots`; `plants 1─* stores 1─* stock_movements`;
`materials 1─* stock_movements`; `materials 1─* cost_layers`; `stock_movements 1─0..1
cost_layers` (a receipt movement opens a layer); `suppliers 1─* material_lots`; `stores 1─* stock_transfers`;
`stock_movements 0..1─1 inventory_exceptions`; `moisture_readings 1─* stock_movements` (linked,
not owned); `stock_movements 0..1─1 stock_movements` (`correction_of`).

## Status lifecycles

- `material_lots`: `pending → released | hold | rejected`; `released → hold` on a quality hold;
  `rejected` terminal. A hold or rejection blocks issue.
- `stock_transfers`: `draft → approved → in_transit → received`, or `cancelled` before `received`.
- `purchase_suggestions`: `open → converted | dismissed`.
- `stock_movements` are **append-only**: posted rows are never edited; a correction is a new
  `reversal` movement that points at `correction_of`.

## Required fields

Movement: store, material, quantity > 0, unit matching the material, occurred_at, source or
reason, actor. Receipt: lot number and unit cost. Issue/consumption: lot when the material is
lot-tracked, and a moisture reading when a wet/dry conversion is claimed. Exception: quantity,
available quantity, actor and a reason of at least the override minimum. Transfer: from/to store
in the same plant and at least one line.

## Permission checks

Read level 1 within plant; post receipt/issue/consumption/return level 3; adjustment, transfer
approval and negative-stock exception level 4; material master, valuation method and reorder
policy level 5. Plant scope is re-checked server-side on every write; UI hiding is not a control.

## Audit events

`inventory.material_created`, `inventory.material_updated`, `inventory.lot_received`,
`inventory.lot_status_changed`, `inventory.movement_posted`, `inventory.movement_reversed`,
`inventory.exception_approved`, `inventory.transfer_approved`, `inventory.transfer_received`,
`inventory.snapshot_generated`, `inventory.valuation_method_set`, `inventory.valuation_assigned`.

## Validation rules

| Rule | Class | Value source |
|---|---|---|
| Quantity > 0, unit matches material, store in plant scope | Mandatory failure | repository convention |
| Valuation method must be selected before the first movement | **Approval required** | per material at creation; no default |
| Bulk material (`is_bulk = true`) not valued at weighted average | Mandatory failure | D1, §34 |
| Valuation method changed after that material's first posted movement | Mandatory failure | D1, §34 |
| Issue from a lot on `rejected` | Mandatory failure | lot quality record |
| Issue from a lot on `hold` | **Engineering hold**, released only by a level-5 quality decision | lot quality record |
| Movement leaving a derived balance at exactly zero | Pass — zero is a valid balance | D2, §34 |
| Movement that would take a derived balance below zero | **Approval required** at level 4 with reason, `inventory_exceptions` row, audit event and a suggested missing document (D2) | this plan, §34 |
| Edit or delete a posted movement | Mandatory failure (correct by reversal) | §8, §34 |
| Duplicate lot number for the same material and supplier | Mandatory failure | repository convention |
| Reorder level breached | Warning | `inventory.reorder_level` — **not specified in the supplied reference** |
| Safety stock breached | Warning | `inventory.safety_stock` — **not specified in the supplied reference** |
| Snapshot disagreeing with derived balance | Warning, reported for reconciliation | §34 |
| Aggregate consumption without a valid moisture reading | **Approval required** | window configurable; **not specified in the supplied reference** |
| Cross-plant transfer | Not in Phase 3 — mandatory failure, deferred to multi-plant (§49) | scope decision |

## Tests that will prove it

1. Receipt then issue yields the derived balance and a dated snapshot that agrees with it.
2. A movement to exactly zero posts; a movement below zero is refused, and the same movement with
   a level-4 exception and reason posts, writes an `inventory_exceptions` row naming a suggested
   missing receipt, and emits an audit event.
3. A lot on `hold` cannot be issued; releasing it allows the issue.
4. Posting before choosing a valuation method is refused as `approval_required`; a bulk material
   refuses FIFO, and a non-bulk spare part values FIFO from its open cost layers oldest first.
5. An edited movement is refused; a reversal movement corrects the balance and preserves history.
6. A transfer moves quantity only after approval and receipt, not at draft.
7. Tenant and plant isolation: another company and another plant see no rows; the restricted role
   reads zero for a foreign id.

---

# M7 — Sales & CRM

## Entities

| Entity | Key fields |
|---|---|
| `leads` | `id`, `company_id`, `plant_id`, `name`, `contact_name`, `phone`, `email`, `source` (`walk_in`,`referral`,`campaign`,`other`), `status` (`new`,`contacted`,`qualified`,`disqualified`,`converted`), `owner_id`, `lost_reason` |
| `opportunities` | `id`, `company_id`, `lead_id`, `customer_id`, `project_id`, `stage` (`qualification`,`proposal`,`negotiation`,`won`,`lost`), `estimated_value`, `expected_close_date`, `status` |
| `opportunity_stage_history` | `id`, `opportunity_id`, `from_stage`, `to_stage`, `actor`, `changed_at`, `reason` |
| `quotations` | `id`, `company_id`, `customer_id`, `project_id`, `quote_no` (unique per company), `status` (`draft`,`submitted`,`approved`,`rejected`,`expired`), `valid_until`, `currency` |
| `quotation_versions` | `id`, `quotation_id`, `version_no`, `status` (`draft`,`submitted`,`approved`,`superseded`), `subtotal`, `discount_total`, `tax_total`, `total`, `price_basis`, `approved_by`, `approved_at`, `document_ref` |
| `quotation_lines` | `id`, `version_id`, `line_no`, `description`, `concrete_grade`, `quantity_m3`, `unit_price`, `discount_pct`, `tax_rate`, `line_total` |
| `price_lists` | `id`, `company_id`, `name`, `currency`, `effective_from`, `effective_to`, `plant_id`, `status` |
| `price_list_items` | `id`, `price_list_id`, `concrete_grade`, `unit_price`, `min_quantity_m3` |
| `contracts` | `id`, `company_id`, `customer_id`, `project_id`, `contract_no`, `quotation_version_id`, `signed_at`, `document_ref`, `status` (`draft`,`signed`,`active`,`expired`,`terminated`) |
| `contract_prices` | `id`, `contract_id`, `concrete_grade`, `unit_price`, `volume_commitment_m3`, `effective_from`, `effective_to` |
| `seasonal_prices` | `id`, `company_id`, `plant_id`, `concrete_grade`, `unit_price`, `season_from`, `season_to`, `status` |
| `volume_commitments` | `id`, `contract_id`, `concrete_grade`, `committed_m3`, `achieved_m3` (derived), `period_from`, `period_to` |
| `discount_approvals` | `id`, `company_id`, `quotation_version_id`, `order_id`, `discount_pct`, `rule_id`, `requested_by`, `approved_by`, `reason`, `decision`, `decided_at` |
| `price_resolutions` | `id`, `company_id`, `customer_id`, `project_id`, `concrete_grade`, `quantity_m3`, `source_type` (`contract`,`volume_commitment`,`seasonal`,`price_list`), `source_id`, `unit_price`, `resolved_at`, `context` |

## Relationships

`leads 1─0..1 opportunities`; `opportunities 1─* stage_history`; `customers 1─* quotations
1─* versions 1─* lines`; `contracts *─1 quotation_versions`; `contracts 1─* contract_prices
1─0..1 volume_commitments`; `price_lists 1─* items`; `quotations/versions 1─* discount_approvals`;
`price_resolutions` references any pricing source by type and id.

## Status lifecycles

- `leads`: `new → contacted → qualified → converted`, or `disqualified` with a reason.
- `opportunities`: stage progression `qualification → proposal → negotiation → won | lost`;
  stages may not move backwards without a level-4 reason.
- `quotations`: `draft → submitted → approved | rejected`, or `expired` by date.
- `quotation_versions`: `draft → submitted → approved → superseded`; an approved version is
  immutable and a revision creates the next version.
- `contracts`: `draft → signed → active → expired | terminated`; `signed` requires an approved
  quotation version and a document reference.

## Required fields

Lead: name and source. Opportunity: stage and estimated value (value may be zero only with a
reason). Quotation: customer, at least one line, valid_until, currency. Quotation line: quantity
> 0, unit price ≥ 0, discount and tax rates explicit. Contract: customer, approved
`quotation_version_id`, signed_at, document_ref. Contract price: grade, unit price, effective
dates. Discount approval: rule, percentage, requester, approver, reason, decision.

## Permission checks

Read level 1; lead/opportunity/quotation draft writes level 3; submit and discount request level
3; quotation approval, contract signature and contract changes level 5; price lists and seasonal
prices level 5. A level-3 user sees only its plant's leads and quotations.

## Audit events

`sales.lead_created`, `sales.lead_converted`, `sales.opportunity_stage_changed`,
`sales.quote_created`, `sales.quote_version_created`, `sales.quote_submitted`,
`sales.quote_approved`, `sales.quote_rejected`, `sales.quote_expired`, `sales.discount_requested`,
`sales.discount_decided`, `sales.contract_signed`, `sales.contract_price_changed`,
`sales.price_resolved`, `sales.price_list_published`.

## Validation rules

| Rule | Class | Value source |
|---|---|---|
| Quantity > 0, price ≥ 0, discount 0–100%, tax ≥ 0 | Mandatory failure | repository convention |
| Edit an approved quotation version | Mandatory failure (create a new version) | §21 |
| Approved quotation silently changing a signed contract | Mandatory failure; contract pins the version (D8) | §21 |
| Discount above the approval threshold | **Approval required** with a five-field approval row | `sales.discount_approval_pct` — **not specified in the supplied reference** |
| Discount above the maximum | Mandatory failure | `sales.discount_max_pct` — **not specified in the supplied reference** |
| Two pricing sources at the same precedence, or no price | **Approval required**, recorded in `price_resolutions` | §21, D7 |
| Quotation past `valid_until` used for a new order | **Approval required** | §21 |
| Negative opportunity value | Warning with reason | §21 |
| Lead converted twice | Mandatory failure | repository convention |

## Tests that will prove it

1. Two quotation versions: the first is `superseded`, its lines unchanged, and history is readable.
2. Editing an approved version is refused; a new version is created instead.
3. Signing a contract stores the approved version id; a later quotation version leaves the
   contract price untouched.
4. A discount above an unconfigured threshold is `approval_required`; an approval row with all
   five fields lets it through.
5. Price precedence resolves contract over seasonal over list; the resolution row names the source.
6. Ambiguous or missing price is `approval_required`, never a zero price.
7. Tenant isolation for leads, quotations and contracts.

---

# M8 — Orders & Distribution

## Entities

| Entity | Key fields |
|---|---|
| `orders` (extend) | `site_id`, `source_quotation_version_id`, `payment_terms`, `credit_check_status`, `hold_reason`, `cancelled_at`, `cancelled_by`, `cancel_reason`; existing grade/quantity/price remain the header summary |
| `order_items` | `id`, `order_id`, `line_no`, `concrete_grade`, `quantity_m3`, `unit_price`, `discount_pct`, `tax_rate`, `pump_charge`, `distance_charge`, `line_total`, `delivered_m3` (derived) |
| `delivery_locations` | `id`, `customer_id`, `project_id`, `name_ar`, `name_en`, `address`, `latitude`, `longitude`, `contact_name`, `contact_phone` |
| `customers` (extend) | `blacklisted_at`, `blacklist_reason`; add `blacklisted` to the existing status check (`active`,`suspended`,`archived`) in a forward-only migration |
| `order_credit_checks` | `id`, `order_id`, `customer_id`, `exposure`, `exposure_breakdown` (jsonb: posted AR, open orders, overdue invoices), `effective_limit`, `outcome` (`pass`,`warn`,`approval_required`,`block`), `rule_id`, `decided_by`, `reason`, `decided_at` |
| `delivery_tickets` | `id`, `company_id`, `plant_id`, `ticket_no` (unique per company), `order_id`, `order_item_id`, `trip_id`, `issued_at`, `quantity_m3`, `status` (`issued`,`accepted`,`rejected`,`returned`,`void`) |
| `delivery_ticket_batches` | `id`, `ticket_id`, `batch_id`, `quantity_m3` |
| `proof_of_delivery` | `id`, `ticket_id`, `received_by_name`, `received_at`, `signature_ref`, `photo_ref`, `accepted_m3`, `returned_m3`, `notes`, `recorded_by` |
| `returned_loads` | `id`, `ticket_id`, `trip_id`, `quantity_m3`, `reason`, `disposition` (`reuse`,`waste`), `recorded_by` |
| `diversions` | `id`, `ticket_id`, `from_location_id`, `to_location_id`, `reason`, `approved_by`, `approved_at` |
| `order_status_history` | `id`, `order_id`, `from_status`, `to_status`, `actor`, `changed_at`, `reason` |

## Relationships

`orders 1─* order_items`; `orders 1─* delivery_tickets`; `delivery_tickets *─1 trips`,
`delivery_tickets 1─* delivery_ticket_batches *─1 batches`; `delivery_tickets 1─0..1
proof_of_delivery`; `delivery_tickets 1─0..1 returned_loads`; `orders 1─* credit_checks`;
`customers 1─* delivery_locations`; `orders *─1 quotation_versions` (price evidence).

## Status lifecycles

Order header extends the B1 chain (D3):

```
draft → confirmed → scheduled → in_production → delivered → invoiced → closed
draft | confirmed | scheduled → cancelled
confirmed | scheduled | in_production → on_hold → (resume to previous state)
```

`delivered` is allowed only when cumulative accepted quantity reaches the ordered quantity, or a
level-5 short-close authorises the difference. Partial delivery is a derived figure, not a state.
Delivery ticket: `issued → accepted | rejected`, `issued|accepted → returned`, and `void` only
before a POD. Returns: posted once, then immutable; a correction is a new ticket.

## Required fields

Order item: grade, quantity > 0, unit price, tax rate. Delivery ticket: order, item, trip,
quantity > 0, issued_at. POD: received-by name, received_at, accepted quantity, signature or
photo reference, recorder. Returned load: quantity, reason, disposition. Diversion: from/to
location, reason, approver. Credit check: exposure with its three-part breakdown (posted AR, open
orders, overdue invoices), effective limit, outcome and rule.

## Permission checks

Read level 1; create/edit draft order and issue ticket level 3; credit approval, cancellation,
diversion and return acceptance level 4; order price override and short-close level 5. Driver/POD
data follows the M5 rule: personal data read level 3+.

## Audit events

`order.item_added`, `order.credit_checked`, `order.credit_warned`, `order.credit_approved`, `order.held`, `order.resumed`,
`order.cancelled`, `delivery.ticket_issued`, `delivery.pod_recorded`, `delivery.ticket_rejected`,
`delivery.load_returned`, `delivery.diversion_approved`, `order.short_closed`.

## Validation rules

| Rule | Class | Value source |
|---|---|---|
| Transition outside the table above | Mandatory failure | §22, D3 |
| Item quantity > 0; ticket quantity ≤ remaining order quantity | Mandatory failure | repository convention |
| Ticket total quantity ≤ sum of linked batch quantities | Mandatory failure | §19 |
| POD accepted + returned ≤ ticket quantity; POD once per ticket | Mandatory failure | §19 |
| Issue a ticket without a trip or an authorised manual dispatch | Mandatory failure | §19 |
| Credit exposure above 100% of the effective limit | **Warning**, recorded on the check | `sales.credit_warn_pct` — 100 at review, configurable |
| Credit exposure above 110% of the effective limit | **Approval required** at level 4, with limit, exposure, breakdown, actor and reason | `sales.credit_approval_pct` — 110 at review, configurable |
| No credit limit configured for the customer | **Approval required** (never an automatic pass) | D4 |
| Customer `suspended`, `blacklisted` or `archived` | Mandatory failure — hard block, no override | D4, §20 |
| Over-delivery beyond the configured tolerance | **Approval required**; unconfigured tolerance never passes | `sales.over_delivery_tolerance_pct` — **not specified in the supplied reference** |
| Cancellation after production started | **Approval required** (level 5) | §22 |
| Returned load without disposition | Mandatory failure | §22 |
| Diversion without approval | Mandatory failure | §22 |

## Tests that will prove it

1. Two delivery tickets accumulate to the ordered quantity; the order becomes `delivered` only
   after the second accepted POD.
2. A ticket above the remaining quantity is refused; a configured tolerance above the order needs
   approval.
3. Exposure at 105% of the limit warns and proceeds; at 115% it is `approval_required` and stores
   the three-part breakdown, limit, actor and reason; a `suspended` or `blacklisted` customer is
   refused outright.
4. POD with accepted + returned > ticket quantity is refused; a valid POD moves the ticket to
   `accepted`.
5. Cancellation after `in_production` is refused at level 4 and allowed at level 5 with a reason.
6. Returns and diversions are recorded, audited and visible on the order.
7. Tenant and plant isolation for orders, tickets and POD.

---

# M9 — Procurement

## Entities

| Entity | Key fields |
|---|---|
| `purchase_requests` | `id`, `company_id`, `plant_id`, `request_no` (unique per company), `requested_by`, `needed_by`, `status` (`draft`,`submitted`,`approved`,`rejected`,`converted`,`cancelled`), `justification` |
| `purchase_request_lines` | `id`, `request_id`, `line_no`, `material_id`, `quantity`, `unit`, `estimated_unit_price`, `line_total` |
| `purchase_request_approvals` | `id`, `request_id`, `role_level`, `actor`, `decision` (`approved`,`rejected`), `reason`, `decided_at` |
| `supplier_quotations` | `id`, `company_id`, `supplier_id`, `rfq_no`, `quotation_no`, `received_at`, `valid_until`, `currency`, `status` (`received`,`selected`,`rejected`,`expired`), `total` |
| `supplier_quotation_lines` | `id`, `quotation_id`, `line_no`, `material_id`, `quantity`, `unit_price`, `lead_time_days`, `line_total` |
| `purchase_orders` (extend) | `purchase_request_id`, `approved_by`, `approved_at`, `approval_rule_id`, `revision_no` |
| `approval_limits` | `id`, `company_id`, `role_level`, `max_amount`, `currency` |
| `price_history` | `id`, `company_id`, `supplier_id`, `material_id`, `unit_price`, `currency`, `effective_from`, `source_type` (`po`,`quotation`,`manual`), `source_id` |

## Relationships

`purchase_requests 1─* lines`; `purchase_requests 1─* approvals`; `purchase_requests 1─0..1
purchase_orders`; `suppliers 1─* supplier_quotations 1─* lines`; `supplier_quotations 1─0..1
purchase_orders`; `suppliers 1─* price_history`; `materials 1─* price_history`;
`purchase_orders 1─* goods_receipts` (existing).

## Status lifecycles

- `purchase_requests`: `draft → submitted → approved | rejected`, `approved → converted`, any
  pre-approved state → `cancelled`.
- `supplier_quotations`: `received → selected | rejected`, or `expired`.
- `purchase_orders` (existing, extended): `draft → approved → partially_received → received →
  closed`, or `cancelled` before receipt. Editing an approved PO requires a new `revision_no`
  and re-approval; the approved revision is immutable.

## Required fields

PR: plant, requester, needed_by, at least one line, justification. PR line: material, quantity >
0, unit. Approval: role level, actor, decision. Supplier quotation: supplier, quotation number,
received_at, valid_until, currency, at least one line. PO approval: approver, timestamp, approval
rule. Price history: supplier, material, price, effective date, source.

## Permission checks

Read level 1; create/submit PR, record supplier quotation level 3; approve PR/PO, select quotation
level 4; approval limits and price history corrections level 5. A PR or PO above the actor's
approval limit is refused with `approval_required`, not silently routed.

## Audit events

`procurement.pr_created`, `procurement.pr_submitted`, `procurement.pr_approved`,
`procurement.pr_rejected`, `procurement.pr_converted`, `procurement.rfq_recorded`,
`procurement.supplier_quote_received`, `procurement.supplier_quote_selected`,
`procurement.po_approved`, `procurement.po_revised`, `procurement.price_history_recorded`,
`procurement.approval_limit_set`.

## Validation rules

| Rule | Class | Value source |
|---|---|---|
| PR/quote line quantity > 0; PO total = sum of lines | Mandatory failure | repository convention |
| PO created from an unapproved PR | Mandatory failure | §35 |
| PO to a suspended or foreign-tenant supplier | Mandatory failure | §35 |
| PO above the actor's approval limit | **Approval required** | `approval_limits.max_amount` — **not specified in the supplied reference** |
| No approval limit configured | **Approval required** (never an automatic pass) | §35 |
| Duplicate supplier quotation number for the same supplier | Mandatory failure | repository convention |
| Selected quotation does not cover all PR lines | **Warning** with recorded reason | §35 |
| Price above the last recorded price beyond tolerance | **Approval required** | `procurement.price_increase_tolerance_pct` — **not specified in the supplied reference** |
| Edit an approved PO revision | Mandatory failure (new revision) | §35 |
| Approval by the requester above threshold without a second approver | **Approval required** | §35 |

## Tests that will prove it

1. PR approval above an actor's limit is `approval_required`; an unconfigured limit also blocks.
2. Converting an unapproved PR to a PO is refused.
3. An approved PO cannot be edited; a revision creates a new number and requires re-approval.
4. Price history is appended from a PO, and a later price above tolerance is `approval_required`.
5. A duplicate supplier quotation number is refused.
6. Tenant isolation for PRs, quotations and price history.

---

# M10 — Supplier Workflows

## Entities

| Entity | Key fields |
|---|---|
| `goods_receipts` (extend) | `store_id`, `quality_status` (`pending`,`released`,`hold`,`rejected`), `lot_created` |
| `goods_receipt_lines` (extend) | `material_id`, `lot_id`, `accepted_quantity`, `rejected_quantity`, `rejection_reason` |
| `supplier_bills` (extend) | `match_status`, `match_rule_id` |
| `three_way_match_results` (extend) | `rule_id`, `tolerance_snapshot` (jsonb), `requires_approval`, `approved_by`, `approved_at` |
| `match_exceptions` | `id`, `company_id`, `match_id`, `exception_type` (`quantity_variance`,`price_variance`,`amount_variance`,`missing_receipt`,`missing_po`,`over_billing`), `delta`, `status` (`open`,`approved`,`rejected`), `actor`, `reason`, `decided_at` |
| `supplier_performance_events` | `id`, `supplier_id`, `purchase_order_id`, `goods_receipt_id`, `promised_date`, `actual_date`, `quality_status`, `recorded_at` |
| `supplier_scorecards` | `id`, `company_id`, `supplier_id`, `period_from`, `period_to`, `on_time_rate`, `quality_reject_rate`, `price_variance_rate`, `score`, `status` (`draft`,`published`), `computed_at` |

## Relationships

`goods_receipts` (existing) now create `material_lots` and `stock_movements` (receipt) in the same
transaction; `goods_receipts 1─* match_exceptions` through the match; `supplier_bills 1─* matches`;
`suppliers 1─* performance_events 1─* scorecards`; `three_way_match_results 1─* exceptions`.

## Status lifecycles

- `goods_receipts`: existing receipt is posted once; quality status `pending → released | hold |
  rejected`. Rejection creates an adjustment movement, never edits the receipt.
- `three_way_match_results`: `matched` (terminal) or `exception → approved | rejected`; an
  approved exception marks the match `matched` only with actor, reason and decision present.
- `supplier_scorecards`: `draft → published`; published cards are immutable.

## Required fields

Receipt posting: PO reference, store, received_on, accepted quantities by line, quality status.
Match: PO, GRN and bill present; tolerance snapshot. Exception: type, delta, actor, reason,
decision. Performance event: supplier, PO, promised date, actual date, quality outcome. Scorecard:
period, all three rates, evidence counts, computation timestamp.

## Permission checks

Read level 1; post receipt, record bill level 3; match approval, exception approval and quality
release level 4; supplier master, tolerance configuration and scorecard publication level 5.
Purchasing staff cannot approve their own match above the configured limit.

## Audit events

`supplier.receipt_posted`, `supplier.lot_created`, `supplier.quality_decided`,
`supplier.bill_recorded`, `supplier.match_completed`, `supplier.match_exception_opened`,
`supplier.match_exception_decided`, `supplier.scorecard_published`,
`supplier.performance_recorded`.

## Validation rules

| Rule | Class | Value source |
|---|---|---|
| Match without PO, GRN, or bill | Mandatory failure — never “matched” without evidence | §35 |
| Quantity/price/amount variance inside tolerance | Pass | `procurement.match_qty_tolerance_pct`, `procurement.match_price_tolerance_pct` — **not specified in the supplied reference** |
| Variance beyond tolerance | **Approval required**, exception row + audit | §35, D6 |
| Unconfigured tolerance | **Approval required** (never matched) | §35 |
| Over-receipt or over-billing | **Approval required** | §35 |
| Bill without a PO | **Approval required** with reason | §35 |
| Duplicate bill number for the same supplier | Mandatory failure | repository convention |
| Quality hold on a received lot | **Engineering hold** until a level-5 release | lot quality record |
| Approving a match without all evidence | Mandatory failure | §35 |
| Scorecard published with missing periods | **Warning**, `not_available` shown instead of zero | §35 |

## Tests that will prove it

1. A match with a missing GRN is refused; adding the receipt allows matching.
2. A variance inside a configured tolerance matches; outside it is `approval_required`.
3. An unconfigured tolerance leaves the match `approval_required`, never matched.
4. An approved exception writes actor, reason, decision and marks the match matched; a rejected
   exception leaves it unmatched.
5. Posting a receipt creates a lot and a stock movement in the same transaction; a quality hold
   blocks issue until released.
6. A duplicate supplier bill is refused.
7. Scorecards compute from receipts/bills and show `not_available` when the period has no
   evidence.
8. Tenant isolation for receipts, matches and scorecards.

---

# Cross-cutting requirements for M6–M10

- **Schema:** new migrations from `0017` onward, forward-only, additive, with `company_id`,
  `plant_id` where relevant, `deleted_at` soft delete, UTC timestamps, RLS `tenant_isolation` and
  a restrictive plant policy on every plant-scoped table, and unique indexes for duplicate rules.
- **Rules:** every numeric rule is a `rule_definitions` row seeded **with no value and no source
  note**, classified per §25, evaluated only through `src/core/rules.ts`. No module hard-codes a
  tolerance, default or auto-pass.
- **Validation placement:** pure rules in `src/core/*`, enforced again in the repository and in
  SQL where a client could bypass them.
- **Read models:** extend `server/db/datasetRepo.ts`; new KPIs report `not_implemented` rather
  than zero until the tables exist.
- **Excel:** add templates and worksheet mappings for materials, stock movements, PRs, POs,
  delivery tickets and supplier scorecards; bump the template schema version; document in
  `IMPORT_EXPORT_MAP.md`. No workbook formula is copied into the app.
- **Permissions:** every endpoint declares a minimum level and re-checks plant scope server-side;
  UI hiding is not a control.
- **Audit:** each write emits exactly one event with actor, company, plant, record id and
  before/after where applicable; append-only.
- **Honesty gate:** incomplete screens and APIs answer `not_implemented`, never demo numbers.

# Tests required before any Phase 3 module is reported done

Per module: migration on a fresh database; RLS isolation (two companies, two plants); every
lifecycle transition legal and illegal; every rule class with one positive and one negative case;
audit rows present; permission denial per role level; one end-to-end read proving dashboard and
reports pick up the new rows; and a regression run of the full suite (currently 324 pass / 0 fail /
0 skip) with no new skips.

# What approval of this document means

Approval means approving entity shape, relationships, lifecycles, permissions, audit contract,
rule classes, the classified decisions D1–D10 and the test list. Classification stands as FIXED by
the spec for D3, D7, D8 and D10, and OPEN for D1, D2, D4, D5, D6 and D9; D3, D5, D6, D7, D8 and
D9 were approved as stated, and D1, D2 and D4 carry the revised recommendations above. It does
**not** approve any other numeric value: apart from the two review-approved credit percentages
(`sales.credit_warn_pct` = 100, `sales.credit_approval_pct` = 110), every limit, tolerance,
threshold and rate remains “not specified in the supplied reference” until the ECP 203-2007 Code
file or an approved project specification is supplied. Until then those rules stay configurable,
with no default and no automatic pass.
