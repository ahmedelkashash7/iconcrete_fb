import type { DemoDataset } from '../types';
import { computeGeneralBalance } from './balance';
import { customerOutstanding } from './credit';
import { round2, sumBy } from './money';

export const REPORT_TYPES = [
  'general_balance',
  'customer_statement',
  'supplier_statement',
  'sales_period',
  'cash_movement',
  'inventory',
  'production_period',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportColumn {
  key: string;
  labelKey: string;
  format: 'text' | 'money' | 'number' | 'date' | 'percent';
  align: 'start' | 'end';
}

export interface ReportResult {
  type: ReportType;
  titleKey: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number>>;
  totals: Record<string, number>;
  meta: { from: string; to: string; generatedAt: string; rowCount: number; extra?: string };
}

export interface ReportOptions {
  from: string;
  to: string;
  customerId?: string;
}

const day = (iso: string): string => iso.slice(0, 10);

const inRange = (iso: string, from: string, to: string): boolean => {
  const value = day(iso);
  return value >= from && value <= to;
};

const moneyColumn = (key: string, labelKey: string): ReportColumn => ({
  key,
  labelKey,
  format: 'money',
  align: 'end',
});

const textColumn = (key: string, labelKey: string): ReportColumn => ({
  key,
  labelKey,
  format: 'text',
  align: 'start',
});

const dateColumn = (key: string, labelKey: string): ReportColumn => ({
  key,
  labelKey,
  format: 'date',
  align: 'start',
});

const numberColumn = (key: string, labelKey: string): ReportColumn => ({
  key,
  labelKey,
  format: 'number',
  align: 'end',
});

const totalOf = (rows: Array<Record<string, string | number>>, key: string): number =>
  round2(
    rows.reduce((total, row) => {
      const value = row[key];
      return total + (typeof value === 'number' ? value : 0);
    }, 0),
  );

export const REPORT_TITLES: Record<ReportType, string> = {
  general_balance: 'report.type.generalBalance',
  customer_statement: 'report.type.customerStatement',
  supplier_statement: 'report.type.supplierStatement',
  sales_period: 'report.type.salesPeriod',
  cash_movement: 'report.type.cashMovement',
  inventory: 'report.type.inventory',
  production_period: 'report.type.productionPeriod',
};

export const buildReport = (
  type: ReportType,
  dataset: DemoDataset,
  options: ReportOptions,
): ReportResult => {
  const { from, to, customerId } = options;
  const metaBase = { from, to, generatedAt: new Date().toISOString(), rowCount: 0 };

  switch (type) {
    case 'general_balance': {
      const balance = computeGeneralBalance({
        cashTransactions: dataset.cashTransactions.filter((txn) => day(txn.txn_date) <= to),
        bankAccounts: dataset.bankAccounts,
        cheques: dataset.cheques,
        invoices: dataset.invoices.filter((invoice) => day(invoice.issue_date) <= to),
        inventory: dataset.inventory,
        fixedAssets: dataset.fixedAssets,
        loans: dataset.loans,
        supplierBills: dataset.supplierBills,
        salaryPayments: dataset.salaryPayments,
        rentals: dataset.rentals,
        utilityBills: dataset.utilityBills,
        maintenanceOrders: dataset.maintenanceOrders,
        asOf: `${to}T23:59:59.000Z`,
      });

      const rows = [
        ...balance.debit.map((line) => ({
          side: 'debit',
          sideLabelKey: 'balance.debitSide',
          item: line.labelKey,
          amount: line.amount,
          count: line.count,
          source: line.source,
        })),
        ...balance.credit.map((line) => ({
          side: 'credit',
          sideLabelKey: 'balance.creditSide',
          item: line.labelKey,
          amount: line.amount,
          count: line.count,
          source: line.source,
        })),
        {
          side: 'net',
          sideLabelKey: 'balance.net',
          item: 'balance.net',
          amount: balance.net,
          count: 0,
          source: '',
        },
      ];

      return {
        type,
        titleKey: REPORT_TITLES[type],
        columns: [
          textColumn('sideLabelKey', 'report.column.side'),
          textColumn('item', 'report.column.item'),
          moneyColumn('amount', 'report.column.amount'),
          numberColumn('count', 'report.column.count'),
          textColumn('source', 'report.column.source'),
        ],
        rows,
        totals: {
          amount: balance.net,
          debitTotal: balance.debitTotal,
          creditTotal: balance.creditTotal,
        },
        meta: { ...metaBase, rowCount: rows.length },
      };
    }

    case 'customer_statement': {
      const target = dataset.customers.find((customer) => customer.id === customerId) ?? dataset.customers[0];
      if (!target) {
        return {
          type,
          titleKey: REPORT_TITLES[type],
          columns: [],
          rows: [],
          totals: {},
          meta: { ...metaBase, rowCount: 0 },
        };
      }
      const invoices = dataset.invoices
        .filter((invoice) => invoice.customer_id === target.id)
        .filter((invoice) => inRange(invoice.issue_date, from, to) || inRange(invoice.due_date, from, to))
        .sort((a, b) => (a.issue_date < b.issue_date ? -1 : 1));

      const rows = invoices.map((invoice) => ({
        date: day(invoice.issue_date),
        document: invoice.invoice_no,
        description: `م³ ${invoice.subtotal > 0 ? '' : ''}${invoice.invoice_no}`,
        debit: invoice.grand_total,
        credit: invoice.paid_amount,
        balance: invoice.outstanding_amount,
        status: invoice.status,
      }));

      return {
        type,
        titleKey: REPORT_TITLES[type],
        columns: [
          dateColumn('date', 'report.column.date'),
          textColumn('document', 'report.column.document'),
          textColumn('description', 'report.column.description'),
          moneyColumn('debit', 'report.column.debit'),
          moneyColumn('credit', 'report.column.credit'),
          moneyColumn('balance', 'report.column.outstanding'),
          textColumn('status', 'report.column.status'),
        ],
        rows,
        totals: {
          debit: totalOf(rows, 'debit'),
          credit: totalOf(rows, 'credit'),
          balance: customerOutstanding(target.id, dataset.invoices),
        },
        meta: { ...metaBase, rowCount: rows.length, extra: customerId ?? target.id },
      };
    }

    case 'supplier_statement': {
      const rows = dataset.supplierBills
        .filter((bill) => inRange(bill.bill_date, from, to) || inRange(bill.due_date, from, to))
        .sort((a, b) => (a.bill_date < b.bill_date ? -1 : 1))
        .map((bill) => {
          const supplier = dataset.suppliers.find((candidate) => candidate.id === bill.supplier_id);
          return {
            date: day(bill.bill_date),
            document: bill.bill_no,
            supplier: supplier?.name_ar ?? bill.supplier_id,
            debit: bill.total,
            credit: bill.paid_amount,
            balance: bill.outstanding_amount,
            status: bill.status,
          };
        });

      return {
        type,
        titleKey: REPORT_TITLES[type],
        columns: [
          dateColumn('date', 'report.column.date'),
          textColumn('document', 'report.column.document'),
          textColumn('supplier', 'report.column.supplier'),
          moneyColumn('debit', 'report.column.debit'),
          moneyColumn('credit', 'report.column.credit'),
          moneyColumn('balance', 'report.column.outstanding'),
          textColumn('status', 'report.column.status'),
        ],
        rows,
        totals: {
          debit: totalOf(rows, 'debit'),
          credit: totalOf(rows, 'credit'),
          balance: totalOf(rows, 'balance'),
        },
        meta: { ...metaBase, rowCount: rows.length },
      };
    }

    case 'sales_period': {
      const rows = dataset.invoices
        .filter((invoice) => inRange(invoice.issue_date, from, to) && invoice.status !== 'void')
        .sort((a, b) => (a.issue_date < b.issue_date ? -1 : 1))
        .map((invoice) => {
          const customer = dataset.customers.find((candidate) => candidate.id === invoice.customer_id);
          return {
            date: day(invoice.issue_date),
            document: invoice.invoice_no,
            customer: customer?.name_ar ?? invoice.customer_id,
            subtotal: invoice.subtotal,
            vat: round2(invoice.grand_total - invoice.subtotal),
            total: invoice.grand_total,
            paid: invoice.paid_amount,
            outstanding: invoice.outstanding_amount,
          };
        });

      return {
        type,
        titleKey: REPORT_TITLES[type],
        columns: [
          dateColumn('date', 'report.column.date'),
          textColumn('document', 'report.column.document'),
          textColumn('customer', 'report.column.customer'),
          moneyColumn('subtotal', 'report.column.subtotal'),
          moneyColumn('vat', 'report.column.vat'),
          moneyColumn('total', 'report.column.total'),
          moneyColumn('paid', 'report.column.paid'),
          moneyColumn('outstanding', 'report.column.outstanding'),
        ],
        rows,
        totals: {
          subtotal: totalOf(rows, 'subtotal'),
          vat: totalOf(rows, 'vat'),
          total: totalOf(rows, 'total'),
          paid: totalOf(rows, 'paid'),
          outstanding: totalOf(rows, 'outstanding'),
        },
        meta: { ...metaBase, rowCount: rows.length },
      };
    }

    case 'cash_movement': {
      const rows = dataset.cashTransactions
        .filter((txn) => inRange(txn.txn_date, from, to))
        .sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1))
        .map((txn) => ({
          date: day(txn.txn_date),
          reference: txn.reference,
          description: txn.description_ar,
          in: txn.direction === 'in' ? txn.amount : 0,
          out: txn.direction === 'out' ? txn.amount : 0,
          net: txn.direction === 'in' ? txn.amount : -txn.amount,
        }));

      return {
        type,
        titleKey: REPORT_TITLES[type],
        columns: [
          dateColumn('date', 'report.column.date'),
          textColumn('reference', 'report.column.reference'),
          textColumn('description', 'report.column.description'),
          moneyColumn('in', 'report.column.in'),
          moneyColumn('out', 'report.column.out'),
          moneyColumn('net', 'report.column.net'),
        ],
        rows,
        totals: {
          in: totalOf(rows, 'in'),
          out: totalOf(rows, 'out'),
          net: totalOf(rows, 'net'),
        },
        meta: { ...metaBase, rowCount: rows.length },
      };
    }

    case 'inventory': {
      const rows = dataset.inventory.map((item) => {
        const material = dataset.materials.find((candidate) => candidate.id === item.material_id);
        const plant = dataset.plants.find((candidate) => candidate.id === item.plant_id);
        return {
          plant: plant?.name_ar ?? item.plant_id,
          material: material?.name_ar ?? item.material_id,
          unit: material?.unit ?? '',
          quantity: item.quantity,
          unitCost: item.unit_cost,
          value: round2(item.quantity * item.unit_cost),
          reorderLevel: material?.reorder_level ?? 0,
        };
      });

      return {
        type,
        titleKey: REPORT_TITLES[type],
        columns: [
          textColumn('plant', 'report.column.plant'),
          textColumn('material', 'report.column.material'),
          textColumn('unit', 'report.column.unit'),
          numberColumn('quantity', 'report.column.quantity'),
          moneyColumn('unitCost', 'report.column.unitCost'),
          moneyColumn('value', 'report.column.value'),
          numberColumn('reorderLevel', 'report.column.reorderLevel'),
        ],
        rows,
        totals: { value: totalOf(rows, 'value'), quantity: totalOf(rows, 'quantity') },
        meta: { ...metaBase, rowCount: rows.length },
      };
    }

    case 'production_period': {
      const grouped = new Map<string, { date: string; mixCode: string; volume: number; rejects: number; batches: number }>();
      dataset.batches
        .filter((batch) => inRange(batch.produced_at, from, to))
        .forEach((batch) => {
          const date = day(batch.produced_at);
          const key = `${date}|${batch.mix_code}`;
          const current = grouped.get(key) ?? { date, mixCode: batch.mix_code, volume: 0, rejects: 0, batches: 0 };
          current.volume = round2(current.volume + batch.volume_m3);
          current.rejects = round2(current.rejects + batch.reject_m3);
          current.batches += 1;
          grouped.set(key, current);
        });

      const rows = [...grouped.values()]
        .sort((a, b) => (a.date === b.date ? a.mixCode.localeCompare(b.mixCode) : a.date < b.date ? 1 : -1))
        .map((row) => ({
          date: row.date,
          mixCode: row.mixCode,
          batches: row.batches,
          volume: row.volume,
          rejects: row.rejects,
          wastePct: row.volume === 0 ? 0 : round2((row.rejects / (row.volume + row.rejects)) * 100),
        }));

      return {
        type,
        titleKey: REPORT_TITLES[type],
        columns: [
          dateColumn('date', 'report.column.date'),
          textColumn('mixCode', 'report.column.mixCode'),
          numberColumn('batches', 'report.column.batches'),
          numberColumn('volume', 'report.column.volume'),
          numberColumn('rejects', 'report.column.rejects'),
          { key: 'wastePct', labelKey: 'report.column.wastePct', format: 'percent', align: 'end' },
        ],
        rows,
        totals: {
          batches: totalOf(rows, 'batches'),
          volume: totalOf(rows, 'volume'),
          rejects: totalOf(rows, 'rejects'),
        },
        meta: { ...metaBase, rowCount: rows.length },
      };
    }

    default: {
      return {
        type,
        titleKey: REPORT_TITLES[type],
        columns: [],
        rows: [],
        totals: {},
        meta: { ...metaBase, rowCount: 0 },
      };
    }
  }
};

export const defaultReportRange = (): { from: string; to: string } => {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
};

export const monthlySeries = (dataset: DemoDataset, months = 6): Array<{ month: string; revenue: number; volume: number }> => {
  const now = new Date();
  const series: Array<{ month: string; revenue: number; volume: number }> = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const bucket = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = bucket.toISOString().slice(0, 7);
    const invoices = dataset.invoices.filter((invoice) => invoice.issue_date.slice(0, 7) === key);
    const batches = dataset.batches.filter((batch) => batch.produced_at.slice(0, 7) === key);
    series.push({
      month: key,
      revenue: sumBy(invoices, (invoice) => invoice.grand_total),
      volume: sumBy(batches, (batch) => batch.volume_m3),
    });
  }
  return series;
};
