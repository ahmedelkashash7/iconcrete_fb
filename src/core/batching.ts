/** M3 — batching lifecycle and checks. Pure functions: no database, no IO, no clock. */

import {
  evaluateRule,
  type RuleClassification,
  type RuleDefinition,
  type RuleEvaluation,
  type RuleOutcome,
} from './rules';

export type BatchStatus = 'planned' | 'in_progress' | 'completed' | 'held' | 'cancelled';

export const BATCH_STATUSES: readonly BatchStatus[] = [
  'planned',
  'in_progress',
  'completed',
  'held',
  'cancelled',
];

export type MoistureBasis = 'dry' | 'wet';

export const MOISTURE_BASISES: readonly MoistureBasis[] = ['dry', 'wet'];

/** The batching rules that M3 binds to §26 classifications. */
export type BatchRuleKey =
  | 'mixVersionApproved'
  | 'plannedVolumePositive'
  | 'batchNoUnique'
  | 'moistureReadingValid'
  | 'scaleCalibrationCurrent'
  | 'cementWaterDeviation'
  | 'aggregateDeviation'
  | 'yieldOutsideBand';

export const BATCH_RULES: Record<BatchRuleKey, RuleClassification> = {
  mixVersionApproved: 'mandatory_failure',
  plannedVolumePositive: 'mandatory_failure',
  batchNoUnique: 'mandatory_failure',
  moistureReadingValid: 'mandatory_failure',
  scaleCalibrationCurrent: 'engineering_hold',
  cementWaterDeviation: 'approval_required',
  aggregateDeviation: 'warning',
  yieldOutsideBand: 'warning',
};

export interface BatchCheck {
  key: string;
  classification: RuleClassification;
  outcome: RuleOutcome;
  reasonKey: string;
}

const outcomeFor = (classification: RuleClassification): RuleOutcome => {
  switch (classification) {
    case 'warning':
      return 'warning';
    case 'mandatory_failure':
      return 'failure';
    case 'approval_required':
      return 'approval_required';
    case 'engineering_hold':
      return 'engineering_hold';
    case 'authorized_override':
      return 'override_required';
  }
};

const verdict = (
  key: string,
  classification: RuleClassification,
  satisfied: boolean,
  reasonKey: string,
): BatchCheck => ({
  key,
  classification,
  outcome: satisfied ? 'pass' : outcomeFor(classification),
  reasonKey,
});

/** A batch must reference an approved, effective mix version. */
export const checkMixVersionApproved = (
  approved: boolean,
  effectiveAt: Date,
  producedAt: Date,
): BatchCheck =>
  verdict(
    'mixVersionApproved',
    BATCH_RULES.mixVersionApproved,
    approved && effectiveAt <= producedAt,
    'batch.mix_version_approved',
  );

/** Planned volume must be a finite positive number. */
export const checkPlannedVolumePositive = (volume: number): BatchCheck =>
  verdict(
    'plannedVolumePositive',
    BATCH_RULES.plannedVolumePositive,
    Number.isFinite(volume) && volume > 0,
    'batch.planned_volume_positive',
  );

/** Duplicate batch_no per plant/day is a mandatory failure. */
export const checkBatchNoUnique = (duplicate: boolean): BatchCheck =>
  verdict('batchNoUnique', BATCH_RULES.batchNoUnique, !duplicate, 'batch.batch_no_unique');

/** A moisture reading is valid only while its window covers the production time. */
export const checkMoistureReadingValid = (
  validUntil: Date | null,
  sampleAt: Date,
  windowHours: number | null,
): BatchCheck => {
  if (validUntil === null || windowHours === null || windowHours <= 0) {
    return verdict(
      'moistureReadingValid',
      BATCH_RULES.moistureReadingValid,
      false,
      'batch.moisture_window_unconfigured',
    );
  }
  const expiresAt = new Date(sampleAt.getTime() + windowHours * 3600_000);
  return verdict(
    'moistureReadingValid',
    BATCH_RULES.moistureReadingValid,
    validUntil >= expiresAt,
    'batch.moisture_reading_valid',
  );
};

/**
 * Catalogue codes the four measured batching rules read. A code with no row in
 * `rule_definitions` is treated as unconfigured, so the R1 engine answers
 * `approval_required` — never a pass, and never a default invented here.
 */
export const BATCH_RULE_CODES = {
  cementWaterDeviation: 'batch.cement_water_deviation',
  aggregateDeviation: 'batch.aggregate_deviation',
  yieldOutsideBand: 'batch.yield_tolerance',
  scaleCalibrationCurrent: 'batch.scale_calibration_interval',
} as const;

export type BatchCatalogueKey = keyof typeof BATCH_RULE_CODES;

export const BATCH_CATALOGUE_CODES: readonly string[] = Object.values(BATCH_RULE_CODES);

export type MaterialRole = 'cement' | 'aggregate' | 'water' | 'admixture';

/** The demo materials, mapped to the role a mixing check needs. */
export const MATERIAL_ROLE: Record<string, MaterialRole> = {
  'MAT-001': 'cement',
  'MAT-002': 'aggregate',
  'MAT-003': 'aggregate',
  'MAT-004': 'aggregate',
  'MAT-005': 'admixture',
  'MAT-006': 'water',
};

/** A rule the catalogue does not carry: no value, no source note, engine answers unconfigured. */
export const missingBatchRule = (key: BatchCatalogueKey): RuleDefinition => ({
  code: BATCH_RULE_CODES[key],
  module: 'batching',
  classification: BATCH_RULES[key],
  value: null,
  unit: '',
  sourceNote: '',
  status: 'active',
});

const fromEvaluation = (key: BatchRuleKey, evaluation: RuleEvaluation): BatchCheck => ({
  key,
  classification: evaluation.classification,
  outcome: evaluation.outcome,
  reasonKey: evaluation.reasonKey,
});

/** Percentage deviation of an actual value from its target; null when it cannot be measured. */
export const deviationPercent = (target: number | null, actual: number | null): number | null => {
  if (target === null || actual === null) return null;
  if (!Number.isFinite(target) || !Number.isFinite(actual) || target === 0) return null;
  return (Math.abs(actual - target) / Math.abs(target)) * 100;
};

/** Largest deviation across the components whose material plays one of the roles. */
export const roleDeviationPercent = (
  components: readonly { materialId: string; targetWeight: number | null; actualWeight: number | null }[],
  roles: readonly MaterialRole[],
): number | null => {
  let worst: number | null = null;
  for (const component of components) {
    const role = MATERIAL_ROLE[component.materialId];
    if (!role || !roles.includes(role)) continue;
    const deviation = deviationPercent(component.targetWeight, component.actualWeight);
    if (deviation === null) continue;
    worst = worst === null ? deviation : Math.max(worst, deviation);
  }
  return worst;
};

/**
 * Cement/water deviation outside the configured band is approval_required. The band is a rule
 * value, so an unconfigured rule blocks instead of guessing a percentage.
 */
export const checkCementWaterDeviation = (
  rule: RuleDefinition | null,
  deviation: number | null,
): BatchCheck => {
  if (deviation === null) {
    return verdict(
      'cementWaterDeviation',
      BATCH_RULES.cementWaterDeviation,
      false,
      'batch.deviation_unmeasured',
    );
  }
  return fromEvaluation(
    'cementWaterDeviation',
    evaluateRule(rule ?? missingBatchRule('cementWaterDeviation'), {
      actual: deviation,
      comparator: 'lte',
    }),
  );
};

/** Aggregate deviation outside the configured band is a warning. */
export const checkAggregateDeviation = (
  rule: RuleDefinition | null,
  deviation: number | null,
): BatchCheck => {
  if (deviation === null) {
    return verdict('aggregateDeviation', BATCH_RULES.aggregateDeviation, false, 'batch.deviation_unmeasured');
  }
  return fromEvaluation(
    'aggregateDeviation',
    evaluateRule(rule ?? missingBatchRule('aggregateDeviation'), {
      actual: deviation,
      comparator: 'lte',
    }),
  );
};

/** Yield outside the configured tolerance is a warning. */
export const checkYieldOutsideBand = (
  rule: RuleDefinition | null,
  deviation: number | null,
): BatchCheck => {
  if (deviation === null) {
    return verdict('yieldOutsideBand', BATCH_RULES.yieldOutsideBand, false, 'batch.yield_unmeasured');
  }
  return fromEvaluation(
    'yieldOutsideBand',
    evaluateRule(rule ?? missingBatchRule('yieldOutsideBand'), {
      actual: deviation,
      comparator: 'lte',
    }),
  );
};

/**
 * A scale calibration is current while the hours since it stay within the configured
 * interval. A missing calibration record is an engineering_hold, never an assumed pass.
 */
export const checkScaleCalibrationCurrent = (
  rule: RuleDefinition | null,
  calibratedAt: Date | null,
  productionAt: Date,
): BatchCheck => {
  if (calibratedAt === null || Number.isNaN(calibratedAt.getTime())) {
    return verdict(
      'scaleCalibrationCurrent',
      BATCH_RULES.scaleCalibrationCurrent,
      false,
      'batch.scale_calibration_missing',
    );
  }
  const hours = Math.max(0, (productionAt.getTime() - calibratedAt.getTime()) / 3600_000);
  return fromEvaluation(
    'scaleCalibrationCurrent',
    evaluateRule(rule ?? missingBatchRule('scaleCalibrationCurrent'), {
      actual: Math.round(hours * 1000) / 1000,
      comparator: 'lte',
    }),
  );
};

/** Lifecycle: planned → in_progress → completed; planned|in_progress → held → in_progress; planned|in_progress|held → cancelled. Completed is terminal. */
export const BATCH_TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  planned: ['in_progress', 'held', 'cancelled'],
  in_progress: ['completed', 'held', 'cancelled'],
  completed: [],
  held: ['in_progress', 'cancelled'],
  cancelled: [],
};

export const canTransition = (from: BatchStatus, to: BatchStatus): boolean =>
  BATCH_TRANSITIONS[from].includes(to);

export const isCompleted = (status: BatchStatus): boolean => status === 'completed';

/** Material identifiers the demo dataset uses. */
export const BATCH_MATERIALS = [
  { id: 'MAT-001', code: 'CEM-OPC', nameAr: 'أسمنت OPC', nameEn: 'OPC Cement' },
  { id: 'MAT-002', code: 'SAND-01', nameAr: 'رمل', nameEn: 'Sand' },
  { id: 'MAT-003', code: 'GRV-01', nameAr: 'زلط ١', nameEn: 'Gravel 1' },
  { id: 'MAT-004', code: 'GRV-02', nameAr: 'زلط ٢', nameEn: 'Gravel 2' },
  { id: 'MAT-005', code: 'ADM-01', nameAr: 'إضافات خرسانة', nameEn: 'Concrete Admixture' },
  { id: 'MAT-006', code: 'WTR-01', nameAr: 'مياه خلط', nameEn: 'Mixing Water' },
] as const;

export const batchMaterialLabel = (materialId: string, lang: 'ar' | 'en'): string => {
  const material = BATCH_MATERIALS.find((candidate) => candidate.id === materialId);
  if (!material) return materialId;
  return lang === 'ar'
    ? `${material.nameAr} (${material.code})`
    : `${material.nameEn} (${material.code})`;
};
