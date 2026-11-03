/** M3 batching repository. */

import {
  BATCH_RULE_CODES,
  canTransition,
  checkAggregateDeviation,
  checkBatchNoUnique,
  checkCementWaterDeviation,
  checkMixVersionApproved,
  checkMoistureReadingValid,
  checkPlannedVolumePositive,
  checkScaleCalibrationCurrent,
  checkYieldOutsideBand,
  deviationPercent,
  roleDeviationPercent,
  type BatchCatalogueKey,
  type BatchCheck,
  type BatchStatus,
} from '../../src/core/batching';
import {
  MIN_OVERRIDE_REASON,
  type RuleClassification,
  type RuleDefinition,
} from '../../src/core/rules';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

export type BatchRow = {
  id: string;
  plant_id: string;
  plant_name_ar: string;
  plant_name_en: string;
  batch_no: string;
  order_id: string | null;
  mix_version_id: string;
  mix_version_no: number;
  mix_strength_class: string;
  mix_status: BatchStatus;
  planned_volume: number;
  actual_volume: number | null;
  status: BatchStatus;
  operator_id: string | null;
  hold_reason: string | null;
  produced_at: string | null;
  completed_at: string | null;
  created_at: string;
  adjustments: number;
};

export type BatchComponentRow = {
  id: string;
  material_id: string;
  role: string;
  target_weight: number | null;
  actual_weight: number | null;
  unit: string;
  tolerance_pct: number | null;
  deviation_class: string | null;
};

export type MoistureReadingRow = {
  id: string;
  material_id: string;
  basis: 'dry' | 'wet';
  moisture_pct: number | null;
  absorption_pct: number | null;
  sample_at: string;
  valid_until: string | null;
  entered_by: string | null;
};

export type BatchOverrideRow = {
  id: string;
  rule_code: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  reason: string;
  decision: 'approved' | 'rejected';
  decided_at: string;
};

export interface BatchDetail extends BatchRow {
  components: BatchComponentRow[];
  moisture: MoistureReadingRow[];
  overrides: BatchOverrideRow[];
  checks: BatchCheck[];
}

export interface BatchCreatePayload {
  plantId: string;
  batchNo: string;
  orderId: string | null;
  mixVersionId: string;
  plannedVolume: number;
  operatorId: string | null;
}

export interface BatchStartPayload {
  operatorId?: string | null;
}

export interface BatchCompletePayload {
  actualVolume: number;
  operatorId?: string | null;
  /** When the scale used for this batch was last calibrated. Absent = no calibration record. */
  scaleCalibratedAt?: string | null;
  components: {
    materialId: string;
    targetWeight: number | null;
    actualWeight: number | null;
    unit: string;
    tolerancePct: number | null;
  }[];
}

export interface MoisturePayload {
  materialId: string;
  basis: 'dry' | 'wet';
  moisturePct: number | null;
  absorptionPct: number | null;
  validUntil: string | null;
}

export interface OverridePayload {
  ruleId: string;
  ruleCode: string;
  entityType: string;
  entityId: string;
  reason: string;
  decision: 'approved' | 'rejected';
}

type Row = Record<string, unknown>;

const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);
const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

const newId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

export class BatchingService {
  constructor(private readonly db: Db) {}

  private toBatch = (row: Row): BatchRow => ({
    id: str(row.id),
    plant_id: str(row.plant_id),
    plant_name_ar: str(row.plant_name_ar),
    plant_name_en: str(row.plant_name_en),
    batch_no: str(row.batch_no),
    order_id: row.order_id === null || row.order_id === undefined ? null : str(row.order_id),
    mix_version_id: str(row.mix_version_id),
    mix_version_no: num(row.mix_version_no),
    mix_strength_class: str(row.mix_strength_class),
    mix_status: (str(row.mix_status) as BatchStatus) ?? 'draft',
    planned_volume: num(row.planned_volume),
    actual_volume: row.actual_volume === null || row.actual_volume === undefined ? null : num(row.actual_volume),
    status: str(row.status) as BatchStatus,
    operator_id: row.operator_id === null || row.operator_id === undefined ? null : str(row.operator_id),
    hold_reason: row.hold_reason === null || row.hold_reason === undefined ? null : str(row.hold_reason),
    produced_at: row.produced_at === null || row.produced_at === undefined ? null : str(row.produced_at),
    completed_at: row.completed_at === null || row.completed_at === undefined ? null : str(row.completed_at),
    created_at: str(row.created_at),
    adjustments: num(row.adjustments),
  });

  list = async (
    context: B1Context,
    filters: { plantId?: string; status?: string } = {},
  ): Promise<BatchRow[]> => {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select b.id, b.plant_id, coalesce(p.name_ar, '') as plant_name_ar,
                coalesce(p.name_en, '') as plant_name_en,
                b.batch_no, b.order_id, b.mix_version_id,
                mv.version_no as mix_version_no, mv.strength_class as mix_strength_class,
                mv.status as mix_status,
                b.planned_volume, b.actual_volume, b.status,
                b.operator_id, b.hold_reason, b.produced_at, b.completed_at,
                b.created_at,
                (select count(*) from batch_components c
                   where c.company_id = b.company_id and c.batch_id = b.id) as adjustments
         from batches b
         left join plants p on p.id = b.plant_id
         left join mix_design_versions mv on mv.id = b.mix_version_id
        where b.company_id = $1
          and ($2::text = '' or b.plant_id = $2)
          and ($3::text = '' or b.status = $3)
        order by b.created_at desc, b.batch_no`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? ''],
      );
      return rows.map(this.toBatch);
    });
  };

  /** Plants the caller may read, for the dispatch filters and the planning form. */
  plants = async (
    context: B1Context,
  ): Promise<{ id: string; name_ar: string; name_en: string }[]> =>
    this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, coalesce(name_ar, '') as name_ar, coalesce(name_en, '') as name_en
           from plants
          where company_id = $1 and deleted_at is null
          order by id`,
        [context.tenant.companyId],
      );
      return rows.map((row) => ({ id: str(row.id), name_ar: str(row.name_ar), name_en: str(row.name_en) }));
    });

  /** Approved, effective mix versions a batch may be planned against. */
  approvedVersions = async (
    context: B1Context,
  ): Promise<
    {
      id: string;
      mix_code: string;
      mix_name_ar: string;
      mix_name_en: string;
      version_no: number;
      strength_class: string;
    }[]
  > =>
    this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select mv.id, md.code as mix_code, coalesce(md.name_ar, '') as mix_name_ar,
                coalesce(md.name_en, '') as mix_name_en, mv.version_no, mv.strength_class
           from mix_design_versions mv
           join mix_designs md on md.id = mv.mix_id
          where mv.company_id = $1 and mv.status = 'approved'
          order by md.code, mv.version_no desc`,
        [context.tenant.companyId],
      );
      return rows.map((row) => ({
        id: str(row.id),
        mix_code: str(row.mix_code),
        mix_name_ar: str(row.mix_name_ar),
        mix_name_en: str(row.mix_name_en),
        version_no: num(row.version_no),
        strength_class: str(row.strength_class),
      }));
    });

  get = async (context: B1Context, id: string): Promise<BatchDetail> =>
    this.db.withTenant(context.tenant, (tx) => this.readDetail(tx, context, id));

  /**
   * Reads one batch on the caller's transaction. A write uses this so it returns the record
   * it just changed; opening a second transaction would not see the uncommitted row.
   */
  private readDetail = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<BatchDetail> => {
    {
      const rows = await tx.unsafe<Row>(
        `select b.id, b.plant_id, coalesce(p.name_ar, '') as plant_name_ar,
                coalesce(p.name_en, '') as plant_name_en,
                b.batch_no, b.order_id, b.mix_version_id,
                mv.version_no as mix_version_no, mv.strength_class as mix_strength_class,
                mv.status as mix_status, b.planned_volume, b.actual_volume, b.status,
                b.operator_id, b.hold_reason, b.produced_at, b.completed_at,
                b.created_at,
                (select count(*) from batch_components c
                   where c.company_id = b.company_id and c.batch_id = b.id) as adjustments
         from batches b
         left join plants p on p.id = b.plant_id
         left join mix_design_versions mv on mv.id = b.mix_version_id
        where b.company_id = $1 and b.id = $2`,
        [context.tenant.companyId, id],
      );
      const row = rows[0];
      if (!row) throw new M1Error('batch_not_found', 404, `batch ${id} does not exist for this company`);
      const batch = this.toBatch(row) as BatchDetail;

      const components = await tx.unsafe<Row>(
        `select id, material_id, '' as role, target_weight::text as target_weight,
                actual_weight::text as actual_weight, unit, tolerance_pct::text as tolerance_pct,
                deviation_class
           from batch_components
          where company_id = $1 and batch_id = $2
          order by id`,
        [context.tenant.companyId, id],
      );
      batch.components = components.map((r) => ({
        id: str(r.id),
        material_id: str(r.material_id),
        role: str(r.role),
        target_weight: r.target_weight === null || r.target_weight === undefined ? null : num(r.target_weight),
        actual_weight: r.actual_weight === null || r.actual_weight === undefined ? null : num(r.actual_weight),
        unit: str(r.unit),
        tolerance_pct: r.tolerance_pct === null || r.tolerance_pct === undefined ? null : num(r.tolerance_pct),
        deviation_class: r.deviation_class === null || r.deviation_class === undefined ? null : str(r.deviation_class),
      }));

      const moisture = await tx.unsafe<Row>(
        `select id, material_id, basis, moisture_pct::text as moisture_pct,
                absorption_pct::text as absorption_pct, sample_at,
                valid_until, entered_by
           from moisture_readings
          where company_id = $1 and plant_id = $2
          order by sample_at desc, id`,
        [context.tenant.companyId, batch.plant_id],
      );
      batch.moisture = moisture.map((r) => ({
        id: str(r.id),
        material_id: str(r.material_id),
        basis: str(r.basis) as 'dry' | 'wet',
        moisture_pct: r.moisture_pct === null || r.moisture_pct === undefined ? null : num(r.moisture_pct),
        absorption_pct: r.absorption_pct === null || r.absorption_pct === undefined ? null : num(r.absorption_pct),
        sample_at: str(r.sample_at),
        valid_until: r.valid_until === null || r.valid_until === undefined ? null : str(r.valid_until),
        entered_by: r.entered_by === null || r.entered_by === undefined ? null : str(r.entered_by),
      }));

      const overrides = await tx.unsafe<Row>(
        `select id::text as id, rule_code, entity_type, entity_id, actor, reason, decision,
                decided_at
           from batch_overrides
          where company_id = $1 and batch_id = $2
          order by decided_at desc`,
        [context.tenant.companyId, id],
      );
      batch.overrides = overrides.map((r) => ({
        id: str(r.id),
        rule_code: str(r.rule_code),
        entity_type: str(r.entity_type),
        entity_id: str(r.entity_id),
        actor: str(r.actor),
        reason: str(r.reason),
        decision: str(r.decision) as 'approved' | 'rejected',
        decided_at: str(r.decided_at),
      }));

      const rules = await loadBatchRules(tx, context.tenant.companyId);
      batch.checks = checksForBatch(rules, batch, batch.components);

      return batch;
    }
  };

  /** Level 3: create a planned batch against an approved, effective mix version. */
  create = async (context: B1Context, payload: BatchCreatePayload): Promise<BatchRow> => {
    requireLevel(context, 3, 'plan a batch');
    if (!payload.batchNo.trim()) throw new M1Error('validation_error', 422, 'batchNo is required', { field: 'batchNo' });
    const volumeCheck = checkPlannedVolumePositive(payload.plannedVolume);
    if (volumeCheck.outcome !== 'pass') {
      throw new M1Error(volumeCheck.classification, 422, 'plannedVolume must be greater than zero', {
        field: 'plannedVolume',
        check: volumeCheck.key,
        classification: volumeCheck.classification,
      });
    }

    return this.db.withTenant(context.tenant, async (tx) => {
      const plant = await tx.unsafe<{ id: string }>(
        `select id from plants where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.plantId],
      );
      if (!plant[0]) throw new M1Error('validation_error', 422, 'plant does not belong to this company', { field: 'plantId' });

      const version = await tx.unsafe<Row>(
        `select id, status, strength_class, version_no
           from mix_design_versions
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, payload.mixVersionId],
      );
      const v = version[0];
      if (!v) throw new M1Error('batch_mix_version_not_found', 404, `mix version ${payload.mixVersionId} does not exist for this company`);
      if (str(v.status) !== 'approved') {
        const check = checkMixVersionApproved(false, new Date(), new Date());
        throw new M1Error(check.classification, 422, `mix version ${payload.mixVersionId} is not approved`, {
          check: check.key,
          classification: check.classification,
        });
      }

      // Same immutable expression as batches_plant_day_no_idx: a planned batch has no
      // produced_at, so its day is the sentinel day. Reusing a batch_no is blocked while an
      // undated batch holds it and allowed again on a later production day.
      const dup = await tx.unsafe<{ id: string }>(
        `select id from batches
          where company_id = $1 and plant_id = $2 and batch_no = $3
            and batch_plant_day(plant_id, produced_at) = '1970-01-01'::date`,
        [context.tenant.companyId, payload.plantId, payload.batchNo],
      );
      const uniqueness = checkBatchNoUnique(Boolean(dup[0]));
      if (uniqueness.outcome !== 'pass') {
        throw new M1Error(uniqueness.classification, 409, `batch_no ${payload.batchNo} already exists for this plant today`, {
          check: uniqueness.key,
          classification: uniqueness.classification,
        });
      }

      const id = newId('BCH');
      await tx.unsafe(
        `insert into batches (id, company_id, plant_id, batch_no, order_id, mix_version_id,
            planned_volume, operator_id, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.batchNo,
          payload.orderId,
          payload.mixVersionId,
          payload.plannedVolume,
          payload.operatorId,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'batch.planned', id, {
        batchNo: payload.batchNo,
        plantId: payload.plantId,
        orderId: payload.orderId,
        mixVersionId: payload.mixVersionId,
        plannedVolume: payload.plannedVolume,
      });
      return this.readDetail(tx, context, id);
    }) as unknown as BatchRow;
  };

  /** Level 3: planned → in_progress. */
  start = async (context: B1Context, id: string, payload: BatchStartPayload): Promise<BatchRow> => {
    requireLevel(context, 3, 'start a batch');
    return this.db.withTenant(context.tenant, async (tx) => {
      const batch = await tx.unsafe<Row>(
        `select id, status from batches where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      if (!batch[0]) throw new M1Error('batch_not_found', 404, `batch ${id} does not exist for this company`);
      if (!canTransition(str(batch[0].status) as BatchStatus, 'in_progress')) {
        throw new M1Error('invalid_transition', 409, `batch ${id} is ${batch[0].status}`, { from: batch[0].status, to: 'in_progress' });
      }
      await tx.unsafe(
        `update batches set status = 'in_progress', operator_id = coalesce($4, operator_id), updated_by = $3
         where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username, payload.operatorId ?? null],
      );
      await audit(tx, context, 'batch.started', id, { operatorId: payload.operatorId });
      return this.readDetail(tx, context, id);
    }) as unknown as BatchRow;
  };

  /** Level 3: complete a batch against an approved, effective version with valid moisture. */
  complete = async (context: B1Context, id: string, payload: BatchCompletePayload): Promise<BatchDetail> => {
    requireLevel(context, 3, 'complete a batch');
    if (payload.actualVolume <= 0) throw new M1Error('validation_error', 422, 'actualVolume must be greater than zero', { field: 'actualVolume' });

    return this.db.withTenant(context.tenant, async (tx) => {
      const batch = await tx.unsafe<Row>(
        `select id, status, mix_version_id, plant_id, planned_volume, produced_at
           from batches where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      const b = batch[0];
      if (!b) throw new M1Error('batch_not_found', 404, `batch ${id} does not exist for this company`);
      if (!canTransition(str(b.status) as BatchStatus, 'completed')) {
        throw new M1Error('invalid_transition', 409, `batch ${id} is ${b.status}`, { from: b.status, to: 'completed' });
      }

      const version = await tx.unsafe<Row>(
        `select id, status, approved_at, strength_class, version_no
           from mix_design_versions
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, str(b.mix_version_id)],
      );
      const v = version[0];
      if (!v) throw new M1Error('batch_mix_version_not_found', 404, `mix version ${str(b.mix_version_id)} does not exist`);
      const approved = str(v.status) === 'approved';
      const effectiveAt = v.approved_at ? new Date(str(v.approved_at)) : new Date(0);
      const producedAt = str(b.produced_at) ? new Date(str(b.produced_at)) : new Date();
      const mixCheck = checkMixVersionApproved(approved, effectiveAt, producedAt);
      if (mixCheck.outcome !== 'pass') {
        throw new M1Error(mixCheck.classification, 422, 'mix version is not approved and effective', {
          check: mixCheck.key,
          classification: mixCheck.classification,
        });
      }

      const moistureRows = await tx.unsafe<Row>(
        `select id, material_id, valid_until, sample_at
           from moisture_readings
          where company_id = $1 and plant_id = $2
            and sample_at <= now()
          order by valid_until desc`,
        [context.tenant.companyId, str(b.plant_id)],
      );
      // ECP 203-2007 does not define this window in the supplied reference, so it is read from
      // configuration and never defaulted: with no window configured a reading cannot pass.
      const windowMinutes = Number(process.env.ICONCRETE_BATCH_MOISTURE_VALID_MINUTES ?? '');
      const windowHours = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes / 60 : null;
      const latest = moistureRows[0];
      const moistureCheck = checkMoistureReadingValid(
        latest && latest.valid_until ? new Date(str(latest.valid_until)) : null,
        latest ? new Date(str(latest.sample_at)) : producedAt,
        windowHours,
      );
      if (moistureCheck.outcome !== 'pass') {
        throw new M1Error(moistureCheck.classification, 422, 'no valid moisture reading for this plant', {
          check: moistureCheck.key,
          classification: moistureCheck.classification,
        });
      }

      // The four measured rules run through the R1 engine against configured values only.
      // Anything that is not an explicit pass or warning blocks completion unless a level-4
      // user has already recorded an approved override for that rule and this batch.
      const ruleMap = await loadBatchRules(tx, context.tenant.companyId);
      const checks: BatchCheck[] = [
        checkCementWaterDeviation(
          ruleFor(ruleMap, 'cementWaterDeviation'),
          roleDeviationPercent(payload.components, ['cement', 'water']),
        ),
        checkAggregateDeviation(
          ruleFor(ruleMap, 'aggregateDeviation'),
          roleDeviationPercent(payload.components, ['aggregate']),
        ),
        checkYieldOutsideBand(
          ruleFor(ruleMap, 'yieldOutsideBand'),
          deviationPercent(num(b.planned_volume), payload.actualVolume),
        ),
        checkScaleCalibrationCurrent(
          ruleFor(ruleMap, 'scaleCalibrationCurrent'),
          payload.scaleCalibratedAt ? new Date(payload.scaleCalibratedAt) : null,
          producedAt,
        ),
      ];

      for (const check of checks) {
        if (check.outcome === 'pass' || check.outcome === 'warning') continue;
        const overridden = await hasApprovedOverride(
          tx,
          context.tenant.companyId,
          id,
          BATCH_RULE_CODES[check.key as BatchCatalogueKey] ?? check.key,
        );
        if (overridden) continue;
        throw new M1Error(check.classification, 422, `batch ${id} is blocked by ${check.key}`, {
          check: check.key,
          classification: check.classification,
          outcome: check.outcome,
          reasonKey: check.reasonKey,
        });
      }

      // The status predicate makes the transition a compare-and-set: of two concurrent
      // completions only one updates a row and the other is refused as an invalid transition.
      const updated = await tx.unsafe<{ id: string }>(
        `update batches
           set status = 'completed', actual_volume = $4, produced_at = now(), completed_at = now(),
               operator_id = coalesce($5, operator_id), updated_by = $3
         where company_id = $1 and id = $2 and status = $6
         returning id`,
        [
          context.tenant.companyId,
          id,
          context.actor.username,
          payload.actualVolume,
          payload.operatorId ?? null,
          str(b.status),
        ],
      );
      if (!updated[0]) {
        throw new M1Error('invalid_transition', 409, `batch ${id} was completed by another request`, {
          from: str(b.status),
          to: 'completed',
        });
      }

      for (const [index, component] of payload.components.entries()) {
        await tx.unsafe(
          `insert into batch_components (id, company_id, batch_id, material_id, target_weight,
              actual_weight, unit, tolerance_pct)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            newId(`BPC${index}`),
            context.tenant.companyId,
            id,
            component.materialId,
            component.targetWeight,
            component.actualWeight,
            component.unit,
            component.tolerancePct,
          ],
        );
      }

      await audit(tx, context, 'batch.completed', id, {
        actualVolume: payload.actualVolume,
        components: payload.components.length,
        operatorId: payload.operatorId,
        checks: checks.map((check) => ({
          key: check.key,
          classification: check.classification,
          outcome: check.outcome,
        })),
      });
      return this.readDetail(tx, context, id);
    });
  };

  /** Level 4: hold → in_progress, or release a hold. */
  hold = async (context: B1Context, id: string, reason: string): Promise<BatchRow> => {
    requireLevel(context, 4, 'hold a batch');
    if (reason.trim().length < MIN_OVERRIDE_REASON) throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, { field: 'reason' });
    return this.db.withTenant(context.tenant, async (tx) => {
      const batch = await tx.unsafe<Row>(
        `select id, status from batches where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      const b = batch[0];
      if (!b) throw new M1Error('batch_not_found', 404, `batch ${id} does not exist for this company`);
      if (!canTransition(str(b.status) as BatchStatus, 'held')) {
        throw new M1Error('invalid_transition', 409, `batch ${id} is ${b.status}`, { from: b.status, to: 'held' });
      }
      await tx.unsafe(
        `update batches set status = 'held', hold_reason = $4, updated_by = $3
         where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username, reason.trim()],
      );
      await audit(tx, context, 'batch.held', id, { reason: reason.trim() });
      return this.readDetail(tx, context, id);
    }) as unknown as BatchRow;
  };

  /** Level 4: release a hold back to in_progress. */
  release = async (context: B1Context, id: string): Promise<BatchRow> => {
    requireLevel(context, 4, 'release a batch hold');
    return this.db.withTenant(context.tenant, async (tx) => {
      const batch = await tx.unsafe<Row>(
        `select id, status, hold_reason from batches where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      const b = batch[0];
      if (!b) throw new M1Error('batch_not_found', 404, `batch ${id} does not exist for this company`);
      if (str(b.status) !== 'held') throw new M1Error('invalid_transition', 409, `batch ${id} is ${b.status}`, { from: b.status, to: 'in_progress' });
      await tx.unsafe(
        `update batches set status = 'in_progress', hold_reason = null, updated_by = $3
         where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'batch.released', id, {});
      return this.readDetail(tx, context, id);
    }) as unknown as BatchRow;
  };

  /** Level 5: release an engineering hold (e.g. expired scale calibration) back to in_progress. */
  releaseEngineeringHold = async (context: B1Context, id: string, reason: string): Promise<BatchRow> => {
    requireLevel(context, 5, 'release an engineering hold on a batch');
    if (reason.trim().length < MIN_OVERRIDE_REASON) throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, { field: 'reason' });
    return this.db.withTenant(context.tenant, async (tx) => {
      const batch = await tx.unsafe<Row>(
        `select id, status, hold_reason from batches where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      const b = batch[0];
      if (!b) throw new M1Error('batch_not_found', 404, `batch ${id} does not exist for this company`);
      if (str(b.status) !== 'held') throw new M1Error('invalid_transition', 409, `batch ${id} is ${b.status}`, { from: b.status, to: 'in_progress' });
      await tx.unsafe(
        `update batches set status = 'in_progress', hold_reason = $4, updated_by = $3
         where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username, reason.trim()],
      );
      await audit(tx, context, 'batch.engineering_hold_released', id, { reason: reason.trim() });
      return this.readDetail(tx, context, id);
    }) as unknown as BatchRow;
  };

  /** Level 4: cancel a planned/in_progress/held batch. */
  cancel = async (context: B1Context, id: string): Promise<BatchRow> => {
    requireLevel(context, 4, 'cancel a batch');
    return this.db.withTenant(context.tenant, async (tx) => {
      const batch = await tx.unsafe<Row>(
        `select id, status from batches where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      const b = batch[0];
      if (!b) throw new M1Error('batch_not_found', 404, `batch ${id} does not exist for this company`);
      if (!canTransition(str(b.status) as BatchStatus, 'cancelled')) {
        throw new M1Error('invalid_transition', 409, `batch ${id} is ${b.status}`, { from: b.status, to: 'cancelled' });
      }
      await tx.unsafe(
        `update batches set status = 'cancelled', updated_by = $3
         where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'batch.cancelled', id, {});
      return this.readDetail(tx, context, id);
    }) as unknown as BatchRow;
  };

  /** Level 3: record a moisture reading for a plant/material from the batch's plant. */
  recordMoisture = async (context: B1Context, id: string, payload: MoisturePayload): Promise<MoistureReadingRow> => {
    requireLevel(context, 3, 'record a moisture reading');
    return this.db.withTenant(context.tenant, async (tx) => {
      const batchRow = await tx.unsafe<Row>(
        `select b.plant_id from batches b
          where b.company_id = $1 and b.id = $2`,
        [context.tenant.companyId, id],
      );
      if (!batchRow[0]) throw new M1Error('batch_not_found', 404, `batch ${id} does not exist for this company`);
      const plantId = str(batchRow[0].plant_id);
      const id2 = newId('MOI');
      await tx.unsafe(
        `insert into moisture_readings (id, company_id, plant_id, material_id, basis,
            moisture_pct, absorption_pct, valid_until, entered_by, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          id2,
          context.tenant.companyId,
          plantId,
          payload.materialId,
          payload.basis,
          payload.moisturePct,
          payload.absorptionPct,
          payload.validUntil === null || payload.validUntil === '' ? null : payload.validUntil,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'batch.moisture_recorded', id2, {
        batchId: id,
        materialId: payload.materialId,
        basis: payload.basis,
        validUntil: payload.validUntil,
      });
      const row = await tx.unsafe<Row>(
        `select id, material_id, basis, moisture_pct::text as moisture_pct,
                absorption_pct::text as absorption_pct, sample_at, valid_until, entered_by
          from moisture_readings where id = $1`,
        [id2],
      );
      return {
        id: str(row[0]?.id),
        material_id: str(row[0]?.material_id),
        basis: str(row[0]?.basis) as 'dry' | 'wet',
        moisture_pct: row[0]?.moisture_pct === null || row[0]?.moisture_pct === undefined ? null : num(row[0]?.moisture_pct),
        absorption_pct: row[0]?.absorption_pct === null || row[0]?.absorption_pct === undefined ? null : num(row[0]?.absorption_pct),
        sample_at: str(row[0]?.sample_at),
        valid_until: row[0]?.valid_until === null || row[0]?.valid_until === undefined ? null : str(row[0]?.valid_until),
        entered_by: row[0]?.entered_by === null || row[0]?.entered_by === undefined ? null : str(row[0]?.entered_by),
      };
    });
  };

  /** Level 4: append-only override on a batch, with actor + reason mandatory. */
  override = async (context: B1Context, id: string, payload: OverridePayload): Promise<BatchOverrideRow> => {
    requireLevel(context, 4, 'override a batch rule');
    if (payload.reason.trim().length < MIN_OVERRIDE_REASON) throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, { field: 'reason' });
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `insert into batch_overrides (company_id, rule_id, rule_code, batch_id, entity_type,
            entity_id, actor, reason, decision)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id::text as id, rule_code, entity_type, entity_id, actor, reason, decision, decided_at`,
        [
          context.tenant.companyId,
          payload.ruleId,
          payload.ruleCode,
          id,
          payload.entityType,
          payload.entityId,
          context.actor.username,
          payload.reason.trim(),
          payload.decision,
        ],
      );
      const r = rows[0]!;
      await audit(tx, context, 'batch.override', id, {
        ruleId: payload.ruleId,
        ruleCode: payload.ruleCode,
        entityType: payload.entityType,
        entityId: payload.entityId,
        decision: payload.decision,
      });
      return {
        id: str(r.id),
        rule_code: str(r.rule_code),
        entity_type: str(r.entity_type),
        entity_id: str(r.entity_id),
        actor: str(r.actor),
        reason: str(r.reason),
        decision: str(r.decision) as 'approved' | 'rejected',
        decided_at: str(r.decided_at),
      };
    });
  };
}

/** Loads this company's batching rules into the shape the R1 engine consumes. */
const loadBatchRules = async (
  tx: Executor,
  companyId: string,
): Promise<Map<string, RuleDefinition>> => {
  const rows = await tx.unsafe<Row>(
    `select code, classification, value::text as value, unit, source_note, status
       from rule_definitions
      where company_id = $1 and module = 'batching'`,
    [companyId],
  );
  const rules = new Map<string, RuleDefinition>();
  for (const row of rows) {
    rules.set(str(row.code), {
      code: str(row.code),
      module: 'batching',
      classification: str(row.classification) as RuleClassification,
      value: row.value === null || row.value === undefined ? null : Number(row.value),
      unit: str(row.unit),
      sourceNote: str(row.source_note),
      status: str(row.status) === 'retired' ? 'retired' : 'active',
    });
  }
  return rules;
};

const ruleFor = (rules: Map<string, RuleDefinition>, key: BatchCatalogueKey): RuleDefinition | null =>
  rules.get(BATCH_RULE_CODES[key]) ?? null;

const checksForBatch = (
  rules: Map<string, RuleDefinition>,
  batch: { planned_volume: number; actual_volume: number | null },
  components: readonly BatchComponentRow[],
): BatchCheck[] => {
  const measured = components.map((component) => ({
    materialId: component.material_id,
    targetWeight: component.target_weight,
    actualWeight: component.actual_weight,
  }));
  return [
    checkCementWaterDeviation(
      ruleFor(rules, 'cementWaterDeviation'),
      roleDeviationPercent(measured, ['cement', 'water']),
    ),
    checkAggregateDeviation(
      ruleFor(rules, 'aggregateDeviation'),
      roleDeviationPercent(measured, ['aggregate']),
    ),
    checkYieldOutsideBand(
      ruleFor(rules, 'yieldOutsideBand'),
      deviationPercent(batch.planned_volume, batch.actual_volume),
    ),
  ];
};

const hasApprovedOverride = async (
  tx: Executor,
  companyId: string,
  batchId: string,
  ruleCode: string,
): Promise<boolean> => {
  const rows = await tx.unsafe<{ n: number }>(
    `select count(*)::int as n
       from batch_overrides
      where company_id = $1 and batch_id = $2 and rule_code = $3 and decision = 'approved'`,
    [companyId, batchId, ruleCode],
  );
  return (rows[0]?.n ?? 0) > 0;
};

const requireLevel = (context: B1Context, min: number, what: string): void => {
  if (context.actor.roleLevel < min) throw new M1Error('forbidden', 403, `only a level-${min} user may ${what}`);
};

const audit = async (
  tx: Executor,
  context: B1Context,
  action: string,
  recordId: string,
  details: Record<string, unknown>,
): Promise<void> => {
  await tx.unsafe(
    `insert into audit_log (company_id, plant_id, user_id, username, action, table_name, record_id,
       ip_address, request_id, details)
     values ($1,$2,$3,$4,$5,'batches',$6,$7,$8,$9::jsonb)`,
    [
      context.tenant.companyId,
      context.tenant.plantIds[0] ?? null,
      context.actor.userId,
      context.actor.username,
      action,
      recordId,
      context.actor.ip ?? null,
      context.actor.requestId ?? null,
      JSON.stringify(details),
    ],
  );
};
