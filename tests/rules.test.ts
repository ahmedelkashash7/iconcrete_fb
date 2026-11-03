/**
 * R1 — pure rule engine (spec §26 rule classes).
 *
 * No database, no clock, no IO: these tests pin the behaviour every module depends on.
 */
import { describe, expect, test } from 'bun:test';
import {
  evaluateRule,
  isRuleConfigured,
  validateOverride,
  type RuleClassification,
  type RuleDefinition,
  type RuleOutcome,
} from '../src/core/rules';

const rule = (overrides: Partial<RuleDefinition> = {}): RuleDefinition => ({
  code: 'batch.water_ratio_max',
  module: 'batching',
  classification: 'approval_required',
  value: 0.55,
  unit: 'ratio',
  sourceNote: 'project specification rev 2, clause 4.1',
  status: 'active',
  ...overrides,
});

const OUTCOMES: [RuleClassification, RuleOutcome][] = [
  ['warning', 'warning'],
  ['mandatory_failure', 'failure'],
  ['approval_required', 'approval_required'],
  ['engineering_hold', 'engineering_hold'],
  ['authorized_override', 'override_required'],
];

describe('rule outcomes', () => {
  for (const [classification, expected] of OUTCOMES) {
    test(`${classification} exceeded yields ${expected}`, () => {
      const evaluation = evaluateRule(rule({ classification }), { actual: 0.6, comparator: 'lte' });
      expect(evaluation.outcome).toBe(expected);
      expect(evaluation.classification).toBe(classification);
      expect(evaluation.requiresOverride).toBe(expected === 'override_required');
    });
  }

  test('a value at the limit passes for every class', () => {
    for (const [classification] of OUTCOMES) {
      const evaluation = evaluateRule(rule({ classification }), { actual: 0.55, comparator: 'lte' });
      expect(evaluation.outcome).toBe('pass');
      expect(evaluation.requiresOverride).toBe(false);
    }
  });

  test('gte compares in the other direction', () => {
    const atLeast = rule({ classification: 'mandatory_failure', value: 28, unit: 'MPa', code: 'quality.strength_acceptance' });
    expect(evaluateRule(atLeast, { actual: 31, comparator: 'gte' }).outcome).toBe('pass');
    expect(evaluateRule(atLeast, { actual: 27.9, comparator: 'gte' }).outcome).toBe('failure');
  });

  test('the engine never corrects the measured value', () => {
    const evaluation = evaluateRule(rule(), { actual: 0.61, comparator: 'lte' });
    expect(evaluation.actual).toBe(0.61);
    expect(evaluation.value).toBe(0.55);
  });

  test('rejects a non-finite measurement instead of guessing', () => {
    expect(() => evaluateRule(rule(), { actual: Number.NaN, comparator: 'lte' })).toThrow(TypeError);
  });
});

describe('unconfigured rules', () => {
  test('no value evaluates to approval_required for every class, never pass', () => {
    for (const [classification] of OUTCOMES) {
      const evaluation = evaluateRule(rule({ classification, value: null }), {
        actual: 0,
        comparator: 'lte',
      });
      expect(evaluation.outcome).toBe('approval_required');
      expect(evaluation.unconfigured).toBe(true);
      expect(evaluation.requiresOverride).toBe(false);
      expect(evaluation.reasonKey).toBe('rule.value_missing');
    }
  });

  test('a value without a source note is still approval_required', () => {
    const evaluation = evaluateRule(rule({ sourceNote: '   ' }), { actual: 0.1, comparator: 'lte' });
    expect(evaluation.outcome).toBe('approval_required');
    expect(evaluation.unconfigured).toBe(true);
    expect(evaluation.reasonKey).toBe('rule.source_missing');
    expect(isRuleConfigured(rule({ sourceNote: '' }))).toBe(false);
  });

  test('a retired rule cannot pass, even with a value and a source', () => {
    const evaluation = evaluateRule(rule({ status: 'retired' }), { actual: 0, comparator: 'lte' });
    expect(evaluation.outcome).toBe('approval_required');
    expect(evaluation.reasonKey).toBe('rule.inactive');
  });

  test('evaluation does not mutate the definition it was given', () => {
    const definition = Object.freeze(rule({ classification: 'engineering_hold' }));
    const before = JSON.stringify(definition);
    evaluateRule(definition, { actual: 1, comparator: 'lte' });
    expect(JSON.stringify(definition)).toBe(before);
  });
});

describe('override evidence', () => {
  const draft = {
    ruleCode: 'dispatch.drum_age_limit',
    entityType: 'batch',
    entityId: 'BAT-1',
    actor: 'admin',
    reason: 'client engineer approved the delay in writing',
    decision: 'approved',
  };

  test('accepts a complete decision', () => {
    expect(validateOverride(draft)).toBeNull();
  });

  test('refuses a missing reason', () => {
    const error = validateOverride({ ...draft, reason: '   ' });
    expect(error?.field).toBe('reason');
  });

  test('refuses a token reason', () => {
    const error = validateOverride({ ...draft, reason: 'ok' });
    expect(error?.field).toBe('reason');
  });

  test('refuses a missing actor, entity and unknown decision', () => {
    expect(validateOverride({ ...draft, actor: '' })?.field).toBe('actor');
    expect(validateOverride({ ...draft, entityId: '' })?.field).toBe('entityId');
    expect(validateOverride({ ...draft, decision: 'maybe' })?.field).toBe('decision');
  });
});
