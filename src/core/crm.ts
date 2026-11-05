/**
 * M8 — sales pricing, commitments and CRM. Pure functions: no database, no IO, no clock.
 *
 * A price is resolved once, at order time, and copied onto the order item. The precedence is
 * contract > volume commitment > seasonal > price list; two sources at the winning rank is an
 * ambiguity that needs a human decision, and no source is never a zero price.
 *
 * The commitment warning and approval thresholds are data (R1): the seed names the execution
 * specification as their source. Removing a value makes the rule approval_required, never a pass.
 */
import {
  evaluateRule,
  type RuleDefinition,
  type RuleOutcome,
} from './rules';

export const PRICE_LIST_STATUSES = ['draft', 'active', 'expired', 'superseded'] as const;
export type PriceListStatus = (typeof PRICE_LIST_STATUSES)[number];

export const COMMITMENT_STATUSES = [
  'draft',
  'active',
  'fulfilled',
  'breached',
  'expired',
  'cancelled',
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const ACTIVITY_STATUSES = ['open', 'done', 'cancelled'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const COMPLAINT_STATUSES = ['open', 'investigating', 'resolved', 'closed', 'rejected'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const CRM_LEVELS = {
  read: 1,
  activity: 2,
  pricing: 3,
  approve: 4,
  supersede: 5,
} as const;

const PRICE_LIST_TRANSITIONS: Record<PriceListStatus, PriceListStatus[]> = {
  draft: ['active'],
  active: ['expired', 'superseded'],
  expired: [],
  superseded: [],
};

const COMMITMENT_TRANSITIONS: Record<CommitmentStatus, CommitmentStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['fulfilled', 'breached', 'expired', 'cancelled'],
  fulfilled: ['expired'],
  breached: ['expired'],
  expired: [],
  cancelled: [],
};

const ACTIVITY_TRANSITIONS: Record<ActivityStatus, ActivityStatus[]> = {
  open: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  open: ['investigating', 'rejected'],
  investigating: ['resolved', 'rejected'],
  resolved: ['closed'],
  closed: [],
  rejected: [],
};

export const canPriceListTransition = (from: PriceListStatus, to: PriceListStatus): boolean =>
  PRICE_LIST_TRANSITIONS[from].includes(to);
export const canCommitmentTransition = (from: CommitmentStatus, to: CommitmentStatus): boolean =>
  COMMITMENT_TRANSITIONS[from].includes(to);
export const canActivityTransition = (from: ActivityStatus, to: ActivityStatus): boolean =>
  ACTIVITY_TRANSITIONS[from].includes(to);
export const canComplaintTransition = (from: ComplaintStatus, to: ComplaintStatus): boolean =>
  COMPLAINT_TRANSITIONS[from].includes(to);

export type CrmCheckKey =
  | 'pricePrecedence'
  | 'priceOverlap'
  | 'commitmentVolume'
  | 'seasonWindow'
  | 'feedbackRating'
  | 'complaintNcr';

export interface CrmCheck {
  key: CrmCheckKey;
  classification: 'mandatory_failure' | 'approval_required' | 'warning';
  outcome: RuleOutcome;
  reasonKey: string;
}

const check = (
  key: CrmCheckKey,
  ok: boolean,
  reasonKey: string,
  classification: CrmCheck['classification'] = 'mandatory_failure',
): CrmCheck => ({
  key,
  classification,
  outcome: ok
    ? 'pass'
    : classification === 'mandatory_failure'
      ? 'failure'
      : classification === 'approval_required'
        ? 'approval_required'
        : 'warning',
  reasonKey: ok ? 'rule.passed' : reasonKey,
});

// ------------------------------------------------------------------ price priority

export const PRICE_SOURCES = ['contract', 'volume_commitment', 'seasonal', 'price_list'] as const;
export type PriceSourceType = (typeof PRICE_SOURCES)[number];

/** Lower rank wins. Contract evidence beats every derived catalogue. */
export const PRICE_SOURCE_RANK: Record<PriceSourceType, number> = {
  contract: 1,
  volume_commitment: 2,
  seasonal: 3,
  price_list: 4,
};

export interface PriceCandidate {
  sourceType: PriceSourceType;
  sourceId: string;
  price: number;
  label?: string;
}

export type PriceDecision =
  | { outcome: 'resolved'; candidate: PriceCandidate; rank: number }
  | { outcome: 'ambiguous'; candidates: PriceCandidate[]; rank: number }
  | { outcome: 'none' };

/**
 * Chooses the highest-precedence candidate. More than one candidate at the winning rank is
 * ambiguous, even when the prices happen to match: the source itself is the evidence.
 */
export const choosePrice = (candidates: PriceCandidate[]): PriceDecision => {
  const valid = candidates.filter(
    (candidate) =>
      candidate.sourceId.trim().length > 0 &&
      Number.isFinite(candidate.price) &&
      candidate.price > 0,
  );
  if (valid.length === 0) return { outcome: 'none' };
  const rank = Math.min(...valid.map((candidate) => PRICE_SOURCE_RANK[candidate.sourceType]));
  const winners = valid.filter((candidate) => PRICE_SOURCE_RANK[candidate.sourceType] === rank);
  if (winners.length === 1) return { outcome: 'resolved', candidate: winners[0]!, rank };
  return { outcome: 'ambiguous', candidates: winners, rank };
};

/** No price, or two sources at the same rank, is approval_required — never a silent pick. */
export const checkPriceDecision = (decision: PriceDecision): CrmCheck =>
  check(
    'pricePrecedence',
    decision.outcome === 'resolved',
    decision.outcome === 'none' ? 'sales.price_missing' : 'sales.price_ambiguous',
    'approval_required',
  );

const overlaps = (fromA: string, toA: string | null, fromB: string, toB: string | null): boolean =>
  (toA === null || toA >= fromB) && (toB === null || toB >= fromA);

/**
 * Two active price lists for the same material and the same plant may not overlap. The check is
 * structural: there is no tolerance to configure.
 */
export const checkPriceListOverlap = (
  candidate: { from: string; to: string | null },
  existing: Array<{ from: string; to: string | null }>,
): CrmCheck =>
  check(
    'priceOverlap',
    !existing.some((row) => overlaps(candidate.from, candidate.to, row.from, row.to)),
    'sales.price_list_overlap',
  );

// -------------------------------------------------------------------- commitments

export const COMMITMENT_RULE_CODES = {
  warn: 'sales.commitment_warn_pct',
  approval: 'sales.commitment_approval_pct',
} as const;

export const missingCommitmentRule = (kind: keyof typeof COMMITMENT_RULE_CODES): RuleDefinition => ({
  code: COMMITMENT_RULE_CODES[kind],
  module: 'sales',
  classification: kind === 'warn' ? 'warning' : 'approval_required',
  value: null,
  unit: '%',
  sourceNote: '',
  status: 'active',
});

export interface CommitmentDecision {
  ratio: number;
  projected: number;
  committed: number;
  outcome: 'pass' | 'warning' | 'approval_required' | 'failure';
  check: CrmCheck;
}

/**
 * Fulfilment is measured against the commitment. Above the warning threshold is a warning; above
 * the approval threshold is approval_required. Both thresholds are R1 values, and an unconfigured
 * threshold can only produce approval_required.
 */
export const commitmentDecision = (
  committed: number,
  fulfilled: number,
  additional: number,
  warnRule: RuleDefinition | null,
  approvalRule: RuleDefinition | null,
): CommitmentDecision => {
  const projected = fulfilled + additional;
  if (!Number.isFinite(committed) || committed <= 0) {
    return {
      ratio: 0,
      projected,
      committed,
      outcome: 'pass',
      check: check('commitmentVolume', true, 'rule.passed'),
    };
  }
  const ratio = (projected / committed) * 100;
  const approval = evaluateRule(approvalRule ?? missingCommitmentRule('approval'), {
    actual: ratio,
    comparator: 'lte',
  });
  if (approval.outcome !== 'pass') {
    return {
      ratio,
      projected,
      committed,
      outcome: approval.outcome === 'failure' ? 'failure' : 'approval_required',
      check: {
        key: 'commitmentVolume',
        classification: 'approval_required',
        outcome: approval.outcome,
        reasonKey: approval.reasonKey,
      },
    };
  }
  const warn = evaluateRule(warnRule ?? missingCommitmentRule('warn'), {
    actual: ratio,
    comparator: 'lte',
  });
  if (warn.outcome !== 'pass') {
    return {
      ratio,
      projected,
      committed,
      outcome: warn.outcome === 'failure' ? 'failure' : 'warning',
      check: {
        key: 'commitmentVolume',
        classification: 'warning',
        outcome: warn.outcome,
        reasonKey: warn.reasonKey,
      },
    };
  }
  return {
    ratio,
    projected,
    committed,
    outcome: 'pass',
    check: check('commitmentVolume', true, 'rule.passed'),
  };
};

// ----------------------------------------------------------------------- CRM checks

export const checkFeedbackRating = (rating: number): CrmCheck =>
  check(
    'feedbackRating',
    Number.isFinite(rating) && rating >= 1 && rating <= 5,
    'sales.feedback_rating',
  );

/** A quality-related complaint is only complete with the NCR that recorded the failure. */
export const checkComplaintNcr = (qualityRelated: boolean, ncrId: string | null): CrmCheck =>
  check('complaintNcr', !qualityRelated || Boolean(ncrId?.trim()), 'sales.complaint_ncr');

/** A season whose end precedes its start cannot price anything. */
export const checkSeasonWindow = (start: string, end: string): CrmCheck =>
  check('seasonWindow', start.length >= 10 && end.length >= 10 && end >= start, 'sales.season_window');

/** A seasonal price prices a date only inside its own window. */
export const isInsideSeason = (start: string, end: string, date: string): boolean =>
  date >= start && date <= end;
