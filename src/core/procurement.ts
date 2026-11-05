/**
 * M9 — procurement, supplier standing and payables. Pure functions: no database, no IO, no clock.
 *
 * Three-way matching compares the purchase order, the confirmed goods receipt and the supplier
 * invoice. The quantity and price tolerances are R1 values with no default: an unconfigured
 * tolerance is approval_required, never a silent match. Invoice arithmetic, duplicate invoice
 * numbers, payment without an approved invoice and overpayment are mandatory failures.
 *
 * A supplier is grade D when any evaluation score is below the configured D threshold or a
 * mandatory document is expired/rejected. Grade D suspends the supplier; a suspended supplier
 * cannot receive a new purchase order.
 */
import { evaluateRule, type RuleDefinition, type RuleOutcome } from './rules';

export const SUPPLIER_EVALUATION_STATUSES = ['draft', 'published', 'superseded'] as const;
export const SUPPLIER_DOCUMENT_STATUSES = ['pending', 'verified', 'expired', 'rejected'] as const;
export const SUPPLIER_CONTRACT_STATUSES = ['draft', 'signed', 'active', 'expired', 'void'] as const;
export const PURCHASE_INVOICE_STATUSES = [
  'received',
  'verified',
  'approved',
  'paid',
  'disputed',
  'voided',
] as const;
export const PAYMENT_VOUCHER_STATUSES = ['draft', 'approved', 'paid', 'cancelled'] as const;

export type SupplierEvaluationStatus = (typeof SUPPLIER_EVALUATION_STATUSES)[number];
export type SupplierDocumentStatus = (typeof SUPPLIER_DOCUMENT_STATUSES)[number];
export type SupplierContractStatus = (typeof SUPPLIER_CONTRACT_STATUSES)[number];
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number];
export type PaymentVoucherStatus = (typeof PAYMENT_VOUCHER_STATUSES)[number];
export type SupplierGrade = 'A' | 'B' | 'C' | 'D';
export type DocumentType = 'registration' | 'insurance' | 'licence' | 'quality_certificate';

export const PROCUREMENT_LEVELS = {
  read: 1,
  record: 3,
  approve: 4,
  control: 5,
} as const;

const EVALUATION_TRANSITIONS: Record<SupplierEvaluationStatus, SupplierEvaluationStatus[]> = {
  draft: ['published'],
  published: ['superseded'],
  superseded: [],
};

const DOCUMENT_TRANSITIONS: Record<SupplierDocumentStatus, SupplierDocumentStatus[]> = {
  pending: ['verified', 'rejected'],
  verified: ['expired', 'rejected'],
  expired: [],
  rejected: [],
};

const CONTRACT_TRANSITIONS: Record<SupplierContractStatus, SupplierContractStatus[]> = {
  draft: ['signed', 'void'],
  signed: ['active', 'void'],
  active: ['expired', 'void'],
  expired: [],
  void: [],
};

const INVOICE_TRANSITIONS: Record<PurchaseInvoiceStatus, PurchaseInvoiceStatus[]> = {
  received: ['verified', 'disputed', 'voided'],
  verified: ['approved', 'disputed', 'voided'],
  approved: ['paid', 'disputed', 'voided'],
  paid: [],
  disputed: ['approved', 'voided'],
  voided: [],
};

const VOUCHER_TRANSITIONS: Record<PaymentVoucherStatus, PaymentVoucherStatus[]> = {
  draft: ['approved', 'cancelled'],
  approved: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

export const canSupplierEvaluationTransition = (
  from: SupplierEvaluationStatus,
  to: SupplierEvaluationStatus,
): boolean => EVALUATION_TRANSITIONS[from].includes(to);
export const canSupplierDocumentTransition = (
  from: SupplierDocumentStatus,
  to: SupplierDocumentStatus,
): boolean => DOCUMENT_TRANSITIONS[from].includes(to);
export const canSupplierContractTransition = (
  from: SupplierContractStatus,
  to: SupplierContractStatus,
): boolean => CONTRACT_TRANSITIONS[from].includes(to);
export const canPurchaseInvoiceTransition = (
  from: PurchaseInvoiceStatus,
  to: PurchaseInvoiceStatus,
): boolean => INVOICE_TRANSITIONS[from].includes(to);
export const canPaymentVoucherTransition = (
  from: PaymentVoucherStatus,
  to: PaymentVoucherStatus,
): boolean => VOUCHER_TRANSITIONS[from].includes(to);

export type ProcurementCheckKey =
  | 'invoiceArithmetic'
  | 'invoiceDuplicate'
  | 'threeWayMatch'
  | 'paymentInvoice'
  | 'paymentOutstanding'
  | 'supplierStanding'
  | 'supplierDocuments'
  | 'evaluationScores'
  | 'chequeTiming';

export interface ProcurementCheck {
  key: ProcurementCheckKey;
  classification: 'mandatory_failure' | 'approval_required' | 'warning';
  outcome: RuleOutcome;
  reasonKey: string;
}

const check = (
  key: ProcurementCheckKey,
  ok: boolean,
  reasonKey: string,
  classification: ProcurementCheck['classification'] = 'mandatory_failure',
  extraOutcome?: RuleOutcome,
): ProcurementCheck => ({
  key,
  classification,
  outcome: ok
    ? 'pass'
    : extraOutcome ??
      (classification === 'mandatory_failure'
        ? 'failure'
        : classification === 'approval_required'
          ? 'approval_required'
          : 'warning'),
  reasonKey: ok ? 'rule.passed' : reasonKey,
});

// ------------------------------------------------------------------ lifecycles
export interface Scores {
  quality: number;
  delivery: number;
  price: number;
  responsiveness: number;
}

export const SCORE_KEYS = ['quality', 'delivery', 'price', 'responsiveness'] as const;

export const checkEvaluationScores = (scores: Scores): ProcurementCheck => {
  const invalid = SCORE_KEYS.filter((key) => {
    const value = scores[key];
    return !Number.isFinite(value) || value < 0 || value > 100;
  });
  return check(
    'evaluationScores',
    invalid.length === 0,
    'procurement.evaluation_score_range',
    'mandatory_failure',
  );
};

const averageScore = (scores: Scores): number =>
  (scores.quality + scores.delivery + scores.price + scores.responsiveness) / 4;

/**
 * Deterministic grade. Any score below the threshold, or an invalid mandatory document,
 * forces D. Otherwise the average sets A (>=90), B (>=80), C (>=70) and D below 70.
 */
export const evaluationGrade = (
  scores: Scores,
  threshold: number,
  mandatoryDocumentsValid: boolean,
): { outcome: RuleOutcome; grade: SupplierGrade | null; average: number; failing: string[] } => {
  const range = checkEvaluationScores(scores);
  if (range.outcome !== 'pass') {
    return { outcome: 'failure', grade: null, average: 0, failing: ['range'] };
  }
  if (!Number.isFinite(threshold)) {
    return { outcome: 'approval_required', grade: null, average: averageScore(scores), failing: ['threshold'] };
  }
  const failing = SCORE_KEYS.filter((key) => scores[key] < threshold);
  const average = Math.round(averageScore(scores) * 100) / 100;
  if (failing.length > 0 || !mandatoryDocumentsValid) {
    return {
      outcome: 'pass',
      grade: 'D',
      average,
      failing: [...failing, ...(mandatoryDocumentsValid ? [] : ['documents'])],
    };
  }
  const grade: SupplierGrade = average >= 90 ? 'A' : average >= 80 ? 'B' : average >= 70 ? 'C' : 'D';
  return { outcome: 'pass', grade, average, failing: [] };
};

export const gradeIsSuspension = (grade: SupplierGrade | null): boolean => grade === 'D';

// ------------------------------------------------------------- supplier documents
export interface DocumentStanding {
  docType: DocumentType | string;
  status: SupplierDocumentStatus | string;
  validUntil: string | null;
}

/** Verified documents are valid through their last day; an expired status is always invalid. */
export const documentIsValid = (document: DocumentStanding, asOf: string): boolean => {
  if (document.status === 'rejected' || document.status === 'expired') return false;
  if (document.status !== 'verified') return false;
  return document.validUntil === null || document.validUntil >= asOf;
};

/**
 * A confirmed PO may proceed only when every mandatory document is valid. Missing document
 * rows are not invented; an existing expired or rejected row blocks with approval_required.
 */
export const checkSupplierDocuments = (
  documents: DocumentStanding[],
  asOf: string,
): ProcurementCheck => {
  const invalid = documents.filter((document) => !documentIsValid(document, asOf));
  return check(
    'supplierDocuments',
    invalid.length === 0,
    'procurement.supplier_document_invalid',
    'approval_required',
  );
};

export const checkSupplierStanding = (
  supplierStatus: string,
  grade: SupplierGrade | string | null,
): ProcurementCheck =>
  check(
    'supplierStanding',
    supplierStatus !== 'suspended' && grade !== 'D',
    'procurement.supplier_suspended',
    'mandatory_failure',
  );

// ---------------------------------------------------------------- three-way match
export const MATCH_RULE_CODES = {
  quantity: 'procurement.match_qty_tolerance_pct',
  price: 'procurement.match_price_tolerance_pct',
} as const;

export const missingMatchRule = (kind: keyof typeof MATCH_RULE_CODES): RuleDefinition => ({
  code: MATCH_RULE_CODES[kind],
  module: 'procurement',
  classification: 'approval_required',
  value: null,
  unit: '%',
  sourceNote: '',
  status: 'active',
});

export interface MatchLine {
  materialId: string;
  quantity: number;
  unitPrice: number;
}

export interface MatchInput {
  poId: string | null;
  poLines: MatchLine[];
  receiptLines: MatchLine[];
  invoiceLines: MatchLine[];
  qtyRule: RuleDefinition | null;
  priceRule: RuleDefinition | null;
}

export interface MatchResult {
  outcome: RuleOutcome;
  status: 'matched' | 'approval_required';
  checks: ProcurementCheck[];
  details: {
    poId: string | null;
    lines: Array<{
      materialId: string;
      ordered: number;
      received: number;
      invoiced: number;
      poPrice: number | null;
      invoicePrice: number;
      qtyVariancePct: number | null;
      priceVariancePct: number | null;
    }>;
    reasons: string[];
  };
}

const sumByMaterial = (lines: MatchLine[]): Map<string, { quantity: number; unitPrice: number }> => {
  const map = new Map<string, { quantity: number; unitPrice: number }>();
  for (const line of lines) {
    const current = map.get(line.materialId);
    map.set(line.materialId, {
      quantity: (current?.quantity ?? 0) + line.quantity,
      unitPrice: line.unitPrice,
    });
  }
  return map;
};

const pctOver = (actual: number, base: number): number => {
  if (base <= 0) return actual > 0 ? 100 : 0;
  return ((actual - base) / base) * 100;
};

/**
 * A three-way match needs the PO, a confirmed receipt and the invoice. Every line is compared
 * by material; the tolerance rules decide over-quantity and over-price. An unconfigured or
 * missing tolerance is approval_required.
 */
export const threeWayMatch = (input: MatchInput): MatchResult => {
  const checks: ProcurementCheck[] = [];
  const reasons: string[] = [];
  const details: MatchResult['details'] = { poId: input.poId, lines: [], reasons };

  if (!input.poId) {
    checks.push(check('threeWayMatch', false, 'procurement.no_matching_po', 'approval_required'));
  }
  if (input.poLines.length === 0) {
    checks.push(check('threeWayMatch', false, 'procurement.po_missing_lines', 'approval_required'));
  }
  if (input.receiptLines.length === 0) {
    checks.push(check('threeWayMatch', false, 'procurement.receipt_missing', 'approval_required'));
  }
  if (input.invoiceLines.length === 0) {
    checks.push(check('threeWayMatch', false, 'procurement.invoice_missing_lines', 'mandatory_failure'));
  }

  const ordered = sumByMaterial(input.poLines);
  const received = sumByMaterial(input.receiptLines);
  const invoiced = sumByMaterial(input.invoiceLines);

  for (const [materialId, invoice] of invoiced) {
    const po = ordered.get(materialId);
    const receipt = received.get(materialId);
    const receivedQty = receipt?.quantity ?? 0;
    const poPrice = po?.unitPrice ?? null;
    const qtyVariancePct = receivedQty > 0 ? pctOver(invoice.quantity, receivedQty) : null;
    const priceVariancePct =
      poPrice !== null && poPrice > 0 ? pctOver(invoice.unitPrice, poPrice) : null;

    details.lines.push({
      materialId,
      ordered: po?.quantity ?? 0,
      received: receivedQty,
      invoiced: invoice.quantity,
      poPrice,
      invoicePrice: invoice.unitPrice,
      qtyVariancePct,
      priceVariancePct,
    });

    if (!po) {
      checks.push(check('threeWayMatch', false, 'procurement.invoice_material_not_on_po', 'approval_required'));
      reasons.push(`material ${materialId} is not on the PO`);
      continue;
    }
    if (receivedQty <= 0) {
      checks.push(check('threeWayMatch', false, 'procurement.receipt_missing', 'approval_required'));
      reasons.push(`material ${materialId} has no confirmed receipt`);
      continue;
    }

    const qtyEvaluation = evaluateRule(input.qtyRule ?? missingMatchRule('quantity'), {
      actual: Math.max(0, qtyVariancePct ?? 0),
      comparator: 'lte',
    });
    if (qtyEvaluation.outcome !== 'pass') {
      checks.push({
        key: 'threeWayMatch',
        classification: 'approval_required',
        outcome: qtyEvaluation.outcome === 'failure' ? 'failure' : 'approval_required',
        reasonKey: qtyEvaluation.reasonKey,
      });
      reasons.push(`quantity variance ${qtyVariancePct?.toFixed(2)}% for ${materialId}`);
    }

    const priceEvaluation = evaluateRule(input.priceRule ?? missingMatchRule('price'), {
      actual: Math.max(0, priceVariancePct ?? 0),
      comparator: 'lte',
    });
    if (priceEvaluation.outcome !== 'pass') {
      checks.push({
        key: 'threeWayMatch',
        classification: 'approval_required',
        outcome:
          priceEvaluation.outcome === 'failure' ? 'failure' : 'approval_required',
        reasonKey: priceEvaluation.reasonKey,
      });
      reasons.push(`price variance ${priceVariancePct?.toFixed(2)}% for ${materialId}`);
    }
  }

  if (checks.length === 0) {
    checks.push(check('threeWayMatch', true, 'rule.passed'));
  }
  const failure = checks.some((row) => row.outcome === 'failure');
  const approval = checks.some((row) => row.outcome === 'approval_required');
  const outcome: RuleOutcome = failure ? 'failure' : approval ? 'approval_required' : 'pass';
  const status = outcome === 'pass' ? 'matched' : 'approval_required';
  return { outcome, status, checks, details };
};

// --------------------------------------------------------------- invoice arithmetic
export interface InvoiceLineAmount {
  quantity: number;
  unitPrice: number;
  total: number;
}

const cents = (value: number): number => Math.round(value * 100) / 100;

export const checkInvoiceArithmetic = (
  subtotal: number,
  tax: number,
  total: number,
  lines: InvoiceLineAmount[],
): ProcurementCheck => {
  const lineSum = cents(lines.reduce((sum, line) => sum + line.total, 0));
  const expectedTotal = cents(subtotal + tax);
  const lineMathOk = lines.every(
    (line) => Math.abs(cents(line.quantity * line.unitPrice) - cents(line.total)) <= 0.01,
  );
  const ok =
    lines.length > 0 &&
    Math.abs(lineSum - cents(subtotal)) <= 0.01 &&
    Math.abs(expectedTotal - cents(total)) <= 0.01 &&
    lineMathOk;
  return check('invoiceArithmetic', ok, 'procurement.invoice_arithmetic', 'mandatory_failure');
};

export const checkDuplicateInvoice = (duplicate: boolean): ProcurementCheck =>
  check('invoiceDuplicate', !duplicate, 'procurement.duplicate_invoice', 'mandatory_failure');

// --------------------------------------------------------------------- payments
export interface PaymentInput {
  paymentType: 'supplier_payment' | 'customer_receipt' | 'expense';
  amount: number;
  invoiceStatus: PurchaseInvoiceStatus | null;
  invoiceTotal: number;
  invoicePaid: number;
}

export const checkPayment = (input: PaymentInput): ProcurementCheck[] => {
  if (input.paymentType !== 'supplier_payment') {
    return [check('paymentInvoice', true, 'rule.passed')];
  }
  const outstanding = Math.max(0, cents(input.invoiceTotal - input.invoicePaid));
  const approved =
    input.invoiceStatus === 'approved' ||
    (input.invoiceStatus === 'paid' && outstanding > 0);
  return [
    check('paymentInvoice', approved, 'procurement.payment_invoice_not_approved', 'mandatory_failure'),
    check(
      'paymentOutstanding',
      outstanding > 0 && input.amount <= outstanding + 0.005,
      'procurement.payment_exceeds_outstanding',
      'mandatory_failure',
    ),
  ];
};

export const chequeEarlyWarning = (
  method: string,
  paidAt: string | null,
  dueDate: string | null,
): ProcurementCheck => {
  const early =
    method === 'cheque' &&
    paidAt !== null &&
    dueDate !== null &&
    paidAt.slice(0, 10) < dueDate;
  return check('chequeTiming', !early, 'procurement.cheque_early', 'warning');
};

// ------------------------------------------------------------------- AP aging
export interface AgingInvoice {
  supplierId: string;
  dueDate: string | null;
  invoiceDate: string;
  total: number;
  paid: number;
}

export interface AgingBuckets {
  supplierId: string;
  bucket0To30: number;
  bucket31To60: number;
  bucket61To90: number;
  bucket90Plus: number;
  totalDue: number;
}

const daysBetween = (from: string, to: string): number =>
  Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const apAging = (invoices: AgingInvoice[], asOf: string): AgingBuckets[] => {
  const map = new Map<string, AgingBuckets>();
  for (const invoice of invoices) {
    const outstanding = cents(invoice.total - invoice.paid);
    if (outstanding <= 0) continue;
    const row =
      map.get(invoice.supplierId) ??
      {
        supplierId: invoice.supplierId,
        bucket0To30: 0,
        bucket31To60: 0,
        bucket61To90: 0,
        bucket90Plus: 0,
        totalDue: 0,
      };
    const age = Math.max(0, daysBetween(invoice.dueDate ?? invoice.invoiceDate, asOf));
    if (age <= 30) row.bucket0To30 = cents(row.bucket0To30 + outstanding);
    else if (age <= 60) row.bucket31To60 = cents(row.bucket31To60 + outstanding);
    else if (age <= 90) row.bucket61To90 = cents(row.bucket61To90 + outstanding);
    else row.bucket90Plus = cents(row.bucket90Plus + outstanding);
    row.totalDue = cents(row.totalDue + outstanding);
    map.set(invoice.supplierId, row);
  }
  return [...map.values()].sort((a, b) => b.totalDue - a.totalDue);
};
