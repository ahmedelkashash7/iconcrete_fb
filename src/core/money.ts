import type { Lang } from '../types';

/** Monetary helpers. All money math stays in one place and rounds to 2 decimals. */
export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const sum = (values: readonly number[]): number =>
  round2(values.reduce((total, value) => total + value, 0));

export const sumBy = <T>(items: readonly T[], pick: (item: T) => number): number =>
  sum(items.map(pick));

export const percent = (part: number, whole: number): number =>
  whole === 0 ? 0 : round2((part / whole) * 100);

const localeFor = (lang: Lang): string => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG');

export const formatMoney = (value: number, lang: Lang): string =>
  new Intl.NumberFormat(localeFor(lang), {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);

export const formatNumber = (value: number, lang: Lang, digits = 0): string =>
  new Intl.NumberFormat(localeFor(lang), {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);

export const formatPercent = (value: number, lang: Lang): string =>
  `${formatNumber(value, lang, 1)}%`;
