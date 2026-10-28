/** Invoice, tax, retention and deposit maths — the numbers the ledger will post. */
import { add, compare, dec, decToNumber, isNegative, percentOf, rescale, sub, sumDec } from './decimal';

export interface InvoiceItemInput {
  descriptionAr?: string;
  descriptionEn?: string;
  quantity: string | number;
  unitPrice: string | number;
}

export interface InvoiceTotalsInput {
  items: readonly InvoiceItemInput[];
  discountAmount?: string | number;
  taxPercent?: string | number;
  retentionPercent?: string | number;
  depositAmount?: string | number;
}

export interface InvoiceLineTotals {
  lineNo: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceTotals {
  lines: InvoiceLineTotals[];
  subtotal: number;
  discountAmount: number;
  netSubtotal: number;
  taxPercent: number;
  taxAmount: number;
  grandTotal: number;
  retentionPercent: number;
  retentionAmount: number;
  depositAmount: number;
  /** Amount the customer owes now: grand total less retention held and deposit applied. */
  receivableAmount: number;
}

export const computeInvoiceTotals = (input: InvoiceTotalsInput): InvoiceTotals => {
  if (input.items.length === 0) throw new Error('invoice_needs_items');

  const lines = input.items.map((item, index) => {
    const quantity = dec(item.quantity, 3);
    const unitPrice = dec(item.unitPrice, 2);
    if (compare(quantity, dec(0, 3)) <= 0) throw new Error(`line_${index + 1}_quantity_invalid`);
    if (isNegative(unitPrice)) throw new Error(`line_${index + 1}_price_invalid`);
    const lineTotal = rescale(
      { units: (quantity.units * unitPrice.units) / 1_000n, scale: 2 },
      2,
    );
    return {
      lineNo: index + 1,
      quantity: decToNumber(quantity),
      unitPrice: decToNumber(unitPrice),
      lineTotal: decToNumber(rescale(lineTotal, 2)),
    };
  });

  const subtotal = sumDec(lines.map((line) => dec(line.lineTotal, 2)), 2);
  const discount = rescale(dec(input.discountAmount ?? 0, 2), 2);
  if (compare(discount, subtotal) > 0) throw new Error('discount_exceeds_subtotal');
  const netSubtotal = sub(subtotal, discount);

  const taxPercent = dec(input.taxPercent ?? 14, 3);
  const tax = percentOf(netSubtotal, taxPercent, 2);

  const retentionPercent = dec(input.retentionPercent ?? 0, 3);
  const retention = percentOf(netSubtotal, retentionPercent, 2);

  const deposit = rescale(dec(input.depositAmount ?? 0, 2), 2);

  const grandTotal = add(netSubtotal, tax);
  const receivable = sub(sub(grandTotal, retention), deposit);
  if (isNegative(receivable)) throw new Error('deposit_and_retention_exceed_total');

  return {
    lines,
    subtotal: decToNumber(subtotal),
    discountAmount: decToNumber(discount),
    netSubtotal: decToNumber(netSubtotal),
    taxPercent: decToNumber(taxPercent),
    taxAmount: decToNumber(tax),
    grandTotal: decToNumber(grandTotal),
    retentionPercent: decToNumber(retentionPercent),
    retentionAmount: decToNumber(retention),
    depositAmount: decToNumber(deposit),
    receivableAmount: decToNumber(receivable),
  };
};

export interface InvoiceAgingInput {
  invoiceId: string;
  invoiceNo: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  grandTotal: string | number;
  paidAmount: string | number;
  retentionHeld?: string | number;
  status: string;
}

export type AgingBucket = 'current' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'days_over_90';

export interface AgingRow {
  invoiceId: string;
  invoiceNo: string;
  customerId: string;
  dueDate: string;
  daysOverdue: number;
  bucket: AgingBucket;
  outstanding: number;
}

export interface AgingSummary {
  asOf: string;
  rows: AgingRow[];
  buckets: Record<AgingBucket, number>;
  totalOutstanding: number;
}

export const bucketFor = (daysOverdue: number): AgingBucket => {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days_1_30';
  if (daysOverdue <= 60) return 'days_31_60';
  if (daysOverdue <= 90) return 'days_61_90';
  return 'days_over_90';
};

const dayDiff = (from: string, to: string): number => {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
};

/** Aging is derived from source invoices; it is never a stored running total. */
export const agingReport = (invoices: readonly InvoiceAgingInput[], asOf: string): AgingSummary => {
  const rows: AgingRow[] = [];
  const buckets: Record<AgingBucket, number> = {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_over_90: 0,
  };

  for (const invoice of invoices) {
    if (invoice.status === 'draft' || invoice.status === 'void') continue;
    const outstanding = sub(
      sub(dec(invoice.grandTotal, 2), dec(invoice.paidAmount, 2)),
      dec(invoice.retentionHeld ?? 0, 2),
    );
    if (compare(outstanding, dec(0, 2)) <= 0) continue;

    const daysOverdue = dayDiff(invoice.dueDate, asOf);
    const bucket = bucketFor(daysOverdue);
    rows.push({
      invoiceId: invoice.invoiceId,
      invoiceNo: invoice.invoiceNo,
      customerId: invoice.customerId,
      dueDate: invoice.dueDate.slice(0, 10),
      daysOverdue,
      bucket,
      outstanding: decToNumber(outstanding),
    });
    buckets[bucket] = decToNumber(add(dec(buckets[bucket], 2), outstanding));
  }

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || a.invoiceNo.localeCompare(b.invoiceNo));
  const totalOutstanding = decToNumber(sumDec(rows.map((row) => dec(row.outstanding, 2))));
  return { asOf: asOf.slice(0, 10), rows, buckets, totalOutstanding };
};
