/**
 * Route and navigation smoke test (gate criteria 1 and 2, gap A3).
 *
 * There is no browser in this environment, so this test exhausts the mechanical checks:
 * every registered page resolves to a real component export, the router has an explicit
 * branch for it, every sidebar item is a registered page, and every nav label exists in
 * both locales. A missing page, a typo'd import or an untranslated nav item fails here
 * instead of failing silently at runtime.
 *
 * Browser rendering itself remains NOT TESTED.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PAGES, PAGE_MIN_LEVEL } from '../src/core/rbac';
import { ar } from '../src/i18n/locales/ar';
import { en } from '../src/i18n/locales/en';
import { createApp } from '../server/index';

const EXPECTED_EXPORT: Record<string, string> = {
  dashboard: 'DashboardPage',
  reports: 'ReportsPage',
  customers: 'CustomerListPage',
  projects: 'ProjectsPage',
  quotations: 'QuotationPage',
  contracts: 'ContractPage',
  orders: 'SalesOrderPage',
  deliveryTickets: 'DeliveryTicketPage',
  priceLists: 'PriceListPage',
  commitments: 'VolumeCommitmentPage',
  crm: 'CrmActivitiesPage',
  complaints: 'ComplaintsPage',
  mixDesigns: 'MixDesignsPage',
  batches: 'BatchListPage',
  costBatches: 'CostBatchesPage',
  costReport: 'CostReportPage',
  costDashboard: 'CostDashboardPage',
  costSettings: 'CostSettingsPage',
  quality: 'QualityListPage',
  fleet: 'FleetListPage',
  dispatch: 'DispatchBoardPage',
  inventory: 'InventoryListPage',
  purchaseRequests: 'PurchaseRequestPage',
  purchaseOrders: 'PurchaseOrderPage',
  goodsReceipts: 'GoodsReceiptPage',
  suppliers: 'SuppliersPage',
  purchaseInvoices: 'PurchaseInvoicesPage',
  paymentVouchers: 'PaymentsVoucherPage',
  apAging: 'ApAgingReportPage',
  rules: 'RuleCataloguePage',
  invoices: 'InvoicesPage',
  payments: 'PaymentsPage',
  statement: 'StatementPage',
  ledger: 'LedgerPage',
  excelCenter: 'ExcelCenterPage',
  plants: 'PlantsPage',
  users: 'UsersPage',
  audit: 'AuditPage',
  settings: 'SettingsPage',
  designSystem: 'DesignSystemPage',
};

const MODULES: Record<string, Record<string, unknown>> = {
  dashboard: await import('../src/pages/DashboardPage'),
  reports: await import('../src/pages/ReportsPage'),
  customers: await import('../src/pages/CustomerListPage'),
  projects: await import('../src/pages/ProjectsPage'),
  quotations: await import('../src/pages/QuotationPage'),
  contracts: await import('../src/pages/ContractPage'),
  orders: await import('../src/pages/SalesOrderPage'),
  deliveryTickets: await import('../src/pages/DeliveryTicketPage'),
  priceLists: await import('../src/pages/PriceListPage'),
  commitments: await import('../src/pages/VolumeCommitmentPage'),
  crm: await import('../src/pages/CrmActivitiesPage'),
  complaints: await import('../src/pages/ComplaintsPage'),
  mixDesigns: await import('../src/pages/MixDesignsPage'),
  batches: await import('../src/pages/BatchListPage'),
  costBatches: await import('../src/pages/CostPages'),
  costReport: await import('../src/pages/CostPages'),
  costDashboard: await import('../src/pages/CostPages'),
  costSettings: await import('../src/pages/CostPages'),
  quality: await import('../src/pages/QualityListPage'),
  fleet: await import('../src/pages/FleetListPage'),
  dispatch: await import('../src/pages/DispatchBoardPage'),
  inventory: await import('../src/pages/InventoryListPage'),
  purchaseRequests: await import('../src/pages/PurchaseRequestPage'),
  purchaseOrders: await import('../src/pages/PurchaseOrderPage'),
  goodsReceipts: await import('../src/pages/GoodsReceiptPage'),
  suppliers: await import('../src/pages/SuppliersPage'),
  purchaseInvoices: await import('../src/pages/PurchaseInvoicesPage'),
  paymentVouchers: await import('../src/pages/PaymentsVoucherPage'),
  apAging: await import('../src/pages/ApAgingReportPage'),
  rules: await import('../src/pages/RuleCataloguePage'),
  invoices: await import('../src/pages/LedgerPages'),
  payments: await import('../src/pages/LedgerPages'),
  statement: await import('../src/pages/LedgerPages'),
  ledger: await import('../src/pages/LedgerPages'),
  excelCenter: await import('../src/pages/ExcelCenterPage'),
  plants: await import('../src/pages/StructurePages'),
  users: await import('../src/pages/StructurePages'),
  audit: await import('../src/pages/StructurePages'),
  settings: await import('../src/pages/StructurePages'),
  designSystem: await import('../src/pages/DesignSystemPage'),
};

const api = await createApp();

const status = async (path: string, method = 'GET'): Promise<number> =>
  (
    await api.handle(
      new Request(`http://localhost${path}`, {
        method,
        ...(method === 'GET'
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: '{}' }),
      }),
    )
  ).status;

const appSource = readFileSync('src/App.tsx', 'utf8');
const shellSource = readFileSync('src/components/AppShell.tsx', 'utf8');

const navGroups = [...shellSource.matchAll(/\{ key: 'nav\.([A-Za-z]+)', pages: \[([^\]]*)\] \}/g)].map(
  (match) => ({
    group: match[1]!,
    pages: match[2]!.split(',').map((entry) => entry.trim().replace(/'/g, '')).filter(Boolean),
  }),
);

describe('route and navigation smoke', () => {
  test('every registered page has a component and an explicit router branch', () => {
    const missing: string[] = [];
    for (const page of PAGES) {
      const module = MODULES[page];
      const exportName = EXPECTED_EXPORT[page];
      if (!module || !exportName || typeof module[exportName] !== 'function') {
        missing.push(`${page} -> ${exportName ?? '?'} (no component export)`);
        continue;
      }
      // SettingsPage is the final else branch; every other page must be matched explicitly.
      if (page !== 'settings' && !appSource.includes(`page === '${page}'`)) {
        missing.push(`${page} (no router branch)`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('the settings page is the router fallback, not an unreachable branch', () => {
    expect(appSource).toContain('<SettingsPage />');
  });

  test('every sidebar item is a registered page and every page appears in the sidebar', () => {
    const navPages = navGroups.flatMap((group) => group.pages);
    expect(navPages.length).toBeGreaterThan(0);
    expect(navPages.filter((page) => !(PAGES as readonly string[]).includes(page))).toEqual([]);
    const missingFromNav = PAGES.filter((page) => !navPages.includes(page));
    expect(missingFromNav).toEqual([]);
  });

  test('every nav group and page label exists in Arabic and English', () => {
    const keys = [
      ...navGroups.map((group) => `nav.${group.group}`),
      ...PAGES.map((page) => `nav.${page}`),
    ];
    const missingAr = keys.filter((key) => !(key in ar));
    const missingEn = keys.filter((key) => !(key in en));
    expect(missingAr).toEqual([]);
    expect(missingEn).toEqual([]);
  });

  test('B1 project, order and customer-write routes are mounted above the M1 fallback', async () => {
    const routes: Array<[string, string]> = [
      ['/api/projects', 'GET'],
      ['/api/projects/PRJ-0001', 'GET'],
      ['/api/projects', 'POST'],
      ['/api/projects/PRJ-0001', 'PATCH'],
      ['/api/orders', 'GET'],
      ['/api/orders/ORD-0001', 'GET'],
      ['/api/orders', 'POST'],
      ['/api/orders/ORD-0001/transition', 'POST'],
      ['/api/m1/customers', 'POST'],
      ['/api/m1/customers/CUS-0001', 'PATCH'],
    ];
    const unresolved: string[] = [];
    for (const [path, method] of routes) {
      // 401 (anonymous) or 503 (durable store required) both prove the route is owned
      // and gated by the API; a 404 would mean it was swallowed by the fallback.
      const code = await status(path, method);
      if (code !== 401 && code !== 503) unresolved.push(`${method} ${path} -> ${code}`);
    }
    expect(unresolved).toEqual([]);
  });

  test('fleet read, assign, trip and maintenance routes are mounted', async () => {
    const routes: Array<[string, string]> = [
      ['/api/fleet/trucks', 'GET'],
      ['/api/fleet/drivers', 'GET'],
      ['/api/fleet/assignments', 'GET'],
      ['/api/fleet/assignments', 'POST'],
      ['/api/fleet/trips/TRP-0001', 'GET'],
      ['/api/fleet/maintenance', 'GET'],
      ['/api/rules', 'GET'],
      ['/api/trips', 'GET'],
      ['/api/trips', 'POST'],
      ['/api/trips/TRP-0001/advance', 'POST'],
      ['/api/trips/TRP-0001/assign', 'POST'],
      ['/api/trips/TRP-0001/cancel', 'POST'],
      ['/api/trips/TRP-0001/events', 'GET'],
      ['/api/trucks', 'GET'],
      ['/api/trucks', 'POST'],
      ['/api/trucks/TRK-0001/status', 'PATCH'],
    ];
    const unresolved: string[] = [];
    for (const [path, method] of routes) {
      const code = await status(path, method);
      if (code !== 401 && code !== 503) unresolved.push(`${method} ${path} -> ${code}`);
    }
    expect(unresolved).toEqual([]);
  });

  test('report, staged-import and error-report routes answer, unknown paths do not', async () => {
    expect([401, 503]).toContain(await status('/api/csv/upload', 'POST'));
    expect([401, 503]).toContain(await status('/api/csv/commit/CSV-0001', 'POST'));
    expect([401, 503]).toContain(await status('/api/csv/errors/CSV-0001.csv'));
    expect([401, 503]).toContain(await status('/api/csv/staging/CSV-0001/reject', 'POST'));
    expect(await status('/api/reports/general_balance')).toBe(401);
    expect(await status('/api/excel/staged')).toBe(401);
    expect(await status('/api/excel/errors/STG-0001.csv')).toBe(401);
    expect(await status('/api/not-a-route')).toBe(404);
  });

  test('every page declares a minimum role level within the five-level matrix', () => {
    for (const page of PAGES) {
      expect(PAGE_MIN_LEVEL[page]).toBeGreaterThanOrEqual(1);
      expect(PAGE_MIN_LEVEL[page]).toBeLessThanOrEqual(5);
    }
  });
});
