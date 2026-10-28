import ExcelJS from 'exceljs';
import { BRAND } from '../src/brand';
import { ar } from '../src/i18n/locales/ar';
import { en } from '../src/i18n/locales/en';
import type { Lang } from '../src/types';
import type { ReportResult } from '../src/core/reports';
import { escapeForSpreadsheet } from '../src/core/validation';

const PURPLE = 'FF6D28D9';
const PURPLE_DARK = 'FF4C1D95';
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 } as const;

const dict = (lang: Lang): Record<string, string> => (lang === 'ar' ? ar : en);

const translate = (lang: Lang, key: string): string => dict(lang)[key] ?? key;

const valueFor = (lang: Lang, raw: string | number, labelKeys: Set<string>): string | number => {
  if (typeof raw === 'number') return raw;
  if (labelKeys.has(raw)) return translate(lang, raw);
  if (raw.startsWith('/api/') || raw.startsWith('http')) return escapeForSpreadsheet(raw);
  return escapeForSpreadsheet(raw);
};

const brandHeader = (sheet: ExcelJS.Worksheet, span: number, lang: Lang, title: string): void => {
  sheet.mergeCells(1, 1, 1, span);
  sheet.getCell(1, 1).value = BRAND.name;
  sheet.getCell(1, 1).font = { bold: true, size: 18, color: { argb: PURPLE_DARK } };
  sheet.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 30;

  sheet.mergeCells(2, 1, 2, span);
  sheet.getCell(2, 1).value = BRAND.tagline;
  sheet.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  sheet.getCell(2, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(3, 1, 3, span);
  sheet.getCell(3, 1).value = title;
  sheet.getCell(3, 1).font = { bold: true, size: 13, color: { argb: 'FF0F172A' } };
  sheet.getCell(3, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(4, 1, 4, span);
  sheet.getCell(4, 1).value = `${translate(lang, 'report.generatedAt')}: ${new Date().toISOString()} | ${BRAND.demoCompany.ar} — ${BRAND.demoPlant.ar}`;
  sheet.getCell(4, 1).font = { size: 9, color: { argb: 'FF64748B' } };
  sheet.getCell(4, 1).alignment = { horizontal: 'center' };
};

const styleDataHeader = (sheet: ExcelJS.Worksheet, rowNumber: number, columns: number): void => {
  const row = sheet.getRow(rowNumber);
  row.height = 24;
  for (let index = 1; index <= columns; index += 1) {
    const cell = row.getCell(index);
    cell.font = HEADER_FONT;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: PURPLE_DARK } } };
  }
};

/** Build a real .xlsx export for any generated report. */
export const buildReportWorkbook = async (report: ReportResult, lang: Lang): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${BRAND.name} — ${BRAND.tagline}`;
  workbook.created = new Date();

  const sheetName = report.type.slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ rightToLeft: lang === 'ar', state: 'frozen', ySplit: 6 }],
  });

  brandHeader(sheet, Math.max(report.columns.length, 1), lang, translate(lang, report.titleKey));
  const labelKeys = new Set(report.columns.map((column) => column.labelKey));

  const headerRow = 6;
  report.columns.forEach((column, index) => {
    sheet.getCell(headerRow, index + 1).value = translate(lang, column.labelKey);
    sheet.getColumn(index + 1).width = column.format === 'money' ? 18 : 20;
  });
  styleDataHeader(sheet, headerRow, report.columns.length);

  let rowNumber = headerRow + 1;
  report.rows.forEach((row) => {
    report.columns.forEach((column, index) => {
      const cell = sheet.getCell(rowNumber, index + 1);
      const raw = row[column.key] ?? '';
      cell.value = valueFor(lang, raw, labelKeys);
      if (column.format === 'money') {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'left' };
      } else if (column.format === 'number' || column.format === 'percent') {
        cell.numFmt = column.format === 'percent' ? '0.00"%"' : '#,##0.##';
        cell.alignment = { horizontal: 'left' };
      } else {
        cell.alignment = { horizontal: lang === 'ar' ? 'right' : 'left', wrapText: true };
      }
      if ((rowNumber - headerRow) % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
    rowNumber += 1;
  });

  rowNumber += 1;
  sheet.getCell(rowNumber, 1).value = translate(lang, 'report.totals');
  sheet.getCell(rowNumber, 1).font = { bold: true, size: 12, color: { argb: PURPLE_DARK } };
  rowNumber += 1;

  const totalsEntries = Object.entries(report.totals);
  totalsEntries.forEach(([key, amount]) => {
    const column = report.columns.find((candidate) => candidate.key === key);
    const label = column ? translate(lang, column.labelKey) : key;
    sheet.getCell(rowNumber, 1).value = `${translate(lang, 'common.total')} — ${label}`;
    sheet.getCell(rowNumber, 1).font = { bold: true };
    sheet.getCell(rowNumber, 2).value = amount;
    sheet.getCell(rowNumber, 2).numFmt = '#,##0.00';
    sheet.getCell(rowNumber, 2).font = { bold: true, color: { argb: PURPLE_DARK } };
    rowNumber += 1;
  });

  if (report.meta.from && report.meta.to) {
    rowNumber += 1;
    sheet.getCell(rowNumber, 1).value = `${translate(lang, 'common.from')}: ${report.meta.from} — ${translate(lang, 'common.to')}: ${report.meta.to}`;
    sheet.getCell(rowNumber, 1).font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
  }

  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow + Math.max(report.rows.length, 1), column: Math.max(report.columns.length, 1) },
  };

  const info = workbook.addWorksheet('About', { views: [{ rightToLeft: lang === 'ar' }] });
  info.getColumn(1).width = 100;
  info.getCell(1, 1).value = `${BRAND.name} — ${BRAND.tagline}`;
  info.getCell(1, 1).font = { bold: true, size: 14, color: { argb: PURPLE_DARK } };
  info.getCell(3, 1).value =
    'هذا الملف مُصدَّر من بيانات النظام الحالية (مصدر الحقيقة). التعديل عليه لا يعيد كتابة البيانات في النظام. / This file was exported from current system data (the source of truth). Editing it does not write back to the system.';
  info.getCell(3, 1).alignment = { wrapText: true };
  info.getCell(5, 1).value =
    'لا يحتوي الملف ماكروات ولا ينفّذ كوداً. / The workbook contains no macros and executes no code.';
  info.getCell(7, 1).value = `Report: ${report.type} | Rows: ${report.meta.rowCount} | Generated: ${report.meta.generatedAt}`;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

export interface CustomerExportRow {
  id: string;
  nameAr: string;
  nameEn: string;
  plantAr: string;
  tier: string;
  creditLimit: number;
  outstanding: number;
  available: number;
  creditDays: number;
  status: string;
  phone: string;
}

/** Customers export (Addendum B3/B6 item 8). */
export const buildCustomersWorkbook = async (
  rows: readonly CustomerExportRow[],
  lang: Lang,
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${BRAND.name} — ${BRAND.tagline}`;
  const sheet = workbook.addWorksheet('Customers', {
    views: [{ rightToLeft: lang === 'ar', state: 'frozen', ySplit: 6 }],
  });

  brandHeader(sheet, 10, lang, translate(lang, 'customers.title'));
  const headers =
    lang === 'ar'
      ? ['المعرّف', 'اسم العميل', 'المحطة', 'الأولوية', 'سقف الائتمان', 'المستخدم', 'المتاح', 'أيام السماح', 'الحالة', 'الهاتف']
      : ['ID', 'Customer', 'Plant', 'Tier', 'Credit limit', 'Used', 'Available', 'Credit days', 'Status', 'Phone'];
  headers.forEach((header, index) => {
    sheet.getCell(6, index + 1).value = header;
    sheet.getColumn(index + 1).width = index === 1 ? 34 : 18;
  });
  styleDataHeader(sheet, 6, headers.length);

  rows.forEach((row, index) => {
    const excelRow = 7 + index;
    sheet.getCell(excelRow, 1).value = row.id;
    sheet.getCell(excelRow, 2).value = lang === 'ar' ? row.nameAr : row.nameEn;
    sheet.getCell(excelRow, 3).value = row.plantAr;
    sheet.getCell(excelRow, 4).value = row.tier;
    sheet.getCell(excelRow, 5).value = row.creditLimit;
    sheet.getCell(excelRow, 6).value = row.outstanding;
    sheet.getCell(excelRow, 7).value = row.available;
    sheet.getCell(excelRow, 8).value = row.creditDays;
    sheet.getCell(excelRow, 9).value = row.status;
    // Phones start with "+" legitimately; ExcelJS stores plain strings verbatim, so no escaping
    // prefix here (it would appear as a literal apostrophe in the cell).
    sheet.getCell(excelRow, 10).value = row.phone;
    sheet.getCell(excelRow, 10).numFmt = '@';
    for (const column of [5, 6, 7]) {
      sheet.getCell(excelRow, column).numFmt = '#,##0.00';
    }
    if (row.available < 0) {
      sheet.getCell(excelRow, 7).font = { color: { argb: 'FFDC2626' }, bold: true };
    }
  });

  const totalRow = 7 + rows.length;
  sheet.getCell(totalRow, 4).value = translate(lang, 'report.totals');
  sheet.getCell(totalRow, 5).value = rows.reduce((total, row) => total + row.creditLimit, 0);
  sheet.getCell(totalRow, 6).value = rows.reduce((total, row) => total + row.outstanding, 0);
  sheet.getCell(totalRow, 7).value = rows.reduce((total, row) => total + row.available, 0);
  [4, 5, 6, 7].forEach((column) => {
    sheet.getCell(totalRow, column).font = { bold: true, color: { argb: PURPLE_DARK } };
    if (column >= 5) sheet.getCell(totalRow, column).numFmt = '#,##0.00';
  });

  sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + Math.max(rows.length, 1), column: headers.length } };

  const info = workbook.addWorksheet('Notes', { views: [{ rightToLeft: lang === 'ar' }] });
  info.getColumn(1).width = 100;
  info.getCell(1, 1).value = `${BRAND.name} — ${BRAND.tagline}`;
  info.getCell(1, 1).font = { bold: true, size: 14, color: { argb: PURPLE_DARK } };
  info.getCell(3, 1).value =
    'المستخدم والمتاح محسوبان من الفواتير المفتوحة، وليسا مُدخلين يدوياً. / Used and available credit are derived from open invoices, never entered by hand.';
  info.getCell(5, 1).value = 'بيانات تجريبية — لا تحتوي أي بيانات حقيقية. / Demo data — contains no real business data.';
  info.getCell(5, 1).font = { bold: true, color: { argb: 'FFDC2626' } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};
