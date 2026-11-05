/**
 * M7 — orders and distribution. Pure functions: no database, no IO, no clock.
 *
 * Quotation and contract versions are evidence: they are appended, never edited, and a later
 * quotation never changes a signed contract because the contract pins `quotation_version_id`.
 * Delivery progress is derived from confirmed and delivered tickets, not from a status field.
 *
 * Configurable limits (discount approval and maximum) run through `evaluateRule` and are seeded
 * with no value. The credit bands and the zero-tolerance loaded/delivered check are fixed by the
 * execution specification; they are structural checks, not configuration.
 */
import {
  evaluateRule,
  isRuleConfigured,
  type RuleClassification,
  type RuleDefinition,
  type RuleEvaluation,
  type RuleOutcome,
} from './rules';

export const QUOTATION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'superseded',
  'expired',
  'cancelled',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const CONTRACT_STATUSES = ['draft', 'signed', 'active', 'expired', 'void'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const SALES_ORDER_STATUSES = [
  'draft',
  'confirmed',
  'scheduled',
  'in_production',
  'delivered',
  'invoiced',
  'closed',
  'on_hold',
  'cancelled',
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const DELIVERY_TICKET_STATUSES = ['draft', 'confirmed', 'delivered', 'voided'] as const;
export type DeliveryTicketStatus = (typeof DELIVERY_TICKET_STATUSES)[number];

export const SALES_LEVELS = {
  read: 1,
  create: 3,
  approve: 4,
  sign: 5,
  void: 5,
} as const;

const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'cancelled'],
  approved: ['superseded', 'expired', 'cancelled'],
  superseded: ['expired', 'cancelled'],
  expired: [],
  cancelled: [],
};

const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['signed', 'void'],
  signed: ['active', 'void'],
  active: ['expired', 'void'],
  expired: [],
  void: [],
};

const ORDER_TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['scheduled', 'in_production', 'on_hold', 'cancelled'],
  scheduled: ['in_production', 'on_hold', 'cancelled'],
  in_production: ['delivered', 'on_hold'],
  delivered: ['invoiced'],
  invoiced: ['closed'],
  closed: [],
  on_hold: ['confirmed', 'scheduled', 'in_production', 'cancelled'],
  cancelled: [],
};

const TICKET_TRANSITIONS: Record<DeliveryTicketStatus, DeliveryTicketStatus[]> = {
  draft: ['confirmed', 'voided'],
  confirmed: ['delivered', 'voided'],
  delivered: [],
  voided: [],
};

export const canQuotationTransition = (from: QuotationStatus, to: QuotationStatus): boolean =>
  QUOTATION_TRANSITIONS[from].includes(to);
export const canContractTransition = (from: ContractStatus, to: ContractStatus): boolean =>
  CONTRACT_TRANSITIONS[from].includes(to);
export const canSalesOrderTransition = (from: SalesOrderStatus, to: SalesOrderStatus): boolean =>
  ORDER_TRANSITIONS[from].includes(to);
export const canTicketTransition = (from: DeliveryTicketStatus, to: DeliveryTicketStatus): boolean =>
  TICKET_TRANSITIONS[from].includes(to);

export const resumedOrderStatus = (
  heldFrom: SalesOrderStatus | null,
): SalesOrderStatus => (heldFrom && ['confirmed', 'scheduled', 'in_production'].includes(heldFrom) ? heldFrom : 'confirmed');

export type SalesRuleKey =
  | 'uniqueDocument'
  | 'positiveValue'
  | 'quotationValidity'
  | 'approvedVersion'
  | 'salesReference'
  | 'contractLimit'
  | 'ticketReferences'
  | 'volumeVariance'
  | 'batchCoverage'
  | 'customerBlacklist'
  | 'creditExposure'
  | 'priceResolution'
  | 'discount';

export const SALES_RULES: Record<SalesRuleKey, RuleClassification> = {
  uniqueDocument: 'mandatory_failure',
  positiveValue: 'mandatory_failure',
  quotationValidity: 'mandatory_failure',
  approvedVersion: 'mandatory_failure',
  salesReference: 'approval_required',
  contractLimit: 'approval_required',
  ticketReferences: 'mandatory_failure',
  volumeVariance: 'approval_required',
  batchCoverage: 'mandatory_failure',
  customerBlacklist: 'mandatory_failure',
  creditExposure: 'approval_required',
  priceResolution: 'approval_required',
  discount: 'approval_required',
};

export type SalesCatalogueKey = 'discountApproval' | 'discountMax';

export const SALES_RULE_CODES: Record<SalesCatalogueKey, string> = {
  discountApproval: 'sales.discount_approval_pct',
  discountMax: 'sales.discount_max_pct',
};

export interface SalesCheck {
  key: SalesRuleKey;
  classification: RuleClassification;
  outcome: RuleOutcome;
  reasonKey: string;
}

const OUTCOME_BY_CLASS: Record<RuleClassification, RuleOutcome> = {
  warning: 'warning',
  mandatory_failure: 'failure',
  approval_required: 'approval_required',
  engineering_hold: 'engineering_hold',
  authorized_override: 'override_required',
};

const verdict = (
  key: SalesRuleKey,
  ok: boolean,
  failReason: string,
  failClass: RuleClassification = SALES_RULES[key],
): SalesCheck => ({
  key,
  classification: failClass,
  outcome: ok ? 'pass' : OUTCOME_BY_CLASS[failClass],
  reasonKey: ok ? 'rule.passed' : failReason,
});

const fromEvaluation = (key: SalesRuleKey, evaluation: RuleEvaluation): SalesCheck => ({
  key,
  classification: evaluation.classification,
  outcome: evaluation.outcome,
  reasonKey: evaluation.reasonKey,
});

export const missingSalesRule = (key: SalesCatalogueKey): RuleDefinition => ({
  code: SALES_RULE_CODES[key],
  module: 'sales',
  classification: SALES_RULES.discount,
  value: null,
  unit: '',
  sourceNote: '',
  status: 'active',
});

export const checkUniqueDocument = (duplicate: boolean, kind: string): SalesCheck =>
  verdict('uniqueDocument', !duplicate, `sales.duplicate_${kind}`);

export interface SalesLine {
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
}

/** Quantity and price must be positive, and percentages inside their stated range. */
export const checkPositiveLines = (
  lines: Array<{ quantity: number; unitPrice: number; discountPct?: number; taxRate?: number }>,
): SalesCheck =>
  verdict(
    'positiveValue',
    lines.length > 0 &&
      lines.every(
        (line) =>
          Number.isFinite(line.quantity) &&
          line.quantity > 0 &&
          Number.isFinite(line.unitPrice) &&
          line.unitPrice > 0 &&
          Number.isFinite(line.discountPct ?? 0) &&
          (line.discountPct ?? 0) >= 0 &&
          (line.discountPct ?? 0) <= 100 &&
          Number.isFinite(line.taxRate ?? 0) &&
          (line.taxRate ?? 0) >= 0 &&
          (line.taxRate ?? 0) <= 100,
      ),
    'sales.positive_value',
  );

/** A quotation past its validity date cannot be used as the price evidence for a new order. */
export const checkQuotationValidity = (validUntil: string, today: string): SalesCheck =>
  verdict('quotationValidity', validUntil.length >= 10 && validUntil >= today, 'sales.quotation_expired');

/** A contract needs an approved quotation version; a newer quotation never rewrites it. */
export const checkApprovedVersion = (versionStatus: string | null): SalesCheck =>
  verdict('approvedVersion', versionStatus === 'approved', 'sales.version_not_approved');

/** Neither a quotation nor a contract means the price has no source: approval, never zero. */
export const checkSalesReference = (
  quotationId: string | null,
  contractId: string | null,
): SalesCheck =>
  verdict(
    'salesReference',
    Boolean(quotationId?.trim() || contractId?.trim()),
    'sales.reference_missing',
  );

/** Ordering more than the contract's contracted quantity needs level-4 approval. */
export const checkContractLimit = (committed: number, limit: number): SalesCheck => {
  if (!Number.isFinite(limit) || limit <= 0) return verdict('contractLimit', true, 'rule.passed');
  return verdict('contractLimit', committed <= limit + 1e-9, 'sales.contract_limit');
};

/** A ticket cannot exist without both the trip and the truck that carried the load. */
export const checkTicketReferences = (
  tripId: string | null,
  truckId: string | null,
): SalesCheck =>
  verdict(
    'ticketReferences',
    Boolean(tripId?.trim()) && Boolean(truckId?.trim()),
    'sales.ticket_references',
  );

/** More delivered than loaded is evidence, not an automatic correction. */
export const checkVolumeVariance = (loaded: number, delivered: number): SalesCheck =>
  verdict('volumeVariance', delivered <= loaded + 1e-9, 'sales.volume_variance');

/** The linked batches must cover the loaded volume when batch links are recorded. */
export const checkBatchCoverage = (batchVolumes: number[], loaded: number): SalesCheck => {
  if (batchVolumes.length === 0) return verdict('batchCoverage', true, 'rule.passed');
  const total = batchVolumes.reduce((sum, volume) => sum + (Number.isFinite(volume) ? volume : 0), 0);
  return verdict('batchCoverage', total + 1e-9 >= loaded, 'sales.batch_coverage');
};

/** A blacklisted customer is a hard block at every level. */
export const checkBlacklist = (blacklisted: boolean): SalesCheck =>
  verdict('customerBlacklist', !blacklisted, 'sales.customer_blacklisted');

export type CreditBand = 'pass' | 'warn' | 'approval_required';

export interface CreditDecision {
  band: CreditBand;
  ratio: number | null;
  exposure: number;
  limit: number | null;
  check: SalesCheck;
}

/**
 * Fixed by the execution specification: above 100% of the effective limit is a warning, above
 * 110% is approval_required. No limit configured is not a zero limit: the decision carries no
 * ratio instead of inventing a ceiling.
 */
export const creditDecision = (
  exposure: number,
  limit: number | null,
): CreditDecision => {
  if (limit === null || !Number.isFinite(limit) || limit <= 0) {
    return {
      band: 'pass',
      ratio: null,
      exposure,
      limit,
      check: verdict('creditExposure', true, 'sales.credit_no_limit'),
    };
  }
  const ratio = (exposure / limit) * 100;
  if (ratio > 110) {
    return {
      band: 'approval_required',
      ratio,
      exposure,
      limit,
      check: verdict('creditExposure', false, 'sales.credit_approval', 'approval_required'),
    };
  }
  if (ratio > 100) {
    return {
      band: 'warn',
      ratio,
      exposure,
      limit,
      check: verdict('creditExposure', false, 'sales.credit_warn', 'warning'),
    };
  }
  return {
    band: 'pass',
    ratio,
    exposure,
    limit,
    check: verdict('creditExposure', true, 'rule.passed'),
  };
};

/** No price, or two different prices for the same line, is approval_required — never zero. */
export const checkPriceResolution = (prices: number[]): SalesCheck =>
  verdict(
    'priceResolution',
    prices.length > 0 && prices.every((price) => Number.isFinite(price) && price > 0),
    'sales.price_missing',
  );

/**
 * Discount thresholds come from the catalogue. A discount on an unconfigured threshold cannot
 * pass: the rule engine returns approval_required, and a discount above a configured maximum is
 * a mandatory failure.
 */
export const checkDiscounts = (
  approvalRule: RuleDefinition | null,
  maxRule: RuleDefinition | null,
  lines: SalesLine[],
): SalesCheck => {
  const highest = lines.reduce((max, line) => Math.max(max, line.discountPct || 0), 0);
  if (highest <= 0) return verdict('discount', true, 'rule.passed');

  if (maxRule && isRuleConfigured(maxRule) && highest > (maxRule.value ?? 0)) {
    return verdict('discount', false, 'sales.discount_above_max', 'mandatory_failure');
  }

  for (const line of lines) {
    if (line.discountPct <= 0) continue;
    const evaluation = evaluateRule(approvalRule ?? missingSalesRule('discountApproval'), {
      actual: line.discountPct,
      comparator: 'lte',
    });
    if (evaluation.outcome !== 'pass') return fromEvaluation('discount', evaluation);
  }
  return verdict('discount', true, 'rule.passed');
};

export const lineTotal = (line: SalesLine): number => {
  const gross = line.quantity * line.unitPrice;
  const net = gross - (gross * line.discountPct) / 100;
  return Math.round((net + (net * line.taxRate) / 100) * 100) / 100;
};

export const sumLines = (lines: SalesLine[]): number =>
  Math.round(lines.reduce((sum, line) => sum + lineTotal(line), 0) * 100) / 100;

export interface SalesVersionSnapshot {
  status: string;
  total: number;
  validUntil?: string;
  customerId?: string;
  quotationId?: string;
  quotationVersionId?: string;
  lines: Array<SalesLine & { materialId: string | null; description: string }>;
  capturedAt: string;
}

export const buildQuotationSnapshot = (payload: {
  quotationId: string;
  customerId: string;
  validUntil: string;
  status: string;
  lines: Array<SalesLine & { materialId: string | null; description: string }>;
  capturedAt: string;
}): SalesVersionSnapshot => ({
  status: payload.status,
  total: sumLines(payload.lines),
  validUntil: payload.validUntil,
  customerId: payload.customerId,
  quotationId: payload.quotationId,
  lines: payload.lines,
  capturedAt: payload.capturedAt,
});

export const buildContractSnapshot = (payload: {
  contractId: string;
  customerId: string;
  quotationVersionId: string;
  startDate: string | null;
  endDate: string | null;
  terms: string;
  status: string;
  capturedAt: string;
}): SalesVersionSnapshot => ({
  status: payload.status,
  total: 0,
  customerId: payload.customerId,
  quotationVersionId: payload.quotationVersionId,
  lines: [],
  capturedAt: payload.capturedAt,
});

/**
 * Delivery progress is the sum of confirmed and delivered ticket volumes. A draft ticket is not
 * evidence of a delivery, and a voided ticket never counts.
 */
export const deliveredVolume = (
  tickets: Array<{ status: string; deliveredVol: number }>,
): number =>
  tickets
    .filter((ticket) => ticket.status === 'confirmed' || ticket.status === 'delivered')
    .reduce((sum, ticket) => sum + (Number.isFinite(ticket.deliveredVol) ? ticket.deliveredVol : 0), 0);

export const isPartiallyDelivered = (ordered: number, delivered: number): boolean =>
  delivered > 0 && delivered + 1e-9 < ordered;

export const isFullyDelivered = (ordered: number, delivered: number): boolean =>
  ordered > 0 && delivered + 1e-9 >= ordered;
