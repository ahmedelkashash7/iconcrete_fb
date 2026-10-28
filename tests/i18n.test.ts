import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ar } from '../src/i18n/locales/ar';
import { en } from '../src/i18n/locales/en';
import { BRAND } from '../src/brand';

const walk = (directory: string): string[] => {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
};

describe('bilingual resources', () => {
  test('Arabic is the locked default language with RTL', () => {
    expect(BRAND.defaultLang).toBe('ar');
    expect(BRAND.supportedLangs).toEqual(['ar', 'en']);
    expect(ar['html.lang']).toBe('ar');
    expect(en['html.lang']).toBe('en');
  });

  test('Arabic and English have exactly the same keys', () => {
    const arKeys = Object.keys(ar).sort();
    const enKeys = Object.keys(en).sort();
    expect(arKeys).toEqual(enKeys);
    expect(arKeys.length).toBeGreaterThan(150);
  });

  test('no translation value is empty', () => {
    for (const key of Object.keys(ar)) {
      expect((ar as Record<string, string>)[key]?.trim().length).toBeGreaterThan(0);
      expect((en as Record<string, string>)[key]?.trim().length).toBeGreaterThan(0);
    }
  });

  test('every literal t() key used in the UI exists in both languages', () => {
    const files = walk('src');
    const used = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const regex = /\bt\(\s*'([^']+)'/g;
      let match = regex.exec(source);
      while (match) {
        if (match[1]) used.add(match[1]);
        match = regex.exec(source);
      }
    }
    expect(used.size).toBeGreaterThan(50);
    const missing = [...used].filter((key) => !(key in ar));
    expect(missing).toEqual([]);
  });

  test('Arabic strings actually contain Arabic characters', () => {
    const arabicPattern = /[\u0600-\u06FF]/;
    const sample = ['dashboard.title', 'login.title', 'excel.title', 'customers.title', 'report.title'];
    for (const key of sample) {
      expect(arabicPattern.test(ar[key as keyof typeof ar])).toBe(true);
    }
  });
});
