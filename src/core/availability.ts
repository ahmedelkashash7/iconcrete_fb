/**
 * Honest KPI availability (gap G3).
 *
 * A missing table must never be rendered as a real zero. Each dashboard metric declares
 * which collections/tables back it, and this module reports one of five states:
 *
 *   available        real rows back the number
 *   real_zero        real rows exist, the computed value happens to be 0
 *   no_records       the tables exist but the tenant has no rows yet
 *   not_implemented  the module has no tables in this phase
 *   unavailable      the data source could not be read
 */
import type { DemoDataset } from '../types';
import type { DashboardKpis } from './metrics';

export type DataStatus = 'available' | 'real_zero' | 'no_records' | 'not_implemented' | 'unavailable';

export type DataSourceMode = 'postgres' | 'demo' | 'test';

export interface KpiState {
  status: DataStatus;
  source: DataSourceMode;
  /** Rows backing the metric, or null when the module has no table yet. */
  records: number | null;
  reason?: string;
}

export type KpiKey = keyof DashboardKpis;

interface MetricSpec {
  /** Table that would back the metric in postgres mode; null means the module has no table. */
  table: string | null;
  collections: (keyof DemoDataset)[];
}

export const KPI_SPECS: Record<KpiKey, MetricSpec> = {
  producedTodayM3: { table: null, collections: ['batches'] },
  rejectedTodayM3: { table: null, collections: ['batches'] },
  activeTrucks: { table: null, collections: ['trucks'] },
  totalTrucks: { table: null, collections: ['trucks'] },
  onTimeDeliveryPct: { table: null, collections: ['trips'] },
  avg7dStrengthMpa: { table: null, collections: ['qualityTests'] },
  overdueReceivables: { table: 'invoices', collections: ['invoices'] },
  lowStockCount: { table: null, collections: ['inventory', 'materials'] },
  creditUtilizationPct: { table: 'customers', collections: ['customers'] },
  pendingBatches: { table: null, collections: ['batches'] },
};

const rowCount = (dataset: DemoDataset, spec: MetricSpec): number =>
  spec.collections.reduce((total, key) => {
    const value = dataset[key];
    return total + (Array.isArray(value) ? value.length : 0);
  }, 0);

export interface KpiStateOptions {
  /** Set when the dataset could not be read at all; every metric becomes unavailable. */
  readError?: string;
}

export const kpiStates = (
  dataset: DemoDataset,
  kpis: DashboardKpis,
  mode: DataSourceMode,
  options: KpiStateOptions = {},
): Record<KpiKey, KpiState> => {
  const result = {} as Record<KpiKey, KpiState>;
  for (const key of Object.keys(KPI_SPECS) as KpiKey[]) {
    const spec = KPI_SPECS[key];
    if (options.readError) {
      result[key] = { status: 'unavailable', source: mode, records: null, reason: options.readError };
      continue;
    }
    // Demo and test adapters are intentionally in-memory; the number is real for the demo
    // fixture but the UI labels the source, so it is never mistaken for tenant data.
    if (spec.table === null && mode === 'postgres') {
      result[key] = { status: 'not_implemented', source: mode, records: null };
      continue;
    }
    const records = rowCount(dataset, spec);
    if (records === 0) {
      result[key] = {
        status: spec.table === null ? 'not_implemented' : 'no_records',
        source: mode,
        records,
      };
      continue;
    }
    const value = Number(kpis[key]);
    result[key] = {
      status: Number.isFinite(value) && value === 0 ? 'real_zero' : 'available',
      source: mode,
      records,
    };
  }
  return result;
};

export const unavailableKpiStates = (
  mode: DataSourceMode,
  reason = 'data_source_unavailable',
): Record<KpiKey, KpiState> =>
  Object.fromEntries(
    (Object.keys(KPI_SPECS) as KpiKey[]).map((key) => [
      key,
      { status: 'unavailable' as const, source: mode, records: null, reason },
    ]),
  ) as Record<KpiKey, KpiState>;

export const summarizeKpiStates = (
  states: Record<KpiKey, KpiState>,
): Record<DataStatus, number> => {
  const summary: Record<DataStatus, number> = {
    available: 0,
    real_zero: 0,
    no_records: 0,
    not_implemented: 0,
    unavailable: 0,
  };
  for (const state of Object.values(states)) summary[state.status] += 1;
  return summary;
};
