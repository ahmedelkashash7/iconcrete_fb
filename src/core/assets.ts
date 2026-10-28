/** Straight-line depreciation with an exact final period (no drifting piastres). */
import { add, dec, decToString, isNegative, isZero, rescale, sub, type Dec } from './decimal';

export interface AssetInput {
  assetId: string;
  nameAr?: string;
  nameEn?: string;
  purchaseDate: string;
  purchaseCost: string | number;
  residualValue: string | number;
  usefulLifeMonths: number;
  accumulatedDepreciation?: string | number;
  impairmentAmount?: string | number;
}

export interface DepreciationPeriod {
  period: string;
  amount: number;
  accumulated: number;
  bookValue: number;
}

const addMonths = (iso: string, months: number): string => {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
};

export const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;

/**
 * Monthly schedule from the month after acquisition.
 * The last period absorbs rounding so accumulated never exceeds depreciable value.
 */
export const straightLineSchedule = (asset: AssetInput): DepreciationPeriod[] => {
  const cost = rescale(dec(asset.purchaseCost, 2), 2);
  const residual = rescale(dec(asset.residualValue ?? 0, 2), 2);
  const impairment = rescale(dec(asset.impairmentAmount ?? 0, 2), 2);
  if (isNegative(residual)) throw new Error('residual_value_negative');
  if (asset.usefulLifeMonths <= 0) throw new Error('useful_life_invalid');

  const depreciable = sub(sub(cost, residual), impairment);
  if (isNegative(depreciable)) throw new Error('depreciable_value_negative');

  const already = rescale(dec(asset.accumulatedDepreciation ?? 0, 2), 2);
  const remaining: Dec = sub(depreciable, already);
  if (isNegative(remaining) || isZero(remaining)) return [];

  const months = asset.usefulLifeMonths;
  const perMonth = rescale({ units: remaining.units / BigInt(months), scale: 2 }, 2);
  const remainder = sub(remaining, { units: perMonth.units * BigInt(months), scale: 2 });

  const periods: DepreciationPeriod[] = [];
  let accumulated = already;
  const start = monthStart(addMonths(asset.purchaseDate, 1));

  for (let index = 0; index < months; index += 1) {
    // The final period absorbs the truncated remainder so the schedule closes exactly.
    const amount = index === months - 1 ? add(perMonth, remainder) : perMonth;
    accumulated = add(accumulated, amount);
    periods.push({
      period: addMonths(start, index),
      amount: Number(decToString(amount)),
      accumulated: Number(decToString(accumulated)),
      bookValue: Number(decToString(sub(cost, accumulated))),
    });
  }

  return periods;
};

/** Depreciation charge for one month, or 0 when the asset is fully depreciated. */
export const monthlyDepreciation = (asset: AssetInput): number => {
  const schedule = straightLineSchedule(asset);
  return schedule[0]?.amount ?? 0;
};

export interface DisposalResult {
  bookValue: number;
  gainLoss: number;
  isGain: boolean;
}

export const disposalResult = (
  asset: AssetInput,
  proceeds: string | number,
  disposalDate: string,
): DisposalResult => {
  const schedule = straightLineSchedule({ ...asset, purchaseDate: asset.purchaseDate });
  const accumulated =
    schedule.length > 0
      ? schedule[schedule.length - 1]?.accumulated ?? Number(asset.accumulatedDepreciation ?? 0)
      : Number(asset.accumulatedDepreciation ?? 0);
  const bookValue = Number(decToString(sub(dec(asset.purchaseCost, 2), dec(accumulated, 2))));
  const gainLoss = Number(decToString(sub(dec(proceeds, 2), dec(bookValue, 2))));
  void disposalDate;
  return { bookValue, gainLoss, isGain: gainLoss >= 0 };
};
