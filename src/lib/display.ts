import type { Lang } from '../types';
import { formatMoney, formatNumber } from '../core/money';

export type CellFormat = 'text' | 'money' | 'number' | 'date' | 'percent';

export const STATUS_LABELS: Record<string, string> = {
  active: 'customers.status.active',
  suspended: 'customers.status.suspended',
  archived: 'customers.status.archived',
  paid: 'report.column.paid',
  open: 'common.open',
  partially_paid: 'report.column.outstanding',
  overdue: 'alert.invoiceOverdue',
  draft: 'common.preview',
  issued: 'report.column.document',
  cleared: 'common.apply',
  bounced: 'dashboard.result.fail',
  received: 'common.upload',
  under_collection: 'balance.cheques',
  cancelled: 'common.cancel',
  pending: 'common.loading',
  done: 'common.save',
  in_progress: 'common.loading',
  void: 'common.cancel',
};

export const formatCellValue = (
  value: string | number | undefined,
  format: CellFormat,
  lang: Lang,
): string => {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'number') {
    if (format === 'money') return formatMoney(value, lang);
    if (format === 'percent') return `${formatNumber(value, lang, 2)}%`;
    if (format === 'number') return formatNumber(value, lang, 2);
    return formatNumber(value, lang, 0);
  }
  if (format === 'money' || format === 'number' || format === 'percent') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return formatCellValue(parsed, format, lang);
  }
  if (format === 'date') return value.slice(0, 10);
  return value;
};

export const formatIsoDate = (iso: string | null, lang: Lang): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

export const formatDateTime = (iso: string | null, lang: Lang): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const initials = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('');
