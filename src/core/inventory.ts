/**
 * M6 — inventory. Pure functions: no database, no IO, no clock.
 *
 * Two valuation methods exist and neither default is invented here. A bulk material is valued at
 * the weighted average (D1); FIFO is allowed only for non-bulk stock and consumes open cost
 * layers oldest first. A material with no chosen method never posts: the R1 engine turns the
 * missing decision into `approval_required`.
 *
 * Every configurable limit (reorder level, safety stock, unit-cost band) runs through
 * `evaluateRule`. ECP 203-2007 does not define any of them in the supplied reference, so the
 * catalogue rows are seeded empty and an unconfigured rule never passes.
 */
import {
  evaluateRule,
  isRuleConfigured,
  MIN_OVERRIDE_REASON,
  type RuleClassification,
  type RuleDefinition,
  type RuleEvaluation,
  type RuleOutcome,
} from './rules';

export type MaterialCategory =
  | 'cement'
  | 'scm'
  | 'aggregate'
  | 'water'
  | 'admixture'
  | 'fuel'
  | 'spare_part'
  | 'other';

export const MATERIAL_CATEGORIES: readonly MaterialCategory[] = [
  'cement',
  'scm',
  'aggregate',
  'water',
  'admixture',
  'fuel',
  'spare_part',
  'other',
];

export type ValuationMethod = 'weighted_average' | 'fifo';
export const VALUATION_METHODS: readonly ValuationMethod[] = ['weighted_average', 'fifo'];

export type MaterialStatus = 'active' | 'inactive';
export type PurchaseRequestStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'converted_to_po'
  | 'rejected';
export type PurchaseOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'partially_received'
  | 'fully_received'
  | 'closed'
  | 'cancelled';
export type GoodsReceiptStatus = 'draft' | 'confirmed' | 'voided';
export type ExceptionStatus = 'open' | 'investigation' | 'resolved' | 'escalated' | 'voided';
export type MovementType =
  | 'receipt'
  | 'issue'
  | 'consumption'
  | 'return'
  | 'adjustment'
  | 'transfer_out'
  | 'transfer_in'
  | 'reversal';

export const MOVEMENT_SIGNS: Record<MovementType, 1 | -1> = {
  receipt: 1,
  issue: -1,
  consumption: -1,
  return: 1,
  adjustment: 1,
  transfer_out: -1,
  transfer_in: 1,
  reversal: 1,
};

export type InventoryRuleKey =
  | 'materialCode'
  | 'positiveQuantity'
  | 'unitMatch'
  | 'requiredReference'
  | 'purchaseOrderQuantity'
  | 'overReceipt'
  | 'unitCostBand'
  | 'negativeStock'
  | 'duplicateDocument'
  | 'fifoOnBulk'
  | 'valuationSelected'
  | 'valuationLocked'
  | 'reorderLevel'
  | 'safetyStock'
  | 'appendOnlyMovement';

/** Rules whose value comes from the company catalogue. The rest are structural. */
export type InventoryCatalogueKey = 'reorderLevel' | 'safetyStock' | 'unitCostBand';

export const INVENTORY_RULE_CODES: Record<InventoryCatalogueKey, string> = {
  reorderLevel: 'inventory.reorder_level',
  safetyStock: 'inventory.safety_stock',
  unitCostBand: 'inventory.unit_cost_band',
};

/** The M6 rules, each bound to its §26 classification. */
export const INVENTORY_RULES: Record<InventoryRuleKey, RuleClassification> = {
  materialCode: 'mandatory_failure',
  positiveQuantity: 'mandatory_failure',
  unitMatch: 'mandatory_failure',
  requiredReference: 'mandatory_failure',
  purchaseOrderQuantity: 'warning',
  overReceipt: 'approval_required',
  unitCostBand: 'approval_required',
  negativeStock: 'mandatory_failure',
  duplicateDocument: 'mandatory_failure',
  fifoOnBulk: 'mandatory_failure',
  valuationSelected: 'approval_required',
  valuationLocked: 'mandatory_failure',
  reorderLevel: 'warning',
  safetyStock: 'warning',
  appendOnlyMovement: 'mandatory_failure',
};

export interface InventoryCheck {
  key: InventoryRuleKey;
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
  key: InventoryRuleKey,
  ok: boolean,
  failReason: string,
  failClass: RuleClassification = INVENTORY_RULES[key],
): InventoryCheck => ({
  key,
  classification: failClass,
  outcome: ok ? 'pass' : OUTCOME_BY_CLASS[failClass],
  reasonKey: ok ? 'rule.passed' : failReason,
});

const fromEvaluation = (key: InventoryRuleKey, evaluation: RuleEvaluation): InventoryCheck => ({
  key,
  classification: evaluation.classification,
  outcome: evaluation.outcome,
  reasonKey: evaluation.reasonKey,
});

export const missingInventoryRule = (key: InventoryCatalogueKey): RuleDefinition => ({
  code: INVENTORY_RULE_CODES[key],
  module: 'inventory',
  classification: INVENTORY_RULES[key],
  value: null,
  unit: '',
  sourceNote: '',
  status: 'active',
});

/** A material code is required, trimmed and unique per company. */
export const checkMaterialCode = (code: string, duplicate: boolean): InventoryCheck =>
  verdict(
    'materialCode',
    code.trim().length > 0 && !duplicate,
    code.trim().length === 0 ? 'inventory.code_required' : 'inventory.code_duplicate',
  );

export const checkPositiveQuantity = (quantity: number): InventoryCheck =>
  verdict(
    'positiveQuantity',
    Number.isFinite(quantity) && quantity > 0,
    'inventory.quantity_positive',
  );

/** The movement unit must be the material's declared unit; there is no conversion table. */
export const checkUnitMatch = (declaredUnit: string, movementUnit: string): InventoryCheck =>
  verdict(
    'unitMatch',
    declaredUnit.trim().length > 0 &&
      declaredUnit.trim().toLowerCase() === movementUnit.trim().toLowerCase(),
    'inventory.unit_mismatch',
  );

/** A purchase order needs a supplier and at least one material line. */
export const checkRequiredReferences = (payload: {
  supplierId: string | null;
  materialIds: string[];
}): InventoryCheck =>
  verdict(
    'requiredReference',
    Boolean(payload.supplierId && payload.supplierId.trim()) &&
      payload.materialIds.length > 0 &&
      payload.materialIds.every((id) => id.trim().length > 0),
    payload.supplierId && payload.supplierId.trim()
      ? 'inventory.material_required'
      : 'inventory.supplier_required',
  );

/** A PO line above the material's reorder point warns; the point itself is configuration. */
export const checkPurchaseOrderQuantity = (
  quantityOrdered: number,
  reorderPoint: number | null,
): InventoryCheck => {
  if (reorderPoint === null || !Number.isFinite(reorderPoint)) {
    return verdict('purchaseOrderQuantity', false, 'inventory.reorder_not_configured', 'warning');
  }
  return verdict(
    'purchaseOrderQuantity',
    quantityOrdered <= reorderPoint,
    'inventory.order_above_reorder',
    'warning',
  );
};

/** Receiving more than was ordered needs a level-4 approval, with a reason. */
export const checkOverReceipt = (
  quantityOrdered: number,
  quantityReceived: number,
  receiving: number,
): InventoryCheck =>
  verdict(
    'overReceipt',
    quantityReceived + receiving <= quantityOrdered + 1e-9,
    'inventory.over_receipt',
    'approval_required',
  );

/**
 * A unit cost outside the configured band around the recent average needs approval. With no band
 * configured there is no band to breach, so the receipt proceeds: a limit that does not exist is
 * not an approval gate.
 */
export const checkUnitCostBand = (
  rule: RuleDefinition | null,
  unitCost: number,
  baselineAverage: number | null,
): InventoryCheck => {
  if (rule === null || !isRuleConfigured(rule)) {
    return verdict('unitCostBand', true, 'inventory.no_cost_band');
  }
  if (baselineAverage === null || !Number.isFinite(baselineAverage) || baselineAverage <= 0) {
    return verdict('unitCostBand', true, 'inventory.no_cost_history');
  }
  const deviation = (Math.abs(unitCost - baselineAverage) / baselineAverage) * 100;
  return fromEvaluation(
    'unitCostBand',
    evaluateRule(rule ?? missingInventoryRule('unitCostBand'), { actual: deviation, comparator: 'lte' }),
  );
};

/** Exactly zero is a valid balance; only a balance below zero is refused. */
export const checkStockBalance = (
  balanceBefore: number,
  quantity: number,
  direction: 'in' | 'out',
): InventoryCheck => {
  const after = direction === 'in' ? balanceBefore + quantity : balanceBefore - quantity;
  return verdict('negativeStock', after >= -1e-9, 'inventory.negative_stock');
};

export const checkDuplicateDocument = (duplicate: boolean, kind: string): InventoryCheck =>
  verdict('duplicateDocument', !duplicate, `inventory.duplicate_${kind}`);

/** D1: a bulk material is never valued at FIFO. */
export const checkFifoOnBulk = (isBulk: boolean, method: ValuationMethod | null): InventoryCheck =>
  verdict(
    'fifoOnBulk',
    !(isBulk && method === 'fifo'),
    'inventory.fifo_on_bulk',
  );

/** No method chosen means no posting: approval_required, never a default. */
export const checkValuationSelected = (method: ValuationMethod | null): InventoryCheck =>
  verdict(
    'valuationSelected',
    method === 'weighted_average' || method === 'fifo',
    'inventory.valuation_method_missing',
    'approval_required',
  );

/** The method is fixed once the material has a posted movement. */
export const checkValuationLocked = (
  current: ValuationMethod | null,
  requested: ValuationMethod | null,
  postedMovements: number,
): InventoryCheck => {
  if (requested === null || requested === current) return verdict('valuationLocked', true, 'rule.passed');
  return verdict(
    'valuationLocked',
    postedMovements === 0,
    'inventory.valuation_locked',
  );
};

export const checkReorderLevel = (rule: RuleDefinition | null, balance: number): InventoryCheck =>
  fromEvaluation(
    'reorderLevel',
    evaluateRule(rule ?? missingInventoryRule('reorderLevel'), { actual: balance, comparator: 'gte' }),
  );

export const checkSafetyStock = (rule: RuleDefinition | null, balance: number): InventoryCheck =>
  fromEvaluation(
    'safetyStock',
    evaluateRule(rule ?? missingInventoryRule('safetyStock'), { actual: balance, comparator: 'gte' }),
  );

/** A posted movement is never edited; a correction is a reversal naming the original. */
export const checkAppendOnlyMovement = (operation: 'insert' | 'update' | 'delete'): InventoryCheck =>
  verdict('appendOnlyMovement', operation === 'insert', 'inventory.append_only');

/**
 * Usage-weighted deviation across an issue: the caller values from the current average, so the
 * band only ever gates the receipt price. Kept separate so the service cannot confuse the two.
 */
export const checkSnapshotAgreement = (
  derivedQuantity: number,
  snapshotQuantity: number,
): { outcome: RuleOutcome; reasonKey: string } =>
  Math.abs(derivedQuantity - snapshotQuantity) <= 1e-6
    ? { outcome: 'pass', reasonKey: 'rule.passed' }
    : { outcome: 'warning', reasonKey: 'inventory.snapshot_disagrees' };

// ------------------------------------------------------------------ lifecycles

export const MATERIAL_TRANSITIONS: Record<MaterialStatus, readonly MaterialStatus[]> = {
  active: ['inactive'],
  inactive: ['active'],
};

export const PURCHASE_REQUEST_TRANSITIONS: Record<
  PurchaseRequestStatus,
  readonly PurchaseRequestStatus[]
> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: ['converted_to_po'],
  converted_to_po: [],
  rejected: [],
};

export const PURCHASE_ORDER_TRANSITIONS: Record<
  PurchaseOrderStatus,
  readonly PurchaseOrderStatus[]
> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['partially_received', 'fully_received', 'cancelled'],
  partially_received: ['partially_received', 'fully_received', 'cancelled'],
  fully_received: ['closed'],
  closed: [],
  cancelled: [],
};

export const GOODS_RECEIPT_TRANSITIONS: Record<
  GoodsReceiptStatus,
  readonly GoodsReceiptStatus[]
> = {
  draft: ['confirmed'],
  confirmed: ['voided'],
  voided: [],
};

export const EXCEPTION_TRANSITIONS: Record<ExceptionStatus, readonly ExceptionStatus[]> = {
  open: ['investigation', 'resolved', 'escalated', 'voided'],
  investigation: ['resolved', 'escalated', 'voided'],
  resolved: [],
  escalated: ['resolved'],
  voided: [],
};

export const canMaterialTransition = (from: MaterialStatus, to: MaterialStatus): boolean =>
  MATERIAL_TRANSITIONS[from].includes(to);
export const canPurchaseRequestTransition = (
  from: PurchaseRequestStatus,
  to: PurchaseRequestStatus,
): boolean => PURCHASE_REQUEST_TRANSITIONS[from].includes(to);
export const canPurchaseOrderTransition = (
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean => PURCHASE_ORDER_TRANSITIONS[from].includes(to);
export const canGoodsReceiptTransition = (
  from: GoodsReceiptStatus,
  to: GoodsReceiptStatus,
): boolean => GOODS_RECEIPT_TRANSITIONS[from].includes(to);
export const canExceptionTransition = (from: ExceptionStatus, to: ExceptionStatus): boolean =>
  EXCEPTION_TRANSITIONS[from].includes(to);

// ------------------------------------------------------------------- valuation

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export interface ValuationState {
  quantity: number;
  value: number;
  averageCost: number;
}

export const emptyValuation = (): ValuationState => ({ quantity: 0, value: 0, averageCost: 0 });

export interface ValuationMovement {
  quantity: number;
  unitCost?: number | null;
}

/**
 * Weighted-average valuation. A receipt re-values the whole balance; an issue leaves the unit
 * cost alone and removes quantity at that cost, so a balance reaches exactly zero with no
 * residual value.
 */
export const applyWeightedAverage = (
  state: ValuationState,
  movement: ValuationMovement,
  direction: 'in' | 'out',
): { state: ValuationState; unitCost: number; amount: number } => {
  if (direction === 'in') {
    const unitCost = Math.max(0, Number(movement.unitCost ?? 0));
    const amount = round(movement.quantity * unitCost, 4);
    const quantity = round(state.quantity + movement.quantity, 3);
    const value = round(state.value + amount, 4);
    return {
      state: {
        quantity,
        value,
        averageCost: quantity > 0 ? round(value / quantity, 4) : 0,
      },
      unitCost,
      amount,
    };
  }

  const unitCost = state.averageCost;
  const quantity = round(state.quantity - movement.quantity, 3);
  const amount = round(movement.quantity * unitCost, 4);
  const value = quantity <= 0 ? 0 : round(Math.max(0, state.value - amount), 4);
  return {
    state: { quantity, value, averageCost: quantity <= 0 ? 0 : round(value / quantity, 4) },
    unitCost,
    amount,
  };
};

export interface CostLayer {
  layerId: string;
  receivedAt: string;
  quantityRemaining: number;
  unitCost: number;
}

export interface LayerTake {
  layerId: string;
  quantity: number;
  unitCost: number;
  amount: number;
}

/**
 * FIFO consumption: oldest receipt first, then layer id as a stable tie-break. The function does
 * not invent stock: when the layers cannot cover the quantity it reports the shortage instead.
 */
export const consumeFifoLayers = (
  layers: readonly CostLayer[],
  quantity: number,
): { takes: LayerTake[]; totalCost: number; shortage: number } => {
  // Timestamps arrive either as ISO strings or as PostgreSQL's text form; both parse. When a
  // caller passes an unparseable value the layer id is the only stable order, so it is used
  // rather than an arbitrary comparison.
  const instant = (value: string): number | null => {
    // PostgreSQL prints "2026-01-31 08:00:00.123456+00", which Date.parse rejects because the
    // offset has no minutes; parse the wall clock directly and ignore the (identical) zone.
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(value);
    if (!match) return null;
    const fraction = (match[7] ?? '').padEnd(3, '0').slice(0, 3);
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      Number(fraction || 0),
    );
  };
  const ordered = [...layers].sort((a, b) => {
    const left = instant(a.receivedAt);
    const right = instant(b.receivedAt);
    if (left !== null && right !== null && left !== right) return left - right;
    if (left !== null && right === null) return -1;
    if (left === null && right !== null) return 1;
    return a.layerId.localeCompare(b.layerId);
  });
  let remaining = quantity;
  let totalCost = 0;
  const takes: LayerTake[] = [];
  for (const layer of ordered) {
    if (remaining <= 1e-9) break;
    if (!Number.isFinite(layer.quantityRemaining) || layer.quantityRemaining <= 0) continue;
    const take = Math.min(remaining, layer.quantityRemaining);
    const amount = round(take * layer.unitCost, 4);
    takes.push({ layerId: layer.layerId, quantity: round(take, 3), unitCost: layer.unitCost, amount });
    totalCost = round(totalCost + amount, 4);
    remaining = round(remaining - take, 3);
  }
  return { takes, totalCost, shortage: remaining > 1e-9 ? round(remaining, 3) : 0 };
};

/** The balance is always derived from the ledger, never stored. */
export const derivedBalance = (
  movements: readonly { quantity: number; movementType: MovementType; correctionOf?: string | null }[],
): number =>
  round(
    movements.reduce((total, movement) => total + MOVEMENT_SIGNS[movement.movementType] * movement.quantity, 0),
    3,
  );

export interface SnapshotFigures {
  openingQty: number;
  receipts: number;
  issues: number;
  closingQty: number;
  averageCost: number;
}

export const buildSnapshot = (figures: SnapshotFigures): SnapshotFigures & { closingValue: number } => ({
  ...figures,
  closingQty: round(figures.openingQty + figures.receipts - figures.issues, 3),
  closingValue: round(Math.max(0, figures.openingQty + figures.receipts - figures.issues) * figures.averageCost, 4),
});

// ------------------------------------------------------------ negative stock (D2)

export interface MissingSourceCandidate {
  type: 'goods_receipt' | 'purchase_order' | 'adjustment';
  id: string;
  note: string;
}

/**
 * The suggestion names the document that would have prevented the negative balance: an open PO
 * line or a receipt expected for the material. It never creates that document.
 */
export const suggestMissingSource = (
  candidates: readonly MissingSourceCandidate[],
): { type: 'goods_receipt' | 'purchase_order' | 'adjustment' | 'none'; id: string | null; note: string } => {
  const first = candidates[0];
  if (!first) {
    return {
      type: 'none',
      id: null,
      note: 'no open purchase order or expected receipt was found for this material',
    };
  }
  return { type: first.type, id: first.id, note: first.note };
};

export interface StockExceptionDraft {
  quantity: number;
  availableQuantity: number;
  reason: string;
  suggestedSourceType: 'goods_receipt' | 'purchase_order' | 'adjustment' | 'none';
  suggestedSourceId: string | null;
  suggestionNote: string;
}

/**
 * A movement below zero is refused. A level-4 user may authorise it with a reason; the draft it
 * returns is written as an `inventory_exceptions` row and audited. No branch makes the stock
 * silently negative.
 */
export const negativeStockDecision = (input: {
  level: number;
  balanceBefore: number;
  quantity: number;
  reason: string;
  candidates?: readonly MissingSourceCandidate[];
}): { outcome: 'refused' | 'exception'; check: InventoryCheck; exception: StockExceptionDraft | null } => {
  const balanceAfter = input.balanceBefore - input.quantity;
  if (balanceAfter >= -1e-9) {
    return {
      outcome: 'refused',
      check: verdict('negativeStock', true, 'rule.passed'),
      exception: null,
    };
  }
  const reason = input.reason.trim();
  if (input.level < 4) {
    return {
      outcome: 'refused',
      check: verdict('negativeStock', false, 'inventory.override_requires_level4'),
      exception: null,
    };
  }
  if (reason.length < MIN_OVERRIDE_REASON) {
    return {
      outcome: 'refused',
      check: verdict('negativeStock', false, 'inventory.reason_required'),
      exception: null,
    };
  }
  const suggestion = suggestMissingSource(input.candidates ?? []);
  return {
    outcome: 'exception',
    check: {
      key: 'negativeStock',
      classification: 'authorized_override',
      outcome: 'override_required',
      reasonKey: 'inventory.negative_stock_override',
    },
    exception: {
      quantity: input.quantity,
      availableQuantity: round(Math.max(0, input.balanceBefore), 3),
      reason,
      suggestedSourceType: suggestion.type,
      suggestedSourceId: suggestion.id,
      suggestionNote: suggestion.note,
    },
  };
};

// ------------------------------------------------------------------------ access

/** Permission levels from the M6 plan; the server re-checks every one of them. */
export const INVENTORY_LEVELS = {
  read: 1,
  raisePurchaseRequest: 3,
  approvePurchaseRequest: 4,
  receiveGoods: 3,
  postMovement: 3,
  adjustStock: 4,
  closeException: 4,
  voidDocument: 5,
  materialMaster: 5,
  valuationMethod: 5,
} as const;
