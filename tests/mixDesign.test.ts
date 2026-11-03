/**
 * M2 — pure mix design engine: the five module checks and the lifecycle.
 *
 * No database and no IO: these tests pin the contract the service enforces — an unknown
 * strength class and a missing source note are approval_required (never a pass, never a
 * silent default), a non-positive quantity, a duplicate code and an edit to an approved
 * version are mandatory failures, and only draft → submitted → approved → superseded exists.
 */
import { describe, expect, test } from 'bun:test';
import {
  KNOWN_STRENGTH_CLASSES,
  MIX_RULES,
  MIX_TRANSITIONS,
  MIX_VERSION_STATUSES,
  blockingChecks,
  canTransition,
  checkCodeUnique,
  checkComponentQty,
  checkStrengthClass,
  checkStrengthSource,
  checkVersionEditable,
  evaluateMixDraft,
  isEditable,
  isKnownStrengthClass,
} from '../src/core/mixDesign';
import { RULE_CLASSIFICATIONS, type RuleClassification } from '../src/core/rules';

describe('M2 mix design rules', () => {
  test('binds each M2 rule to a §26 classification', () => {
    expect(MIX_RULES).toEqual({
      qty_positive: 'mandatory_failure',
      strength_class_known: 'approval_required',
      strength_source_present: 'approval_required',
      code_unique: 'mandatory_failure',
      version_editable: 'mandatory_failure',
    } satisfies Record<keyof typeof MIX_RULES, RuleClassification>);
    for (const classification of Object.values(MIX_RULES)) {
      expect(RULE_CLASSIFICATIONS).toContain(classification);
    }
  });

  test('a positive quantity passes; zero and negatives are mandatory failures', () => {
    expect(checkComponentQty(450)).toMatchObject({ outcome: 'pass', classification: 'mandatory_failure' });
    expect(checkComponentQty(0)).toMatchObject({ outcome: 'failure', classification: 'mandatory_failure' });
    expect(checkComponentQty(-5)).toMatchObject({ outcome: 'failure', classification: 'mandatory_failure' });
    expect(checkComponentQty(Number.NaN)).toMatchObject({ outcome: 'failure' });
  });

  test('an unknown strength class is approval_required, never a pass', () => {
    expect(checkStrengthClass('C35/45')).toMatchObject({ outcome: 'pass' });
    expect(isKnownStrengthClass(' c35/45 ')).toBe(true);
    expect(checkStrengthClass('MIX-99')).toMatchObject({
      outcome: 'approval_required',
      classification: 'approval_required',
    });
    expect(checkStrengthClass('')).toMatchObject({ outcome: 'approval_required' });
    expect(KNOWN_STRENGTH_CLASSES).toContain('C35/45');
  });

  test('a missing source note is approval_required, never a pass', () => {
    expect(checkStrengthSource('client specification rev 1')).toMatchObject({ outcome: 'pass' });
    expect(checkStrengthSource('')).toMatchObject({
      outcome: 'approval_required',
      classification: 'approval_required',
    });
    expect(checkStrengthSource('   ')).toMatchObject({ outcome: 'approval_required' });
  });

  test('a duplicate code and an edit to an approved version are mandatory failures', () => {
    expect(checkCodeUnique(false)).toMatchObject({ outcome: 'pass' });
    expect(checkCodeUnique(true)).toMatchObject({
      outcome: 'failure',
      classification: 'mandatory_failure',
    });
    expect(checkVersionEditable('draft')).toMatchObject({ outcome: 'pass' });
    for (const status of ['submitted', 'approved', 'superseded'] as const) {
      expect(checkVersionEditable(status)).toMatchObject({
        outcome: 'failure',
        classification: 'mandatory_failure',
      });
      expect(isEditable(status)).toBe(false);
    }
  });

  test('evaluateMixDraft never reports a pass while a source note is missing', () => {
    const checks = evaluateMixDraft({
      codeTaken: false,
      strengthClass: 'C35/45',
      versionStatus: 'draft',
      components: [{ materialId: 'MAT-001', role: 'cement', qtyPerM3: 350, unit: 'kg', moistureBasis: '' }],
      strengthTests: [{ ageDays: 28, targetMinMpa: 30, sourceNote: '' }],
    });
    const source = checks.find((check) => check.key === 'strength_source_present');
    expect(source?.outcome).toBe('approval_required');
    expect(blockingChecks(checks).map((check) => check.key)).toEqual(['strength_source_present']);
    expect(checks.every((check) => check.key === 'strength_source_present' || check.outcome === 'pass')).toBe(true);
  });

  test('evaluateMixDraft reports every blocking check with its classification', () => {
    const checks = evaluateMixDraft({
      codeTaken: true,
      strengthClass: 'WEIRD',
      versionStatus: 'approved',
      components: [{ materialId: 'MAT-001', role: '', qtyPerM3: 0, unit: 'kg', moistureBasis: '' }],
      strengthTests: [{ ageDays: 7, targetMinMpa: null, sourceNote: '' }],
    });
    expect(blockingChecks(checks)).toEqual([
      { key: 'code_unique', classification: 'mandatory_failure', outcome: 'failure', reasonKey: 'mix.code_unique' },
      { key: 'version_editable', classification: 'mandatory_failure', outcome: 'failure', reasonKey: 'mix.version_editable' },
      { key: 'qty_positive', classification: 'mandatory_failure', outcome: 'failure', reasonKey: 'mix.qty_positive' },
      { key: 'strength_class_known', classification: 'approval_required', outcome: 'approval_required', reasonKey: 'mix.strength_class_known' },
      { key: 'strength_source_present', classification: 'approval_required', outcome: 'approval_required', reasonKey: 'mix.strength_source_present' },
    ]);
  });
});

describe('M2 mix design lifecycle', () => {
  test('allows exactly draft → submitted → approved → superseded', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'approved')).toBe(true);
    expect(canTransition('approved', 'superseded')).toBe(true);
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('submitted', 'draft')).toBe(false);
    expect(canTransition('superseded', 'draft')).toBe(false);
    expect(canTransition('superseded', 'approved')).toBe(false);
    expect(MIX_TRANSITIONS.superseded).toEqual([]);
  });

  test('exposes the four statuses and treats only drafts as editable', () => {
    expect([...MIX_VERSION_STATUSES]).toEqual(['draft', 'submitted', 'approved', 'superseded']);
    expect(isEditable('draft')).toBe(true);
    expect(MIX_TRANSITIONS.draft).toEqual(['submitted']);
    expect(MIX_TRANSITIONS.approved).toEqual(['superseded']);
  });
});
