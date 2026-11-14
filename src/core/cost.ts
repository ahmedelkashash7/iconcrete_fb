/**
 * M12 — actual cost per delivered m³. Pure arithmetic only: no database, no clock.
 *
 * Units are explicit at every boundary:
 *   solids: kg, liquids: L, water: 1 L = 1 kg, volumes: m³, energy: kWh, money: EGP.
 * A ton, gram or cubic-metre input is converted only when the target unit makes the
 * conversion unambiguous. An aggregate in m³ has no density on the line, so it throws
 * instead of silently assuming 1 m³ = 1 ton.
 */

export type BaseUnit = 'kg' | 'L';
export type CostLineType =
  | 'material'
  | 'moisture'
  | 'electricity'
  | 'fuel_loader'
  | 'labor'
  | 'maintenance'
  | 'depreciation';

export class CostDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostDimensionError';
  }
}

const MASS_TO_KG: Record<string, number> = {
  kg: 1,
  kilogram: 1,
  kilograms: 1,
  g: 0.001,
  gram: 0.001,
  grams: 0.001,
  ton: 1000,
  tons: 1000,
  tonne: 1000,
  tonnes: 1000,
  t: 1000,
};

const VOLUME_TO_L: Record<string, number> = {
  l: 1,
  liter: 1,
  liters: 1,
  litre: 1,
  litres: 1,
  ml: 0.001,
  m3: 1000,
  'm³': 1000,
  cubic_meter: 1000,
};

const norm = (unit: string): string => unit.trim().toLowerCase().replace(/\s+/g, '_');

/** Converts a quantity to kg or L. Unknown or cross-dimension units throw. */
export const toBaseQuantity = (
  quantity: number,
  unit: string,
  target: BaseUnit,
): number => {
  if (!Number.isFinite(quantity)) throw new CostDimensionError(`quantity is not finite: ${quantity}`);
  const key = norm(unit);
  if (target === 'kg') {
    const factor = MASS_TO_KG[key];
    if (factor === undefined) {
      throw new CostDimensionError(`cannot convert "${unit}" to kg`);
    }
    return quantity * factor;
  }
  const factor = VOLUME_TO_L[key];
  if (factor === undefined) {
    throw new CostDimensionError(`cannot convert "${unit}" to L`);
  }
  return quantity * factor;
};

/** Converts a price expressed per `unit` to EGP per base unit. 3000/ton -> 3/kg. */
export const pricePerBaseUnit = (price: number, unit: string, target: BaseUnit): number => {
  if (!Number.isFinite(price) || price < 0) {
    throw new CostDimensionError(`price must be a non-negative number: ${price}`);
  }
  const oneBaseInSource = toBaseQuantity(1, unit, target);
  if (oneBaseInSource === 0) throw new CostDimensionError(`zero unit factor for "${unit}"`);
  return price / oneBaseInSource;
};

export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
export const roundQty = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

/** Surface moisture increases the wet mass used for purchase costing. */
export const moistureCorrectedQty = (measuredQty: number, moisturePct: number): number => {
  if (!Number.isFinite(measuredQty) || measuredQty < 0) {
    throw new CostDimensionError(`measured quantity must be >= 0: ${measuredQty}`);
  }
  if (!Number.isFinite(moisturePct) || moisturePct < 0) {
    throw new CostDimensionError(`moisture % must be >= 0: ${moisturePct}`);
  }
  return measuredQty * (1 + moisturePct / 100);
};

/**
 * Added water = design water - aggregate surface water.
 * Aggregate moisture mass is kg; 1 kg water = 1 L, so the result is litres.
 */
export const addedWaterL = (
  designWaterL: number,
  aggregates: Array<{ measuredKg: number; moisturePct: number }>,
): number => {
  if (!Number.isFinite(designWaterL) || designWaterL < 0) {
    throw new CostDimensionError(`design water must be >= 0: ${designWaterL}`);
  }
  const surfaceWaterKg = aggregates.reduce((sum, row) => {
    if (row.measuredKg < 0 || row.moisturePct < 0) {
      throw new CostDimensionError('aggregate weight and moisture must be >= 0');
    }
    return sum + row.measuredKg * (row.moisturePct / 100);
  }, 0);
  return designWaterL - surfaceWaterKg;
};

/**
 * Moisture adjustment is the cost of the water carried by aggregate, less the water
 * purchase that surface moisture displaces. It is a separate line; the base material
 * cost below always uses the measured (as-weighed) quantity so nothing is counted twice.
 */
export const moistureAdjustmentEgp = (
  measuredKg: number,
  moisturePct: number,
  aggregatePricePerKg: number,
  waterPricePerL: number,
): { moistureKg: number; adjustmentEgp: number } => {
  const moistureKg = measuredKg * (moisturePct / 100);
  return {
    moistureKg,
    adjustmentEgp: moistureKg * (aggregatePricePerKg - waterPricePerL),
  };
};

export const materialVariancePct = (
  actualQty: number,
  theoreticalQty: number,
): number | null => {
  if (!Number.isFinite(theoreticalQty) || theoreticalQty === 0) return null;
  return ((actualQty - theoreticalQty) / theoreticalQty) * 100;
};

export const yieldCheck = (
  totalWeightKg: number,
  densityKgPerM3: number,
  billedM3: number,
  tolerancePct = 2,
): {
  yieldM3: number;
  variancePct: number | null;
  flagged: boolean;
  missing: string[];
} => {
  const missing: string[] = [];
  if (!Number.isFinite(totalWeightKg) || totalWeightKg <= 0) missing.push('batch_weights');
  if (!Number.isFinite(densityKgPerM3) || densityKgPerM3 <= 0) missing.push('mix_density');
  if (!Number.isFinite(billedM3) || billedM3 <= 0) missing.push('billed_m3');
  if (missing.length > 0) {
    return { yieldM3: 0, variancePct: null, flagged: false, missing };
  }
  const yieldM3 = totalWeightKg / densityKgPerM3;
  const variancePct = ((yieldM3 - billedM3) / billedM3) * 100;
  return { yieldM3, variancePct, flagged: Math.abs(variancePct) > tolerancePct, missing };
};

export interface ProductionInput {
  kwhPerM3: number;
  electricityTariff: number;
  fuelLPerM3: number;
  fuelPrice: number;
  crewMonthly: number;
  maintenanceMonthly: number;
  depreciationMonthly: number;
  producedM3: number;
}

export interface ProductionResult {
  electricity: number;
  fuel: number;
  labor: number;
  maintenance: number;
  depreciation: number;
  total: number;
  missing: string[];
}

/** Production costs are all expressed per produced m³ of the same plant-month. */
export const productionCostPerM3 = (input: ProductionInput): ProductionResult => {
  const missing: string[] = [];
  if (!Number.isFinite(input.producedM3) || input.producedM3 <= 0) missing.push('produced_m3_month');
  const values = [
    input.kwhPerM3,
    input.electricityTariff,
    input.fuelLPerM3,
    input.fuelPrice,
    input.crewMonthly,
    input.maintenanceMonthly,
    input.depreciationMonthly,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) missing.push('production_rate');
  if (missing.length > 0) {
    return { electricity: 0, fuel: 0, labor: 0, maintenance: 0, depreciation: 0, total: 0, missing };
  }
  const m3 = input.producedM3;
  const electricity = input.kwhPerM3 * input.electricityTariff;
  const fuel = input.fuelLPerM3 * input.fuelPrice;
  const labor = input.crewMonthly / m3;
  const maintenance = input.maintenanceMonthly / m3;
  const depreciation = input.depreciationMonthly / m3;
  return {
    electricity,
    fuel,
    labor,
    maintenance,
    depreciation,
    total: electricity + fuel + labor + maintenance + depreciation,
    missing,
  };
};

export const monthlyDepreciation = (assetCost: number, usefulLifeMonths: number): number => {
  if (!Number.isFinite(assetCost) || assetCost < 0) {
    throw new CostDimensionError(`asset cost must be >= 0: ${assetCost}`);
  }
  if (!Number.isFinite(usefulLifeMonths) || usefulLifeMonths <= 0) {
    throw new CostDimensionError(`useful life months must be > 0: ${usefulLifeMonths}`);
  }
  return assetCost / usefulLifeMonths;
};

export interface TransportInput {
  distanceKm: number;
  fuelLPerKm: number;
  fuelPrice: number;
  loadM3: number;
  driverCostPerTrip: number;
  truckDepreciationPerTrip: number;
  truckMaintenancePerTrip: number;
  waitMinutes: number;
  waitThresholdMinutes: number;
  idleLPerHour: number;
  driverHourlyCost: number;
}

export interface TransportResult {
  fuelCostTotal: number;
  fuelPerM3: number;
  driverPerM3: number;
  depreciationPerM3: number;
  maintenancePerM3: number;
  waitingCost: number;
  waitingPerM3: number;
  totalPerM3: number;
  totalTrip: number;
  waitingFlagged: boolean;
  missing: string[];
}

export const transportCost = (input: TransportInput): TransportResult => {
  const missing: string[] = [];
  if (!Number.isFinite(input.loadM3) || input.loadM3 <= 0) missing.push('load_m3');
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) missing.push('distance_km');
  if (!Number.isFinite(input.fuelLPerKm) || input.fuelLPerKm <= 0) missing.push('truck_fuel_l_per_km');
  if (!Number.isFinite(input.fuelPrice) || input.fuelPrice < 0) missing.push('fuel_price');
  if (missing.length > 0) {
    return {
      fuelCostTotal: 0,
      fuelPerM3: 0,
      driverPerM3: 0,
      depreciationPerM3: 0,
      maintenancePerM3: 0,
      waitingCost: 0,
      waitingPerM3: 0,
      totalPerM3: 0,
      totalTrip: 0,
      waitingFlagged: false,
      missing,
    };
  }
  const load = input.loadM3;
  const fuelCostTotal = input.distanceKm * 2 * input.fuelLPerKm * input.fuelPrice;
  const fuelPerM3 = fuelCostTotal / load;
  const driverPerM3 = input.driverCostPerTrip / load;
  const depreciationPerM3 = input.truckDepreciationPerTrip / load;
  const maintenancePerM3 = input.truckMaintenancePerTrip / load;
  const waitMinutes = Math.max(0, input.waitMinutes || 0);
  const threshold = Math.max(0, input.waitThresholdMinutes || 0);
  const excessHours = Math.max(0, waitMinutes - threshold) / 60;
  const waitingCost = excessHours * (Math.max(0, input.idleLPerHour) * input.fuelPrice + Math.max(0, input.driverHourlyCost));
  const waitingPerM3 = waitingCost / load;
  const totalPerM3 = fuelPerM3 + driverPerM3 + depreciationPerM3 + maintenancePerM3 + waitingPerM3;
  return {
    fuelCostTotal,
    fuelPerM3,
    driverPerM3,
    depreciationPerM3,
    maintenancePerM3,
    waitingCost,
    waitingPerM3,
    totalPerM3,
    totalTrip: totalPerM3 * load,
    waitingFlagged: waitMinutes > threshold,
    missing,
  };
};

export const marginPerM3 = (
  revenuePerM3: number,
  costPerM3: number,
): { marginPerM3: number; marginPct: number | null } => ({
  marginPerM3: revenuePerM3 - costPerM3,
  marginPct: revenuePerM3 === 0 ? null : ((revenuePerM3 - costPerM3) / revenuePerM3) * 100,
});

export const sumMoney = (values: number[]): number =>
  roundMoney(values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0));
