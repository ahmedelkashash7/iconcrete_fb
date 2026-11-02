/**
 * Locked design tokens (Golden Master §1, "Locked colors").
 *
 * These hex values are a product decision, not a theme: changing one requires a new
 * decision record. `src/pages/DesignSystemPage.tsx` renders this list with live
 * contrast ratios, and `tests/design.tokens.test.ts` asserts the palette has not drifted
 * and that every text pair meets its WCAG 2.1 target.
 */

export interface ColorToken {
  key: keyof typeof PALETTE;
  hex: string;
  usageAr: string;
  usageEn: string;
}

export const PALETTE = {
  primary: '#6D28D9',
  primaryDark: '#4C1D95',
  secondary: '#8B5CF6',
  accent: '#2563EB',
  success: '#16A34A',
  danger: '#DC2626',
  warning: '#F59E0B',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
} as const;

export const TOKENS: ColorToken[] = [
  { key: 'primary', hex: PALETTE.primary, usageAr: 'اللون الأساسي، الأزرار الأساسية، الروابط', usageEn: 'Primary actions, links, active nav' },
  { key: 'primaryDark', hex: PALETTE.primaryDark, usageAr: 'العناوين والتباين العالي', usageEn: 'Headings, high-contrast text' },
  { key: 'secondary', hex: PALETTE.secondary, usageAr: 'لمسات ثانوية وحدود مؤشرات', usageEn: 'Secondary accents, chart strokes' },
  { key: 'accent', hex: PALETTE.accent, usageAr: 'المعلومات والروابط المساندة', usageEn: 'Informational accents' },
  { key: 'success', hex: PALETTE.success, usageAr: 'النجاح وحالات الاعتماد', usageEn: 'Success, committed states' },
  { key: 'danger', hex: PALETTE.danger, usageAr: 'الأخطاء والرفض', usageEn: 'Errors, rejected states' },
  { key: 'warning', hex: PALETTE.warning, usageAr: 'التحذيرات وحالات الانتظار', usageEn: 'Warnings, pending states' },
  { key: 'bg', hex: PALETTE.bg, usageAr: 'خلفية التطبيق', usageEn: 'Application background' },
  { key: 'surface', hex: PALETTE.surface, usageAr: 'البطاقات والجداول', usageEn: 'Cards, tables, surfaces' },
  { key: 'text', hex: PALETTE.text, usageAr: 'النص الأساسي', usageEn: 'Body text' },
  { key: 'muted', hex: PALETTE.muted, usageAr: 'النص الثانوي والتلميحات', usageEn: 'Secondary text, hints' },
  { key: 'border', hex: PALETTE.border, usageAr: 'الحدود الهادئة', usageEn: 'Quiet borders' },
  { key: 'borderStrong', hex: PALETTE.borderStrong, usageAr: 'حدود الحقول والمحددات', usageEn: 'Input borders' },
];

export type ContrastKind = 'text' | 'large-text' | 'non-text' | 'decorative';

export interface ContrastPair {
  fg: keyof typeof PALETTE;
  bg: keyof typeof PALETTE;
  kind: ContrastKind;
  min: number;
  pairAr: string;
  pairEn: string;
}

/**
 * Kind decides the WCAG 2.1 target: 4.5 normal text, 3.0 large text (≥18.66px bold or
 * ≥24px) and UI component boundaries, decorative separators are exempt (1.0).
 */
export const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: 'text', bg: 'surface', kind: 'text', min: 4.5, pairAr: 'النص على البطاقات', pairEn: 'Body text on surfaces' },
  { fg: 'text', bg: 'bg', kind: 'text', min: 4.5, pairAr: 'النص على الخلفية', pairEn: 'Body text on background' },
  { fg: 'muted', bg: 'surface', kind: 'text', min: 4.5, pairAr: 'نص ثانوي على البطاقات', pairEn: 'Muted text on surfaces' },
  { fg: 'muted', bg: 'bg', kind: 'text', min: 4.5, pairAr: 'نص ثانوي على الخلفية', pairEn: 'Muted text on background' },
  { fg: 'primary', bg: 'surface', kind: 'text', min: 4.5, pairAr: 'أساسي على البطاقات', pairEn: 'Primary on surfaces' },
  { fg: 'primaryDark', bg: 'surface', kind: 'text', min: 4.5, pairAr: 'عنوان داكن', pairEn: 'Dark heading on surfaces' },
  { fg: 'accent', bg: 'surface', kind: 'text', min: 4.5, pairAr: 'معلومات على البطاقات', pairEn: 'Accent on surfaces' },
  { fg: 'danger', bg: 'surface', kind: 'text', min: 4.5, pairAr: 'خطأ على البطاقات', pairEn: 'Danger on surfaces' },
  { fg: 'secondary', bg: 'surface', kind: 'large-text', min: 3, pairAr: 'لون ثانوي كبير فقط', pairEn: 'Secondary, large text only' },
  { fg: 'success', bg: 'surface', kind: 'large-text', min: 3, pairAr: 'نجاح كبير فقط', pairEn: 'Success, large text only' },
  { fg: 'warning', bg: 'surface', kind: 'non-text', min: 1.5, pairAr: 'تحذير كعنصر غير نصي', pairEn: 'Warning as a non-text marker' },
  { fg: 'surface', bg: 'primary', kind: 'text', min: 4.5, pairAr: 'أبيض على الزر الأساسي', pairEn: 'White on primary button' },
  { fg: 'surface', bg: 'primaryDark', kind: 'text', min: 4.5, pairAr: 'أبيض على الداكن', pairEn: 'White on dark purple' },
  { fg: 'surface', bg: 'accent', kind: 'text', min: 4.5, pairAr: 'أبيض على الأزرق', pairEn: 'White on accent blue' },
  { fg: 'surface', bg: 'danger', kind: 'text', min: 4.5, pairAr: 'أبيض على الأحمر', pairEn: 'White on danger' },
  { fg: 'surface', bg: 'success', kind: 'large-text', min: 3, pairAr: 'أبيض على الأخضر (نص كبير)', pairEn: 'White on success (large text)' },
  { fg: 'borderStrong', bg: 'surface', kind: 'non-text', min: 1.2, pairAr: 'حدود الحقول', pairEn: 'Input borders' },
];
