/**
 * M12 — actual cost per m³.
 *
 * Pure tests pin the hand-checkable arithmetic and dimensional guards. The database block
 * proves that the new cost tables are tenant- and plant-scoped by RLS, not only by service
 * filters, and that a second company cannot read another company's cost settings.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import {
  addedWaterL,
  CostDimensionError,
  marginPerM3,
  moistureAdjustmentEgp,
  pricePerBaseUnit,
  productionCostPerM3,
  toBaseQuantity,
  transportCost,
  yieldCheck,
} from '../../src/core/cost';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run M12 RLS tests.';
const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const settingKey = `m12_test_${tag}`;

describe('M12 cost arithmetic', () => {
  test('the worked cement example is exactly 6 × 350 / 1000 × 3000 = 6,300 EGP', () => {
    const measuredKg = toBaseQuantity(6 * 350, 'kg', 'kg');
    const pricePerKg = pricePerBaseUnit(3000, 'ton', 'kg');
    expect(measuredKg).toBe(2100);
    expect(pricePerKg).toBe(3);
    expect(measuredKg * pricePerKg).toBe(6300);
  });

  test('unit conversion is explicit and refuses cross-dimension or unknown units', () => {
    expect(toBaseQuantity(1, 'ton', 'kg')).toBe(1000);
    expect(toBaseQuantity(1, 'm3', 'L')).toBe(1000);
    expect(toBaseQuantity(250, 'L', 'L')).toBe(250);
    expect(() => toBaseQuantity(1, 'kg', 'L')).toThrow(CostDimensionError);
    expect(() => toBaseQuantity(1, 'widgets', 'kg')).toThrow(CostDimensionError);
    expect(() => pricePerBaseUnit(-1, 'kg', 'kg')).toThrow(CostDimensionError);
  });

  test('water is 1 L = 1 kg and added water subtracts aggregate surface water', () => {
    expect(addedWaterL(170, [{ measuredKg: 1000, moisturePct: 5 }])).toBe(120);
    expect(addedWaterL(170, [])).toBe(170);
    expect(() => addedWaterL(170, [{ measuredKg: -1, moisturePct: 5 }])).toThrow(CostDimensionError);
  });

  test('moisture adjustment is a separate signed line, not double-counted material', () => {
    const result = moistureAdjustmentEgp(1000, 5, 0.5, 0.02);
    expect(result.moistureKg).toBe(50);
    expect(result.adjustmentEgp).toBe(24);
  });

  test('yield flags outside the band and reports exact missing inputs', () => {
    const normal = yieldCheck(14400, 2400, 6, 2);
    expect(normal.yieldM3).toBe(6);
    expect(normal.variancePct).toBe(0);
    expect(normal.flagged).toBe(false);

    const flagged = yieldCheck(13932.104, 2400, 6, 2);
    expect(flagged.variancePct).toBeCloseTo(-3.2493, 4);
    expect(flagged.flagged).toBe(true);

    const missing = yieldCheck(0, 2400, 6, 2);
    expect(missing.missing).toEqual(['batch_weights']);
    expect(missing.flagged).toBe(false);
  });

  test('production cost per m³ is the sum of the five drivers and names missing rates', () => {
    const result = productionCostPerM3({
      kwhPerM3: 18,
      electricityTariff: 3.1,
      fuelLPerM3: 1.2,
      fuelPrice: 14.5,
      crewMonthly: 180000,
      maintenanceMonthly: 45000,
      depreciationMonthly: 66666.67,
      producedM3: 300,
    });
    expect(result.electricity).toBeCloseTo(55.8, 2);
    expect(result.fuel).toBeCloseTo(17.4, 2);
    expect(result.labor).toBeCloseTo(600, 2);
    expect(result.maintenance).toBeCloseTo(150, 2);
    expect(result.depreciation).toBeCloseTo(222.2222, 3);
    expect(result.total).toBeCloseTo(1045.4222, 3);
    expect(result.missing).toEqual([]);
    expect(productionCostPerM3({ ...({
      kwhPerM3: 18,
      electricityTariff: 3.1,
      fuelLPerM3: 1.2,
      fuelPrice: 14.5,
      crewMonthly: 180000,
      maintenanceMonthly: 45000,
      depreciationMonthly: 66666.67,
      producedM3: 0,
    }) }).missing).toContain('produced_m3_month');
  });

  test('transport round trip doubles distance, charges excess waiting only and refuses zero load', () => {
    const result = transportCost({
      distanceKm: 25,
      fuelLPerKm: 0.35,
      fuelPrice: 14.5,
      loadM3: 8,
      driverCostPerTrip: 947.37,
      truckDepreciationPerTrip: 1842.11,
      truckMaintenancePerTrip: 60,
      waitMinutes: 45,
      waitThresholdMinutes: 30,
      idleLPerHour: 3,
      driverHourlyCost: 60,
    });
    expect(result.fuelCostTotal).toBeCloseTo(253.75, 2);
    expect(result.waitingCost).toBeCloseTo(25.875, 3);
    expect(result.waitingFlagged).toBe(true);
    expect(result.totalTrip).toBeCloseTo(result.totalPerM3 * 8, 6);

    const missing = transportCost({
      distanceKm: 25,
      fuelLPerKm: 0.35,
      fuelPrice: 14.5,
      loadM3: 0,
      driverCostPerTrip: 0,
      truckDepreciationPerTrip: 0,
      truckMaintenancePerTrip: 0,
      waitMinutes: 0,
      waitThresholdMinutes: 30,
      idleLPerHour: 0,
      driverHourlyCost: 0,
    });
    expect(missing.missing).toEqual(['load_m3']);
  });

  test('margin is revenue minus cost and a zero-revenue order has no percentage', () => {
    const loss = marginPerM3(2000, 4031.29);
    expect(loss.marginPerM3).toBeCloseTo(-2031.29, 2);
    expect(loss.marginPct).toBeCloseTo(-101.5645, 4);
    expect(marginPerM3(0, 100)).toEqual({ marginPerM3: -100, marginPct: null });
  });
});

describeDb('M12 cost RLS', () => {
  let admin: Db;
  let app: Db;

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    await admin.unsafe('delete from cost_settings where setting_key = $1', [settingKey]);
  });

  afterAll(async () => {
    await admin?.unsafe('delete from cost_settings where setting_key = $1', [settingKey]);
    await app?.close();
    await admin?.close();
  });

  dbTest('company and plant policy hides a cost setting from another tenant', async () => {
    const settingId = `CS-M12-${tag}`;
    await app.withTenant({ companyId: 'CMP-0001', plantIds: ['PLT-0001'], userId: 'USR-M12' }, (tx) =>
      tx.unsafe(
        `insert into cost_settings
           (id, company_id, plant_id, setting_key, value, unit, effective_from, is_demo, created_by)
         values ($1, 'CMP-0001', 'PLT-0001', $2, 14.5, 'EGP/L', current_date, false, 'test')`,
        [settingId, settingKey],
      ),
    );

    const own = await app.withTenant({ companyId: 'CMP-0001', plantIds: ['PLT-0001'], userId: 'USR-M12' }, (tx) =>
      tx.unsafe<{ n: number }>('select count(*)::int as n from cost_settings where setting_key = $1', [settingKey]),
    );
    expect(own[0]?.n).toBe(1);

    const otherCompany = await app.withTenant({ companyId: 'CMP-0002', plantIds: [], userId: 'USR-M12-B' }, (tx) =>
      tx.unsafe<{ n: number }>('select count(*)::int as n from cost_settings where setting_key = $1', [settingKey]),
    );
    expect(otherCompany[0]?.n).toBe(0);

    const otherPlant = await app.withTenant({ companyId: 'CMP-0001', plantIds: ['PLT-0002'], userId: 'USR-M12-C' }, (tx) =>
      tx.unsafe<{ n: number }>('select count(*)::int as n from cost_settings where setting_key = $1', [settingKey]),
    );
    expect(otherPlant[0]?.n).toBe(0);
  });
});
