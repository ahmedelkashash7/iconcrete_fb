/**
 * R1 — the rule engine. Pure functions only: no database, no IO, no clock.
 *
 * The five classes are the ones named in spec §26. Every rule is data, so a module never
 * hard-codes a limit and never silently corrects a value: it evaluates, records the
 * outcome, and a human authorises anything that is not a pass.
 *
 * The contract at the centre of this file: a rule without a value, or without a source
 * note, evaluates to `approval_required`. It is never a pass, and there is no default.
 * Numeric limits are not defined here because the ECP 203-2007 reference was not supplied;
 * a configured value carries the note that says where it came from.
 */

export type RuleClassification =
  | 'warning'
  | 'mandatory_failure'
  | 'approval_required'
  | 'engineering_hold'
  | 'authorized_override';

export const RULE_CLASSIFICATIONS: readonly RuleClassification[] = [
  'warning',
  'mandatory_failure',
  'approval_required',
  'engineering_hold',
  'authorized_override',
];

export type RuleModule = 'mix_design' | 'batching' | 'quality' | 'fleet' | 'inventory' | 'sales';

export const RULE_MODULES: readonly RuleModule[] = [
  'mix_design',
  'batching',
  'quality',
  'fleet',
  'inventory',
  'sales',
];

export type RuleStatus = 'active' | 'retired';

/** `lte`: actual must not exceed the value. `gte`: actual must not fall below it. */
export type LimitComparator = 'lte' | 'gte';

export type RuleOutcome =
  | 'pass'
  | 'warning'
  | 'failure'
  | 'approval_required'
  | 'engineering_hold'
  | 'override_required';

/** Shown wherever a rule has no value: never blank, never a guess. */
export const MISSING_REFERENCE = 'not specified in the supplied reference';

export const MISSING_SOURCE = 'no source note recorded';

export interface RuleDefinition {
  code: string;
  module: RuleModule;
  classification: RuleClassification;
  value: number | null;
  unit: string;
  sourceNote: string;
  status: RuleStatus;
}

export interface RuleEvaluationInput {
  actual: number;
  comparator: LimitComparator;
}

export interface RuleEvaluation {
  code: string;
  module: RuleModule;
  classification: RuleClassification;
  outcome: RuleOutcome;
  actual: number;
  value: number | null;
  unit: string;
  comparator: LimitComparator;
  /** True when the rule cannot decide: it has no value, no source note, or is not active. */
  unconfigured: boolean;
  /** True only for `authorized_override` rules that were exceeded. */
  requiresOverride: boolean;
  reasonKey: string;
}

const hasValue = (rule: RuleDefinition): boolean =>
  typeof rule.value === 'number' && Number.isFinite(rule.value);

export const isRuleConfigured = (rule: RuleDefinition): boolean =>
  rule.status === 'active' && hasValue(rule) && rule.sourceNote.trim().length > 0;

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

/**
 * Evaluates one rule against one measured value.
 *
 * There is no branch that returns `pass` for an unconfigured rule, and no branch that
 * rewrites `actual`: the caller decides what to do with the outcome.
 */
export const evaluateRule = (rule: RuleDefinition, input: RuleEvaluationInput): RuleEvaluation => {
  if (!Number.isFinite(input.actual)) {
    throw new TypeError('rule evaluation needs a finite actual value');
  }
  if (input.comparator !== 'lte' && input.comparator !== 'gte') {
    throw new TypeError(`unknown comparator: ${String(input.comparator)}`);
  }

  const base = {
    code: rule.code,
    module: rule.module,
    classification: rule.classification,
    actual: input.actual,
    value: hasValue(rule) ? rule.value : null,
    unit: rule.unit,
    comparator: input.comparator,
  } as const;

  if (rule.status !== 'active') {
    return {
      ...base,
      outcome: 'approval_required',
      unconfigured: true,
      requiresOverride: false,
      reasonKey: 'rule.inactive',
    };
  }

  if (!isRuleConfigured(rule)) {
    return {
      ...base,
      outcome: 'approval_required',
      unconfigured: true,
      requiresOverride: false,
      reasonKey: hasValue(rule) ? 'rule.source_missing' : 'rule.value_missing',
    };
  }

  const limit = rule.value as number;
  const violated = input.comparator === 'lte' ? input.actual > limit : input.actual < limit;

  if (!violated) {
    return {
      ...base,
      outcome: 'pass',
      unconfigured: false,
      requiresOverride: false,
      reasonKey: 'rule.passed',
    };
  }

  const outcome = outcomeFor(rule.classification);
  return {
    ...base,
    outcome,
    unconfigured: false,
    requiresOverride: outcome === 'override_required',
    reasonKey: `rule.${outcome}`,
  };
};

export type OverrideDecision = 'approved' | 'rejected';

export interface OverrideDraft {
  ruleCode: string;
  entityType: string;
  entityId: string;
  actor: string;
  reason: string;
  decision: string;
}

export interface OverrideError {
  code: 'validation_error';
  field: string;
  message: string;
}

export const MIN_OVERRIDE_REASON = 5;

/**
 * An override is only valid with all five pieces of evidence: rule, entity, actor, reason,
 * decision. A missing or token reason is refused here, before any row exists.
 */
export const validateOverride = (draft: OverrideDraft): OverrideError | null => {
  const required: [keyof OverrideDraft, string][] = [
    ['ruleCode', 'ruleCode'],
    ['entityType', 'entityType'],
    ['entityId', 'entityId'],
    ['actor', 'actor'],
  ];
  for (const [field, label] of required) {
    if (draft[field].trim().length === 0) {
      return { code: 'validation_error', field: label, message: `${label} is required` };
    }
  }
  if (draft.reason.trim().length < MIN_OVERRIDE_REASON) {
    return {
      code: 'validation_error',
      field: 'reason',
      message: `reason must be at least ${MIN_OVERRIDE_REASON} characters`,
    };
  }
  if (draft.decision !== 'approved' && draft.decision !== 'rejected') {
    return {
      code: 'validation_error',
      field: 'decision',
      message: 'decision must be approved or rejected',
    };
  }
  return null;
};
