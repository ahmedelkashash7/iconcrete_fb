import { describe, expect, test } from 'bun:test';
import { TEMPLATES, templateById, templateHeaderRow } from '../src/core/excelSchema';

describe('Excel import templates', () => {
  test('exposes the seven Phase 1 templates', () => {
    const ids = TEMPLATES.map((template) => template.id).sort();
    expect(ids).toEqual(
      ['customers', 'employees', 'fleet', 'materials', 'mix_designs', 'orders', 'suppliers'].sort(),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every template is versioned and bilingual', () => {
    for (const template of TEMPLATES) {
      expect(template.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(template.descriptionAr.length).toBeGreaterThan(5);
      expect(template.descriptionEn.length).toBeGreaterThan(5);
      expect(template.sheetName.length).toBeGreaterThan(2);
      expect(template.columns.length).toBeGreaterThan(3);
    }
  });

  test('column keys are unique and examples respect enums', () => {
    for (const template of TEMPLATES) {
      const keys = template.columns.map((column) => column.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const column of template.columns) {
        expect(column.labelAr.length).toBeGreaterThan(0);
        expect(column.labelEn.length).toBeGreaterThan(0);
        if (column.enumValues) {
          expect(column.enumValues).toContain(column.example);
        }
      }
      for (const key of template.uniqueKeys) {
        expect(keys).toContain(key);
      }
    }
  });

  test('customers template carries the credit and plant requirements', () => {
    const template = templateById('customers');
    if (!template) throw new Error('customers template missing');
    const byKey = new Map(template.columns.map((column) => [column.key, column]));
    expect(byKey.get('credit_limit_egp')?.required).toBe(true);
    expect(byKey.get('credit_days')?.min).toBe(0);
    expect(byKey.get('credit_days')?.max).toBe(180);
    expect(byKey.get('plant_id')?.reference).toBe('plants');
    expect(byKey.get('status')?.enumValues).toEqual(['active', 'suspended', 'archived']);
    expect(byKey.get('priority_tier')?.enumValues).toEqual(['A', 'B', 'C']);
  });

  test('mix design template encodes the 1 m3 rule inputs', () => {
    const template = templateById('mix_designs');
    if (!template) throw new Error('mix template missing');
    const keys = template.columns.map((column) => column.key);
    for (const key of ['cement_kg', 'sand_kg', 'gravel_kg', 'water_l', 'air_percent', 'sg_cement', 'sg_sand', 'sg_gravel']) {
      expect(keys).toContain(key);
    }
  });

  test('header row format is stable for generated workbooks', () => {
    const template = templateById('customers');
    if (!template) throw new Error('customers template missing');
    const headers = templateHeaderRow(template);
    expect(headers[0]).toBe('معرّف العميل | Customer ID');
    expect(headers.every((header) => header.includes(' | '))).toBe(true);
    expect(templateById('unknown-template')).toBeUndefined();
  });
});
