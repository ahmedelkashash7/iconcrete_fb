/**
 * Deterministic FIFO payment allocation.
 *
 * Allocation order is (due_date, invoice_no, invoice_id) so the same inputs always
 * produce the same schedule on any machine, in any timezone.
 */
import { add, compare, dec, decToNumber, isZero, rescale, sub, sumDec, type Dec } from './decimal';

export interface AllocatableInvoice {
  invoiceId: string;
  invoiceNo: string;
  dueDate: string;
  /** Outstanding receivable: grand total less retention held less amount already paid. */
  outstanding: string | number;
  status: string;
}

export interface AllocationLine {
  invoiceId: string;
  invoiceNo: string;
  amount: number;
  sequence: number;
}

export interface AllocationResult {
  allocations: AllocationLine[];
  allocated: number;
  unapplied: number;
  /** Invoices in the order they were consumed, with the remaining balance. */
  remaining: { invoiceId: string; outstanding: number }[];
}

export const fifoAllocate = (
  paymentAmount: string | number,
  invoices: readonly AllocatableInvoice[],
  requested?: readonly { invoiceId: string; amount: string | number }[],
): AllocationResult => {
  let available = rescale(dec(paymentAmount, 2), 2);
  if (compare(available, dec(0, 2)) <= 0) throw new Error('payment_amount_must_be_positive');

  const candidates = invoices
    .filter((invoice) => invoice.status !== 'draft' && invoice.status !== 'void')
    .slice()
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.invoiceNo.localeCompare(b.invoiceNo) ||
        a.invoiceId.localeCompare(b.invoiceId),
    );

  const open = new Map<string, Dec>();
  for (const invoice of candidates) {
    const outstanding = rescale(dec(invoice.outstanding, 2), 2);
    if (compare(outstanding, dec(0, 2)) > 0) open.set(invoice.invoiceId, outstanding);
  }

  const allocations: AllocationLine[] = [];
  let sequence = 0;

  const consume = (invoice: AllocatableInvoice, limit: Dec | null): void => {
    const outstanding = open.get(invoice.invoiceId);
    if (!outstanding) return;
    let amount = outstanding;
    if (limit !== null && compare(limit, amount) < 0) amount = limit;
    if (compare(amount, available) > 0) amount = available;
    if (compare(amount, dec(0, 2)) <= 0) return;

    sequence += 1;
    allocations.push({
      invoiceId: invoice.invoiceId,
      invoiceNo: invoice.invoiceNo,
      amount: decToNumber(amount),
      sequence,
    });
    available = sub(available, amount);
    const left = sub(outstanding, amount);
    if (isZero(left)) open.delete(invoice.invoiceId);
    else open.set(invoice.invoiceId, left);
  };

  if (requested && requested.length > 0) {
    for (const request of requested) {
      const invoice = candidates.find((candidate) => candidate.invoiceId === request.invoiceId);
      if (!invoice) throw new Error(`invoice_not_found:${request.invoiceId}`);
      consume(invoice, rescale(dec(request.amount, 2), 2));
    }
  }

  for (const invoice of candidates) {
    if (isZero(available)) break;
    consume(invoice, null);
  }

  return {
    allocations,
    allocated: decToNumber(sumDec(allocations.map((line) => dec(line.amount, 2)))),
    unapplied: decToNumber(available),
    remaining: [...open.entries()]
      .map(([invoiceId, outstanding]) => ({ invoiceId, outstanding: decToNumber(outstanding) }))
      .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId)),
  };
};

export interface OutstandingInput {
  invoiceId: string;
  grandTotal: string | number;
  retentionHeld?: string | number;
  status: string;
}

/** Outstanding is derived: total − retention held − allocated payments. */
export const outstandingFor = (
  invoice: OutstandingInput,
  allocations: readonly { invoiceId: string; amount: string | number }[],
): number => {
  if (invoice.status === 'void' || invoice.status === 'draft') return 0;
  const allocated = sumDec(
    allocations.filter((line) => line.invoiceId === invoice.invoiceId).map((line) => dec(line.amount, 2)),
  );
  const value = sub(sub(dec(invoice.grandTotal, 2), dec(invoice.retentionHeld ?? 0, 2)), allocated);
  return compare(value, dec(0, 2)) < 0 ? 0 : decToNumber(value);
};

/** Credit check used before an invoice is posted (server-side, never UI-only). */
export const creditDecision = (input: {
  creditLimit: string | number;
  currentOutstanding: string | number;
  newAmount: string | number;
  customerStatus: string;
}): { allowed: boolean; reason?: 'customer_not_active' | 'credit_limit_exceeded'; used: number; available: number; shortfall: number } => {
  const limit = dec(input.creditLimit, 2);
  const outstanding = dec(input.currentOutstanding, 2);
  const amount = dec(input.newAmount, 2);

  if (input.customerStatus !== 'active') {
    return { allowed: false, reason: 'customer_not_active', used: decToNumber(outstanding), available: 0, shortfall: 0 };
  }

  const projected = add(outstanding, amount);
  const available = sub(limit, outstanding);
  if (compare(projected, limit) > 0) {
    return {
      allowed: false,
      reason: 'credit_limit_exceeded',
      used: decToNumber(outstanding),
      available: decToNumber(available),
      shortfall: decToNumber(sub(projected, limit)),
    };
  }

  return { allowed: true, used: decToNumber(outstanding), available: decToNumber(available), shortfall: 0 };
};
