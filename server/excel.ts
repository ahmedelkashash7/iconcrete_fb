import ExcelJS from 'exceljs';
import { BRAND } from '../src/brand';
import type { ImportTemplate, ValidationResult } from '../src/core/validation';
import { escapeForSpreadsheet } from '../src/core/validation';
import { parseCsv } from './csv';

const PURPLE = 'FF6D28D9';
const PURPLE_DARK = 'FF4C1D95';
const LIGHT = 'FFF8FAFC';
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 } as const;

const brandBanner = (sheet: ExcelJS.Worksheet): void => {
  sheet.getCell(1, 1).value = BRAND.name;
  sheet.getCell(2, 1).value = BRAND.tagline;
};

/** Import template workbook: header row, examples, dropdowns, freeze panes, RTL. */
export const buildTemplateWorkbook = async (template: ImportTemplate): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${BRAND.name} — ${BRAND.tagline}`;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(template.sheetName, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 20 },
  });

  sheet.getCell('A1').value = `${BRAND.name} — ${template.descriptionAr}`;
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: PURPLE_DARK } };
  sheet.getCell('A2').value = `${BRAND.name} — ${template.descriptionEn}`;
  sheet.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  sheet.getCell('A3').value = `Template version ${template.version} | ${template.descriptionAr} | Data below is an EXAMPLE row — replace it.`;
  sheet.getCell('A3').font = { size: 9, color: { argb: 'FFDC2626' } };

  const headerRowIndex = 4;
  const headers = template.columns.map((column) => `${column.labelAr} | ${column.labelEn}`);
  headers.forEach((header, index) => {
    const cell = sheet.getCell(headerRowIndex, index + 1);
    cell.value = header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sheet.getColumn(index + 1).width = Math.max(18, Math.min(34, header.length + 4));
  });
  sheet.getRow(headerRowIndex).height = 32;

  template.columns.forEach((column, index) => {
    const cell = sheet.getCell(headerRowIndex + 1, index + 1);
    cell.value = column.example;
    cell.font = { color: { argb: 'FF94A3B8' }, italic: true };
  });

  if (template.columns.some((column) => column.enumValues)) {
    const noteRow = headerRowIndex + 3;
    sheet.getCell(noteRow, 1).value = 'Allowed values / القيم المسموح بها:';
    sheet.getCell(noteRow, 1).font = { bold: true, size: 9 };
    template.columns.forEach((column, index) => {
      if (column.enumValues) {
        sheet.getCell(noteRow, index + 1).value = `${column.labelEn}: ${column.enumValues.join(' / ')}`;
        sheet.getCell(noteRow, index + 1).font = { size: 9, color: { argb: 'FF475569' } };
      }
    });
  }

  for (let row = headerRowIndex + 1; row <= headerRowIndex + 500; row += 1) {
    template.columns.forEach((column, index) => {
      const cell = sheet.getCell(row, index + 1);
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
      };
      if (column.enumValues) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: !column.required,
          formulae: [`"${column.enumValues.join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'قيمة غير مسموحة / Invalid value',
          error: `${column.labelAr} / ${column.labelEn}: ${column.enumValues.join(' / ')}`,
        };
      }
    });
  }

  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: template.columns.length },
  };

  const instructions = workbook.addWorksheet('Instructions', {
    views: [{ rightToLeft: true }],
  });
  instructions.getColumn(1).width = 6;
  instructions.getColumn(2).width = 70;
  instructions.getColumn(3).width = 70;
  brandBanner(instructions);
  instructions.getCell('A4').value = 'تعليمات الاستيراد | Import instructions';
  instructions.getCell('A4').font = { bold: true, size: 14, color: { argb: PURPLE_DARK } };
  instructions.getCell('A6').value = '#';
  instructions.getCell('B6').value = 'العربية';
  instructions.getCell('C6').value = 'English';
  [instructions.getCell('A6'), instructions.getCell('B6'), instructions.getCell('C6')].forEach((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
  });

  const steps: Array<[string, string]> = [
    ['لا تحذف صف العناوين ولا تغيّر ترتيب الأعمدة.', 'Do not delete the header row or reorder columns.'],
    ['الصف أسفل العناوين مثال توضيحي — استبدله ببياناتك.', 'The row below the headers is an example — replace it with your data.'],
    ['استخدم القيم المسموح بها فقط في أعمدة القوائم المنسدلة.', 'Only use the allowed values in dropdown columns.'],
    ['لا تضع معادلات في الخلايا؛ يتم رفض أي محتوى يشبه معادلة.', 'Do not place formulas in cells; formula-like content is rejected.'],
    ['احفظ الملف بصيغة .xlsx ثم ارفعه في مركز تكامل Excel داخل النظام.', 'Save as .xlsx and upload it in the Excel Integration Center.'],
    ['أي صف به خطأ لن يُستورد؛ حمّل تقرير الأخطاء لمعرفة السبب.', 'Rows with errors are not imported; download the error report for details.'],
    ['الاستيراد لا يعيد كتابة سجل موجود بصمت أبداً.', 'Importing never silently overwrites an existing record.'],
    ['هذا القالب لا يحتوي ماكروات ولا ينفّذ أي كود.', 'This template contains no macros and executes no code.'],
  ];
  steps.forEach(([ar, en], index) => {
    const row = 7 + index;
    instructions.getCell(row, 1).value = index + 1;
    instructions.getCell(row, 2).value = ar;
    instructions.getCell(row, 3).value = en;
    instructions.getCell(row, 1).alignment = { horizontal: 'center' };
    instructions.getCell(row, 2).alignment = { wrapText: true, vertical: 'top' };
    instructions.getCell(row, 3).alignment = { wrapText: true, vertical: 'top' };
    instructions.getRow(row).height = 32;
    if (index % 2 === 0) {
      for (let column = 1; column <= 3; column += 1) {
        instructions.getCell(row, column).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: LIGHT },
        };
      }
    }
  });

  const fields = workbook.addWorksheet('Fields', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
  const fieldHeaders = ['Column key', 'العربية', 'English', 'Type', 'Required', 'Allowed / Range', 'Example'];
  fieldHeaders.forEach((header, index) => {
    const cell = fields.getCell(3, index + 1);
    cell.value = header;
    cell.font = HEADER_FONT;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    fields.getColumn(index + 1).width = index < 5 ? 20 : 34;
  });
  fields.getCell('A1').value = `${BRAND.name} — ${template.descriptionEn}`;
  fields.getCell('A1').font = { bold: true, size: 13, color: { argb: PURPLE_DARK } };
  template.columns.forEach((column, index) => {
    const row = fields.getRow(4 + index);
    row.getCell(1).value = column.key;
    row.getCell(2).value = column.labelAr;
    row.getCell(3).value = column.labelEn;
    row.getCell(4).value = column.type;
    row.getCell(5).value = column.required ? 'Yes / نعم' : 'No / لا';
    row.getCell(6).value =
      column.enumValues?.join(' / ') ??
      [column.min !== undefined ? `min ${column.min}` : '', column.max !== undefined ? `max ${column.max}` : '']
        .filter(Boolean)
        .join(' ') ??
      '';
    row.getCell(7).value = column.example;
    row.alignment = { vertical: 'middle', wrapText: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

export interface ParsedUpload {
  records: Record<string, string>[];
  headerMatches: string[];
  missingHeaders: string[];
}

const normaliseHeader = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\s|_\-]+/g, '')
    .trim();

/** Parse an uploaded CSV/XLSX into records keyed by template column keys. */
export const parseUpload = async (
  file: File,
  template: ImportTemplate,
): Promise<ParsedUpload> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsm') || name.endsWith('.xlsb') || name.endsWith('.xls')) {
    throw new Error('UNSUPPORTED_TYPE');
  }

  let headers: string[] = [];
  let rawRows: string[][] = [];

  if (name.endsWith('.csv')) {
    const parsed = parseCsv(await file.text());
    headers = parsed.headers;
    rawRows = parsed.rows;
  } else if (name.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('EMPTY_FILE');
    let headerRowNumber = 0;
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 10); rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values = row.values as ExcelJS.CellValue[];
      const matches = values.filter((value) => typeof value === 'string' && value.includes('|')).length;
      if (matches >= 2) {
        headerRowNumber = rowNumber;
        break;
      }
    }
    if (headerRowNumber === 0) headerRowNumber = sheet.rowCount > 0 ? 1 : 0;
    const headerRow = sheet.getRow(headerRowNumber);
    const columnCount = Math.max(headerRow.cellCount, template.columns.length);
    for (let column = 1; column <= columnCount; column += 1) {
      const value = headerRow.getCell(column).value;
      headers.push(value === null || value === undefined ? '' : String(value).trim());
    }
    for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values: string[] = [];
      for (let column = 1; column <= columnCount; column += 1) {
        const value = row.getCell(column).value;
        if (value === null || value === undefined) {
          values.push('');
        } else if (typeof value === 'object') {
          if ('result' in value && value.result !== undefined && value.result !== null) {
            values.push(String(value.result));
          } else if ('text' in value) {
            values.push(String((value as { text: string }).text));
          } else if ('richText' in value) {
            values.push(
              (value as { richText: Array<{ text: string }> }).richText.map((part) => part.text).join(''),
            );
          } else if (value instanceof Date) {
            values.push(value.toISOString().slice(0, 10));
          } else {
            values.push('');
          }
        } else {
          values.push(String(value));
        }
      }
      if (values.some((value) => value.trim() !== '')) rawRows.push(values);
    }
  } else {
    throw new Error('UNSUPPORTED_TYPE');
  }

  const headerMatches: string[] = [];
  const missingHeaders: string[] = [];
  const headerIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    if (header !== '') headerIndex.set(normaliseHeader(header), index);
  });

  const columnIndex = new Map<string, number>();
  template.columns.forEach((column) => {
    const candidates = [
      normaliseHeader(`${column.labelAr} | ${column.labelEn}`),
      normaliseHeader(column.labelAr),
      normaliseHeader(column.labelEn),
      normaliseHeader(column.key),
    ];
    const found = candidates.find((candidate) => headerIndex.has(candidate));
    if (found !== undefined) {
      const index = headerIndex.get(found);
      if (index !== undefined) {
        columnIndex.set(column.key, index);
        headerMatches.push(column.key);
        return;
      }
    }
    missingHeaders.push(column.key);
  });

  const records = rawRows.slice(0, 5000).map((row) => {
    const record: Record<string, string> = {};
    template.columns.forEach((column) => {
      const index = columnIndex.get(column.key);
      const value = index === undefined ? '' : (row[index] ?? '');
      record[column.key] = value;
    });
    return record;
  });

  return { records, headerMatches, missingHeaders };
};

/** Error report workbook with bilingual messages and the rejected rows. */
export const buildErrorWorkbook = async (
  result: ValidationResult,
  template: ImportTemplate,
  fileName: string,
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${BRAND.name} — ${BRAND.tagline}`;

  const summary = workbook.addWorksheet('Error_Report', { views: [{ rightToLeft: true }] });
  summary.getColumn(1).width = 12;
  summary.getColumn(2).width = 24;
  summary.getColumn(3).width = 14;
  summary.getColumn(4).width = 60;
  summary.getColumn(5).width = 60;
  summary.getColumn(6).width = 26;
  brandBanner(summary);
  summary.getCell('A4').value = `تقرير أخطاء الاستيراد | Import error report — ${template.sheetName}`;
  summary.getCell('A4').font = { bold: true, size: 15, color: { argb: PURPLE_DARK } };
  summary.getCell('A5').value = `File: ${fileName} | Template ${template.id} v${template.version} | Generated ${new Date().toISOString()}`;
  summary.getCell('A5').font = { size: 9, color: { argb: 'FF64748B' } };
  summary.getCell('A6').value =
    `Rows: ${result.summary.totalRows} | Valid: ${result.summary.validRows} | With errors: ${result.summary.errorRows} | Errors: ${result.summary.errorCount} | Warnings: ${result.summary.warningCount}`;
  summary.getCell('A6').font = { bold: true, size: 10, color: { argb: 'FFDC2626' } };

  const headers = ['Row', 'Column', 'Severity', 'الرسالة', 'Message', 'Value'];
  headers.forEach((header, index) => {
    const cell = summary.getCell(8, index + 1);
    cell.value = header;
    cell.font = HEADER_FONT;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  let rowNumber = 9;
  result.rows.forEach((row) => {
    row.issues.forEach((issue) => {
      const row = summary.getRow(rowNumber);
      row.getCell(1).value = issue.rowNumber;
      row.getCell(2).value = issue.column;
      row.getCell(3).value = issue.severity;
      row.getCell(4).value = issue.messageAr;
      row.getCell(5).value = issue.messageEn;
      row.getCell(6).value = escapeForSpreadsheet(issue.value);
      row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
      row.height = 28;
      if (issue.severity === 'error') {
        row.getCell(3).font = { bold: true, color: { argb: 'FFDC2626' } };
      } else {
        row.getCell(3).font = { bold: true, color: { argb: 'FFF59E0B' } };
      }
      rowNumber += 1;
    });
  });

  const rowsSheet = workbook.addWorksheet('Rejected_Rows', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  const rowHeaders = ['Row', ...template.columns.map((column) => `${column.labelAr} | ${column.labelEn}`)];
  rowHeaders.forEach((header, index) => {
    const cell = rowsSheet.getCell(1, index + 1);
    cell.value = header;
    cell.font = HEADER_FONT;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
    cell.alignment = { horizontal: 'center', wrapText: true, vertical: 'middle' };
    rowsSheet.getColumn(index + 1).width = index === 0 ? 8 : 24;
  });
  let outRow = 2;
  result.rows
    .filter((row) => row.issues.some((issue) => issue.severity === 'error'))
    .forEach((row) => {
      rowsSheet.getCell(outRow, 1).value = row.rowNumber;
      template.columns.forEach((column, index) => {
        rowsSheet.getCell(outRow, index + 2).value = escapeForSpreadsheet(row.values[column.key] ?? '');
      });
      outRow += 1;
    });

  const notes = workbook.addWorksheet('How_to_fix', { views: [{ rightToLeft: true }] });
  notes.getColumn(1).width = 90;
  notes.getColumn(2).width = 90;
  notes.getCell('A1').value = 'كيف تصحح الملف | How to fix the file';
  notes.getCell('A1').font = { bold: true, size: 14, color: { argb: PURPLE_DARK } };
  const guidance: Array<[string, string]> = [
    ['افتح قالب الاستيراد الأصلي، وصحح الصفوف المذكورة في هذا التقرير.', 'Open the original import template and fix the rows listed here.'],
    ['لا تغيّر أسماء الأعمدة أو ترتيبها.', 'Do not rename or reorder columns.'],
    ['التزم بالقيم المسموح بها في أعمدة القوائم المنسدلة.', 'Use only allowed values in dropdown columns.'],
    ['تأكد من صحة التواريخ بصيغة YYYY-MM-DD.', 'Use dates in YYYY-MM-DD format.'],
    ['أعد رفع الملف بعد التصحيح — لن يتم تعديل أي سجل موجود بصمت.', 'Re-upload after fixing — existing records are never overwritten silently.'],
  ];
  guidance.forEach(([ar, en], index) => {
    notes.getCell(index + 3, 1).value = ar;
    notes.getCell(index + 3, 2).value = en;
    notes.getCell(index + 3, 1).alignment = { wrapText: true, vertical: 'top' };
    notes.getCell(index + 3, 2).alignment = { wrapText: true, vertical: 'top' };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};
