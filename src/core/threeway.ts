/** Purchase order → goods receipt → supplier bill matching (M1 procurement). */
import { add, compare, dec, decToNumber, decToString, isNegative, sub, type Dec } from './decimal';

export interface PurchaseOrderLine {
  lineNo: number;
  quantity: string | number;
  unitPrice: string | number;
}

export interface ReceiptLine {
  lineNo: number;
  quantity: string | number;
}

export interface BillLine {
  lineNo: number;
  quantity: string | number;
  unitPrice: string | number;
}

export type MatchStatus =
  | 'matched'
  | 'quantity_variance'
  | 'price_variance'
  | 'amount_variance'
  | 'over_receipt'
  | 'over_billing'
  | 'exception';

export interface LineMatch {
  lineNo: number;
  orderedQty: number;
  receivedQty: number;
  billedQty: number;
  orderedPrice: number;
  billedPrice: number;
  orderedValue: number;
  billedValue: number;
  overReceiptQty: number;
  overBilledQty: number;
  priceVariance: number;
  status: MatchStatus;
}

export interface ThreeWayMatchResult {
  status: MatchStatus;
  requiresApproval: boolean;
  lines: LineMatch[];
  overReceiptQty: number;
  overBilledQty: number;
  priceVariance: number;
  amountVariance: number;
  reasons: MatchStatus[];
}

export interface ThreeWayInput {
  orderLines: readonly PurchaseOrderLine[];
  receiptLines: readonly ReceiptLine[];
  billLines: readonly BillLine[];
  /** Absolute tolerance for price comparisons, default 0.01 EGP. */
  tolerance?: string | number;
}

const qty = (value: string | number): Dec => dec(value, 3);
const money = (value: string | number): Dec => dec(value, 2);

/**
 * Deterministic three-way match.
 *   - billing more than received is over-billing
 *   - receiving more than ordered is over-receipt
 *   - a different unit price than ordered is a price variance requiring approval
 */
export const matchThreeWay = (input: ThreeWayInput): ThreeWayMatchResult => {
  const tolerance = money(input.tolerance ?? '0.01');
  const receiptByLine = new Map<number, Dec>();
  for (const line of input.receiptLines) {
    receiptByLine.set(line.lineNo, add(receiptByLine.get(line.lineNo) ?? dec(0, 3), qty(line.quantity)));
  }

  const lines: LineMatch[] = [];
  const reasons = new Set<MatchStatus>();

  for (const billLine of input.billLines) {
    const orderLine = input.orderLines.find((order) => order.lineNo === billLine.lineNo);
    if (!orderLine) {
      reasons.add('exception');
      continue;
    }

    const orderedQty = qty(orderLine.quantity);
    const receivedQty = receiptByLine.get(orderLine.lineNo) ?? dec(0, 3);
    const billedQty = qty(billLine.quantity);
    const orderedPrice = money(orderLine.unitPrice);
    const billedPrice = money(billLine.unitPrice);

    const overReceipt = sub(receivedQty, orderedQty);
    const overBilled = sub(billedQty, receivedQty);
    const orderedValue = money(decToNumber(qty(orderLine.quantity)) * decToNumber(orderedPrice));
    const billedValue = money(decToNumber(qty(billLine.quantity)) * decToNumber(billedPrice));
    const priceVariance = money(decToNumber(sub(billedValue, orderedValue)));

    let status: MatchStatus = 'matched';
    if (compare(overReceipt, dec(0, 3)) > 0) status = 'over_receipt';
    else if (compare(overBilled, dec(0, 3)) > 0) status = 'over_billing';
    else if (compare(abs(priceVariance), tolerance) > 0) status = 'price_variance';
    else if (compare(overReceipt, dec(0, 3)) < 0) status = 'amount_variance';

    if (status !== 'matched') reasons.add(status);

    lines.push({
      lineNo: orderLine.lineNo,
      orderedQty: decToNumber(orderedQty),
      receivedQty: decToNumber(receivedQty),
      billedQty: decToNumber(billedQty),
      orderedPrice: decToNumber(orderedPrice),
      billedPrice: decToNumber(billedPrice),
      orderedValue: decToNumber(orderedValue),
      billedValue: decToNumber(billedValue),
      overReceiptQty: compare(overReceipt, dec(0, 3)) > 0 ? decToNumber(overReceipt) : 0,
      overBilledQty: compare(overBilled, dec(0, 3)) > 0 ? decToNumber(overBilled) : 0,
      priceVariance: decToNumber(priceVariance),
      status,
    });
  }

  const sum = (pick: (line: LineMatch) => number): number => Number(lines.reduce((total, line) => total + pick(line), 0).toFixed(2));

  const overReceiptQty = sum((line) => line.overReceiptQty);
  const overBilledQty = sum((line) => line.overBilledQty);
  const priceVariance = sum((line) => line.priceVariance);
  const amountVariance = sum((line) => line.billedValue - line.orderedValue);

  const orderedValue = input.orderLines.reduce(
    (total, line) => total + decToNumber(qty(line.quantity)) * decToNumber(money(line.unitPrice)),
    0,
  );
  const billedValue = input.billLines.reduce(
    (total, line) => total + decToNumber(qty(line.quantity)) * decToNumber(money(line.unitPrice)),
    0,
  );
  const toleranceValue = decToNumber(tolerance);

  let status: MatchStatus = 'matched';
  if (overReceiptQty > 0) status = 'over_receipt';
  else if (overBilledQty > 0) status = 'over_billing';
  else if (Math.abs(priceVariance) > toleranceValue) status = 'price_variance';
  else if (Math.abs(billedValue - orderedValue) > toleranceValue) status = 'amount_variance';

  const requiresApproval = status !== 'matched';
  void isNegative;

  return {
    status,
    requiresApproval,
    lines,
    overReceiptQty,
    overBilledQty,
    priceVariance,
    amountVariance: Number(amountVariance.toFixed(2)),
    reasons: [...reasons],
  };
};

const abs = (value: Dec): Dec => (value.units < 0n ? { units: -value.units, scale: value.scale } : value);

/** Human-readable summary used in the API and audit trail. */
export const describeMatch = (result: ThreeWayMatchResult): string => {
  if (result.status === 'matched') return 'matched';
  const parts: string[] = [result.status];
  if (result.overReceiptQty > 0) parts.push(`over_receipt=${decToString(dec(result.overReceiptQty, 3), 3)}`);
  if (result.overBilledQty > 0) parts.push(`over_billed=${decToString(dec(result.overBilledQty, 3), 3)}`);
  if (result.priceVariance !== 0) parts.push(`price_variance=${decToString(dec(result.priceVariance, 2), 2)}`);
  return parts.join(' ');
};
