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

const EXPECTED_EXPORT: Record<string, string> = {
  dashboard: 'DashboardPage',
  reports: 'ReportsPage',
  customers: 'CustomersPage',
  invoices: 'InvoicesPage',
  payments: 'PaymentsPage',
  statement: 'StatementPage',
  ledger: 'LedgerPage',
  excelCenter: 'ExcelCenterPage',
  plants: 'PlantsPage',
  users: 'UsersPage',
  audit: 'AuditPage',
  settings: 'SettingsPage',
};

const MODULES: Record<string, Record<string, unknown>> = {
  dashboard: await import('../src/pages/DashboardPage'),
  reports: await import('../src/pages/ReportsPage'),
  customers: await import('../src/pages/CustomersPage'),
  invoices: await import('../src/pages/LedgerPages'),
  payments: await import('../src/pages/LedgerPages'),
  statement: await import('../src/pages/LedgerPages'),
  ledger: await import('../src/pages/LedgerPages'),
  excelCenter: await import('../src/pages/ExcelCenterPage'),
  plants: await import('../src/pages/StructurePages'),
  users: await import('../src/pages/StructurePages'),
  audit: await import('../src/pages/StructurePages'),
  settings: await import('../src/pages/StructurePages'),
};

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

  test('every page declares a minimum role level within the five-level matrix', () => {
    for (const page of PAGES) {
      expect(PAGE_MIN_LEVEL[page]).toBeGreaterThanOrEqual(1);
      expect(PAGE_MIN_LEVEL[page]).toBeLessThanOrEqual(5);
    }
  });
});
