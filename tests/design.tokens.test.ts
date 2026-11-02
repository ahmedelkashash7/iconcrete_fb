/**
 * B3 — the locked palette and its contrast contract.
 *
 * §1 locks the palette; §60 requires contrast testing. A ratio is a number, so this is a
 * unit test rather than a claim: every pair below is computed with the same WCAG code the
 * design-system page renders.
 */
import { describe, expect, test } from 'bun:test';
import { CONTRAST_PAIRS, PALETTE, TOKENS } from '../src/lib/designTokens';
import { contrastRatio, formatRatio, hexToRgb, mix, relativeLuminance, wcagGrade } from '../src/lib/contrast';

/** Golden Master §1 "Locked colors", transcribed independently of `designTokens.ts`. */
const SPEC_PALETTE: Record<string, string> = {
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
};

describe('locked palette', () => {
  test('matches the specification hex values exactly', () => {
    for (const [key, hex] of Object.entries(SPEC_PALETTE)) {
      expect(String(PALETTE[key as keyof typeof PALETTE])).toBe(hex);
    }
  });

  test('every token is a valid six-digit hex value', () => {
    for (const token of TOKENS) {
      expect(token.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(hexToRgb(token.hex)).toHaveLength(3);
    }
  });

  test('exposes no duplicate colours under different names', () => {
    const seen = new Map<string, string>();
    for (const token of TOKENS) {
      const existing = seen.get(token.hex);
      expect(existing ?? token.key).toBe(token.key);
      seen.set(token.hex, token.key);
    }
  });
});

describe('contrast maths', () => {
  test('computes the known extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  test('is symmetric and stable under upper/lower case', () => {
    expect(contrastRatio('#6D28D9', '#FFFFFF')).toBe(contrastRatio('#ffffff', '#6d28d9'));
  });

  test('grades a ratio against its WCAG band', () => {
    expect(wcagGrade(21)).toBe('AAA');
    expect(wcagGrade(4.6)).toBe('AA');
    expect(wcagGrade(3.2)).toBe('FAIL');
    expect(wcagGrade(3.2, true)).toBe('AA-large');
  });

  test('mix moves a colour toward the target without leaving the gamut', () => {
    expect(mix('#6D28D9', '#FFFFFF', 0)).toBe('#6D28D9');
    expect(mix('#6D28D9', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#6D28D9', '#FFFFFF', 0.1)).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('contrast contract (Golden Master §60)', () => {
  for (const pair of CONTRAST_PAIRS) {
    test(`${pair.fg} on ${pair.bg} meets ${pair.min}:1 (${pair.pairEn})`, () => {
      const ratio = contrastRatio(PALETTE[pair.fg], PALETTE[pair.bg]);
      expect(ratio, `${pair.fg} on ${pair.bg} = ${formatRatio(ratio)}, target ${pair.min}:1`).toBeGreaterThanOrEqual(pair.min);
    });
  }

  test('body text pairs reach AA rather than only the large-text band', () => {
    const textPairs = CONTRAST_PAIRS.filter((pair) => pair.kind === 'text');
    expect(textPairs.length).toBeGreaterThan(5);
    for (const pair of textPairs) {
      const ratio = contrastRatio(PALETTE[pair.fg], PALETTE[pair.bg]);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(pair.min).toBeGreaterThanOrEqual(4.5);
    }
  });
});
