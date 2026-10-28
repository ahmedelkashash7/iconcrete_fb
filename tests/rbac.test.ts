import { describe, expect, test } from 'bun:test';
import {
  canAccessPage,
  canExportReports,
  canImportExcel,
  PAGES,
  PAGE_MIN_LEVEL,
  ROLE_KEYS,
  visiblePages,
} from '../src/core/rbac';
import type { RoleLevel } from '../src/types';

const LEVELS: RoleLevel[] = [1, 2, 3, 4, 5];

describe('RBAC matrix', () => {
  test('defines a minimum level for every page', () => {
    for (const page of PAGES) {
      expect(PAGE_MIN_LEVEL[page]).toBeGreaterThanOrEqual(1);
      expect(PAGE_MIN_LEVEL[page]).toBeLessThanOrEqual(5);
    }
    expect(new Set(PAGES).size).toBe(PAGES.length);
  });

  test('viewer sees only dashboard and reports', () => {
    expect(visiblePages(1).sort()).toEqual(['dashboard', 'reports']);
    expect(canAccessPage(1, 'dashboard')).toBe(true);
    expect(canAccessPage(1, 'customers')).toBe(false);
    expect(canAccessPage(1, 'users')).toBe(false);
    expect(canAccessPage(1, 'excelCenter')).toBe(false);
  });

  test('plant manager gets customers and Excel center but not administration', () => {
    expect(canAccessPage(4, 'customers')).toBe(true);
    expect(canAccessPage(4, 'excelCenter')).toBe(true);
    expect(canAccessPage(4, 'users')).toBe(false);
    expect(canAccessPage(4, 'plants')).toBe(false);
    expect(canAccessPage(4, 'audit')).toBe(false);
  });

  test('owner sees every page', () => {
    expect(visiblePages(5).length).toBe(PAGES.length);
    for (const page of PAGES) expect(canAccessPage(5, page)).toBe(true);
  });

  test('report export is denied to the viewer role only', () => {
    expect(canExportReports(1)).toBe(false);
    for (const level of [2, 3, 4, 5] as RoleLevel[]) {
      expect(canExportReports(level)).toBe(true);
    }
  });

  test('Excel import requires a plant manager level', () => {
    expect(canImportExcel(1)).toBe(false);
    expect(canImportExcel(3)).toBe(false);
    expect(canImportExcel(4)).toBe(true);
    expect(canImportExcel(5)).toBe(true);
  });

  test('every role level has a translation key', () => {
    for (const level of LEVELS) {
      expect(ROLE_KEYS[level]).toMatch(/^role\./);
    }
  });
});
