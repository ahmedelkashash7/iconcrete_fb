import type { Customer, Invoice } from '../types';
import { round2 } from './money';

export type CreditDecision =
  | { allowed: true; usedCredit: number; availableCredit: number; remainingAfter: number }
  | {
      allowed: false;
      reason: 'credit_limit_exceeded';
      usedCredit: number;
      availableCredit: number;
      shortfall: number;
    }
  | { allowed: false; reason: 'customer_not_active' };

/** Outstanding per customer, derived from invoices (never a stored manual balance). */
export const customerOutstanding = (
  customerId: string,
  invoices: readonly Invoice[],
): number =>
  round2(
    invoices
      .filter(
        (invoice) =>
          invoice.customer_id === customerId &&
          invoice.status !== 'void' &&
          invoice.status !== 'draft',
      )
      .reduce((total, invoice) => total + invoice.outstanding_amount, 0),
  );

/** Master spec rule 10 in PART 5: a new order is blocked above the credit limit. */
export const evaluateCredit = (
  customer: Customer,
  invoices: readonly Invoice[],
  newOrderValue: number,
): CreditDecision => {
  if (customer.status !== 'active') {
    return { allowed: false, reason: 'customer_not_active' };
  }

  const usedCredit = customerOutstanding(customer.id, invoices);
  const availableCredit = round2(customer.credit_limit_egp - usedCredit);
  const projected = round2(usedCredit + newOrderValue);

  if (projected > customer.credit_limit_egp) {
    return {
      allowed: false,
      reason: 'credit_limit_exceeded',
      usedCredit,
      availableCredit,
      shortfall: round2(projected - customer.credit_limit_egp),
    };
  }

  return {
    allowed: true,
    usedCredit,
    availableCredit: round2(availableCredit - newOrderValue),
    remainingAfter: round2(customer.credit_limit_egp - projected),
  };
};
