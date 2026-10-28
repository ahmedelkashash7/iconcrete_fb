import { describe, expect, test } from 'bun:test';
import { TEMPLATES, templateById } from '../src/core/excelSchema';
import {
  escapeForSpreadsheet,
  looksLikeFormula,
  parseNumber,
  sanitizeValue,
  validateRows,
  type ReferenceIndex,
} from '../src/core/validation';

const references: ReferenceIndex = {
  customers: ['CUS-0001'],
  suppliers: ['SUP-001'],
  materials: ['MAT-001'],
  plants: ['PLT-0001'],
  mix_designs: [],
  employees: [],
  trucks: ['TRK-001'],
};

const context = { references, existingIds: ['CUS-0001'] };

const customersTemplate = () => {
  const template = templateById('customers');
  if (!template) throw new Error('customers template missing');
  return template;
};

const validCustomer = (overrides: Record<string, string> = {}) => ({
  customer_id: 'CUS-2000',
  name_ar: 'شركة اختبار',
  name_en: 'Test Co.',
  tax_id: 'TAX-2000',
  phone: '+201000000099',
  email: 'test@example.com',
  address: 'القاهرة',
  priority_tier: 'A',
  credit_limit_egp: '1000000',
  credit_days: '30',
  status: 'active',
  plant_id: 'PLT-0001',
  ...overrides,
});

describe('validation engine', () => {
  test('accepts a valid customer row', () => {
    const result = validateRows(customersTemplate(), [validCustomer()], context);
    expect(result.summary.totalRows).toBe(1);
    expect(result.summary.errorRows).toBe(0);
    expect(result.summary.validRows).toBe(1);
    expect(result.rows[0]?.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  test('flags every required and typed field error', () => {
    const result = validateRows(
      customersTemplate(),
      [
        validCustomer({
          customer_id: '12345',
          name_ar: '',
          email: 'bad-email',
          phone: 'abc',
          priority_tier: 'Z',
          credit_limit_egp: 'abc',
          credit_days: '400',
        }),
      ],
      context,
    );
    const codes = result.rows[0]?.issues.map((issue) => issue.code) ?? [];
    expect(codes).toContain('INVALID_ID');
    expect(codes).toContain('MISSING_REQUIRED');
    expect(codes).toContain('INVALID_EMAIL');
    expect(codes).toContain('INVALID_PHONE');
    expect(codes).toContain('INVALID_ENUM');
    expect(codes).toContain('INVALID_NUMBER');
    expect(codes).toContain('OUT_OF_RANGE');
    expect(result.summary.errorRows).toBe(1);
  });

  test('detects duplicates inside the file and against existing ids', () => {
    const inFile = validateRows(
      customersTemplate(),
      [validCustomer(), validCustomer()],
      { references },
    );
    expect(inFile.summary.duplicateIds).toContain('CUS-2000');
    expect(inFile.rows[1]?.issues.map((issue) => issue.code)).toContain('DUPLICATE_IN_FILE');

    const existing = validateRows(customersTemplate(), [validCustomer({ customer_id: 'CUS-0001' })], context);
    expect(existing.rows[0]?.issues.map((issue) => issue.code)).toContain('DUPLICATE_EXISTING');
  });

  test('detects broken references and negative numbers', () => {
    const result = validateRows(
      customersTemplate(),
      [validCustomer({ plant_id: 'PLT-9999', credit_limit_egp: '-500' })],
      context,
    );
    const codes = result.rows[0]?.issues.map((issue) => issue.code) ?? [];
    expect(codes).toContain('BROKEN_REFERENCE');
    expect(codes).toContain('OUT_OF_RANGE');
  });

  test('neutralises formula-like content', () => {
    const result = validateRows(
      customersTemplate(),
      [validCustomer({ name_en: '=cmd|calc' })],
      context,
    );
    expect(result.rows[0]?.issues.map((issue) => issue.code)).toContain('SUSPICIOUS_FORMULA');
    expect(looksLikeFormula('=1+1')).toBe(true);
    expect(escapeForSpreadsheet('=1+1')).toBe("'=1+1");
    expect(escapeForSpreadsheet('Normal name')).toBe('Normal name');
  });

  test('accepts international and local Egyptian phone numbers without a formula warning', () => {
    for (const phone of ['+201000009101', '01000009102']) {
      const result = validateRows(customersTemplate(), [validCustomer({ phone })], context);
      expect(result.summary.errorRows).toBe(0);
      expect(result.summary.warningCount).toBe(0);
      expect(result.rows[0]?.issues).toHaveLength(0);
    }
  });

  test('rejects a spreadsheet formula typed into a phone field', () => {
    for (const phone of ['=HYPERLINK("http://evil.example","click")', '@SUM(1+1)']) {
      const result = validateRows(customersTemplate(), [validCustomer({ phone })], context);
      const codes = result.rows[0]?.issues.map((issue) => issue.code) ?? [];
      expect(codes).toContain('INVALID_PHONE');
      expect(result.summary.errorRows).toBe(1);
    }
  });

  test('still flags formula prefixes on non-phone fields', () => {
    for (const payload of ['=HYPERLINK("http://evil.example","click")', '@SUM(1+1)']) {
      const result = validateRows(customersTemplate(), [validCustomer({ name_en: payload })], context);
      expect(result.rows[0]?.issues.map((issue) => issue.code)).toContain('SUSPICIOUS_FORMULA');
    }
  });

  test('looksLikeFormula keeps detecting every prefix character', () => {
    expect(looksLikeFormula('+201000009101')).toBe(true);
    expect(looksLikeFormula('=1+1')).toBe(true);
    expect(looksLikeFormula('@SUM(1)')).toBe(true);
    expect(looksLikeFormula('-1+1')).toBe(true);
    expect(looksLikeFormula('01000009102')).toBe(false);
  });

  test('sanitises control characters, spacing and length', () => {
    expect(sanitizeValue('  شركة\u0000   النيل  ')).toBe('شركة النيل');
    expect(sanitizeValue('x'.repeat(300), 50)).toHaveLength(50);
    expect(sanitizeValue(undefined)).toBe('');
  });

  test('parses numbers with separators and Arabic-Indic digits', () => {
    expect(parseNumber('1,000,500')).toBe(1000500);
    expect(parseNumber('٤٥٠')).toBe(450);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  test('mix design yield rule rejects an overweight batch', () => {
    const template = templateById('mix_designs');
    if (!template) throw new Error('mix template missing');
    const row = {
      mix_id: 'MIX-900',
      code: 'C30X',
      grade: 'C30',
      exposure_class: 'XC1',
      cement_kg: '400',
      sand_kg: '650',
      gravel_kg: '1250',
      water_l: '180',
      air_percent: '2',
      sg_cement: '3.15',
      sg_sand: '2.65',
      sg_gravel: '2.68',
      status: 'approved',
    };
    const result = validateRows(template, [row], { references });
    const codes = result.rows[0]?.issues.map((issue) => issue.code) ?? [];
    expect(codes).toContain('YIELD_OUT_OF_RANGE');
    expect(result.summary.errorRows).toBe(1);

    const good = validateRows(template, [{ ...row, gravel_kg: '1150' }], { references });
    expect(good.summary.errorRows).toBe(0);
  });

  test('mix design rejects a W/C above the exposure limit', () => {
    const template = templateById('mix_designs');
    if (!template) throw new Error('mix template missing');
    const result = validateRows(
      template,
      [
        {
          mix_id: 'MIX-901',
          code: 'C30W',
          grade: 'C30',
          exposure_class: 'XC1',
          cement_kg: '320',
          sand_kg: '700',
          gravel_kg: '1180',
          water_l: '200',
          air_percent: '2',
          sg_cement: '3.15',
          sg_sand: '2.65',
          sg_gravel: '2.68',
          status: 'approved',
        },
      ],
      { references },
    );
    expect(result.rows[0]?.issues.map((issue) => issue.code)).toContain('WC_TOO_HIGH');
  });

  test('orders enforce the customer credit limit and status', () => {
    const template = templateById('orders');
    if (!template) throw new Error('orders template missing');
    const base = {
      order_id: 'ORD-9001',
      customer_id: 'CUS-0001',
      mix_code: 'C30',
      volume_m3: '100',
      pour_date: '2026-10-30',
      unit_price: '2000',
      pump_fee: '0',
      distance_km: '20',
      status: 'confirmed',
      plant_id: 'PLT-0001',
    };
    const creditContext = {
      references,
      credit: [{ customerId: 'CUS-0001', creditLimit: 150_000, outstanding: 10_000, status: 'active' }],
    };
    const blocked = validateRows(template, [base], creditContext);
    expect(blocked.rows[0]?.issues.map((issue) => issue.code)).toContain('CREDIT_LIMIT_EXCEEDED');

    const allowed = validateRows(template, [{ ...base, volume_m3: '50' }], creditContext);
    expect(allowed.summary.errorRows).toBe(0);

    const inactive = validateRows(
      template,
      [base],
      {
        references,
        credit: [{ customerId: 'CUS-0001', creditLimit: 10_000_000, outstanding: 0, status: 'suspended' }],
      },
    );
    expect(inactive.rows[0]?.issues.map((issue) => issue.code)).toContain('CUSTOMER_NOT_ACTIVE');
  });

  test('warns when a single order exceeds one batch capacity', () => {
    const template = templateById('orders');
    if (!template) throw new Error('orders template missing');
    const result = validateRows(
      template,
      [
        {
          order_id: 'ORD-9002',
          customer_id: 'CUS-0001',
          mix_code: 'C30',
          volume_m3: '40',
          pour_date: '2026-10-30',
          unit_price: '1700',
          pump_fee: '0',
          distance_km: '10',
          status: 'confirmed',
          plant_id: 'PLT-0001',
        },
      ],
      { references },
    );
    const warnings = result.rows[0]?.issues.filter((issue) => issue.severity === 'warning') ?? [];
    expect(warnings.map((issue) => issue.code)).toContain('VOLUME_TOO_LARGE');
    expect(result.summary.errorRows).toBe(0);
  });

  test('every template validates headers and produces bilingual messages', () => {
    for (const template of TEMPLATES) {
      const empty = Object.fromEntries(template.columns.map((column) => [column.key, '']));
      const result = validateRows(template, [empty], { references });
      expect(result.summary.totalRows).toBe(1);
      expect(result.summary.errorRows).toBe(1);
      const firstIssue = result.rows[0]?.issues[0];
      expect(firstIssue?.messageAr.length).toBeGreaterThan(5);
      expect(firstIssue?.messageEn.length).toBeGreaterThan(5);
    }
  });
});
