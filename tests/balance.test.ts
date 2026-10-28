import { describe, expect, test } from 'bun:test';
import { computeGeneralBalance, type BalanceInput } from '../src/core/balance';
import { sumBy } from '../src/core/money';

const emptyInput = (overrides: Partial<BalanceInput> = {}): BalanceInput => ({
  cashTransactions: [],
  bankAccounts: [],
  cheques: [],
  invoices: [],
  inventory: [],
  fixedAssets: [],
  loans: [],
  supplierBills: [],
  salaryPayments: [],
  rentals: [],
  utilityBills: [],
  maintenanceOrders: [],
  asOf: '2026-10-28T12:00:00.000Z',
  ...overrides,
});

describe('general balance', () => {
  test('empty dataset yields a zero, non-negative position', () => {
    const balance = computeGeneralBalance(emptyInput());
    expect(balance.debitTotal).toBe(0);
    expect(balance.creditTotal).toBe(0);
    expect(balance.net).toBe(0);
    expect(balance.isProfit).toBe(true);
    expect(balance.debit).toHaveLength(6);
    expect(balance.credit).toHaveLength(6);
  });

  test('derives every line from its source table', () => {
    const balance = computeGeneralBalance(
      emptyInput({
        cashTransactions: [
          { id: 'C1', plant_id: 'PLT-0001', txn_date: '2026-10-01T10:00:00.000Z', direction: 'in', amount: 1000, reference: 'R1', description_ar: '', description_en: '' },
          { id: 'C2', plant_id: 'PLT-0001', txn_date: '2026-10-02T10:00:00.000Z', direction: 'out', amount: 250, reference: 'R2', description_ar: '', description_en: '' },
        ],
        bankAccounts: [
          { id: 'B1', plant_id: 'PLT-0001', bank_name_ar: 'بنك', bank_name_en: 'Bank', iban_last4: '0001', current_balance: 5000 },
        ],
        cheques: [
          { id: 'Q1', cheque_no: 'Q1', direction: 'incoming', party_name_ar: 'عميل', party_name_en: 'Client', amount: 700, due_date: '2026-10-30', status: 'under_collection' },
          { id: 'Q2', cheque_no: 'Q2', direction: 'incoming', party_name_ar: 'عميل', party_name_en: 'Client', amount: 900, due_date: '2026-10-30', status: 'cleared' },
        ],
        invoices: [
          { id: 'I1', invoice_no: 'INV-1', customer_id: 'CUS-0001', plant_id: 'PLT-0001', issue_date: '2026-10-01T10:00:00.000Z', due_date: '2026-10-20', subtotal: 500, vat_percent: 14, grand_total: 570, paid_amount: 270, outstanding_amount: 300, status: 'partially_paid' },
          { id: 'I2', invoice_no: 'INV-2', customer_id: 'CUS-0002', plant_id: 'PLT-0001', issue_date: '2026-10-01T10:00:00.000Z', due_date: '2026-10-20', subtotal: 400, vat_percent: 14, grand_total: 456, paid_amount: 0, outstanding_amount: 456, status: 'draft' },
        ],
        inventory: [
          { id: 'INV-M1', plant_id: 'PLT-0001', material_id: 'MAT-001', quantity: 10, unit_cost: 2450 },
        ],
        fixedAssets: [
          { id: 'A1', name_ar: 'أصل', name_en: 'Asset', category: 'vehicle', purchase_date: '2024-01-01', purchase_cost: 1_000_000, current_book_value: 680_000 },
        ],
        loans: [
          { id: 'L1', bank_name_ar: 'بنك', bank_name_en: 'Bank', principal: 3_000_000, outstanding_principal: 1_850_000, next_installment_date: '2026-11-01', status: 'active' },
          { id: 'L2', bank_name_ar: 'بنك', bank_name_en: 'Bank', principal: 500_000, outstanding_principal: 0, next_installment_date: '2025-01-01', status: 'closed' },
        ],
        supplierBills: [
          { id: 'S1', supplier_id: 'SUP-001', bill_no: 'SB-1', bill_date: '2026-10-01T10:00:00.000Z', due_date: '2026-10-31', total: 200, paid_amount: 80, outstanding_amount: 120_000, status: 'partially_paid' },
          { id: 'S2', supplier_id: 'SUP-002', bill_no: 'SB-2', bill_date: '2026-10-01T10:00:00.000Z', due_date: '2026-10-31', total: 500, paid_amount: 500, outstanding_amount: 0, status: 'paid' },
        ],
        salaryPayments: [
          { id: 'P1', employee_name_ar: 'موظف', employee_name_en: 'Employee', period: '2026-10', net_amount: 185_000, status: 'pending' },
          { id: 'P2', employee_name_ar: 'موظف', employee_name_en: 'Employee', period: '2026-10', net_amount: 10_000, status: 'paid' },
        ],
        rentals: [
          { id: 'R1', description_ar: '', description_en: '', amount: 45_000, due_date: '2026-10-26', status: 'pending' },
          { id: 'R2', description_ar: '', description_en: '', amount: 32_000, due_date: '2026-11-30', status: 'pending' },
        ],
        utilityBills: [
          { id: 'U1', kind: 'electricity', bill_no: 'ELC', amount: 128_400, due_date: '2026-11-05', status: 'pending' },
        ],
        maintenanceOrders: [
          { id: 'M1', asset_name_ar: 'خلاطة', asset_name_en: 'Mixer', cost_estimate: 42_000, status: 'open', opened_at: '2026-10-20' },
          { id: 'M2', asset_name_ar: 'خلاطة', asset_name_en: 'Mixer', cost_estimate: 9_000, status: 'done', opened_at: '2026-10-01' },
        ],
      }),
    );

    expect(balance.debitTotal).toBe(711_250);
    expect(balance.creditTotal).toBe(2_370_400);
    expect(balance.net).toBe(-1_659_150);
    expect(balance.isProfit).toBe(false);

    const cashLine = balance.debit.find((line) => line.key === 'cash');
    expect(cashLine?.amount).toBe(750);
    expect(cashLine?.count).toBe(2);

    const chequeLine = balance.debit.find((line) => line.key === 'cheques');
    expect(chequeLine?.amount).toBe(700);

    const receivables = balance.debit.find((line) => line.key === 'receivables');
    expect(receivables?.amount).toBe(300);

    const suppliers = balance.credit.find((line) => line.key === 'suppliers');
    expect(suppliers?.amount).toBe(120_000);

    const rentalsLine = balance.credit.find((line) => line.key === 'rentals');
    expect(rentalsLine?.amount).toBe(45_000);

    expect(balance.debit.every((line) => line.amount >= 0)).toBe(true);
  });

  test('as-of filtering excludes later cash movements', () => {
    const input = emptyInput({
      cashTransactions: [
        { id: 'C1', plant_id: 'PLT-0001', txn_date: '2026-10-01T10:00:00.000Z', direction: 'in', amount: 100, reference: '', description_ar: '', description_en: '' },
        { id: 'C2', plant_id: 'PLT-0001', txn_date: '2026-12-01T10:00:00.000Z', direction: 'in', amount: 500, reference: '', description_ar: '', description_en: '' },
      ],
    });
    const balance = computeGeneralBalance(input);
    expect(balance.debit.find((line) => line.key === 'cash')?.amount).toBe(100);
  });

  test('line totals always equal the sum of their lines', () => {
    const balance = computeGeneralBalance(
      emptyInput({
        bankAccounts: [
          { id: 'B1', plant_id: 'PLT-0001', bank_name_ar: 'بنك', bank_name_en: 'Bank', iban_last4: '0001', current_balance: 0.1 },
          { id: 'B2', plant_id: 'PLT-0001', bank_name_ar: 'بنك', bank_name_en: 'Bank', iban_last4: '0002', current_balance: 0.2 },
        ],
      }),
    );
    expect(balance.debitTotal).toBe(0.3);
    expect(sumBy(balance.debit, (line) => line.amount)).toBe(0.3);
  });
});
