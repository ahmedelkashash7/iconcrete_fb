/**
 * M2 — mix design lifecycle and checks. Pure functions: no database, no IO, no clock.
 *
 * M2 consumes the R1 engine instead of inventing verdicts: every check carries the §26
 * classification it belongs to and the outcome the engine would produce. A rule with
 * nothing to check never passes — an unknown strength class or a missing source note is
 * `approval_required`, never a silent default — and a non-positive quantity, a duplicate
 * code or an edit to an approved version is a `mandatory_failure`. Nothing is corrected
 * silently; the caller decides what to do with each outcome.
 */
import type { RuleClassification, RuleOutcome } from './rules';

export type MixVersionStatus = 'draft' | 'submitted' | 'approved' | 'superseded';

export const MIX_VERSION_STATUSES: readonly MixVersionStatus[] = [
  'draft',
  'submitted',
  'approved',
  'superseded',
];

export type MixCheckKey =
  | 'qty_positive'
  | 'strength_class_known'
  | 'strength_source_present'
  | 'code_unique'
  | 'version_editable';

/** The five M2 rules, each bound to its §26 classification. */
export const MIX_RULES: Record<MixCheckKey, RuleClassification> = {
  qty_positive: 'mandatory_failure',
  strength_class_known: 'approval_required',
  strength_source_present: 'approval_required',
  code_unique: 'mandatory_failure',
  version_editable: 'mandatory_failure',
};

export interface MixCheck {
  key: MixCheckKey;
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

const verdict = (key: MixCheckKey, satisfied: boolean): MixCheck => ({
  key,
  classification: MIX_RULES[key],
  outcome: satisfied ? 'pass' : outcomeFor(MIX_RULES[key]),
  reasonKey: satisfied ? `mix.${key}.pass` : `mix.${key}`,
});

/**
 * Strength class designations follow the EN 206 naming scheme: they are labels, not
 * limits, so no numeric value is invented here. An unrecognised class needs a human
 * decision (approval_required) instead of being coerced into a known one.
 */
export const KNOWN_STRENGTH_CLASSES = [
  'C12/15',
  'C16/20',
  'C20/25',
  'C25/30',
  'C30/37',
  'C35/45',
  'C40/50',
  'C45/55',
  'C50/60',
] as const;

export const isKnownStrengthClass = (grade: string): boolean => {
  const normalised = grade.trim().toUpperCase();
  return (KNOWN_STRENGTH_CLASSES as readonly string[]).includes(normalised);
};

export interface MixComponentInput {
  materialId: string;
  role: string;
  qtyPerM3: number;
  unit: string;
  moistureBasis: string;
}

export interface MixStrengthTestInput {
  ageDays: number;
  targetMinMpa: number | null;
  sourceNote: string;
}

export interface MixDraftInput {
  codeTaken: boolean;
  strengthClass: string;
  versionStatus: MixVersionStatus;
  components: readonly MixComponentInput[];
  strengthTests: readonly MixStrengthTestInput[];
}

/** qty must be a finite positive number; zero and negatives are mandatory failures. */
export const checkComponentQty = (qty: number): MixCheck =>
  verdict('qty_positive', Number.isFinite(qty) && qty > 0);

export const checkStrengthClass = (grade: string): MixCheck =>
  verdict('strength_class_known', isKnownStrengthClass(grade));

/**
 * Same contract as R1: a strength test without a source note is approval_required, never
 * a pass and never filled in for the user.
 */
export const checkStrengthSource = (sourceNote: string): MixCheck =>
  verdict('strength_source_present', sourceNote.trim().length > 0);

export const checkCodeUnique = (taken: boolean): MixCheck => verdict('code_unique', !taken);

/** Only a draft version may be edited; approved and superseded versions are immutable. */
export const checkVersionEditable = (status: MixVersionStatus): MixCheck =>
  verdict('version_editable', status === 'draft');

/**
 * Every check that applies to a version, in a stable order: structural failures first so
 * the caller can report the blocking reason without hiding the approval-required ones.
 */
export const evaluateMixDraft = (input: MixDraftInput): MixCheck[] => {
  const structural: MixCheck[] = [
    checkCodeUnique(input.codeTaken),
    checkVersionEditable(input.versionStatus),
    ...input.components.map((component) => checkComponentQty(component.qtyPerM3)),
  ];
  const approvals: MixCheck[] = [
    checkStrengthClass(input.strengthClass),
    ...input.strengthTests.map((test) => checkStrengthSource(test.sourceNote)),
  ];
  return [...structural, ...approvals];
};

/** The checks that block the next step: anything that is not an explicit pass. */
export const blockingChecks = (checks: readonly MixCheck[]): MixCheck[] =>
  checks.filter((check) => check.outcome !== 'pass');

/**
 * Lifecycle: draft → submitted → approved → superseded. No other transition exists, and a
 * superseded version starts a new draft instead of being reopened.
 */
export const MIX_TRANSITIONS: Record<MixVersionStatus, readonly MixVersionStatus[]> = {
  draft: ['submitted'],
  submitted: ['approved'],
  approved: ['superseded'],
  superseded: [],
};

export const canTransition = (from: MixVersionStatus, to: MixVersionStatus): boolean =>
  MIX_TRANSITIONS[from].includes(to);

export const isEditable = (status: MixVersionStatus): boolean => status === 'draft';

/**
 * Material identifiers the demo dataset uses (src/seed/demo.ts). The materials module has
 * no durable table yet, so mix components store this reference as text and the UI labels
 * it from here instead of inventing names.
 */
export const MIX_MATERIALS = [
  { id: 'MAT-001', code: 'CEM-OPC', nameAr: 'أسمنت OPC', nameEn: 'OPC Cement', unit: 'kg' },
  { id: 'MAT-002', code: 'SAND-01', nameAr: 'رمل', nameEn: 'Sand', unit: 'kg' },
  { id: 'MAT-003', code: 'GRV-01', nameAr: 'زلط ١', nameEn: 'Gravel 1', unit: 'kg' },
  { id: 'MAT-004', code: 'GRV-02', nameAr: 'زلط ٢', nameEn: 'Gravel 2', unit: 'kg' },
  { id: 'MAT-005', code: 'ADM-01', nameAr: 'إضافات خرسانة', nameEn: 'Concrete Admixture', unit: 'liter' },
  { id: 'MAT-006', code: 'WTR-01', nameAr: 'مياه خلط', nameEn: 'Mixing Water', unit: 'm3' },
] as const;

export const mixMaterialLabel = (materialId: string, lang: 'ar' | 'en'): string => {
  const material = MIX_MATERIALS.find((candidate) => candidate.id === materialId);
  if (!material) return materialId;
  return lang === 'ar' ? `${material.nameAr} (${material.code})` : `${material.nameEn} (${material.code})`;
};
