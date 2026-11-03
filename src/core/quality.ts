/**
 * M4 — quality and laboratory. Pure functions: no database, no IO, no clock.
 *
 * Every verdict carries the §26 classification it belongs to, and the two rules that compare a
 * measured value against a limit run through the R1 engine (`evaluateRule`) instead of local
 * arithmetic. A rule with nothing to check never passes: missing acceptance limits are
 * `approval_required`, a lapsed calibration is an `engineering_hold`, and an unconfigured
 * specimen requirement is a `warning` that is still recorded — never silently accepted.
 *
 * ECP 203-2007 does not define any acceptance limit, test age or slump/temperature band in the
 * reference supplied to this project, so none appears here as a number.
 */
import {
  evaluateRule,
  type RuleClassification,
  type RuleDefinition,
  type RuleEvaluation,
  type RuleOutcome,
} from './rules';

export type TestType = 'slump' | 'cube_strength' | 'temperature' | 'density' | 'other';

export const TEST_TYPES: readonly TestType[] = [
  'slump',
  'cube_strength',
  'temperature',
  'density',
  'other',
];

export type TestStatus = 'sampled' | 'testing' | 'passed' | 'failed' | 'inconclusive';

export type NcrStatus = 'open' | 'investigation' | 'capa_open' | 'verification' | 'closed' | 'void';

export type CertificateStatus = 'draft' | 'issued' | 'revoked';

export type EquipmentStatus = 'active' | 'out_of_service' | 'retired';

export type CapaStatus = 'open' | 'in_progress' | 'done' | 'verified';

export type QualityRuleKey =
  | 'resultPresent'
  | 'unitMatches'
  | 'chronology'
  | 'failedNeedsNcr'
  | 'certificateEligible'
  | 'plantScope'
  | 'calibrationCurrent'
  | 'capaEffectiveness'
  | 'specLimitsPresent'
  | 'resultInSpec'
  | 'specimenCount';

/** The M4 rules, each bound to its §26 classification. */
export const QUALITY_RULES: Record<QualityRuleKey, RuleClassification> = {
  resultPresent: 'mandatory_failure',
  unitMatches: 'mandatory_failure',
  chronology: 'mandatory_failure',
  failedNeedsNcr: 'mandatory_failure',
  certificateEligible: 'mandatory_failure',
  plantScope: 'mandatory_failure',
  calibrationCurrent: 'engineering_hold',
  capaEffectiveness: 'approval_required',
  specLimitsPresent: 'approval_required',
  resultInSpec: 'mandatory_failure',
  specimenCount: 'warning',
};

export interface QualityCheck {
  key: QualityRuleKey;
  classification: RuleClassification;
  outcome: RuleOutcome;
  reasonKey: string;
}

/** Catalogue codes the measured M4 rules read. */
export const QUALITY_RULE_CODES = {
  specimenCount: 'quality.specimen_count',
  calibrationValidity: 'quality.calibration_validity',
} as const;

export type QualityCatalogueKey = keyof typeof QUALITY_RULE_CODES;

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

const verdict = (key: QualityRuleKey, satisfied: boolean, reasonKey: string): QualityCheck => ({
  key,
  classification: QUALITY_RULES[key],
  outcome: satisfied ? 'pass' : outcomeFor(QUALITY_RULES[key]),
  reasonKey,
});

const fromEvaluation = (key: QualityRuleKey, evaluation: RuleEvaluation): QualityCheck => ({
  key,
  classification: evaluation.classification,
  outcome: evaluation.outcome,
  reasonKey: evaluation.reasonKey,
});

/** The unit each test type is recorded in. `other` declares its own unit and is not guessed. */
export const TEST_TYPE_UNITS: Record<TestType, string | null> = {
  slump: 'mm',
  cube_strength: 'MPa',
  temperature: 'C',
  density: 'kg/m3',
  other: null,
};

export const isTestType = (value: string): value is TestType =>
  (TEST_TYPES as readonly string[]).includes(value);

/** Result present, finite and strictly positive. */
export const checkResultPresent = (value: number | null): QualityCheck =>
  verdict('resultPresent', value !== null && Number.isFinite(value) && value > 0, 'quality.result_present');

/** The recorded unit must be the declared unit for the test type; `other` requires a unit. */
export const checkUnitMatches = (unit: string, testType: TestType): QualityCheck => {
  const expected = TEST_TYPE_UNITS[testType];
  if (unit.trim().length === 0) return verdict('unitMatches', false, 'quality.unit_missing');
  if (expected === null) return verdict('unitMatches', true, 'quality.unit_declared');
  return verdict('unitMatches', unit.trim() === expected, 'quality.unit_matches');
};

const dayGap = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / 86_400_000;

/**
 * Chronology: testing cannot precede sampling, a specimen cannot be cast after it is tested,
 * and the recorded age must agree with the cast date within a day.
 */
export const checkChronology = (input: {
  sampledAt: Date;
  testedAt: Date;
  castAt: Date | null;
  ageDays: number | null;
}): QualityCheck => {
  const { sampledAt, testedAt, castAt, ageDays } = input;
  if (testedAt.getTime() < sampledAt.getTime()) {
    return verdict('chronology', false, 'quality.chronology.tested_before_sampled');
  }
  if (castAt !== null && castAt.getTime() > testedAt.getTime()) {
    return verdict('chronology', false, 'quality.chronology.cast_after_test');
  }
  if (castAt !== null && ageDays !== null && Math.abs(dayGap(castAt, testedAt) - ageDays) > 1) {
    return verdict('chronology', false, 'quality.chronology.age_mismatch');
  }
  return verdict('chronology', true, 'quality.chronology.pass');
};

/** A failed result always has an NCR; a passing one never needs it. */
export const checkFailedNeedsNcr = (status: TestStatus, hasNcr: boolean): QualityCheck =>
  verdict('failedNeedsNcr', status !== 'failed' || hasNcr, 'quality.failed_needs_ncr');

/** A certificate needs a passed, verified test. */
export const checkCertificateEligible = (status: TestStatus, verified: boolean): QualityCheck =>
  verdict(
    'certificateEligible',
    status === 'passed' && verified,
    status === 'failed' ? 'quality.certificate.failed_test' : 'quality.certificate.unverified',
  );

/** A test may only reference a batch from its own plant. */
export const checkPlantScope = (testPlantId: string, batchPlantId: string | null): QualityCheck =>
  verdict(
    'plantScope',
    batchPlantId === null || batchPlantId === testPlantId,
    'quality.plant_scope',
  );

/** Acceptance limits need both bounds and the note that says where they came from. */
export const checkSpecLimitsPresent = (
  min: number | null,
  max: number | null,
  sourceNote: string,
): QualityCheck =>
  verdict(
    'specLimitsPresent',
    min !== null && max !== null && sourceNote.trim().length > 0,
    'quality.spec_limits_missing',
  );

/** Below the lower or above the upper acceptance limit is a failure. */
export const checkResultInSpec = (
  value: number,
  min: number | null,
  max: number | null,
): QualityCheck =>
  verdict(
    'resultInSpec',
    min !== null && max !== null && value >= min && value <= max,
    'quality.result_out_of_spec',
  );

/** An NCR cannot be closed while a corrective action is still open. */
export const checkCapaEffectiveness = (
  openCapa: number,
  effectivenessChecked: boolean,
): QualityCheck =>
  verdict(
    'capaEffectiveness',
    openCapa === 0 || effectivenessChecked,
    'quality.capa_effectiveness_missing',
  );

/**
 * Specimen count against the count required for this test. The comparison and the classification
 * come from the R1 engine; a mismatch is a warning that must be recorded with a reason.
 */
export const checkSpecimenCount = (required: number | null, actual: number): QualityCheck => {
  if (required === null || required <= 0) {
    return verdict('specimenCount', false, 'quality.specimen_count_unconfigured');
  }
  const rule: RuleDefinition = {
    code: QUALITY_RULE_CODES.specimenCount,
    module: 'quality',
    classification: QUALITY_RULES.specimenCount,
    value: required,
    unit: 'count',
    sourceNote: 'recorded on the test',
    status: 'active',
  };
  return fromEvaluation('specimenCount', evaluateRule(rule, { actual, comparator: 'gte' }));
};

/**
 * Calibration currency. The engine compares the hours of validity left against the configured
 * minimum (0 by default for a calibration record), and classifies a lapse as an engineering hold.
 */
export const checkCalibrationCurrent = (
  rule: RuleDefinition | null,
  expiresAt: Date | null,
  at: Date,
): QualityCheck => {
  if (expiresAt === null || Number.isNaN(expiresAt.getTime())) {
    return verdict('calibrationCurrent', false, 'quality.calibration.missing');
  }
  const hoursLeft = (expiresAt.getTime() - at.getTime()) / 3_600_000;
  const definition: RuleDefinition = rule ?? {
    code: QUALITY_RULE_CODES.calibrationValidity,
    module: 'quality',
    classification: QUALITY_RULES.calibrationCurrent,
    value: 0,
    unit: 'h',
    sourceNote: 'calibration record',
    status: 'active',
  };
  return fromEvaluation(
    'calibrationCurrent',
    evaluateRule(definition, { actual: Math.round(hoursLeft * 1000) / 1000, comparator: 'gte' }),
  );
};

/** Lifecycles. Result states are terminal: a re-test is a new sample, not an edit. */
export const TEST_TRANSITIONS: Record<TestStatus, readonly TestStatus[]> = {
  sampled: ['testing', 'inconclusive'],
  testing: ['passed', 'failed', 'inconclusive'],
  passed: [],
  failed: [],
  inconclusive: [],
};

export const NCR_TRANSITIONS: Record<NcrStatus, readonly NcrStatus[]> = {
  open: ['investigation', 'void'],
  investigation: ['capa_open', 'verification', 'void'],
  capa_open: ['verification', 'void'],
  verification: ['closed', 'void'],
  closed: [],
  void: [],
};

export const CERTIFICATE_TRANSITIONS: Record<CertificateStatus, readonly CertificateStatus[]> = {
  draft: ['issued'],
  issued: ['revoked'],
  revoked: [],
};

export const EQUIPMENT_TRANSITIONS: Record<EquipmentStatus, readonly EquipmentStatus[]> = {
  active: ['out_of_service', 'retired'],
  out_of_service: ['active', 'retired'],
  retired: [],
};

export const canTestTransition = (from: TestStatus, to: TestStatus): boolean =>
  TEST_TRANSITIONS[from].includes(to);

export const canNcrTransition = (from: NcrStatus, to: NcrStatus): boolean =>
  NCR_TRANSITIONS[from].includes(to);

export const canCertificateTransition = (from: CertificateStatus, to: CertificateStatus): boolean =>
  CERTIFICATE_TRANSITIONS[from].includes(to);

/** Required test ages are configuration. There is no 7/28/56 default here. */
export const requiredAgeDays = (configured: readonly number[] | null, ageDays: number): boolean | null => {
  if (configured === null || configured.length === 0) return null;
  return configured.includes(ageDays);
};

/** Demo material list reused by the sampling screens; no acceptance value is implied. */
export const QUALITY_SEVERITIES = ['minor', 'major', 'critical'] as const;
export type NcrSeverity = (typeof QUALITY_SEVERITIES)[number];
