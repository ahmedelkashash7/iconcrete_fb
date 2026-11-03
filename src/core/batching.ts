/** M3 — batching lifecycle and checks. Pure functions: no database, no IO, no clock. */

import type { RuleClassification, RuleOutcome } from './rules';

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

/** A calibration record must be current at production time. */
export const checkScaleCalibrationCurrent = (
  calibratedAt: Date | null,
  validUntil: Date | null,
  productionAt: Date,
): BatchCheck =>
  verdict(
    'scaleCalibrationCurrent',
    BATCH_RULES.scaleCalibrationCurrent,
    calibratedAt !== null && validUntil !== null && validUntil > productionAt,
    'batch.scale_calibration_current',
  );

/** Cement/water deviation outside a configured band is approval_required. */
export const checkCementWaterDeviation = (
  target: number | null,
  actual: number | null,
  bandPercent: number | null,
): BatchCheck => {
  if (target === null || actual === null || bandPercent === null || bandPercent <= 0) {
    return verdict(
      'cementWaterDeviation',
      BATCH_RULES.cementWaterDeviation,
      false,
      'batch.water_ratio_band_unconfigured',
    );
  }
  const deviation = Math.abs(actual - target) / Math.max(1, Math.abs(target));
  return verdict(
    'cementWaterDeviation',
    BATCH_RULES.cementWaterDeviation,
    deviation <= bandPercent / 100,
    'batch.water_ratio_deviation',
  );
};

/** Aggregate deviation outside a configured band is a warning. */
export const checkAggregateDeviation = (
  target: number | null,
  actual: number | null,
  bandPercent: number | null,
): BatchCheck => {
  if (target === null || actual === null || bandPercent === null || bandPercent <= 0) {
    return verdict(
      'aggregateDeviation',
      BATCH_RULES.aggregateDeviation,
      false,
      'batch.aggregate_band_unconfigured',
    );
  }
  const deviation = Math.abs(actual - target) / Math.max(1, Math.abs(target));
  return verdict(
    'aggregateDeviation',
    BATCH_RULES.aggregateDeviation,
    deviation <= bandPercent / 100,
    'batch.aggregate_deviation',
  );
};

/** Yield outside a configured tolerance is a warning. */
export const checkYieldOutsideBand = (
  planned: number,
  actual: number,
  tolerance: number | null,
): BatchCheck => {
  if (tolerance === null || tolerance <= 0) {
    return verdict(
      'yieldOutsideBand',
      BATCH_RULES.yieldOutsideBand,
      false,
      'batch.yield_tolerance_unconfigured',
    );
  }
  const ratio = planned > 0 ? actual / planned : 0;
  return verdict(
    'yieldOutsideBand',
    BATCH_RULES.yieldOutsideBand,
    Math.abs(ratio - 1) <= tolerance / 100,
    'batch.yield_outside_band',
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
