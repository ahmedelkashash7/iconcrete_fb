# Phase 2 plan — M2 Mix Design, M3 Batching, M4 Quality/Lab, M5 Fleet & Dispatch

**Status: PLAN FOR APPROVAL. Nothing in this document is implemented, migrated or tested.**
No table, endpoint, screen or test from this plan exists in the repository at this tip.

## Reference position (read this first)

The controlling reference named for this plan is **ECP 203-2007**. **The Code file was not
supplied with this task**: it is not in the repository, not attached to the conversation, and
no text of it is available to search. Therefore:

- **No clause number appears in this plan.** None is invented.
- **No numeric limit, tolerance, acceptance threshold, sampling rate, curing condition or
  test age is attributed to ECP.** Every such value below is marked
  **“not specified in the supplied reference”**.
- Values that do already exist in this repository are cited to the repository, not to ECP, and
  are labelled as demo assumptions (`docs/ASSUMPTIONS.md` A1–A4).
- Where a decision needs a code value, the plan defers it: the rule is built as
  **configurable**, defaults stay empty, and the module must refuse to auto-pass until an
  authorised person enters the value with its source.

Consequence: this plan can be approved as **structure, lifecycles, permissions, audit events,
rule classes and test list**. It cannot be approved as **compliance with ECP 203-2007**, and
this document does not claim that.

## Rule classification used throughout

The approved classification in `docs/GOLDEN_MASTER_SPEC.md` (batching validation section) is
authoritative and is used verbatim:

| Class | Meaning in this plan |
|---|---|
| **Warning** | recorded, shown, does not block; requires a reason to dismiss |
| **Mandatory validation failure** | blocks the transaction; no override path exists |
| **Approval required** | blocked until a named role approves; approval is audited |
| **Engineering hold** | blocked, and only a level-5 engineer can release; release is audited |
| **Authorized override** | allowed past a Warning/Approval with actor, reason, time, rule id and decision recorded |

Never silently correct a batch or a mix design: the system proposes, a human authorises.

---

## M2 — Mix Design

### Entities

| Entity | Key fields (proposed) | Notes |
|---|---|---|
| `mix_designs` | `id`, `company_id`, `code`, `name_ar`, `name_en`, `strength_class`, `exposure_class`, `slump_class`, `status`, `current_version`, `created_by`, `approved_by`, `approved_at` | identity of the mix, not its recipe |
| `mix_design_versions` | `id`, `mix_design_id`, `version`, `status`, `effective_from`, `superseded_at`, `approved_by`, `approval_reason` | recipe is immutable once approved |
| `mix_components` | `id`, `version_id`, `material_id`, `role` (`cement`/`scm`/`fine_aggregate`/`coarse_aggregate`/`water`/`admixture`), `quantity_per_m3`, `unit`, `moisture_basis` (`dry`/`wet`, explicit) | quantities per 1 m³ |
| `mix_design_targets` | `version_id`, `target_strength`, `max_wc_ratio`, `min_cement_content`, `target_density`, `source_note` | each value carries its own source |

Relationships: `company 1─* mix_designs 1─* versions 1─* components`; `versions *─1 materials`;
`mix_designs` referenced by `batches` and `orders` (M3/M5 read only the **approved** version).

### Status lifecycle

`mix_design_versions`: `draft → submitted → approved → superseded` and `draft|submitted → withdrawn`.
`mix_designs.status` mirrors the current version (`draft`/`active`/`superseded`/`withdrawn`).

Transitions: `submit` (level 4), `approve`/`reject` (level 5), `supersede` (level 5, requires a
reason), `withdraw` (level 4 while not approved). An approved version can never be edited; a
change creates a new version. Batches already produced keep their version reference.

### Required fields

`code` (unique per company), `name_ar`, `name_en`, `strength_class`, at least one cementitious
component, at least one aggregate, water, `quantity_per_m3 > 0` for every component, explicit
moisture basis on every aggregate, `source_note` on every target value. Approval additionally
requires `approved_by` and a version note.

### Permission checks

Read: level 1 (own plant scope). Create/edit draft: level 4. Approve/supersede: level 5.
Every query constrained by `company_id` + plant scope through RLS; approval is also rejected if
the user's plant scope does not include the mix's plant.

### Audit events

`mix.created`, `mix.version_created`, `mix.submitted`, `mix.approved`, `mix.rejected`,
`mix.superseded`, `mix.withdrawn`, `mix.target_changed`, `mix.override` (actor, reason, rule id).

### Validation rules and classification

| Rule | Class | Source of the value |
|---|---|---|
| Every component quantity > 0 and unit known | Mandatory validation failure | repository convention |
| Sum of component volumes must yield 1.000 m³ within the plant tolerance | **Warning** until a reference value exists; existing demo tolerance 0.98–1.02 (`docs/ASSUMPTIONS.md` A1) | demo assumption, not ECP |
| Water/cementitious ratio must not exceed the exposure-class limit | **Approval required**; limit per exposure class is **not specified in the supplied reference** | configurable per project, empty by default |
| Minimum cementitious content per exposure class | **Approval required**; value **not specified in the supplied reference** | configurable |
| Editing an approved version | **Mandatory validation failure** (must version instead) | spec §24 |
| Duplicate `code` in the same company | Mandatory validation failure | repository convention |
| Strength class not in the approved list | Mandatory validation failure | list supplied by the project, empty by default |
| Target strength without `source_note` | Approval required | this plan |

### Tests that will prove it

1. Approve a version, attempt an update, expect a rejection and an unchanged row.
2. Create version 2 while version 1 is referenced by a batch: batch still resolves version 1.
3. Yield outside the configured band returns a Warning result, not a hard failure, and the
   dismissal requires a reason recorded in `audit_log`.
4. A level-4 user cannot approve (403) and the attempt is audited.
5. RLS: company B cannot read company A's mix by id; plant scope hides a mix of another plant.
6. Missing `source_note` on a W/C limit is refused at the API, not defaulted.

---

## M3 — Batching (production)

### Entities

| Entity | Key fields |
|---|---|
| `batches` | `id`, `company_id`, `plant_id`, `batch_no` (unique per plant per day), `order_id`, `mix_version_id`, `status`, `planned_volume_m3`, `actual_volume_m3`, `produced_at`, `operator_id`, `approved_by`, `hold_reason` |
| `batch_components` | `batch_id`, `material_id`, `target_qty`, `actual_qty`, `unit`, `tolerance_pct`, `deviation_class` |
| `moisture_readings` | `id`, `plant_id`, `material_id`, `sample_at`, `moisture_pct`, `basis` (`dry`/`wet`), `absorption_pct`, `valid_until`, `entered_by` |
| `production_queue` | `id`, `plant_id`, `order_id`, `mix_version_id`, `sequence`, `requested_at`, `state` |
| `batch_overrides` | `batch_id`, `rule_id`, `class`, `actor_id`, `reason`, `decided_at` |

Relationships: `orders 1─* batches *─1 mix_design_versions`; `moisture_readings *─1 materials`;
`batch_overrides` is append-only and referenced by the batch's audit trail.

### Status lifecycle

`batches`: `planned → in_progress → completed` and `planned|in_progress → held → in_progress`,
plus `planned|in_progress|held → cancelled`. `completed` is terminal; corrections are a new
adjustment record, never an edit. `production_queue.state`: `queued → active → done` / `cancelled`.

### Required fields

`batch_no`, `plant_id`, `order_id`, `mix_version_id` (must be an **approved** version),
`planned_volume_m3 > 0`, operator, machine/plant line, and for every component a target and an
actual quantity. Completion additionally requires actual volume and a moisture reading whose
`valid_until` covers `produced_at` for every moisture-sensitive aggregate.

### Permission checks

Read: level 1 within plant. Create/start/complete: level 3 (operator/batcher) within plant.
Hold/release: level 4; engineering hold release: level 5. Overrides: level 4 with the class
constraints in the rule table. Every write re-checks plant scope server-side.

### Audit events

`batch.planned`, `batch.started`, `batch.completed`, `batch.held`, `batch.released`,
`batch.cancelled`, `batch.override`, `batch.moisture_recorded`, `batch.moisture_expired`.

### Validation rules and classification

| Rule | Class | Value source |
|---|---|---|
| Planned volume > 0, actual volume > 0 | Mandatory validation failure | repository convention |
| Mix version approved and effective at `produced_at` | Mandatory validation failure | spec §24 |
| Duplicate `batch_no` per plant/day | Mandatory validation failure | repository convention |
| Component quantity > 0 and unit matches the material | Mandatory validation failure | repository convention |
| Moisture reading older than its validity window | **Mandatory validation failure**; the window itself is **not specified in the supplied reference** (the repository's 2-hour demo value is an assumption) | configurable |
| Actual vs target cement/water deviation | **Approval required** with plant-configured band; band **not specified in the supplied reference** | configurable |
| Actual vs target aggregate deviation | **Warning** with plant-configured band | configurable |
| Yield outside plant tolerance | **Warning** (`docs/ASSUMPTIONS.md` A1 is a demo value) | configurable |
| Plant capacity exceeded | **Approval required**; capacity per plant is configuration, not a code value | config |
| Calibration expired on the batching scale | **Engineering hold** | calibration records (M4) |
| Concrete age/drum-time limit | **Warning** until a project value is supplied; A4's 90/110/120 min is a demo assumption | configurable |

### Tests that will prove it

1. Complete a batch with an unapproved mix version → Mandatory failure, batch stays `in_progress`.
2. Complete with an expired moisture reading → Mandatory failure; refresh reading → success.
3. Deviation inside the Approval band → Warning path; outside → Approval required; level-3
   user cannot override, level-4 can, and the override row and audit event exist with reason.
4. `batch.completed` rows cannot be updated (`update` affects 0 rows / trigger raises).
5. Duplicate `batch_no` for the same plant and day is rejected by a unique index.
6. Concurrent completion of the same batch produces one winner and one lifecycle error.
7. RLS: a batcher scoped to plant 1 cannot read or write plant 2 batches.

---

## M4 — Quality and Laboratory

### Entities

| Entity | Key fields |
|---|---|
| `lab_equipment` | `id`, `company_id`, `plant_id`, `name`, `serial`, `status`, `calibration_interval_days` |
| `equipment_calibrations` | `equipment_id`, `calibrated_at`, `valid_until`, `certificate_doc_id`, `performed_by`, `result` |
| `trial_batches` | `id`, `mix_version_id`, `plant_id`, `produced_at`, `purpose`, `status`, `approved_by` |
| `quality_tests` | `id`, `company_id`, `plant_id`, `batch_id`, `test_type` (`slump`/`cube_strength`/`temperature`/…), `sampled_at`, `tested_at`, `age_days`, `result_value`, `unit`, `spec_min`, `spec_max`, `status`, `entered_by`, `verified_by` |
| `specimens` | `test_id`, `specimen_no`, `cast_at`, `curing_method`, `tested_at`, `result_value` |
| `ncr` | `id`, `test_id`, `severity`, `description`, `status`, `opened_by`, `closed_by` |
| `capa` | `id`, `ncr_id`, `action`, `owner_id`, `due_date`, `status`, `effectiveness_check` |
| `certificates` | `id`, `test_id`, `issued_at`, `signature_ref`, `qr_ref`, `status` |
| `itp_schedules` | `id`, `project_id`, `activity`, `hold_point`, `required_test`, `status` |

Relationships: `batches 1─* quality_tests`; `quality_tests 1─* specimens`; `quality_tests 1─0..1
ncr 1─* capa`; `lab_equipment 1─* calibrations`; `quality_tests 1─0..1 certificates`.

### Status lifecycle

`quality_tests`: `sampled → testing → passed | failed | inconclusive`; a `failed` test opens an
`ncr` in `open`; `ncr`: `open → investigation → capa_open → verification → closed` (or `void`
with a reason). `certificates`: `draft → issued → revoked`. `equipment`: `active → out_of_service
→ retired`; a calibration that lapses moves its equipment to `out_of_service` automatically and
raises an Engineering hold on acceptance decisions that depend on it.

### Required fields

Sample id, batch reference, plant, test type, sampling time, test age in days, result value with
unit, spec min/max **with their source**, technician, verifying engineer. Failed results
additionally require an `ncr` with severity and description. Certificates require an issued
test, a signature reference and a QR reference placeholder.

### Permission checks

Read: level 1 within plant. Enter results: level 3 within plant. Verify/approve results and
close NCR: level 4. Release an Engineering hold, revoke a certificate, approve a CAPA
effectiveness check: level 5. Certificates are read-only once issued; a re-issue is a new row.

### Audit events

`test.sampled`, `test.result_entered`, `test.verified`, `test.failed`, `ncr.opened`,
`ncr.closed`, `capa.created`, `capa.verified`, `certificate.issued`, `certificate.revoked`,
`equipment.calibration_recorded`, `equipment.calibration_expired`, `lab.hold_released`.

### Validation rules and classification

| Rule | Class | Value source |
|---|---|---|
| Result value present, positive, unit matches test type | Mandatory validation failure | repository convention |
| Test age recorded and specimens cast before testing | Mandatory validation failure | repository convention |
| Required test ages (the 7/28/56-day set) | **“not specified in the supplied reference”** — the set is configurable per project; the repository's 7/28/56 is a demo assumption | configurable |
| Acceptance limits (`spec_min`/`spec_max`) | **Approval required** when absent; values **not specified in the supplied reference** | project specification, entered with source |
| Test performed on equipment with lapsed calibration | **Engineering hold** | calibration record |
| Result below the acceptance limit | Mandatory validation failure + automatic `ncr` | repository convention |
| NCR closed without a CAPA effectiveness check | Approval required | this plan |
| Certificate issued for an unverified or failed test | Mandatory validation failure | repository convention |
| Test entered against a batch from another plant | Mandatory validation failure (scope) | RLS + server check |

### Tests that will prove it

1. A test cannot be verified while its equipment calibration is lapsed (Engineering hold), and
   after recalibration verification succeeds.
2. A failed result creates exactly one NCR, twice-submitted verification does not create two.
3. Certificate issuance is refused for a `failed` or unverified test.
4. NCR cannot close while a CAPA is open; closing writes the audit event and a `closed_by`.
5. Acceptance limits cannot be omitted: the API refuses to auto-pass and returns the missing
   source field.
6. RLS: plant-1 technician cannot enter a result for a plant-2 batch.
7. Specimen count per test matches the configured requirement; a mismatch is a Warning with a
   recorded reason.

---

## M5 — Fleet and Dispatch

### Entities

| Entity | Key fields |
|---|---|
| `trucks` | `id`, `company_id`, `plant_id`, `plate_no`, `capacity_m3`, `mixer_type`, `status`, `odometer_km`, `ownership` |
| `drivers` | `id`, `company_id`, `name_ar`, `name_en`, `licence_no`, `licence_class`, `licence_expiry`, `status` |
| `dispatch_assignments` | `id`, `company_id`, `plant_id`, `order_id`, `truck_id`, `driver_id`, `sequence`, `status`, `assigned_at`, `assigned_by` |
| `trips` | `id`, `assignment_id`, `batch_id`, `depart_at`, `arrive_site_at`, `return_at`, `loaded_m3`, `delivered_m3`, `site_wait_minutes`, `status` |
| `truck_maintenance` | `id`, `truck_id`, `opened_at`, `closed_at`, `type`, `status`, `cost` |
| `gps_positions` | `truck_id`, `recorded_at`, `lat`, `lng`, `source` (`mock` in Phase 2) |

Relationships: `orders 1─* dispatch_assignments *─1 trucks *─1 drivers`; `assignments 1─* trips
*─1 batches`; `trucks 1─* truck_maintenance`.

### Status lifecycle

`trucks`: `available → assigned → loading → en_route → at_site → returning → available`;
`available|assigned → maintenance → available`; `retired` terminal.
`dispatch_assignments`: `proposed → confirmed → dispatched → delivered → closed`, or `cancelled`.
`trips`: `planned → departed → arrived → returned`, or `aborted` with a reason.
Illegal transitions are rejected; a truck cannot be `available` while it has an open trip.

### Required fields

Truck: plate, capacity, plant, status. Driver: name, licence number/class/expiry. Assignment:
order, truck, driver, sequence, dispatch time. Trip: batch reference, loaded volume, departure
time; delivery additionally requires arrived time and delivered volume. Any volume difference
requires a reason.

### Permission checks

Read: level 1 within plant. Create/confirm assignment and update trip: level 3 within plant.
Cancel a dispatch, open maintenance: level 4. Retire a truck, release an Engineering hold:
level 5. Driver licence data is readable at level 3+ only (personal data), and export is level 4+.

### Audit events

`dispatch.proposed`, `dispatch.confirmed`, `dispatch.cancelled`, `trip.departed`, `trip.arrived`,
`trip.returned`, `trip.aborted`, `truck.status_changed`, `truck.maintenance_opened`,
`truck.maintenance_closed`, `driver.licence_updated`, `fleet.override`.

### Validation rules and classification

| Rule | Class | Value source |
|---|---|---|
| Truck capacity ≥ assigned load | **Mandatory validation failure** | repository convention |
| One open trip per truck; one active assignment per order position | Mandatory validation failure (unique partial index) | repository convention |
| Driver licence present and not expired at dispatch time | **Mandatory validation failure**; grace period, if any, is **not specified in the supplied reference** | configurable |
| Truck in `maintenance`/`retired` cannot be dispatched | Mandatory validation failure | repository convention |
| Delivered volume differs from loaded volume beyond the plant band | **Approval required** | configurable band |
| Drum/age limit since batch time exceeded | **Warning** (A4 demo values, unverified) | configurable |
| Site waiting time beyond the plant threshold | **Warning** | configurable |
| Cross-plant assignment | Mandatory validation failure | RLS + server check |
| Manual GPS correction | Authorized override with actor, reason, time | this plan |

### Tests that will prove it

1. Dispatching a truck in `maintenance` fails and leaves the assignment `proposed`.
2. A second open trip on the same truck is rejected by the unique index.
3. Expired driver licence blocks dispatch; renewing it allows dispatch, with the licence change
   audited.
4. Load above capacity fails; load within capacity but above the plant's soft limit warns.
5. Delivered-vs-loaded difference inside the band warns, outside requires level-4 approval and
   records the override.
6. Cancelling a dispatch releases the truck back to `available` in the same transaction.
7. RLS: a plant-1 dispatcher cannot see or assign a plant-2 truck.

---

## Cross-cutting requirements for all four modules

- **Schema:** new migrations only (`0012+`), forward-only, additive, with `company_id`,
  `plant_id` where relevant, `deleted_at` soft delete, UTC timestamps, RLS enabled with
  `tenant_isolation` and a restrictive plant policy, and unique indexes for the duplicate rules.
- **Validation placement:** rules live in `src/core/*` (pure, unit-testable) and are enforced
  again in SQL where a client could bypass them.
- **Read models:** each module extends `server/db/datasetRepo.ts` so Dashboard and Reports keep
  reading tenant tables; new KPI states must report `not_implemented` rather than zero until the
  tables exist.
- **Excel:** each module adds a template, bumps the template schema version, and documents the
  mapping in `docs/IMPORT_EXPORT_MAP.md`.
- **Permissions:** every endpoint declares a minimum role level and checks plant scope
  server-side; UI hiding is not a control.
- **Audit:** the event names above are the contract; each write emits exactly one event with
  actor, company, plant, record id, before/after diff where applicable.
- **Honesty gate:** while a module is incomplete, its screens and API answer
  `not_implemented`, never zeros or demo values.

## Tests required before any module is reported as done

Per module: migration applied on a fresh database, RLS isolation (two companies, two plants),
every lifecycle transition (legal and illegal), every rule class with one positive and one
negative case, audit rows present and append-only, permission denial per role level, and one
end-to-end read proving Dashboard/Reports pick up the new rows.

## What approval of this document means

Approving means approving the **structure, lifecycles, permissions, audit contract, rule
classes and test list**. It does **not** mean the numeric acceptance values are approved: those
remain “not specified in the supplied reference” until the ECP 203-2007 Code file (or the
project specification) is supplied, and until then the corresponding rules stay configurable
with no default and no automatic pass.
