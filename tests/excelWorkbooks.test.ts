/**
 * Every template must have a generated workbook (gap G6), not just a schema entry.
 * The endpoint serves any template through `buildTemplateWorkbook`; this proves the
 * generator handles all of them and emits a real (PK zip) xlsx.
 */
import { describe, expect, test } from 'bun:test';
import { TEMPLATES } from '../src/core/excelSchema';
import { buildTemplateWorkbook } from '../server/excel';

describe('Excel template workbooks', () => {
  test('every template generates a real xlsx workbook', async () => {
    expect(TEMPLATES.length).toBe(15);
    for (const template of TEMPLATES) {
      const buffer = await buildTemplateWorkbook(template);
      expect(buffer.length).toBeGreaterThan(2000);
      expect(buffer[0]).toBe(0x50); // P
      expect(buffer[1]).toBe(0x4b); // K (zip)
    }
  }, 30_000);
});
