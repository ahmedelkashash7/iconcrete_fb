import { describe, expect, test } from 'bun:test';
import { customerOutstanding, evaluateCredit } from '../src/core/credit';
import type { Customer, Invoice } from '../src/types';

const customer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'CUS-0001',
  company_id: 'CMP-0001',
  plant_id: 'PLT-0001',
  name_ar: 'شركة اختبار',
  name_en: 'Test Co.',
  tax_id: 'TAX-1',
  phone: '+201000000000',
  email: 'test@example.com',
  address: 'Cairo',
  priority_tier: 'A',
  credit_limit_egp: 1000,
  credit_days: 30,
  status: 'active',
  data_source: 'demo',
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'INV-1',
  invoice_no: 'INV-2026-0001',
  customer_id: 'CUS-0001',
  plant_id: 'PLT-0001',
  issue_date: '2026-10-01T00:00:00.000Z',
  due_date: '2026-10-31',
  subtotal: 100,
  vat_percent: 14,
  grand_total: 114,
  paid_amount: 0,
  outstanding_amount: 600,
  status: 'issued',
  ...overrides,
});

describe('credit rules', () => {
  test('outstanding only counts open invoices of the same customer', () => {
    const invoices = [
      invoice({ id: '1', outstanding_amount: 600 }),
      invoice({ id: '2', outstanding_amount: 400, status: 'partially_paid' }),
      invoice({ id: '3', outstanding_amount: 999, status: 'draft' }),
      invoice({ id: '4', outstanding_amount: 999, status: 'void' }),
      invoice({ id: '5', customer_id: 'CUS-0002', outstanding_amount: 500 }),
    ];
    expect(customerOutstanding('CUS-0001', invoices)).toBe(1000);
    expect(customerOutstanding('CUS-0002', invoices)).toBe(500);
    expect(customerOutstanding('CUS-9999', invoices)).toBe(0);
  });

  test('allows an order inside the limit and reports remaining credit', () => {
    const decision = evaluateCredit(customer(), [invoice({ outstanding_amount: 600 })], 300);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.usedCredit).toBe(600);
      expect(decision.availableCredit).toBe(100);
      expect(decision.remainingAfter).toBe(100);
    }
  });

  test('allows an order exactly at the limit', () => {
    const decision = evaluateCredit(customer(), [invoice({ outstanding_amount: 600 })], 400);
    expect(decision.allowed).toBe(true);
  });

  test('blocks an order above the limit and reports the shortfall', () => {
    const decision = evaluateCredit(customer(), [invoice({ outstanding_amount: 600 })], 500);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed && decision.reason === 'credit_limit_exceeded') {
      expect(decision.availableCredit).toBe(400);
      expect(decision.shortfall).toBe(100);
    }
  });

  test('blocks suspended and archived customers regardless of limit', () => {
    for (const status of ['suspended', 'archived'] as const) {
      const decision = evaluateCredit(customer({ status }), [], 10);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('customer_not_active');
    }
  });

  test('rounds monetary values to two decimals', () => {
    const decision = evaluateCredit(customer({ credit_limit_egp: 1000.1 }), [invoice({ outstanding_amount: 600.05 })], 200.02);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.remainingAfter).toBe(200.03);
  });
});
