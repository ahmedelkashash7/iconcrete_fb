/**
 * UI contract tests for the M1 accounting screens (gap G5).
 *
 * No browser is available, so these cover what can be proven without one: the screens
 * are reachable at the right role level, every visible string exists in both languages,
 * Arabic is the default, and the honest states (loading/empty/error/forbidden) have
 * labels instead of invented data. Visual rendering remains NOT TESTED.
 */
import { describe, expect, test } from 'bun:test';
import { ar } from '../src/i18n/locales/ar';
import { en } from '../src/i18n/locales/en';
import { PAGE_MIN_LEVEL, PAGES, canAccessPage, visiblePages } from '../src/core/rbac';

const NEW_PAGES = ['invoices', 'payments', 'statement', 'ledger'] as const;

const STATE_KEYS = [
  'common.loading',
  'common.noData',
  'errors.forbidden',
  'errors.network',
  'common.demoMode',
] as const;

const SCREEN_KEYS = [
  'invoices.title',
  'invoices.subtitle',
  'invoices.customer',
  'invoices.number',
  'invoices.create',
  'invoices.post',
  'invoices.empty',
  'payments.title',
  'payments.subtitle',
  'payments.amount',
  'payments.method',
  'payments.submit',
  'payments.empty',
  'statement.title',
  'statement.opening',
  'statement.closing',
  'statement.pick',
  'statement.empty',
  'ledger.title',
  'ledger.account',
  'ledger.pick',
  'ledger.empty',
] as const;

describe('M1 accounting screens', () => {
  test('are registered pages with role levels', () => {
    for (const page of NEW_PAGES) {
      expect(PAGES).toContain(page);
      expect(PAGE_MIN_LEVEL[page]).toBeGreaterThanOrEqual(1);
    }
    // Manager can invoice and read statements; a receipt clerk can take payments.
    expect(canAccessPage(4, 'invoices')).toBe(true);
    expect(canAccessPage(3, 'invoices')).toBe(false);
    expect(canAccessPage(2, 'payments')).toBe(true);
    expect(canAccessPage(2, 'ledger')).toBe(true);
    expect(canAccessPage(1, 'statement')).toBe(false);
    expect(visiblePages(2)).toContain('payments');
    expect(visiblePages(2)).not.toContain('invoices');
  });

  test('have every label in Arabic and English, with no empty strings', () => {
    for (const key of [...SCREEN_KEYS, ...STATE_KEYS]) {
      expect(typeof ar[key as keyof typeof ar]).toBe('string');
      expect(typeof en[key as keyof typeof en]).toBe('string');
      expect(ar[key as keyof typeof ar].length).toBeGreaterThan(0);
      expect(en[key as keyof typeof en].length).toBeGreaterThan(0);
      expect(ar[key as keyof typeof ar]).not.toBe(en[key as keyof typeof en]);
    }
  });

  test('Arabic is the default language and its labels use Arabic script', () => {
    expect(ar['html.lang']).toBe('ar');
    expect(en['html.lang']).toBe('en');
    for (const key of ['invoices.title', 'payments.title', 'statement.title', 'ledger.title'] as const) {
      expect(/[\u0600-\u06FF]/.test(ar[key])).toBe(true);
      expect(/[\u0600-\u06FF]/.test(en[key])).toBe(false);
    }
  });

  test('both locales expose exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  test('demo mode is labelled instead of being passed off as a database', () => {
    expect(ar['common.demoMode']).toContain('التجريبي');
    expect(en['common.demoMode'].toLowerCase()).toContain('demo');
  });
});
