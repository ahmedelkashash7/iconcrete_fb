import type { RoleLevel } from '../types';

export const PAGES = [
  'dashboard',
  'reports',
  'customers',
  'plants',
  'users',
  'excelCenter',
  'audit',
  'settings',
] as const;

export type PageKey = (typeof PAGES)[number];

/** Minimum role level per page (PART 2.2 RBAC matrix). */
export const PAGE_MIN_LEVEL: Record<PageKey, RoleLevel> = {
  dashboard: 1,
  reports: 1,
  customers: 4,
  excelCenter: 4,
  plants: 5,
  users: 5,
  audit: 5,
  settings: 5,
};

export const ROLE_KEYS: Record<RoleLevel, string> = {
  1: 'role.viewer',
  2: 'role.operator',
  3: 'role.dispatcher',
  4: 'role.manager',
  5: 'role.owner',
};

export const canAccessPage = (level: RoleLevel, page: PageKey): boolean =>
  level >= PAGE_MIN_LEVEL[page];

export const visiblePages = (level: RoleLevel): PageKey[] =>
  PAGES.filter((page) => canAccessPage(level, page));

/** Viewer is limited to read-only reports: exporting is denied (API returns 403). */
export const canExportReports = (level: RoleLevel): boolean => level >= 2;

export const canImportExcel = (level: RoleLevel): boolean => level >= 4;
