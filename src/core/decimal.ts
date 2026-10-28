/**
 * Decimal-safe money arithmetic.
 *
 * Money never travels as a binary float inside the ledger: values are parsed from
 * strings/numbers into scaled integer units (bigint) and rounded explicitly with
 * half-up semantics. TypeScript numbers are only used at the presentation edge.
 *
 * scale 2 is money (EGP piastres), scale 3 is quantity (m3, tons).
 */

export interface Dec {
  readonly units: bigint;
  readonly scale: number;
}

const SCALE_FACTOR: Record<number, bigint> = {
  0: 1n,
  1: 10n,
  2: 100n,
  3: 1_000n,
  4: 10_000n,
  6: 1_000_000n,
};

const factor = (scale: number): bigint => {
  const value = SCALE_FACTOR[scale];
  if (value === undefined) throw new Error(`unsupported decimal scale: ${scale}`);
  return value;
};

/** Parse an exact decimal. Throws on anything that is not a finite decimal literal. */
export const dec = (input: string | number | bigint | Dec, scale = 2): Dec => {
  if (typeof input === 'object' && 'units' in input) {
    return rescale(input, scale);
  }
  if (typeof input === 'bigint') return { units: input * factor(scale), scale };

  const raw = typeof input === 'number' ? numberToLiteral(input) : input.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error(`invalid decimal: ${String(input)}`);

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '0';
  const fraction = (match[3] ?? '').padEnd(scale + 1, '0');
  const kept = fraction.slice(0, scale);
  const nextDigit = Number(fraction[scale] ?? '0');
  let units = BigInt(whole) * factor(scale) + BigInt(kept === '' ? '0' : kept);
  if (nextDigit >= 5) units += 1n;
  return { units: sign * units, scale };
};

/** Numbers are converted through their shortest round-trip literal, never via arithmetic. */
const numberToLiteral = (value: number): string => {
  if (!Number.isFinite(value)) throw new Error(`invalid decimal: ${value}`);
  const literal = value.toString();
  if (literal.includes('e') || literal.includes('E')) {
    return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  return literal;
};

export const rescale = (value: Dec, scale: number): Dec => {
  if (value.scale === scale) return value;
  if (scale > value.scale) {
    const delta = BigInt(scale - value.scale);
    return { units: value.units * 10n ** delta, scale };
  }
  const delta = BigInt(value.scale - scale);
  const divisor = 10n ** delta;
  const negative = value.units < 0n;
  const absolute = negative ? -value.units : value.units;
  let quotient = absolute / divisor;
  const remainder = absolute % divisor;
  if (remainder * 2n >= divisor) quotient += 1n;
  return { units: negative ? -quotient : quotient, scale };
};

export const ZERO: Dec = { units: 0n, scale: 2 };

export const add = (a: Dec, b: Dec): Dec => {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescale(a, scale).units + rescale(b, scale).units, scale };
};

export const sub = (a: Dec, b: Dec): Dec => {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescale(a, scale).units - rescale(b, scale).units, scale };
};

export const negate = (a: Dec): Dec => ({ units: -a.units, scale: a.scale });

/** Multiply by an integer count. */
export const mulInt = (a: Dec, count: number | bigint): Dec => ({
  units: a.units * BigInt(count),
  scale: a.scale,
});

/**
 * Multiply by an exact rational rate (for example a percentage).
 * Both rates carry their own scale, so the result is scaled correctly and rounded
 * half-up exactly once.
 */
export const mulRate = (a: Dec, numerator: Dec | number, denominator: Dec | number = 1, scale = a.scale): Dec => {
  const n = typeof numerator === 'number' ? dec(numerator, 6) : numerator;
  const d = typeof denominator === 'number' ? dec(denominator, 6) : denominator;
  if (d.units === 0n) throw new Error('division by zero in decimal rate');

  // value = (a.units / fA) * (n.units / fN) / (d.units / fD), expressed at `scale`.
  // roundedDivide applies the target scale itself, so it is not multiplied in here.
  const numeratorUnits = a.units * n.units * factor(d.scale);
  const denominatorUnits = factor(a.scale) * factor(n.scale) * d.units;
  return roundedDivide(numeratorUnits, denominatorUnits, scale);
};

const roundedDivide = (numerator: bigint, denominator: bigint, scale: number): Dec => {
  const target = factor(scale);
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const scaled = n * target;
  let quotient = scaled / d;
  const remainder = scaled % d;
  if (remainder * 2n >= d) quotient += 1n;
  return { units: negative ? -quotient : quotient, scale };
};

/** Apply a percentage (14 -> 14%). */
export const percentOf = (value: Dec, percent: Dec | number, scale = value.scale): Dec =>
  mulRate(value, typeof percent === 'number' ? dec(percent, 4) : percent, 100, scale);

export const compare = (a: Dec, b: Dec): number => {
  const scale = Math.max(a.scale, b.scale);
  const left = rescale(a, scale).units;
  const right = rescale(b, scale).units;
  return left === right ? 0 : left < right ? -1 : 1;
};

export const isZero = (a: Dec): boolean => a.units === 0n;
export const isNegative = (a: Dec): boolean => a.units < 0n;
export const abs = (a: Dec): Dec => (a.units < 0n ? negate(a) : a);

/** Human/DB literal, always with the requested number of decimals. */
export const decToString = (value: Dec, scale = value.scale): string => {
  const target = rescale(value, scale);
  const negative = target.units < 0n;
  const absolute = negative ? -target.units : target.units;
  const digits = absolute.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const fraction = scale === 0 ? '' : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
};

/** Only for display and JSON payloads — never for further arithmetic. */
export const decToNumber = (value: Dec): number => Number(decToString(value));

export const sumDec = (values: readonly Dec[], scale = 2): Dec =>
  values.reduce((total, value) => add(total, rescale(value, scale)), { units: 0n, scale });

/**
 * Split an amount into deterministic parts without losing a piastre.
 * The remainder is distributed one minor unit at a time, first part first.
 */
export const allocate = (total: Dec, weights: readonly number[], scale = total.scale): Dec[] => {
  const value = rescale(total, scale);
  if (weights.length === 0) return [];
  if (weights.some((weight) => weight < 0)) throw new Error('allocation weights must be non-negative');
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) throw new Error('allocation weights must not all be zero');

  const parts: bigint[] = weights.map((weight) => (value.units * BigInt(Math.round(weight * 1e6))) / BigInt(Math.round(weightSum * 1e6)));
  let distributed = parts.reduce((sum, part) => sum + part, 0n);
  let index = 0;
  const step = value.units < 0n ? -1n : 1n;
  while (distributed !== value.units) {
    parts[index % parts.length] = (parts[index % parts.length] ?? 0n) + step;
    distributed += step;
    index += 1;
  }
  return parts.map((units) => ({ units, scale }));
};

/** Round a money value for presentation/storage at 2dp. */
export const money = (input: string | number | Dec): Dec => dec(input, 2);

export const formatDec = (value: Dec, scale = 2): string => decToString(rescale(value, scale), scale);
