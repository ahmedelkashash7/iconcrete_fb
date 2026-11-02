/**
 * WCAG 2.1 contrast maths, implemented here so the design-system page and the test suite
 * compute ratios from the same code instead of a copy-pasted table.
 */

const channel = (value: number): number => {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

export const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.trim().replace(/^#/, '');
  const expanded =
    clean.length === 3
      ? clean
          .split('')
          .map((part) => part + part)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) throw new Error(`Invalid hex colour: ${hex}`);
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
};

export const rgbToHex = ([r, g, b]: [number, number, number]): string =>
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio, always ≥ 1, rounded to two decimals for display. */
export const contrastRatio = (foreground: string, background: string): number => {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return Math.round(ratio * 100) / 100;
};

export type WcagGrade = 'AAA' | 'AA' | 'AA-large' | 'FAIL';

export const wcagGrade = (ratio: number, large = false): WcagGrade => {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (large && ratio >= 3) return 'AA-large';
  return 'FAIL';
};

export const formatRatio = (ratio: number): string => `${ratio.toFixed(2)}:1`;

/** Mixes a colour toward white/black; used only for tinted badge and alert backgrounds. */
export const mix = (hex: string, target: '#FFFFFF' | '#000000', weight: number): string => {
  const from = hexToRgb(hex);
  const to = hexToRgb(target);
  const w = Math.min(1, Math.max(0, weight));
  return rgbToHex([
    from[0] + (to[0] - from[0]) * w,
    from[1] + (to[1] - from[1]) * w,
    from[2] + (to[2] - from[2]) * w,
  ]);
};
