import type { DemoDataset } from '../types';
import { computeGeneralBalance, type GeneralBalance } from './balance';
import { percent, round2, sumBy } from './money';

export interface DashboardKpis {
  producedTodayM3: number;
  rejectedTodayM3: number;
  activeTrucks: number;
  totalTrucks: number;
  onTimeDeliveryPct: number;
  avg7dStrengthMpa: number;
  overdueReceivables: number;
  lowStockCount: number;
  creditUtilizationPct: number;
  pendingBatches: number;
}

export type AlertSeverity = 'danger' | 'warning' | 'info';

export interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  labelKey: string;
  values: Record<string, string | number>;
  hrefPage: 'reports' | 'customers' | 'excelCenter' | 'dashboard';
}

const dayKey = (iso: string): string => iso.slice(0, 10);

const todayKey = (): string => new Date().toISOString().slice(0, 10);

const daysAgoKey = (days: number): string => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

export const balanceFor = (dataset: DemoDataset, asOf = new Date().toISOString()): GeneralBalance =>
  computeGeneralBalance({
    cashTransactions: dataset.cashTransactions,
    bankAccounts: dataset.bankAccounts,
    cheques: dataset.cheques,
    invoices: dataset.invoices,
    inventory: dataset.inventory,
    fixedAssets: dataset.fixedAssets,
    loans: dataset.loans,
    supplierBills: dataset.supplierBills,
    salaryPayments: dataset.salaryPayments,
    rentals: dataset.rentals,
    utilityBills: dataset.utilityBills,
    maintenanceOrders: dataset.maintenanceOrders,
    asOf,
  });

export const computeKpis = (dataset: DemoDataset): DashboardKpis => {
  const today = todayKey();
  const todaysBatches = dataset.batches.filter((batch) => dayKey(batch.produced_at) === today);
  const producedToday = sumBy(todaysBatches, (batch) => batch.volume_m3);
  const rejectedToday = sumBy(todaysBatches, (batch) => batch.reject_m3);

  const completedTrips = dataset.trips.filter((trip) => trip.status === 'completed');
  const onTime = completedTrips.filter((trip) => trip.on_time).length;

  const weekStart = daysAgoKey(6);
  const weekTests = dataset.qualityTests.filter((test) => dayKey(test.tested_at) >= weekStart);
  const avgStrength = weekTests.length === 0 ? 0 : sumBy(weekTests, (test) => test.strength_7d_mpa) / weekTests.length;

  const overdue = dataset.invoices.filter(
    (invoice) => invoice.status === 'overdue' && dayKey(invoice.due_date) < today,
  );

  const lowStock = dataset.inventory.filter((item) => {
    const material = dataset.materials.find((candidate) => candidate.id === item.material_id);
    return material !== undefined && item.quantity <= material.reorder_level;
  });

  const creditExtended = sumBy(dataset.customers, (customer) => customer.credit_limit_egp);
  const creditUsed = sumBy(dataset.invoices, (invoice) => invoice.outstanding_amount);

  return {
    producedTodayM3: round2(producedToday),
    rejectedTodayM3: round2(rejectedToday),
    activeTrucks: dataset.trucks.filter((truck) => truck.status === 'active').length,
    totalTrucks: dataset.trucks.length,
    onTimeDeliveryPct: percent(onTime, completedTrips.length),
    avg7dStrengthMpa: round2(avgStrength),
    overdueReceivables: sumBy(overdue, (invoice) => invoice.outstanding_amount),
    lowStockCount: lowStock.length,
    creditUtilizationPct: percent(creditUsed, creditExtended),
    pendingBatches: todaysBatches.length,
  };
};

/** Actionable alerts derived from data (never hard-coded numbers). */
export const buildAlerts = (dataset: DemoDataset, limit = 6): DashboardAlert[] => {
  const today = todayKey();
  const sosKey = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const alerts: DashboardAlert[] = [];

  const dueCheques = dataset.cheques.filter(
    (cheque) =>
      cheque.status === 'under_collection' &&
      dayKey(cheque.due_date) >= today &&
      dayKey(cheque.due_date) <= sosKey,
  );
  dueCheques.forEach((cheque) => {
    alerts.push({
      id: `cheque-${cheque.id}`,
      severity: 'warning',
      labelKey: 'alert.chequeDue',
      values: { no: cheque.cheque_no, date: dayKey(cheque.due_date) },
      hrefPage: 'reports',
    });
  });

  dataset.loans
    .filter((loan) => loan.status === 'overdue')
    .forEach((loan) => {
      alerts.push({
        id: `loan-${loan.id}`,
        severity: 'danger',
        labelKey: 'alert.loanOverdue',
        values: { bank: loan.bank_name_ar, date: dayKey(loan.next_installment_date) },
        hrefPage: 'reports',
      });
    });

  dataset.inventory.forEach((item) => {
    const material = dataset.materials.find((candidate) => candidate.id === item.material_id);
    if (material && item.quantity <= material.reorder_level) {
      alerts.push({
        id: `stock-${item.id}`,
        severity: 'danger',
        labelKey: 'alert.lowStock',
        values: { material: material.name_ar, qty: item.quantity, unit: material.unit },
        hrefPage: 'excelCenter',
      });
    }
  });

  dataset.invoices
    .filter((invoice) => invoice.status === 'overdue')
    .slice(0, 3)
    .forEach((invoice) => {
      alerts.push({
        id: `invoice-${invoice.id}`,
        severity: 'info',
        labelKey: 'alert.invoiceOverdue',
        values: { no: invoice.invoice_no, date: dayKey(invoice.due_date) },
        hrefPage: 'customers',
      });
    });

  return alerts.slice(0, limit);
};
