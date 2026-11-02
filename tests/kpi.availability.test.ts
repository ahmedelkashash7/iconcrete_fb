/**
 * KPI availability states (gap G3). A missing table must never read as a real zero.
 */
import { describe, expect, test } from 'bun:test';
import { kpiStates, summarizeKpiStates, unavailableKpiStates } from '../src/core/availability';
import { computeKpis } from '../src/core/metrics';
import type { DemoDataset } from '../src/types';

const emptyDataset = (): DemoDataset =>
  ({
    company: { id: 'CMP-0001', name_ar: 'x', name_en: 'x', tax_id: '', logo_doc_id: null, created_at: '' },
    plants: [],
    users: [],
    customers: [],
    suppliers: [],
    invoices: [],
    supplierBills: [],
    cashTransactions: [],
    bankAccounts: [],
    cheques: [],
    materials: [],
    inventory: [],
    fixedAssets: [],
    loans: [],
    salaryPayments: [],
    rentals: [],
    utilityBills: [],
    maintenanceOrders: [],
    batches: [],
    trucks: [],
    trips: [],
    qualityTests: [],
    auditLog: [],
  }) as DemoDataset;

describe('KPI availability', () => {
  test('postgres mode reports modules without tables as not_implemented, never zero', () => {
    const dataset = emptyDataset();
    const states = kpiStates(dataset, computeKpis(dataset), 'postgres');

    expect(states.producedTodayM3.status).toBe('not_implemented');
    expect(states.activeTrucks.status).toBe('not_implemented');
    expect(states.avg7dStrengthMpa.status).toBe('not_implemented');
    expect(states.pendingBatches.status).toBe('not_implemented');
    // Tables exist but the tenant has no rows: distinct from "not implemented".
    expect(states.overdueReceivables.status).toBe('no_records');
    expect(states.creditUtilizationPct.status).toBe('no_records');
  });

  test('a real row with a zero metric is real_zero, not missing data', () => {
    const dataset = emptyDataset();
    dataset.invoices = [
      {
        id: 'INV-1',
        invoice_no: 'INV-1',
        customer_id: 'CUS-1',
        plant_id: '',
        issue_date: '2026-01-01',
        due_date: '2099-01-01',
        subtotal: 100,
        vat_percent: 14,
        grand_total: 100,
        paid_amount: 100,
        outstanding_amount: 0,
        status: 'paid',
      },
    ];
    const kpis = { ...computeKpis(dataset), overdueReceivables: 0 };
    const states = kpiStates(dataset, kpis, 'postgres');

    expect(states.overdueReceivables.status).toBe('real_zero');
    expect(states.overdueReceivables.records).toBe(1);
    expect(states.creditUtilizationPct.status).toBe('no_records');
  });

  test('a failed read marks every metric unavailable instead of zero', () => {
    const dataset = emptyDataset();
    const states = kpiStates(dataset, computeKpis(dataset), 'postgres', {
      readError: 'connection reset',
    });
    expect(summarizeKpiStates(states).unavailable).toBe(Object.keys(states).length);
    expect(states.overdueReceivables.reason).toBe('connection reset');

    const fallback = unavailableKpiStates('postgres');
    expect(fallback.overdueReceivables.status).toBe('unavailable');
  });

  test('demo mode keeps its numbers but labels the source', () => {
    const dataset = emptyDataset();
    dataset.invoices = [
      {
        id: 'INV-1',
        invoice_no: 'INV-1',
        customer_id: 'CUS-1',
        plant_id: 'PLT-0001',
        issue_date: '2026-01-01',
        due_date: '2020-01-01',
        subtotal: 100,
        vat_percent: 14,
        grand_total: 100,
        paid_amount: 0,
        outstanding_amount: 100,
        status: 'overdue',
      },
    ];
    const states = kpiStates(dataset, computeKpis(dataset), 'demo');
    expect(states.overdueReceivables.status).toBe('available');
    expect(states.overdueReceivables.source).toBe('demo');
  });
});
