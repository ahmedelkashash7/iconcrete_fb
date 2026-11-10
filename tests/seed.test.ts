import { describe, expect, test } from 'bun:test';
import { createDemoDataset } from '../src/seed/demo';
import { BRAND } from '../src/brand';
import { balanceFor, buildAlerts, computeKpis } from '../src/core/metrics';
import { buildReport, defaultReportRange, monthlySeries } from '../src/core/reports';
import { customerOutstanding } from '../src/core/credit';

const dataset = createDemoDataset();

const unique = (values: string[]): boolean => new Set(values).size === values.length;

describe('demo seed data', () => {
  test('uses the locked demo identity', () => {
    expect(dataset.company.name_ar).toBe(BRAND.demoCompany.ar);
    expect(dataset.company.name_en).toBe(BRAND.demoCompany.en);
    expect(dataset.plants[0]?.name_ar).toBe(BRAND.demoPlant.ar);
    expect(dataset.plants[0]?.name_en).toBe(BRAND.demoPlant.en);
  });

  test('has unique identifiers in every collection', () => {
    expect(unique(dataset.customers.map((row) => row.id))).toBe(true);
    expect(unique(dataset.invoices.map((row) => row.id))).toBe(true);
    expect(unique(dataset.invoices.map((row) => row.invoice_no))).toBe(true);
    expect(unique(dataset.trucks.map((row) => row.code))).toBe(true);
    expect(unique(dataset.materials.map((row) => row.code))).toBe(true);
    expect(unique(dataset.users.map((row) => row.username))).toBe(true);
    expect(unique(dataset.batches.map((row) => row.batch_no))).toBe(true);
  });

  test('builds a realistic plant-sized demo dataset', () => {
    expect(dataset.customers.length).toBeGreaterThanOrEqual(20);
    expect(dataset.suppliers.length).toBeGreaterThanOrEqual(6);
    expect(dataset.materials.length).toBe(6);
    expect(dataset.inventory.length).toBe(12);
    expect(dataset.trucks.length).toBe(12);
    expect(dataset.invoices.length).toBeGreaterThan(40);
    expect(dataset.trips.length).toBeGreaterThan(30);
    expect(dataset.qualityTests.length).toBe(30);
    expect(dataset.batches.length).toBeGreaterThan(50);
    expect(dataset.users).toHaveLength(5);
  });

  test('covers the five role levels exactly once', () => {
    const levels = dataset.users.map((user) => user.role_level).sort();
    expect(levels).toEqual([1, 2, 3, 4, 5]);
    for (const user of dataset.users) {
      expect(typeof user.demo_password).toBe('string');
      expect(user.is_active).toBe(true);
    }
  });

  test('invoice outstanding and status stay consistent', () => {
    for (const invoice of dataset.invoices) {
      expect(invoice.outstanding_amount).toBeCloseTo(invoice.grand_total - invoice.paid_amount, 2);
      if (invoice.outstanding_amount <= 0.01) expect(invoice.status).toBe('paid');
      expect(invoice.grand_total).toBeGreaterThan(0);
      expect(invoice.vat_percent).toBe(14);
    }
    const total = dataset.invoices.reduce((sum, invoice) => sum + invoice.outstanding_amount, 0);
    expect(total).toBeGreaterThan(0);
    const firstCustomer = dataset.customers[0];
    if (firstCustomer) {
      expect(customerOutstanding(firstCustomer.id, dataset.invoices)).toBeGreaterThan(0);
    }
  });

  test('every timestamp is a valid ISO date', () => {
    for (const invoice of dataset.invoices) {
      expect(Number.isNaN(new Date(invoice.issue_date).getTime())).toBe(false);
      expect(Number.isNaN(new Date(invoice.due_date).getTime())).toBe(false);
    }
    for (const batch of dataset.batches) {
      expect(Number.isNaN(new Date(batch.produced_at).getTime())).toBe(false);
    }
  });

  test('dashboard KPIs are derived and non-trivial', () => {
    const kpis = computeKpis(dataset);
    expect(kpis.producedTodayM3).toBeGreaterThan(0);
    expect(kpis.activeTrucks).toBeGreaterThan(0);
    expect(kpis.totalTrucks).toBe(dataset.trucks.length);
    expect(kpis.onTimeDeliveryPct).toBeGreaterThan(0);
    expect(kpis.onTimeDeliveryPct).toBeLessThanOrEqual(100);
    expect(kpis.lowStockCount).toBeGreaterThanOrEqual(1);
    expect(kpis.creditUtilizationPct).toBeGreaterThan(0);
  });

  test('general balance has both sides populated and a positive net position', () => {
    const balance = balanceFor(dataset);
    expect(balance.debitTotal).toBeGreaterThan(0);
    expect(balance.creditTotal).toBeGreaterThan(0);
    expect(balance.net).toBeCloseTo(balance.debitTotal - balance.creditTotal, 2);
    expect(balance.debit.every((line) => line.amount >= 0)).toBe(true);
    expect(balance.credit.every((line) => line.amount >= 0)).toBe(true);
    expect(balance.net).toBeGreaterThan(0);
  });

  test('urgent alerts include the low-stock material', () => {
    const alerts = buildAlerts(dataset, 20);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((alert) => alert.labelKey === 'alert.lowStock')).toBe(true);
  });
});

describe('reports', () => {
  const range = defaultReportRange();

  test('general balance report exposes both sides and a net total', () => {
    const report = buildReport('general_balance', dataset, range);
    expect(report.rows.length).toBe(13);
    expect(report.totals.debitTotal).toBeGreaterThan(0);
    expect(report.totals.creditTotal).toBeGreaterThan(0);
    expect(report.columns.map((column) => column.key)).toContain('amount');
  });

  test('customer statement returns only the selected customer invoices', () => {
    const customer = dataset.customers[0];
    expect(customer).toBeDefined();
    if (!customer) return;
    const report = buildReport('customer_statement', dataset, {
      from: '2020-01-01',
      to: '2030-12-31',
      customerId: customer.id,
    });
    const expected = dataset.invoices.filter((invoice) => invoice.customer_id === customer.id);
    expect(report.rows.length).toBe(expected.length);
    expect(report.totals.balance).toBe(customerOutstanding(customer.id, dataset.invoices));
  });

  test('sales report totals equal the sum of its rows', () => {
    const report = buildReport('sales_period', dataset, { from: range.from, to: range.to });
    const subtotal = report.rows.reduce((total, row) => total + Number(row.subtotal ?? 0), 0);
    const reportSubtotal = report.totals.subtotal ?? 0;
    const reportTotal = report.totals.total ?? 0;
    expect(reportSubtotal).toBeCloseTo(subtotal, 2);
    expect(reportTotal).toBeGreaterThanOrEqual(reportSubtotal);
  });

  test('cash movement separates in, out and net', () => {
    const report = buildReport('cash_movement', dataset, { from: '2020-01-01', to: '2030-12-31' });
    const cashIn = report.totals.in ?? 0;
    const cashOut = report.totals.out ?? 0;
    expect(report.totals.net ?? 0).toBeCloseTo(cashIn - cashOut, 2);
    expect(cashIn).toBeGreaterThan(0);
    expect(cashOut).toBeGreaterThan(0);
  });

  test('inventory and production reports aggregate correctly', () => {
    const inventory = buildReport('inventory', dataset, range);
    expect(inventory.rows).toHaveLength(dataset.inventory.length);
    const value = dataset.inventory.reduce((total, item) => total + item.quantity * item.unit_cost, 0);
    expect(inventory.totals.value ?? -1).toBeCloseTo(Math.round(value * 100) / 100, 2);

    const production = buildReport('production_period', dataset, { from: '2020-01-01', to: '2030-12-31' });
    const volume = dataset.batches.reduce((total, batch) => total + batch.volume_m3, 0);
    expect(production.totals.volume ?? -1).toBeCloseTo(Math.round(volume * 100) / 100, 2);
  });

  test('monthly series returns six chronological buckets', () => {
    const series = monthlySeries(dataset, 6);
    expect(series).toHaveLength(6);
    const months = series.map((point) => point.month);
    expect([...months].sort()).toEqual(months);
    expect(series.every((point) => point.revenue >= 0 && point.volume >= 0)).toBe(true);
  });
});
