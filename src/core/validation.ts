/**
 * Import validation engine for the Excel Integration Center (Addendum B3).
 * Pure functions only: same rules run in the browser preview and on the server,
 * so what the user previews is exactly what the server enforces.
 */

export type ColumnType = 'text' | 'id' | 'number' | 'integer' | 'date' | 'enum' | 'phone' | 'email';

export type ReferenceTable =
  | 'customers'
  | 'suppliers'
  | 'materials'
  | 'plants'
  | 'mix_designs'
  | 'employees'
  | 'trucks'
  | 'gl_accounts'
  | 'invoices';

export interface TemplateColumn {
  key: string;
  labelAr: string;
  labelEn: string;
  type: ColumnType;
  required: boolean;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  example: string;
  reference?: ReferenceTable;
  note?: string;
}

export interface ImportTemplate {
  id: string;
  entity: string;
  version: string;
  sheetName: string;
  descriptionAr: string;
  descriptionEn: string;
  columns: TemplateColumn[];
  uniqueKeys: string[];
}

export type IssueSeverity = 'error' | 'warning';

export interface RowIssue {
  rowNumber: number;
  column: string;
  code: string;
  messageAr: string;
  messageEn: string;
  value: string;
  severity: IssueSeverity;
}

export interface ValidatedRow {
  rowNumber: number;
  values: Record<string, string>;
  issues: RowIssue[];
}

export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errorCount: number;
  warningCount: number;
  duplicateIds: string[];
}

export interface ValidationResult {
  templateId: string;
  templateVersion: string;
  rows: ValidatedRow[];
  summary: ValidationSummary;
}

export interface ReferenceIndex {
  customers: readonly string[];
  suppliers: readonly string[];
  materials: readonly string[];
  plants: readonly string[];
  mix_designs: readonly string[];
  employees: readonly string[];
  trucks: readonly string[];
  /** Accounting references added with the M1 templates; optional for the demo fixture. */
  gl_accounts?: readonly string[];
  invoices?: readonly string[];
}

export interface ValidationContext {
  references?: Partial<ReferenceIndex>;
  /** IDs already stored for the same entity, used to block duplicate imports. */
  existingIds?: readonly string[];
  /** Optional customer credit data so Orders imports respect the credit limit. */
  credit?: readonly { customerId: string; creditLimit: number; outstanding: number; status: string }[];
}

const MESSAGES: Record<string, { ar: string; en: string }> = {
  MISSING_REQUIRED: { ar: 'قيمة مطلوبة — الحقل لا يمكن تركه فارغاً', en: 'Required value is missing' },
  INVALID_NUMBER: { ar: 'قيمة رقمية غير صحيحة', en: 'Value is not a valid number' },
  INVALID_INTEGER: { ar: 'يجب أن يكون عدداً صحيحاً', en: 'Value must be a whole number' },
  INVALID_DATE: { ar: 'تاريخ غير صحيح — الصيغة المطلوبة YYYY-MM-DD', en: 'Invalid date — use YYYY-MM-DD' },
  INVALID_EMAIL: { ar: 'بريد إلكتروني غير صحيح', en: 'Invalid email address' },
  INVALID_PHONE: { ar: 'رقم هاتف غير صحيح', en: 'Invalid phone number' },
  INVALID_ENUM: { ar: 'قيمة غير مسموح بها', en: 'Value is not in the allowed list' },
  INVALID_ID: { ar: 'صيغة المعرّف غير صحيحة (مثال: CUS-0001)', en: 'Invalid identifier format (example: CUS-0001)' },
  OUT_OF_RANGE: { ar: 'القيمة خارج النطاق المسموح', en: 'Value is outside the allowed range' },
  TOO_LONG: { ar: 'النص أطول من الحد المسموح', en: 'Text is longer than the allowed limit' },
  DUPLICATE_IN_FILE: { ar: 'معرّف مكرر داخل الملف نفسه', en: 'Duplicate identifier inside the same file' },
  DUPLICATE_EXISTING: { ar: 'المعرّف موجود بالفعل في النظام', en: 'Identifier already exists in the system' },
  BROKEN_REFERENCE: { ar: 'مرجع غير موجود في النظام', en: 'Referenced record does not exist' },
  SUSPICIOUS_FORMULA: { ar: 'تم إلغاء محتوى يشبه معادلة لأسباب أمنية', en: 'Formula-like content was neutralised for security' },
  YIELD_OUT_OF_RANGE: { ar: 'عائد الخلطة خارج النطاق 0.98–1.02 م³', en: 'Mix yield is outside the 0.98–1.02 m3 range' },
  WC_TOO_HIGH: { ar: 'نسبة المياه/الأسمنت أعلى من حد ظرف التعرض', en: 'Water/cement ratio exceeds the exposure-class limit' },
  CREDIT_LIMIT_EXCEEDED: { ar: 'قيمة الطلب تتجاوز سقف ائتمان العميل', en: 'Order value exceeds the customer credit limit' },
  CUSTOMER_NOT_ACTIVE: { ar: 'العميل غير نشط ولا يمكن استقبال طلبات له', en: 'Customer is not active' },
  VOLUME_TOO_LARGE: { ar: 'الحجم أكبر من السعة الدفعة الواحدة 12 م³', en: 'Volume exceeds the 12 m3 single-batch capacity' },
};

const message = (code: string): { ar: string; en: string } =>
  MESSAGES[code] ?? { ar: 'خطأ في التحقق', en: 'Validation error' };

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export const sanitizeValue = (raw: unknown, maxLength = 250): string => {
  const text = raw === null || raw === undefined ? '' : String(raw);
  return text.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

export const looksLikeFormula = (value: string): boolean => FORMULA_PREFIX.test(value.trim());

export const parseNumber = (value: string): number | null => {
  const normalized = value
    .replace(/,/g, '')
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  if (normalized === '') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?[0-9\s-]{7,20}$/;
const ID_RE = /^[A-Za-z]{2,4}-[A-Za-z0-9-]{1,24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const W_C_LIMITS: Record<string, number> = { XC1: 0.6, XC4: 0.45, XS2: 0.45, XS3: 0.4 };

const makeIssue = (
  rowNumber: number,
  column: TemplateColumn,
  code: string,
  value: string,
  severity: IssueSeverity,
  suffixAr = '',
  suffixEn = '',
): RowIssue => {
  const base = message(code);
  return {
    rowNumber,
    column: column.key,
    code,
    messageAr: `${column.labelAr}: ${base.ar}${suffixAr}`,
    messageEn: `${column.labelEn}: ${base.en}${suffixEn}`,
    value,
    severity,
  };
};

interface CellContext {
  rowNumber: number;
  column: TemplateColumn;
  rawValue: string;
  sanitized: Record<string, string>;
  numeric: Record<string, number>;
  context: ValidationContext;
}

const validateCellFormat = (cell: CellContext): RowIssue | null => {
  const { rowNumber, column, rawValue } = cell;
  const value = rawValue;

  if (column.required && value === '') {
    return makeIssue(rowNumber, column, 'MISSING_REQUIRED', '', 'error');
  }
  if (value === '') return null;

  // Numeric fields are parsed rather than stored verbatim, and phone numbers legitimately start
  // with "+" (e.g. +201000009101), so neither is treated as a formula prefix. Every other column
  // still runs the prefix guard.
  const formulaExempt: ColumnType[] = ['number', 'integer', 'phone'];
  if (looksLikeFormula(value) && !formulaExempt.includes(column.type)) {
    return makeIssue(rowNumber, column, 'SUSPICIOUS_FORMULA', value, 'warning');
  }

  switch (column.type) {
    case 'number':
    case 'integer': {
      const parsed = parseNumber(value);
      if (parsed === null) return makeIssue(rowNumber, column, 'INVALID_NUMBER', value, 'error');
      if (column.type === 'integer' && !Number.isInteger(parsed)) {
        return makeIssue(rowNumber, column, 'INVALID_INTEGER', value, 'error');
      }
      return null;
    }
    case 'date': {
      if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
        return makeIssue(rowNumber, column, 'INVALID_DATE', value, 'error');
      }
      return null;
    }
    case 'email':
      return EMAIL_RE.test(value) ? null : makeIssue(rowNumber, column, 'INVALID_EMAIL', value, 'error');
    case 'phone':
      return PHONE_RE.test(value) ? null : makeIssue(rowNumber, column, 'INVALID_PHONE', value, 'error');
    case 'enum':
      return column.enumValues?.includes(value)
        ? null
        : makeIssue(rowNumber, column, 'INVALID_ENUM', value, 'error', ` (${column.enumValues?.join(' / ') ?? ''})`);
    case 'id':
      return ID_RE.test(value) ? null : makeIssue(rowNumber, column, 'INVALID_ID', value, 'error');
    case 'text':
    default:
      return null;
  }
};

const applyRange = (cell: CellContext, parsed: number): RowIssue | null => {
  const { column, rowNumber } = cell;
  if (column.min !== undefined && parsed < column.min) {
    return makeIssue(rowNumber, column, 'OUT_OF_RANGE', String(parsed), 'error', ` (الحد الأدنى ${column.min})`, ` (minimum ${column.min})`);
  }
  if (column.max !== undefined && parsed > column.max) {
    return makeIssue(rowNumber, column, 'OUT_OF_RANGE', String(parsed), 'error', ` (الحد الأقصى ${column.max})`, ` (maximum ${column.max})`);
  }
  return null;
};

const businessRules = (template: ImportTemplate, cell: CellContext): RowIssue[] => {
  const issues: RowIssue[] = [];
  const { sanitized, rowNumber } = cell;

  if (template.id === 'mix_designs') {
    const cement = parseNumber(sanitized.cement_kg ?? '');
    const sand = parseNumber(sanitized.sand_kg ?? '');
    const gravel = parseNumber(sanitized.gravel_kg ?? '');
    const water = parseNumber(sanitized.water_l ?? '');
    const air = parseNumber(sanitized.air_percent ?? '');
    const sgCement = parseNumber(sanitized.sg_cement ?? '');
    const sgSand = parseNumber(sanitized.sg_sand ?? '');
    const sgGravel = parseNumber(sanitized.sg_gravel ?? '');

    if (
      cement !== null && sand !== null && gravel !== null && water !== null &&
      air !== null && sgCement !== null && sgSand !== null && sgGravel !== null &&
      sgCement > 0 && sgSand > 0 && sgGravel > 0
    ) {
      const yieldM3 =
        cement / (sgCement * 1000) +
        sand / (sgSand * 1000) +
        gravel / (sgGravel * 1000) +
        water / 1000 +
        air / 100;
      const yieldColumn = template.columns.find((column) => column.key === 'cement_kg');
      if (yieldColumn && (yieldM3 < 0.98 || yieldM3 > 1.02)) {
        issues.push(
          makeIssue(
            rowNumber,
            yieldColumn,
            'YIELD_OUT_OF_RANGE',
            yieldM3.toFixed(4),
            'error',
            ` — العائد المحسوب ${yieldM3.toFixed(4)} م³`,
            ` — computed yield ${yieldM3.toFixed(4)} m3`,
          ),
        );
      }

      const binder = cement;
      const exposure = sanitized.exposure_class ?? 'XC1';
      const limit = W_C_LIMITS[exposure] ?? 0.6;
      const wc = binder > 0 ? water / binder : 0;
      const wcColumn = template.columns.find((column) => column.key === 'water_l');
      if (wcColumn && wc > limit) {
        issues.push(
          makeIssue(
            rowNumber,
            wcColumn,
            'WC_TOO_HIGH',
            wc.toFixed(3),
            'error',
            ` — النسبة ${wc.toFixed(2)} والحد ${limit}`,
            ` — ratio ${wc.toFixed(2)} exceeds limit ${limit}`,
          ),
        );
      }
    }
  }

  if (template.id === 'orders') {
    const customerId = sanitized.customer_id ?? '';
    const volume = parseNumber(sanitized.volume_m3 ?? '');
    const unitPrice = parseNumber(sanitized.unit_price ?? '');
    const pumpFee = parseNumber(sanitized.pump_fee ?? '0') ?? 0;
    const credit = cell.context.credit?.find((entry) => entry.customerId === customerId);
    const volumeColumn = template.columns.find((column) => column.key === 'volume_m3');

    if (volumeColumn && volume !== null && volume > 12) {
      issues.push(
        makeIssue(rowNumber, volumeColumn, 'VOLUME_TOO_LARGE', String(volume), 'warning'),
      );
    }

    if (credit && volumeColumn) {
      const orderValue = volume !== null && unitPrice !== null ? volume * unitPrice + pumpFee : 0;
      if (credit.status !== 'active') {
        issues.push(makeIssue(rowNumber, volumeColumn, 'CUSTOMER_NOT_ACTIVE', customerId, 'error'));
      } else if (orderValue > 0 && credit.outstanding + orderValue > credit.creditLimit) {
        issues.push(
          makeIssue(
            rowNumber,
            volumeColumn,
            'CREDIT_LIMIT_EXCEEDED',
            String(orderValue),
            'error',
            ` — المتاح ${Math.max(credit.creditLimit - credit.outstanding, 0)} ج.م`,
            ` — available ${Math.max(credit.creditLimit - credit.outstanding, 0)} EGP`,
          ),
        );
      }
    }
  }

  return issues;
};

export const validateRows = (
  template: ImportTemplate,
  rawRows: readonly Readonly<Record<string, string>>[],
  context: ValidationContext = {},
): ValidationResult => {
  const rows: ValidatedRow[] = [];
  const duplicateIds = new Set<string>();
  const seen = new Map<string, Set<string>>(template.uniqueKeys.map((key) => [key, new Set<string>()]));

  rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 2; // header is row 1
    const sanitized: Record<string, string> = {};
    for (const column of template.columns) {
      sanitized[column.key] = sanitizeValue(rawRow[column.key], column.maxLength ?? 250);
    }

    const issues: RowIssue[] = [];
    for (const column of template.columns) {
      const value = sanitized[column.key] ?? '';
      const cell: CellContext = {
        rowNumber,
        column,
        rawValue: value,
        sanitized,
        numeric: {},
        context,
      };
      const formatIssue = validateCellFormat(cell);
      if (formatIssue) issues.push(formatIssue);

      if (column.type === 'number' || column.type === 'integer') {
        const parsed = parseNumber(value);
        if (parsed !== null) {
          const rangeIssue = applyRange(cell, parsed);
          if (rangeIssue) issues.push(rangeIssue);
        }
      }

      if (column.reference && value !== '') {
        const ids = context.references?.[column.reference];
        if (ids && !ids.includes(value)) {
          issues.push(makeIssue(rowNumber, column, 'BROKEN_REFERENCE', value, 'error'));
        }
      }

      if (template.uniqueKeys.includes(column.key) && value !== '') {
        const bucket = seen.get(column.key);
        if (bucket?.has(value)) {
          duplicateIds.add(value);
          issues.push(makeIssue(rowNumber, column, 'DUPLICATE_IN_FILE', value, 'error'));
        } else {
          bucket?.add(value);
          const existing = context.existingIds;
          if (existing && existing.includes(value)) {
            duplicateIds.add(value);
            issues.push(makeIssue(rowNumber, column, 'DUPLICATE_EXISTING', value, 'error'));
          }
        }
      }
    }

    if (issues.every((issue) => issue.severity !== 'error')) {
      issues.push(...businessRules(template, {
        rowNumber,
        column: template.columns[0] as TemplateColumn,
        rawValue: '',
        sanitized,
        numeric: {},
        context,
      }));
    }

    rows.push({ rowNumber, values: sanitized, issues });
  });

  const errorRows = rows.filter((row) => row.issues.some((issue) => issue.severity === 'error')).length;
  const errorCount = rows.reduce(
    (total, row) => total + row.issues.filter((issue) => issue.severity === 'error').length,
    0,
  );
  const warningCount = rows.reduce(
    (total, row) => total + row.issues.filter((issue) => issue.severity === 'warning').length,
    0,
  );

  return {
    templateId: template.id,
    templateVersion: template.version,
    rows,
    summary: {
      totalRows: rows.length,
      validRows: rows.length - errorRows,
      errorRows,
      errorCount,
      warningCount,
      duplicateIds: [...duplicateIds],
    },
  };
};

/** Guard used when exporting any user-supplied text into a spreadsheet. */
export const escapeForSpreadsheet = (value: string): string =>
  looksLikeFormula(value) ? `'${value}` : value;

export const issueCatalog = MESSAGES;
