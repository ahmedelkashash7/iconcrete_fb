import { describe, expect, test } from 'bun:test';
import { add, allocate, compare, dec, decToNumber, decToString, mulRate, percentOf, sub, sumDec } from '../../src/core/decimal';
import { computeInvoiceTotals, agingReport } from '../../src/core/invoicing';
import { fifoAllocate, creditDecision, outstandingFor } from '../../src/core/allocation';
import { validateJournal, buildReversal, trialBalance, taxAmount } from '../../src/core/accounting';
import { applyChequeTransition, canTransition, chequesRequiringAction } from '../../src/core/cheques';
import { straightLineSchedule, monthlyDepreciation, disposalResult } from '../../src/core/assets';
import { annuitySchedule, outstandingPrincipal, earlySettlementAmount } from '../../src/core/loans';
import { matchThreeWay, describeMatch } from '../../src/core/threeway';
import { reconcileBank, canCloseReconciliation } from '../../src/core/reconciliation';

const egyptian = (value: number): string => (value / 100).toFixed(2);

describe('decimal money', () => {
  test('parses and prints exact 2dp values without float drift', () => {
    expect(decToString(dec('0.1', 2))).toBe('0.10');
    expect(decToString(add(dec('0.1'), dec('0.2')), 2)).toBe('0.30');
    expect(decToString(sub(dec('1000.00'), dec('0.01')), 2)).toBe('999.99');
    expect(decToNumber(dec('1234.567', 2))).toBe(1234.57);
    expect(decToString(dec('-5.005', 2), 2)).toBe('-5.01');
  });

  test('rounds percentages half-up once', () => {
    expect(decToNumber(percentOf(dec('100.00'), 14, 2))).toBe(14);
    expect(decToNumber(percentOf(dec('0.05'), 50, 2))).toBe(0.03);
    expect(taxAmount('999.99', 14)).toBe(140);
    expect(decToNumber(mulRate(dec('1234.56'), dec('0.14', 4), 1, 2))).toBe(172.84);
  });

  test('allocation never loses or invents a piastre', () => {
    const parts = allocate(dec('100.00'), [1, 1, 1]);
    expect(parts.map((part) => decToNumber(part))).toEqual([33.34, 33.33, 33.33]);
    expect(decToNumber(sumDec(parts))).toBe(100);
    expect(compare(sumDec(parts), dec('100.00'))).toBe(0);
  });
});

describe('invoice totals and tax', () => {
  test('computes subtotal, VAT, retention and deposit exactly', () => {
    const totals = computeInvoiceTotals({
      items: [
        { quantity: '10', unitPrice: '1750.00' },
        { quantity: '2.5', unitPrice: '990.50' },
      ],
      taxPercent: 14,
      retentionPercent: 5,
      depositAmount: 1000,
    });

    expect(totals.subtotal).toBe(19976.25);
    expect(totals.taxAmount).toBe(2796.68);
    expect(totals.grandTotal).toBe(22772.93);
    expect(totals.retentionAmount).toBe(998.81);
    expect(totals.receivableAmount).toBe(20774.12);
  });

  test('rejects an empty invoice, invalid quantity and oversized discount', () => {
    expect(() => computeInvoiceTotals({ items: [] })).toThrow('invoice_needs_items');
    expect(() => computeInvoiceTotals({ items: [{ quantity: 0, unitPrice: 10 }] })).toThrow('quantity_invalid');
    expect(() =>
      computeInvoiceTotals({ items: [{ quantity: 1, unitPrice: 100 }], discountAmount: 500 }),
    ).toThrow('discount_exceeds_subtotal');
  });

  test('ages receivables into the five buckets', () => {
    const asOf = '2026-10-28';
    const report = agingReport(
      [
        { invoiceId: 'A', invoiceNo: 'INV-1', customerId: 'C1', issueDate: '2026-10-01', dueDate: '2026-11-01', grandTotal: '1000', paidAmount: '0', status: 'issued' },
        { invoiceId: 'B', invoiceNo: 'INV-2', customerId: 'C1', issueDate: '2026-08-01', dueDate: '2026-09-01', grandTotal: '2000', paidAmount: '500', status: 'partially_paid' },
        { invoiceId: 'C', invoiceNo: 'INV-3', customerId: 'C2', issueDate: '2026-04-01', dueDate: '2026-05-01', grandTotal: '3000', paidAmount: '0', status: 'overdue' },
        { invoiceId: 'D', invoiceNo: 'INV-4', customerId: 'C2', issueDate: '2026-10-01', dueDate: '2026-10-10', grandTotal: '900', paidAmount: '0', status: 'draft' },
      ],
      asOf,
    );

    expect(report.buckets.current).toBe(1000);
    expect(report.buckets.days_31_60).toBe(1500);
    expect(report.buckets.days_over_90).toBe(3000);
    expect(report.totalOutstanding).toBe(5500);
    expect(report.rows.find((row) => row.invoiceId === 'D')).toBeUndefined();
  });
});

describe('FIFO allocation and credit', () => {
  const invoices = [
    { invoiceId: 'I2', invoiceNo: 'INV-0002', dueDate: '2026-10-15', outstanding: 500, status: 'issued' },
    { invoiceId: 'I1', invoiceNo: 'INV-0001', dueDate: '2026-09-15', outstanding: 1000, status: 'issued' },
    { invoiceId: 'I3', invoiceNo: 'INV-0003', dueDate: '2026-11-15', outstanding: 300, status: 'issued' },
  ];

  test('allocates oldest due date first and reports the unapplied remainder', () => {
    const result = fifoAllocate(1200, invoices);
    expect(result.allocations.map((line) => [line.invoiceId, line.amount])).toEqual([
      ['I1', 1000],
      ['I2', 200],
    ]);
    expect(result.allocated).toBe(1200);
    expect(result.unapplied).toBe(0);
    expect(result.remaining).toEqual([
      { invoiceId: 'I2', outstanding: 300 },
      { invoiceId: 'I3', outstanding: 300 },
    ]);
  });

  test('keeps the difference unapplied when the payment exceeds the debt', () => {
    const result = fifoAllocate(2000, invoices);
    expect(result.allocated).toBe(1800);
    expect(result.unapplied).toBe(200);
  });

  test('is deterministic for equal due dates', () => {
    const same = fifoAllocate(750, [
      { invoiceId: 'B', invoiceNo: 'INV-0002', dueDate: '2026-10-01', outstanding: 500, status: 'issued' },
      { invoiceId: 'A', invoiceNo: 'INV-0001', dueDate: '2026-10-01', outstanding: 500, status: 'issued' },
    ]);
    expect(same.allocations[0]?.invoiceId).toBe('A');
    expect(same.allocations[1]?.amount).toBe(250);
  });

  test('blocks an invoice above the credit limit and for inactive customers', () => {
    const blocked = creditDecision({ creditLimit: 1000, currentOutstanding: 800, newAmount: 500, customerStatus: 'active' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('credit_limit_exceeded');
    expect(blocked.shortfall).toBe(300);

    const inactive = creditDecision({ creditLimit: 1000, currentOutstanding: 0, newAmount: 10, customerStatus: 'suspended' });
    expect(inactive.allowed).toBe(false);
    expect(inactive.reason).toBe('customer_not_active');

    expect(creditDecision({ creditLimit: 1000, currentOutstanding: 500, newAmount: 500, customerStatus: 'active' }).allowed).toBe(true);
  });

  test('derives outstanding from invoices and allocations', () => {
    expect(
      outstandingFor({ invoiceId: 'I1', grandTotal: 1000, retentionHeld: 100, status: 'partially_paid' }, [
        { invoiceId: 'I1', amount: 400 },
      ]),
    ).toBe(500);
    expect(outstandingFor({ invoiceId: 'I1', grandTotal: 1000, status: 'void' }, [])).toBe(0);
  });
});

describe('double-entry accounting', () => {
  const balanced = {
    companyId: 'CMP-0001',
    entryDate: '2026-10-28',
    lines: [
      { accountId: 'ACC-1100', debit: 1140 },
      { accountId: 'ACC-4000', credit: 1000 },
      { accountId: 'ACC-2100', credit: 140 },
    ],
  };

  test('accepts a balanced entry', () => {
    const check = validateJournal(balanced);
    expect(check.ok).toBe(true);
    expect(decToNumber(check.debitTotal)).toBe(1140);
    expect(decToNumber(check.creditTotal)).toBe(1140);
  });

  test('rejects unbalanced, single-line, two-sided, zero and negative entries', () => {
    expect(validateJournal({ ...balanced, lines: [{ accountId: 'A', debit: 100 }, { accountId: 'B', credit: 90 }] }).errors).toContain('unbalanced');
    expect(validateJournal({ ...balanced, lines: [{ accountId: 'A', debit: 100 }] }).errors).toContain('needs_at_least_two_lines');
    expect(validateJournal({ ...balanced, lines: [{ accountId: 'A', debit: 100, credit: 100 }, { accountId: 'B', credit: 0.01 }] }).errors.join(',')).toContain('two_sided');
    expect(validateJournal({ ...balanced, lines: [{ accountId: 'A', debit: 0 }, { accountId: 'B', credit: 0 }] }).errors.join(',')).toContain('zero_amount');
    expect(validateJournal({ ...balanced, lines: [{ accountId: 'A', debit: -5 }, { accountId: 'B', credit: -5 }] }).errors.join(',')).toContain('negative');
    expect(validateJournal({ ...balanced, entryDate: '28-10-2026' }).errors).toContain('entry_date_invalid');
  });

  test('reversal swaps sides and still balances', () => {
    const reversal = buildReversal(balanced, { ar: 'عكس', en: 'Reversal' });
    const check = validateJournal(reversal);
    expect(check.ok).toBe(true);
    expect(check.lines[0]?.credit).toEqual(dec('1140', 2));
    expect(check.lines[1]?.debit).toEqual(dec('1000', 2));
    expect(reversal.sourceType).toBe('reversal');
  });

  test('trial balance groups accounts and proves debits equal credits', () => {
    const report = trialBalance([
      { accountId: 'A', accountCode: '1100', accountNameAr: 'عملاء', accountNameEn: 'AR', accountType: 'asset', normalSide: 'debit', debit: 1140, credit: 0 },
      { accountId: 'B', accountCode: '4000', accountNameAr: 'إيرادات', accountNameEn: 'Revenue', accountType: 'revenue', normalSide: 'credit', debit: 0, credit: 1000 },
      { accountId: 'C', accountCode: '2100', accountNameAr: 'ضريبة', accountNameEn: 'VAT', accountType: 'liability', normalSide: 'credit', debit: 0, credit: 140 },
      { accountId: 'A', accountCode: '1100', accountNameAr: 'عملاء', accountNameEn: 'AR', accountType: 'asset', normalSide: 'debit', debit: 60, credit: 0 },
      { accountId: 'C', accountCode: '2100', accountNameAr: 'ضريبة', accountNameEn: 'VAT', accountType: 'liability', normalSide: 'credit', debit: 0, credit: 60 },
    ]);
    expect(report.balanced).toBe(true);
    expect(report.rows.find((row) => row.accountCode === '1100')?.balance).toBe(1200);
  });
});

describe('cheque lifecycle', () => {
  test('allows only defined transitions', () => {
    expect(canTransition('received', 'deposited')).toBe(true);
    expect(canTransition('received', 'cleared')).toBe(false);
    expect(canTransition('deposited', 'bounced')).toBe(true);
    expect(canTransition('cleared', 'bounced')).toBe(false);
    expect(canTransition('closed', 'received')).toBe(false);
  });

  test('requires an account for deposit and records the bounce fee', () => {
    expect(applyChequeTransition({ chequeId: 'C1', from: 'received', to: 'deposited', direction: 'incoming', amount: 5000 })).toEqual({
      ok: false,
      reason: 'missing_account',
    });

    const bounced = applyChequeTransition({
      chequeId: 'C1',
      from: 'deposited',
      to: 'bounced',
      direction: 'incoming',
      amount: 5000,
    });
    expect(bounced.ok).toBe(true);

    const recovered = applyChequeTransition({
      chequeId: 'C1',
      from: 'bounced',
      to: 'recovered',
      direction: 'incoming',
      amount: 5000,
      fee: 150,
    });
    expect(recovered.ok && recovered.fee).toBe(150);

    const illegal = applyChequeTransition({ chequeId: 'C1', from: 'received', to: 'cleared', direction: 'incoming', amount: 5000 });
    expect(illegal).toEqual({ ok: false, reason: 'illegal_transition' });
  });

  test('flags cheques needing action inside the window', () => {
    const rows = chequesRequiringAction(
      [
        { id: '1', cheque_no: 'CHQ-1', status: 'deposited', amount: '1000', due_date: '2026-10-30' },
        { id: '2', cheque_no: 'CHQ-2', status: 'cleared', amount: '2000', due_date: '2026-10-29' },
        { id: '3', cheque_no: 'CHQ-3', status: 'bounced', amount: '3000', due_date: '2026-10-20' },
      ],
      '2026-10-28',
      7,
    );
    expect(rows.map((row) => row.chequeNo)).toEqual(['CHQ-3', 'CHQ-1']);
  });
});

describe('depreciation and loans', () => {
  test('straight-line schedule hits the residual exactly', () => {
    const asset = {
      assetId: 'AST-1',
      purchaseDate: '2026-01-15',
      purchaseCost: 120000,
      residualValue: 12000,
      usefulLifeMonths: 12,
    };
    const schedule = straightLineSchedule(asset);
    expect(schedule).toHaveLength(12);
    expect(schedule[0]?.amount).toBe(9000);
    expect(schedule[schedule.length - 1]?.accumulated).toBe(108000);
    expect(schedule[schedule.length - 1]?.bookValue).toBe(12000);
    expect(monthlyDepreciation(asset)).toBe(9000);
  });

  test('rounding remainder lands in the final period', () => {
    const schedule = straightLineSchedule({
      assetId: 'AST-2',
      purchaseDate: '2026-01-31',
      purchaseCost: 100000,
      residualValue: 0,
      usefulLifeMonths: 7,
    });
    expect(schedule.reduce((sum, period) => sum + period.amount, 0)).toBeCloseTo(100000, 2);
    expect(schedule[schedule.length - 1]?.bookValue).toBe(0);
    expect(schedule[0]?.period).toBe('2026-02-01');
  });

  test('disposal gain or loss is measured against book value', () => {
    const result = disposalResult(
      { assetId: 'A', purchaseDate: '2026-01-01', purchaseCost: 100000, residualValue: 0, usefulLifeMonths: 10 },
      50000,
      '2026-06-01',
    );
    expect(result.bookValue).toBe(0);
    expect(result.gainLoss).toBe(50000);
  });

  test('annuity schedule closes to exactly zero', () => {
    const schedule = annuitySchedule({ loanId: 'L1', principal: 120000, annualRate: 12, termMonths: 12, startDate: '2026-01-01' });
    expect(schedule.installments).toHaveLength(12);
    expect(schedule.installments[11]?.remaining).toBe(0);
    const principalPaid = schedule.installments.reduce((sum, item) => sum + item.principalPart, 0);
    expect(principalPaid).toBeCloseTo(120000, 2);
    expect(schedule.totalInterest).toBeGreaterThan(7000);
    expect(outstandingPrincipal({ loanId: 'L1', principal: 120000, annualRate: 12, termMonths: 12, startDate: '2026-01-01' }, 6)).toBeGreaterThan(0);
  });

  test('zero-interest loan divides evenly', () => {
    const schedule = annuitySchedule({ loanId: 'L2', principal: 12000, annualRate: 0, termMonths: 12, startDate: '2026-01-01' });
    expect(schedule.installments.every((item) => item.payment === 1000)).toBe(true);
    expect(schedule.totalInterest).toBe(0);
  });

  test('early settlement reports principal plus next interest', () => {
    const settlement = earlySettlementAmount({ loanId: 'L3', principal: 120000, annualRate: 12, termMonths: 12, startDate: '2026-01-01' }, 6);
    expect(settlement.principal).toBeGreaterThan(0);
    expect(settlement.total).toBeCloseTo(settlement.principal + settlement.interest, 2);
  });
});

describe('three-way match', () => {
  test('matches an exact order, receipt and bill', () => {
    const result = matchThreeWay({
      orderLines: [{ lineNo: 1, quantity: 200, unitPrice: 2500 }],
      receiptLines: [{ lineNo: 1, quantity: 200 }],
      billLines: [{ lineNo: 1, quantity: 200, unitPrice: 2500 }],
    });
    expect(result.status).toBe('matched');
    expect(result.requiresApproval).toBe(false);
    expect(describeMatch(result)).toBe('matched');
  });

  test('detects over-receipt', () => {
    const result = matchThreeWay({
      orderLines: [{ lineNo: 1, quantity: 100, unitPrice: 10 }],
      receiptLines: [{ lineNo: 1, quantity: 120 }],
      billLines: [{ lineNo: 1, quantity: 100, unitPrice: 10 }],
    });
    expect(result.status).toBe('over_receipt');
    expect(result.overReceiptQty).toBe(20);
    expect(result.requiresApproval).toBe(true);
  });

  test('detects over-billing and price variance', () => {
    const overBilled = matchThreeWay({
      orderLines: [{ lineNo: 1, quantity: 100, unitPrice: 10 }],
      receiptLines: [{ lineNo: 1, quantity: 100 }],
      billLines: [{ lineNo: 1, quantity: 150, unitPrice: 10 }],
    });
    expect(overBilled.status).toBe('over_billing');
    expect(overBilled.overBilledQty).toBe(50);

    const price = matchThreeWay({
      orderLines: [{ lineNo: 1, quantity: 100, unitPrice: 10 }],
      receiptLines: [{ lineNo: 1, quantity: 100 }],
      billLines: [{ lineNo: 1, quantity: 100, unitPrice: 12 }],
    });
    expect(price.status).toBe('price_variance');
    expect(price.priceVariance).toBe(200);
  });
});

describe('bank reconciliation', () => {
  test('matches by reference then amount and date, reporting leftovers', () => {
    const result = reconcileBank(
      [
        { id: 'B1', txnDate: '2026-10-01', direction: 'in', amount: 1000, reference: 'STMT-1' },
        { id: 'B2', txnDate: '2026-10-02', direction: 'out', amount: 500, reference: 'X' },
        { id: 'B3', txnDate: '2026-10-03', direction: 'in', amount: 250, reference: 'Y' },
      ],
      [
        { id: 'S1', txnDate: '2026-10-05', direction: 'in', amount: 1000, reference: 'STMT-1' },
        { id: 'S2', txnDate: '2026-10-02', direction: 'out', amount: 500, reference: 'Z' },
      ],
      { dateWindowDays: 1 },
    );

    expect(result.matched.map((pair) => pair.matchType)).toEqual(['reference', 'amount_date']);
    expect(result.unmatchedBook.map((row) => row.id)).toEqual(['B3']);
    expect(result.bookBalance).toBe(750);
    expect(result.variance).toBe(-250);
    expect(canCloseReconciliation(result)).toEqual({ ok: false, reason: 'unmatched_transactions' });
  });

  test('session closes only when nothing is unmatched and balances agree', () => {
    const result = reconcileBank(
      [{ id: 'B1', txnDate: '2026-10-01', direction: 'in', amount: 1000 }],
      [{ id: 'S1', txnDate: '2026-10-01', direction: 'in', amount: 1000 }],
    );
    expect(canCloseReconciliation(result)).toEqual({ ok: true });
    expect(result.matchedCount).toBe(1);
    expect(egyptian(result.bookBalance * 100)).toBe('1000.00');
  });
});
