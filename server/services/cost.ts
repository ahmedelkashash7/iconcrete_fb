/**
 * M12 — actual cost per m³ repository and allocation engine.
 *
 * Every write is tenant + plant scoped. Recompute is idempotent: the batch and trip rows
 * are replaced in one transaction and the rollups are rebuilt from the order snapshots.
 * Missing inputs never become zero silently: the row is marked incomplete with the exact
 * missing field names, while the computed portions remain visible.
 */
import {
  addedWaterL,
  materialVariancePct,
  monthlyDepreciation,
  moistureAdjustmentEgp,
  moistureCorrectedQty,
  marginPerM3,
  pricePerBaseUnit,
  productionCostPerM3,
  roundMoney,
  roundQty,
  toBaseQuantity,
  transportCost,
  yieldCheck,
  type BaseUnit,
} from '../../src/core/cost';
import { COST_DEMO_MATERIALS, COST_DEMO_SETTINGS } from '../../src/core/costDemo';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const nullable = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : String(value);
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const newId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
const dateOnly = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
};
const monthOf = (value: unknown): string => `${dateOnly(value).slice(0, 7)}-01`;
const today = (): string => new Date().toISOString().slice(0, 10);
const parseMissing = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

export interface CostSettingsView {
  mode: 'demo' | 'real';
  plantId: string;
  asOf: string;
  rows: Array<{
    key: string;
    value: number;
    unit: string;
    effectiveFrom: string;
    isDemo: boolean;
    noteAr: string;
    noteEn: string;
  }>;
  prices: Array<{
    materialId: string;
    code: string;
    nameAr: string;
    nameEn: string;
    pricePerUnit: number | null;
    baseUnit: string;
    sourceUnit: string | null;
    effectiveFrom: string | null;
    isDemo: boolean;
  }>;
  missingKeys: string[];
}

export interface BatchCostView extends Row {
  lines: Row[];
}

const settingMap = async (
  tx: Executor,
  companyId: string,
  plantId: string,
  asOf: string,
): Promise<Map<string, Row>> => {
  const rows = await tx.unsafe<Row>(
    `select distinct on (setting_key) setting_key, value::text as value, unit,
            effective_from, is_demo, note_ar, note_en
       from cost_settings
      where company_id = $1 and plant_id = $2 and effective_from <= $3::date
      order by setting_key, effective_from desc, created_at desc`,
    [companyId, plantId, asOf],
  );
  return new Map(rows.map((row) => [str(row.setting_key), row]));
};

const settingValue = (map: Map<string, Row>, key: string): number | null => {
  const row = map.get(key);
  return row ? num(row.value) : null;
};

const plantIdsFor = async (tx: Executor, context: B1Context): Promise<string[]> => {
  const rows = await tx.unsafe<{ id: string }>(
    `select id from plants
      where company_id = $1
        and ($2::text[] = '{}'::text[] or id = any($2::text[]))
      order by id`,
    [context.tenant.companyId, context.tenant.plantIds],
  );
  return rows.map((row) => row.id);
};

export class CostService {
  constructor(private readonly db: Db) {}

  async settings(context: B1Context, plantId: string, asOf = today()): Promise<CostSettingsView> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const plants = await plantIdsFor(tx, context);
      const chosen = plantId && plants.includes(plantId) ? plantId : plants[0];
      if (!chosen) throw new M1Error('plant_required', 422, 'no plant is in scope');
      const map = await settingMap(tx, context.tenant.companyId, chosen, asOf);
      const rows = COST_DEMO_SETTINGS.map((definition) => {
        const row = map.get(definition.key);
        return {
          key: definition.key,
          value: row ? num(row.value) : definition.value,
          unit: row ? str(row.unit) : definition.unit,
          effectiveFrom: row ? dateOnly(row.effective_from) : asOf,
          isDemo: row ? Boolean(row.is_demo) : true,
          noteAr: row ? str(row.note_ar) : definition.noteAr,
          noteEn: row ? str(row.note_en) : definition.noteEn,
        };
      });
      const priceRows = await tx.unsafe<Row>(
        `select m.id as material_id, m.material_code, m.name_ar, m.name_en, m.unit_of_measure, m.category,
                mp.price_per_unit::text as price_per_unit, mp.base_unit, mp.source_unit,
                mp.effective_from, mp.is_demo
           from materials m
           left join lateral (
             select price_per_unit, base_unit, source_unit, effective_from, is_demo
               from material_prices
              where company_id = $1 and plant_id = $2 and material_id = m.id
                and effective_from <= $3::date
              order by effective_from desc, created_at desc
              limit 1
           ) mp on true
          where m.company_id = $1 and (m.plant_id = $2 or m.plant_id is null) and m.deleted_at is null
            and m.category in ('cement', 'aggregate', 'admixture', 'water')
          order by m.material_code`,
        [context.tenant.companyId, chosen, asOf],
      );
      const prices = priceRows.map((row) => ({
        materialId: str(row.material_id),
        code: str(row.material_code),
        nameAr: str(row.name_ar),
        nameEn: str(row.name_en),
        pricePerUnit: row.price_per_unit === null || row.price_per_unit === undefined ? null : num(row.price_per_unit),
        baseUnit: str(row.base_unit || (str(row.category) === 'water' ? 'L' : 'kg')),
        sourceUnit: row.source_unit === null || row.source_unit === undefined ? null : str(row.source_unit),
        effectiveFrom: row.effective_from ? dateOnly(row.effective_from) : null,
        isDemo: Boolean(row.is_demo),
      }));
      return {
        mode: rows.some((row) => row.isDemo) || prices.some((row) => row.isDemo) ? 'demo' : 'real',
        plantId: chosen,
        asOf,
        rows,
        prices,
        missingKeys: [
          ...rows.filter((row) => !map.has(row.key)).map((row) => row.key),
          ...prices.filter((row) => row.pricePerUnit === null).map((row) => `material_price:${row.code}`),
        ],
      };
    });
  }

  async upsertSetting(
    context: B1Context,
    input: { plantId: string; key: string; value: number; effectiveFrom: string; unit: string },
  ): Promise<CostSettingsView> {
    const definition = COST_DEMO_SETTINGS.find((row) => row.key === input.key);
    if (!definition) throw new M1Error('unknown_setting', 422, `unknown cost setting ${input.key}`);
    if (!Number.isFinite(input.value) || input.value < 0) {
      throw new M1Error('validation_error', 422, 'value must be a non-negative number');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
      throw new M1Error('validation_error', 422, 'effectiveFrom must be YYYY-MM-DD');
    }
    await this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `insert into cost_settings
           (id, company_id, plant_id, setting_key, value, unit, effective_from, is_demo,
            note_ar, note_en, created_by)
         values ($1,$2,$3,$4,$5,$6,$7::date,false,$8,$9,$10)
         on conflict (company_id, plant_id, setting_key, effective_from)
         do update set value = excluded.value, unit = excluded.unit, is_demo = false,
                       note_ar = excluded.note_ar, note_en = excluded.note_en`,
        [
          newId('CS'),
          context.tenant.companyId,
          input.plantId,
          input.key,
          input.value,
          input.unit || definition.unit,
          input.effectiveFrom,
          definition.noteAr,
          definition.noteEn,
          context.actor.username,
        ],
      );
    });
    return this.settings(context, input.plantId, input.effectiveFrom);
  }

  async upsertMaterialPrice(
    context: B1Context,
    input: { plantId: string; materialId: string; pricePerUnit: number; baseUnit: string; effectiveFrom: string },
  ): Promise<CostSettingsView> {
    if (!Number.isFinite(input.pricePerUnit) || input.pricePerUnit < 0) {
      throw new M1Error('validation_error', 422, 'pricePerUnit must be a non-negative number');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
      throw new M1Error('validation_error', 422, 'effectiveFrom must be YYYY-MM-DD');
    }
    await this.db.withTenant(context.tenant, async (tx) => {
      const material = await tx.unsafe<{ id: string }>(
        `select id from materials where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, input.materialId],
      );
      if (!material[0]) throw new M1Error('material_not_found', 404, 'material not found in this company');
      const existing = await tx.unsafe<{ id: string }>(
        `select id from material_prices
          where company_id = $1 and plant_id = $2 and material_id = $3
            and effective_from = $4::date and source_invoice_id is null`,
        [context.tenant.companyId, input.plantId, input.materialId, input.effectiveFrom],
      );
      if (existing[0]) {
        await tx.unsafe(
          `update material_prices
              set price_per_unit = $2, base_unit = $3, is_demo = false
            where company_id = $1 and id = $4`,
          [context.tenant.companyId, input.pricePerUnit, input.baseUnit, existing[0].id],
        );
      } else {
        await tx.unsafe(
          `insert into material_prices
             (id, company_id, plant_id, material_id, price_per_unit, base_unit, source_unit,
              effective_from, is_demo, created_by)
           values ($1,$2,$3,$4,$5,$6,$6,$7::date,false,$8)`,
          [
            newId('MP'),
            context.tenant.companyId,
            input.plantId,
            input.materialId,
            input.pricePerUnit,
            input.baseUnit,
            input.effectiveFrom,
            context.actor.username,
          ],
        );
      }
    });
    return this.settings(context, input.plantId, input.effectiveFrom);
  }

  /** Seeds only missing demo inputs; it never overwrites a value the user has edited. */
  async seedDemo(context: B1Context): Promise<{ plants: number; settings: number; prices: number; overheads: number; trucks: number; distances: number }> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const plants = await plantIdsFor(tx, context);
      let settings = 0;
      let prices = 0;
      let overheads = 0;
      let trucks = 0;
      let distances = 0;
      const asOf = today();
      const currentMonth = monthOf(asOf);
      const effectiveFrom = currentMonth;
      for (const plantId of plants) {
        for (const definition of COST_DEMO_SETTINGS) {
          const inserted = await tx.unsafe<{ id: string }>(
            `insert into cost_settings
               (id, company_id, plant_id, setting_key, value, unit, effective_from, is_demo,
                note_ar, note_en, created_by)
             values ($1,$2,$3,$4,$5,$6,$7::date,true,$8,$9,$10)
             on conflict (company_id, plant_id, setting_key, effective_from) do nothing
             returning id`,
            [
              newId('CS'),
              context.tenant.companyId,
              plantId,
              definition.key,
              definition.value,
              definition.unit,
              effectiveFrom,
              definition.noteAr,
              definition.noteEn,
              'demo-seed',
            ],
          );
          settings += inserted.length;
        }

        for (const material of COST_DEMO_MATERIALS) {
          const materials = await tx.unsafe<{ id: string }>(
            `select id from materials
              where company_id = $1 and plant_id = $2 and material_code = $3 and deleted_at is null`,
            [context.tenant.companyId, plantId, material.code],
          );
          for (const row of materials) {
            const exists = await tx.unsafe<{ id: string }>(
              `select id from material_prices
                where company_id = $1 and plant_id = $2 and material_id = $3 limit 1`,
              [context.tenant.companyId, plantId, row.id],
            );
            if (exists.length === 0) {
              await tx.unsafe(
                `insert into material_prices
                   (id, company_id, plant_id, material_id, price_per_unit, base_unit,
                    source_unit, effective_from, is_demo, created_by)
                 values ($1,$2,$3,$4,$5,$6,$7,$8::date,true,'demo-seed')`,
                [
                  newId('MP'),
                  context.tenant.companyId,
                  plantId,
                  row.id,
                  material.pricePerBase,
                  material.baseUnit,
                  material.sourceUnit,
                  currentMonth,
                ],
              );
              prices += 1;
            }
          }
        }

        const overhead = await tx.unsafe<{ id: string }>(
          `insert into monthly_overheads
             (id, company_id, plant_id, month_start, rent, admin, insurance, other, is_demo,
              note_ar, note_en, created_by)
           values ($1,$2,$3,$4::date,120000,90000,35000,0,true,
                   'قيم تجريبية قابلة للتعديل', 'Editable DEMO assumptions', 'demo-seed')
           on conflict (company_id, plant_id, month_start) do nothing
           returning id`,
          [newId('OVH'), context.tenant.companyId, plantId, currentMonth],
        );
        overheads += overhead.length;

        const updatedTrucks = await tx.unsafe<{ id: string }>(
          `update trucks
              set fuel_l_per_km = coalesce(fuel_l_per_km, 0.35),
                  asset_cost = coalesce(asset_cost, 4200000),
                  useful_life_months = coalesce(useful_life_months, 120),
                  maintenance_cost_per_km = coalesce(maintenance_cost_per_km, 1.2),
                  updated_at = now()
            where company_id = $1 and plant_id = $2
            returning id`,
          [context.tenant.companyId, plantId],
        );
        trucks += updatedTrucks.length;

        const updatedDrivers = await tx.unsafe<{ id: string }>(
          `update drivers
              set monthly_salary = coalesce(monthly_salary, 18000), updated_at = now()
            where company_id = $1 and plant_id = $2
            returning id`,
          [context.tenant.companyId, plantId],
        );
        if (updatedDrivers.length > 0) {
          /* salary is part of the demo assumptions, not a hardcoded engine constant */
        }

        const trips = await tx.unsafe<{ id: string }>(
          `update trips
              set distance_km = coalesce(distance_km, 25)
            where company_id = $1 and plant_id = $2 and distance_km is null
            returning id`,
          [context.tenant.companyId, plantId],
        );
        distances += trips.length;
      }
      return { plants: plants.length, settings, prices, overheads, trucks, distances };
    });
  }

  /**
   * Demo-only completed batches for the three M12 mix chains. This is a seed endpoint,
   * not an operating path: the normal M3 complete API still owns real production and
   * its moisture/scale rules. Every generated batch is tagged M12-DEMO and can be deleted
   * by replacing the demo data.
   */
  async seedDemoBatches(
    context: B1Context,
    batches: Array<{
      batchNo: string;
      plantId: string;
      orderId: string;
      mixVersionId: string;
      volume: number;
      components: Array<{ materialId: string; targetWeight: number; actualWeight: number; unit: string }>;
      moistures: Array<{ materialId: string; moisturePct: number }>;
    }>,
  ): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    for (const spec of batches) {
      const result = await this.db.withTenant(context.tenant, async (tx) => {
        const existing = await tx.unsafe<{ id: string; status: string }>(
          `select id, status from batches where company_id = $1 and plant_id = $2 and batch_no = $3`,
          [context.tenant.companyId, spec.plantId, spec.batchNo],
        );
        if (existing[0]?.status === 'completed') return false;
        if (existing[0]) {
          await tx.unsafe(`delete from batches where company_id = $1 and id = $2 and status <> 'completed'`, [
            context.tenant.companyId,
            existing[0].id,
          ]);
        }
        const version = await tx.unsafe<{ id: string }>(
          `select mv.id from mix_design_versions mv join mix_designs md on md.id = mv.mix_id
            where mv.company_id = $1 and mv.id = $2 and md.plant_id = $3 and mv.status = 'approved'`,
          [context.tenant.companyId, spec.mixVersionId, spec.plantId],
        );
        if (version.length === 0) throw new M1Error('mix_version_not_approved', 422, 'demo mix version is not approved for this plant');
        const order = await tx.unsafe<{ id: string }>(
          `select id from orders where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, spec.orderId],
        );
        if (order.length === 0) throw new M1Error('order_not_found', 404, 'demo order not found');
        const batchId = newId('BCH-M12');
        const now = new Date().toISOString();
        await tx.unsafe(
          `insert into batches
             (id, company_id, plant_id, batch_no, order_id, mix_version_id, planned_volume,
              actual_volume, status, operator_id, produced_at, completed_at, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$7,'completed',$8,$9::timestamptz,$9::timestamptz,$8,$8)`,
          [batchId, context.tenant.companyId, spec.plantId, spec.batchNo, spec.orderId,
           spec.mixVersionId, spec.volume, 'demo-seed', now],
        );
        let line = 0;
        for (const component of spec.components) {
          await tx.unsafe(
            `insert into batch_components
               (id, company_id, batch_id, material_id, target_weight, actual_weight, unit, tolerance_pct)
             values ($1,$2,$3,$4,$5,$6,$7,2)`,
            [
              newId(`BCC${line}`),
              context.tenant.companyId,
              batchId,
              component.materialId,
              component.targetWeight,
              component.actualWeight,
              component.unit,
            ],
          );
          line += 1;
        }
        for (const moisture of spec.moistures) {
          await tx.unsafe(
            `insert into moisture_readings
               (id, company_id, plant_id, material_id, basis, moisture_pct, absorption_pct,
                sample_at, valid_until, entered_by, created_by)
             values ($1,$2,$3,$4,'dry',$5,$5,now(),now() + interval '24 hours','demo-seed','demo-seed')`,
            [newId('MOI'), context.tenant.companyId, spec.plantId, moisture.materialId, moisture.moisturePct],
          );
        }
        return true;
      });
      if (result) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /** Copies approved/verified purchase invoice lines into EGP/kg or EGP/L history. */
  async syncMaterialPrices(context: B1Context): Promise<{ inserted: number; skipped: number }> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select ii.material_id, ii.unit_price::text as unit_price, pi.invoice_date,
                pi.id as invoice_id, pi.plant_id, m.category, m.unit_of_measure
           from purchase_invoice_items ii
           join purchase_invoices pi on pi.id = ii.invoice_id and pi.company_id = ii.company_id
           join materials m on m.id = ii.material_id and m.company_id = ii.company_id
          where pi.company_id = $1
            and pi.deleted_at is null and ii.deleted_at is null
            and pi.status in ('verified','approved','paid')
          order by pi.invoice_date, ii.created_at`,
        [context.tenant.companyId],
      );
      let inserted = 0;
      let skipped = 0;
      for (const row of rows) {
        const category = str(row.category);
        const unit = str(row.unit_of_measure);
        const baseUnit: BaseUnit = category === 'water' || category === 'admixture' || /lit/i.test(unit) ? 'L' : 'kg';
        try {
          const price = pricePerBaseUnit(num(row.unit_price), unit, baseUnit);
          const exists = await tx.unsafe<{ id: string }>(
            `select id from material_prices
              where company_id = $1 and plant_id = $2 and material_id = $3
                and effective_from = $4::date and source_invoice_id = $5`,
            [context.tenant.companyId, str(row.plant_id), str(row.material_id), dateOnly(row.invoice_date), str(row.invoice_id)],
          );
          if (exists.length > 0) {
            skipped += 1;
            continue;
          }
          await tx.unsafe(
            `insert into material_prices
               (id, company_id, plant_id, material_id, price_per_unit, base_unit, source_unit,
                source_invoice_id, effective_from, is_demo, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,false,$10)`,
            [
              newId('MP'),
              context.tenant.companyId,
              str(row.plant_id),
              str(row.material_id),
              price,
              baseUnit,
              unit,
              str(row.invoice_id),
              dateOnly(row.invoice_date),
              context.actor.username,
            ],
          );
          inserted += 1;
        } catch {
          skipped += 1;
        }
      }
      return { inserted, skipped };
    });
  }

  async recomputeAll(context: B1Context): Promise<{ batches: number; trips: number; snapshots: number }> {
    await this.syncMaterialPrices(context);
    return this.db.withTenant(context.tenant, async (tx) => {
      const batchIds = await tx.unsafe<{ id: string }>(
        `select id from batches where company_id = $1 order by id`,
        [context.tenant.companyId],
      );
      for (const row of batchIds) await this.recomputeBatchTx(tx, context, row.id);
      const tripIds = await tx.unsafe<{ id: string }>(
        `select id from trips where company_id = $1 order by id`,
        [context.tenant.companyId],
      );
      for (const row of tripIds) await this.recomputeTripTx(tx, context, row.id);
      const snapshots = await this.rebuildSnapshots(tx, context);
      return { batches: batchIds.length, trips: tripIds.length, snapshots };
    });
  }

  async recomputeBatch(context: B1Context, batchId: string): Promise<BatchCostView> {
    await this.db.withTenant(context.tenant, async (tx) => this.recomputeBatchTx(tx, context, batchId));
    return this.getBatch(context, batchId);
  }

  async recomputeTrip(context: B1Context, tripId: string): Promise<Row> {
    await this.db.withTenant(context.tenant, async (tx) => this.recomputeTripTx(tx, context, tripId));
    return this.getTripCost(context, tripId);
  }

  private async recomputeBatchTx(tx: Executor, context: B1Context, batchId: string): Promise<void> {
    const batches = await tx.unsafe<Row>(
      `select b.id, b.company_id, b.plant_id, b.order_id, b.mix_version_id, b.status,
              b.planned_volume::text as planned_volume, b.actual_volume::text as actual_volume,
              b.produced_at, mv.density_kg_per_m3::text as density,
              md.id as mix_id, o.unit_price::text as unit_price, o.customer_id
         from batches b
         join mix_design_versions mv on mv.id = b.mix_version_id and mv.company_id = b.company_id
         join mix_designs md on md.id = mv.mix_id and md.company_id = b.company_id
         left join orders o on o.id = b.order_id and o.company_id = b.company_id
        where b.company_id = $1 and b.id = $2`,
      [context.tenant.companyId, batchId],
    );
    const batch = batches[0];
    if (!batch) return;
    const plantId = str(batch.plant_id);
    const asOf = dateOnly(batch.produced_at) || today();
    const settings = await settingMap(tx, context.tenant.companyId, plantId, asOf);

    const components = await tx.unsafe<Row>(
      `select c.material_id, c.actual_weight::text as actual_weight,
              c.target_weight::text as target_weight, c.unit,
              m.category, m.unit_of_measure, m.deleted_at
         from batch_components c
         left join materials m on m.id = c.material_id and m.company_id = c.company_id
        where c.company_id = $1 and c.batch_id = $2
        order by c.material_id`,
      [context.tenant.companyId, batchId],
    );
    const recipe = await tx.unsafe<Row>(
      `select material_id, qty_per_m3::text as qty_per_m3, unit
         from mix_components
        where company_id = $1 and version_id = $2`,
      [context.tenant.companyId, str(batch.mix_version_id)],
    );
    const recipeMap = new Map(recipe.map((row) => [str(row.material_id), num(row.qty_per_m3)]));
    const moistureRows = await tx.unsafe<Row>(
      `select distinct on (material_id) material_id, moisture_pct::text as moisture_pct
         from moisture_readings
        where company_id = $1 and plant_id = $2
          and sample_at <= ($3::date + interval '1 day')
        order by material_id, sample_at desc`,
      [context.tenant.companyId, plantId, asOf],
    );
    const moistureMap = new Map(moistureRows.map((row) => [str(row.material_id), num(row.moisture_pct)]));
    const priceRows = await tx.unsafe<Row>(
      `select distinct on (material_id) material_id, price_per_unit::text as price_per_unit, base_unit
         from material_prices
        where company_id = $1 and plant_id = $2 and effective_from <= $3::date
        order by material_id, effective_from desc, created_at desc`,
      [context.tenant.companyId, plantId, asOf],
    );
    const priceMap = new Map(priceRows.map((row) => [str(row.material_id), num(row.price_per_unit)]));
    const waterPrice = await tx.unsafe<Row>(
      `select mp.price_per_unit::text as price_per_unit
         from material_prices mp
         join materials m on m.id = mp.material_id and m.company_id = mp.company_id
        where mp.company_id = $1 and mp.plant_id = $2 and m.category = 'water'
          and mp.effective_from <= $3::date
        order by mp.effective_from desc, mp.created_at desc limit 1`,
      [context.tenant.companyId, plantId, asOf],
    );
    const waterPriceL = waterPrice[0] ? num(waterPrice[0].price_per_unit) : 0;

    const billedM3 = num(batch.actual_volume);
    const density = num(batch.density) || 2400;
    const missing: string[] = [];
    if (str(batch.status) !== 'completed') missing.push('batch_not_completed');
    if (billedM3 <= 0) missing.push('billed_m3');
    if (components.length === 0) missing.push('batch_components');
    if (settings.size === 0) missing.push('cost_settings');

    let materialCost = 0;
    let moistureAdjustment = 0;
    let totalWeight = 0;
    let designWater = 0;
    const aggregateMoisture: Array<{ measuredKg: number; moisturePct: number }> = [];
    const lines: Row[] = [];

    for (const component of components) {
      const materialId = str(component.material_id);
      const materialExists = Boolean(component.category);
      const lineMaterialId = materialExists ? materialId : null;
      const category = str(component.category);
      /* The batching line records the unit actually weighed; the master unit is only a fallback. */
      const unit = str(component.unit || component.unit_of_measure || 'kg');
      const actualWeight = numOrNull(component.actual_weight);
      const theoreticalQty = recipeMap.get(materialId) !== undefined && billedM3 > 0
        ? (recipeMap.get(materialId) ?? 0) * billedM3
        : null;
      const lineMissing: string[] = [];
      if (!materialExists) lineMissing.push('material_deleted');
      if (actualWeight === null || actualWeight <= 0) lineMissing.push('actual_weight');
      if (theoreticalQty === null) lineMissing.push('mix_recipe');
      const baseUnit: BaseUnit = category === 'water' || category === 'admixture' || /lit/i.test(unit) ? 'L' : 'kg';
      let measured = 0;
      let actualQty = 0;
      let price: number | null = priceMap.get(materialId) ?? null;
      let cost = 0;
      let moisturePct = 0;
      try {
        /* 1 kg water = 1 L; some recipes store water in kg even though the price is per L. */
        const sourceUnit = category === 'water' && /^kg$/i.test(unit) ? 'L' : unit;
        measured = actualWeight === null ? 0 : toBaseQuantity(actualWeight, sourceUnit, baseUnit);
        moisturePct = category === 'aggregate' ? moistureMap.get(materialId) ?? 0 : 0;
        actualQty = moistureCorrectedQty(measured, moisturePct);
        if (category === 'aggregate' && !moistureMap.has(materialId)) lineMissing.push('moisture_reading');
        if (price === null) lineMissing.push('material_price');
        cost = price === null ? 0 : measured * price;
        if (billedM3 > 0 && theoreticalQty !== null) totalWeight += actualQty;
        if (category === 'water') designWater = Math.max(designWater, actualQty);
        if (category === 'aggregate') aggregateMoisture.push({ measuredKg: measured, moisturePct });
      } catch {
        lineMissing.push('unit_dimension');
      }
      materialCost += cost;
      lines.push({
        lineType: 'material',
        materialId: lineMaterialId,
        measuredQty: measured,
        theoreticalQty,
        actualQty,
        unit: baseUnit,
        unitPrice: price,
        cost,
        moisturePct,
        variancePct: theoreticalQty !== null ? materialVariancePct(actualQty, theoreticalQty) : null,
        incomplete: lineMissing.length > 0,
        missing: lineMissing.join(','),
      });
      if (category === 'aggregate' && measured > 0 && price !== null) {
        const adjustment = moistureAdjustmentEgp(measured, moisturePct, price, waterPriceL);
        moistureAdjustment += adjustment.adjustmentEgp;
        lines.push({
          lineType: 'moisture',
          materialId: lineMaterialId,
          measuredQty: measured,
          theoreticalQty: null,
          actualQty: adjustment.moistureKg,
          unit: 'kg',
          unitPrice: price - waterPriceL,
          cost: adjustment.adjustmentEgp,
          moisturePct,
          variancePct: null,
          incomplete: false,
          missing: '',
        });
      }
      for (const item of lineMissing) missing.push(`${item}:${materialId}`);
    }

    const effectiveWater = designWater > 0 ? addedWaterL(designWater, aggregateMoisture) : 0;
    void effectiveWater;

    const monthRows = await tx.unsafe<{ produced: string }>(
      `select coalesce(sum(actual_volume),0)::text as produced
         from batches
        where company_id = $1 and plant_id = $2 and status = 'completed'
          and date_trunc('month', produced_at) = date_trunc('month', $3::date)`,
      [context.tenant.companyId, plantId, asOf],
    );
    const producedM3 = num(monthRows[0]?.produced);
    const crew = settingValue(settings, 'plant_crew_monthly');
    const maintenanceSetting = settingValue(settings, 'plant_maintenance_monthly');
    const maintenanceRows = await tx.unsafe<{ total: string }>(
      `select coalesce(sum(cost_amount),0)::text as total
         from truck_maintenance
        where company_id = $1 and plant_id = $2
          and date_trunc('month', opened_at) = date_trunc('month', $3::date)`,
      [context.tenant.companyId, plantId, asOf],
    );
    const maintenance = num(maintenanceRows[0]?.total) > 0 ? num(maintenanceRows[0]?.total) : maintenanceSetting ?? 0;
    const asset = settingValue(settings, 'plant_asset_cost');
    const life = settingValue(settings, 'plant_useful_life_months');
    const depreciation = asset !== null && life !== null ? monthlyDepreciation(asset, life) : 0;
    const production = productionCostPerM3({
      kwhPerM3: settingValue(settings, 'kwh_per_m3') ?? 0,
      electricityTariff: settingValue(settings, 'electricity_tariff') ?? 0,
      fuelLPerM3: settingValue(settings, 'fuel_l_per_m3') ?? 0,
      fuelPrice: settingValue(settings, 'fuel_price') ?? 0,
      crewMonthly: crew ?? 0,
      maintenanceMonthly: maintenance,
      depreciationMonthly: depreciation,
      producedM3,
    });
    missing.push(...production.missing);
    if (production.total > 0 && billedM3 > 0) {
      for (const [lineType, value] of [
        ['electricity', production.electricity],
        ['fuel_loader', production.fuel],
        ['labor', production.labor],
        ['maintenance', production.maintenance],
        ['depreciation', production.depreciation],
      ] as const) {
        lines.push({
          lineType,
          materialId: null,
          measuredQty: billedM3,
          theoreticalQty: null,
          actualQty: billedM3,
          unit: 'm3',
          unitPrice: value,
          cost: value * billedM3,
          moisturePct: 0,
          variancePct: null,
          incomplete: false,
          missing: '',
        });
      }
    }

    const overheadRows = await tx.unsafe<Row>(
      `select (rent + admin + insurance + other)::text as total
         from monthly_overheads
        where company_id = $1 and plant_id = $2 and month_start = date_trunc('month', $3::date)::date`,
      [context.tenant.companyId, plantId, asOf],
    );
    const overheadMonthly = overheadRows[0]
      ? num(overheadRows[0].total)
      : (settingValue(settings, 'overhead_rent') ?? 0) +
        (settingValue(settings, 'overhead_admin') ?? 0) +
        (settingValue(settings, 'overhead_insurance') ?? 0);
    if (!overheadRows[0] && overheadMonthly === 0) missing.push('monthly_overhead');
    if (overheadRows[0] === undefined) missing.push('monthly_overhead');
    if (producedM3 <= 0) missing.push('produced_m3_month');
    const overheadPerM3 = producedM3 > 0 ? overheadMonthly / producedM3 : 0;

    /*
     * Store the displayed money components at 2 decimals and derive the total from those
     * exact values, so the dashboard drill-down always sums to the batch total. Computing
     * the total from unrounded components produced a one-piastre mismatch at the boundary.
     */
    const materialRounded = roundMoney(materialCost);
    const moistureRounded = roundMoney(moistureAdjustment);
    const productionTotal = roundMoney(production.total * billedM3);
    const overheadTotal = roundMoney(overheadPerM3 * billedM3);
    const totalCost = roundMoney(materialRounded + moistureRounded + productionTotal + overheadTotal);
    const costPerM3 = billedM3 > 0 ? totalCost / billedM3 : null;
    const revenuePerM3 = num(batch.unit_price);
    const revenue = revenuePerM3 * billedM3;
    const margin = costPerM3 === null ? null : marginPerM3(revenuePerM3, costPerM3).marginPerM3;
    const tolerance = settingValue(settings, 'yield_tolerance_pct') ?? 2;
    const yieldResult = yieldCheck(totalWeight, density, billedM3, tolerance);
    missing.push(...yieldResult.missing);
    const uniqueMissing = [...new Set(missing)];

    await tx.unsafe(`delete from batch_cost_lines where company_id = $1 and batch_id = $2`, [
      context.tenant.companyId,
      batchId,
    ]);
    for (const line of lines) {
      await tx.unsafe(
        `insert into batch_cost_lines
           (id, company_id, plant_id, batch_id, line_type, material_id, measured_qty,
            theoretical_qty, actual_qty, unit, unit_price, cost_egp, moisture_pct,
            variance_pct, is_incomplete, missing_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          newId('BCL'),
          context.tenant.companyId,
          plantId,
          batchId,
          line.lineType,
          line.materialId,
          line.measuredQty,
          line.theoreticalQty,
          line.actualQty,
          line.unit,
          line.unitPrice,
          roundMoney(line.cost as number),
          line.moisturePct,
          line.variancePct,
          line.incomplete,
          line.missing,
        ],
      );
    }
    await tx.unsafe(
      `insert into batch_costs
         (batch_id, company_id, plant_id, order_id, mix_version_id, billed_m3, total_weight_kg,
          density_kg_per_m3, yield_m3, yield_variance_pct, yield_flagged, material_cost, moisture_adjustment,
          production_cost, overhead_cost, total_cost, cost_per_m3, revenue, revenue_per_m3,
          margin_per_m3, status, missing_fields, computed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
       on conflict (batch_id) do update set
         order_id = excluded.order_id, mix_version_id = excluded.mix_version_id,
         billed_m3 = excluded.billed_m3, total_weight_kg = excluded.total_weight_kg,
         density_kg_per_m3 = excluded.density_kg_per_m3, yield_m3 = excluded.yield_m3,
         yield_variance_pct = excluded.yield_variance_pct, yield_flagged = excluded.yield_flagged,
         material_cost = excluded.material_cost,
         moisture_adjustment = excluded.moisture_adjustment, production_cost = excluded.production_cost,
         overhead_cost = excluded.overhead_cost, total_cost = excluded.total_cost,
         cost_per_m3 = excluded.cost_per_m3, revenue = excluded.revenue,
         revenue_per_m3 = excluded.revenue_per_m3, margin_per_m3 = excluded.margin_per_m3,
         status = excluded.status, missing_fields = excluded.missing_fields, computed_at = now()`,
      [
        batchId,
        context.tenant.companyId,
        plantId,
        nullable(batch.order_id),
        nullable(batch.mix_version_id),
        billedM3,
        roundQty(totalWeight),
        density,
        roundQty(yieldResult.yieldM3),
        yieldResult.variancePct,
        yieldResult.flagged,
        materialRounded,
        moistureRounded,
        productionTotal,
        overheadTotal,
        totalCost,
        costPerM3 === null ? null : roundMoney(costPerM3),
        roundMoney(revenue),
        revenuePerM3,
        margin === null ? null : roundMoney(margin),
        uniqueMissing.length === 0 ? 'complete' : 'incomplete',
        JSON.stringify(uniqueMissing),
      ],
    );
  }

  private async recomputeTripTx(tx: Executor, context: B1Context, tripId: string): Promise<void> {
    const rows = await tx.unsafe<Row>(
      `select tr.id, tr.plant_id, tr.order_id, tr.status, tr.distance_km::text as distance_km,
              tr.delivered_volume_m3::text as delivered_volume_m3,
              tr.loaded_m3::text as loaded_m3, tr.target_m3::text as target_m3,
              tr.wait_min_at_site, tr.site_wait_minutes, tr.truck_id, tr.trip_date,
              tk.fuel_l_per_km::text as fuel_l_per_km, tk.asset_cost::text as asset_cost,
              tk.useful_life_months, tk.maintenance_cost_per_km::text as maintenance_cost_per_km,
              tk.plate_no, o.unit_price::text as unit_price
         from trips tr
         left join trucks tk on tk.id = tr.truck_id and tk.company_id = tr.company_id
         left join orders o on o.id = tr.order_id and o.company_id = tr.company_id
        where tr.company_id = $1 and tr.id = $2`,
      [context.tenant.companyId, tripId],
    );
    const trip = rows[0];
    if (!trip) return;
    const plantId = str(trip.plant_id);
    const asOf = dateOnly(trip.trip_date) || today();
    const settings = await settingMap(tx, context.tenant.companyId, plantId, asOf);
    const missing: string[] = [];
    const status = str(trip.status);
    if (status !== 'returned' && status !== 'unloaded') missing.push('trip_not_completed');
    const distance = numOrNull(trip.distance_km) ?? settingValue(settings, 'default_distance_km') ?? 0;
    if (numOrNull(trip.distance_km) === null) missing.push('distance_km');
    const load = numOrNull(trip.delivered_volume_m3) ?? numOrNull(trip.loaded_m3) ?? numOrNull(trip.target_m3) ?? 0;
    if (load <= 0) missing.push('load_m3');
    const fuelPerKm = numOrNull(trip.fuel_l_per_km) ?? settingValue(settings, 'truck_fuel_l_per_km') ?? 0;
    if (fuelPerKm <= 0) missing.push('truck_fuel_l_per_km');
    const asset = numOrNull(trip.asset_cost) ?? settingValue(settings, 'truck_asset_cost') ?? 0;
    const life = num(trip.useful_life_months) || settingValue(settings, 'truck_useful_life_months') || 0;
    const tripsMonth = await tx.unsafe<{ count: string }>(
      `select count(*)::text as count from trips
        where company_id = $1 and plant_id = $2 and status in ('returned','unloaded')
          and date_trunc('month', trip_date) = date_trunc('month', $3::date)`,
      [context.tenant.companyId, plantId, asOf],
    );
    const tripsCount = Math.max(1, num(tripsMonth[0]?.count));
    const driverRows = await tx.unsafe<Row>(
      `select monthly_salary::text as monthly_salary from drivers
        where company_id = $1 and plant_id = $2 and status = 'active'
        order by created_at limit 1`,
      [context.tenant.companyId, plantId],
    );
    const driverSalary = driverRows[0]
      ? num(driverRows[0].monthly_salary) || settingValue(settings, 'driver_salary_monthly') || 0
      : settingValue(settings, 'driver_salary_monthly') ?? 0;
    const driverPerTrip = driverSalary / tripsCount;
    const maintRows = await tx.unsafe<{ total: string }>(
      `select coalesce(sum(cost_amount),0)::text as total from truck_maintenance
        where company_id = $1 and truck_id = $2
          and date_trunc('month', opened_at) = date_trunc('month', $3::date)`,
      [context.tenant.companyId, nullable(trip.truck_id), asOf],
    );
    const maintMonthly = num(maintRows[0]?.total);
    const maintPerTrip = maintMonthly > 0
      ? maintMonthly / tripsCount
      : (numOrNull(trip.maintenance_cost_per_km) ?? 0) * distance * 2;
    const depreciation = asset > 0 && life > 0 ? monthlyDepreciation(asset, life) / tripsCount : 0;
    const waitMinutes = num(trip.wait_min_at_site) || num(trip.site_wait_minutes);
    const transport = transportCost({
      distanceKm: distance,
      fuelLPerKm: fuelPerKm,
      fuelPrice: settingValue(settings, 'fuel_price') ?? 0,
      loadM3: load,
      driverCostPerTrip: driverPerTrip,
      truckDepreciationPerTrip: depreciation,
      truckMaintenancePerTrip: maintPerTrip,
      waitMinutes,
      waitThresholdMinutes: settingValue(settings, 'wait_threshold_minutes') ?? 30,
      idleLPerHour: settingValue(settings, 'driver_idle_l_per_hour') ?? 0,
      driverHourlyCost: settingValue(settings, 'driver_hourly_cost') ?? 0,
    });
    missing.push(...transport.missing);
    const total = transport.totalPerM3 * load;
    await tx.unsafe(
      `insert into trip_cost_lines
         (trip_id, company_id, plant_id, order_id, distance_km, load_m3, fuel_cost, driver_cost,
          depreciation_cost, maintenance_cost, waiting_cost, waiting_minutes, waiting_flagged,
          total_cost, cost_per_m3, status, missing_fields, computed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
       on conflict (trip_id) do update set
         order_id = excluded.order_id, distance_km = excluded.distance_km, load_m3 = excluded.load_m3,
         fuel_cost = excluded.fuel_cost, driver_cost = excluded.driver_cost,
         depreciation_cost = excluded.depreciation_cost, maintenance_cost = excluded.maintenance_cost,
         waiting_cost = excluded.waiting_cost, waiting_minutes = excluded.waiting_minutes,
         waiting_flagged = excluded.waiting_flagged, total_cost = excluded.total_cost,
         cost_per_m3 = excluded.cost_per_m3, status = excluded.status,
         missing_fields = excluded.missing_fields, computed_at = now()`,
      [
        tripId,
        context.tenant.companyId,
        plantId,
        nullable(trip.order_id),
        distance,
        load,
        roundMoney(transport.fuelCostTotal),
        roundMoney(transport.driverPerM3 * load),
        roundMoney(transport.depreciationPerM3 * load),
        roundMoney(transport.maintenancePerM3 * load),
        roundMoney(transport.waitingCost),
        waitMinutes,
        transport.waitingFlagged,
        roundMoney(total),
        roundMoney(transport.totalPerM3),
        missing.length === 0 ? 'complete' : 'incomplete',
        JSON.stringify([...new Set(missing)]),
      ],
    );
  }

  private async rebuildSnapshots(tx: Executor, context: B1Context): Promise<number> {
    const orders = await tx.unsafe<Row>(
      `select o.id, o.plant_id, o.customer_id, o.order_no, o.unit_price::text as unit_price,
              o.quantity_m3::text as quantity_m3, o.delivery_date
         from orders o
        where o.company_id = $1 and o.deleted_at is null
        order by o.id`,
      [context.tenant.companyId],
    );
    const batchCosts = await tx.unsafe<Row>(
      `select batch_id, order_id, plant_id, billed_m3::text as billed_m3,
              total_cost::text as total_cost, mix_version_id,
              (select md.id from mix_design_versions mv join mix_designs md on md.id = mv.mix_id
                where mv.id = batch_costs.mix_version_id) as mix_id,
              status
         from batch_costs where company_id = $1 and order_id is not null`,
      [context.tenant.companyId],
    );
    const trips = await tx.unsafe<Row>(
      `select trip_id, order_id, plant_id, load_m3::text as load_m3,
              total_cost::text as total_cost, status
         from trip_cost_lines where company_id = $1 and order_id is not null`,
      [context.tenant.companyId],
    );
    const batchesByOrder = new Map<string, Row[]>();
    for (const row of batchCosts) {
      const key = str(row.order_id);
      batchesByOrder.set(key, [...(batchesByOrder.get(key) ?? []), row]);
    }
    const tripsByOrder = new Map<string, Row[]>();
    for (const row of trips) {
      const key = str(row.order_id);
      tripsByOrder.set(key, [...(tripsByOrder.get(key) ?? []), row]);
    }

    await tx.unsafe(`delete from cost_snapshots where company_id = $1`, [context.tenant.companyId]);
    const orderSnapshots: Row[] = [];
    for (const order of orders) {
      const id = str(order.id);
      const batchRows = batchesByOrder.get(id) ?? [];
      const tripRows = tripsByOrder.get(id) ?? [];
      if (batchRows.length === 0 && tripRows.length === 0) continue;
      const batchM3 = batchRows.reduce((sum, row) => sum + num(row.billed_m3), 0);
      const tripM3 = tripRows.reduce((sum, row) => sum + num(row.load_m3), 0);
      const m3 = tripM3 > 0 ? tripM3 : batchM3;
      const batchCost = batchRows.reduce((sum, row) => sum + num(row.total_cost), 0);
      const tripCost = tripRows.reduce((sum, row) => sum + num(row.total_cost), 0);
      const missing: string[] = [];
      if (batchRows.length === 0) missing.push('batch_cost');
      if (tripRows.length === 0) missing.push('transport_cost');
      if (batchRows.some((row) => str(row.status) !== 'complete')) missing.push('batch_incomplete');
      if (tripRows.some((row) => str(row.status) !== 'complete')) missing.push('trip_incomplete');
      if (m3 <= 0) missing.push('billed_m3');
      const revenuePerM3 = num(order.unit_price);
      const revenue = revenuePerM3 * m3;
      const cost = batchCost + tripCost;
      const mixId = nullable(batchRows[0]?.mix_id);
      const period = monthOf(order.delivery_date || today());
      const row: Row = {
        id: newId('CST'),
        plantId: nullable(order.plant_id) ?? '',
        dimension: 'order',
        dimensionId: id,
        period,
        customerId: nullable(order.customer_id),
        mixId,
        revenue,
        cost,
        m3,
        margin: revenue - cost,
        marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
        status: missing.length === 0 ? 'complete' : 'incomplete',
      };
      orderSnapshots.push(row);
    }

    const writeRows = async (rows: Row[]): Promise<void> => {
      for (const row of rows) {
        await tx.unsafe(
          `insert into cost_snapshots
             (id, company_id, plant_id, dimension, dimension_id, period_start, customer_id,
              mix_id, revenue, cost, m3, margin, margin_pct, status, computed_at)
           values ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,now())`,
          [
            row.id,
            context.tenant.companyId,
            row.plantId,
            row.dimension,
            row.dimensionId,
            row.period,
            row.customerId,
            row.mixId,
            roundMoney(num(row.revenue)),
            roundMoney(num(row.cost)),
            roundQty(num(row.m3)),
            roundMoney(num(row.margin)),
            row.marginPct === null ? null : num(row.marginPct),
            row.status,
          ],
        );
      }
    };
    await writeRows(orderSnapshots);

    const aggregate = (source: Row[], key: (row: Row) => string, dimension: string): Row[] => {
      const groups = new Map<string, Row[]>();
      for (const row of source) {
        const groupKey = key(row);
        groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
      }
      const output: Row[] = [];
      for (const rows of groups.values()) {
        const first = rows[0] as Row;
        const revenue = rows.reduce((sum, row) => sum + num(row.revenue), 0);
        const cost = rows.reduce((sum, row) => sum + num(row.cost), 0);
        const m3 = rows.reduce((sum, row) => sum + num(row.m3), 0);
        const dimensionId =
          dimension === 'customer'
            ? str(first.customerId)
            : dimension === 'mix'
              ? str(first.mixId)
              : dimension === 'plant'
                ? str(first.plantId)
                : str(first.period);
        output.push({
          id: newId('CST'),
          plantId: first.plantId,
          dimension,
          dimensionId,
          period: first.period,
          customerId: dimension === 'customer' ? first.customerId : null,
          mixId: dimension === 'mix' ? first.mixId : null,
          revenue,
          cost,
          m3,
          margin: revenue - cost,
          marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
          status: rows.some((row) => str(row.status) !== 'complete') ? 'incomplete' : 'complete',
        });
      }
      return output;
    };

    const customerRows = aggregate(orderSnapshots, (row) => `${str(row.customerId)}|${str(row.period)}|${str(row.plantId)}`, 'customer');
    const mixRows = aggregate(orderSnapshots.filter((row) => row.mixId), (row) => `${str(row.mixId)}|${str(row.period)}|${str(row.plantId)}`, 'mix');
    const plantRows = aggregate(orderSnapshots, (row) => `${str(row.plantId)}|${str(row.period)}`, 'plant');
    const monthRows = aggregate(orderSnapshots, (row) => str(row.period), 'month');
    await writeRows([...customerRows, ...mixRows, ...plantRows, ...monthRows]);
    return orderSnapshots.length + customerRows.length + mixRows.length + plantRows.length + monthRows.length;
  }

  async listBatches(
    context: B1Context,
    filters: { plantId?: string; from?: string; to?: string; limit?: number },
  ): Promise<Row[]> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select bc.*, b.batch_no, b.status as batch_status, o.order_no, o.unit_price::text as order_unit_price,
                md.code as mix_code, md.name_ar as mix_name_ar, md.name_en as mix_name_en
           from batch_costs bc
           join batches b on b.id = bc.batch_id
           left join orders o on o.id = bc.order_id
           left join mix_design_versions mv on mv.id = bc.mix_version_id
           left join mix_designs md on md.id = mv.mix_id
          where bc.company_id = $1
            and ($2::text = '' or bc.plant_id = $2)
            and ($3::date is null or b.produced_at::date >= $3::date)
            and ($4::date is null or b.produced_at::date <= $4::date)
          order by b.produced_at desc nulls last, bc.computed_at desc
          limit $5`,
        [context.tenant.companyId, filters.plantId ?? '', filters.from || null, filters.to || null, Math.min(500, filters.limit ?? 200)],
      );
      return rows.map((row) => ({
        ...row,
        missing_fields: parseMissing(row.missing_fields),
      }));
    });
  }

  async getBatch(context: B1Context, batchId: string): Promise<BatchCostView> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select bc.*, b.batch_no, b.status as batch_status, b.produced_at,
                o.order_no, md.code as mix_code, md.name_ar as mix_name_ar, md.name_en as mix_name_en
           from batch_costs bc
           join batches b on b.id = bc.batch_id
           left join orders o on o.id = bc.order_id
           left join mix_design_versions mv on mv.id = bc.mix_version_id
           left join mix_designs md on md.id = mv.mix_id
          where bc.company_id = $1 and bc.batch_id = $2`,
        [context.tenant.companyId, batchId],
      );
      if (!rows[0]) throw new M1Error('not_found', 404, 'batch cost not found; recompute first');
      const lines = await tx.unsafe<Row>(
        `select bcl.*, m.name_ar as material_name_ar, m.name_en as material_name_en,
                m.material_code, m.category
           from batch_cost_lines bcl
           left join materials m on m.id = bcl.material_id and m.company_id = bcl.company_id
          where bcl.company_id = $1 and bcl.batch_id = $2
          order by bcl.line_type, m.material_code`,
        [context.tenant.companyId, batchId],
      );
      return { ...rows[0], missing_fields: parseMissing(rows[0].missing_fields), lines: lines.map((line) => ({ ...line })) };
    });
  }

  async getTripCost(context: B1Context, tripId: string): Promise<Row> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select tcl.*, t.status as trip_status, t.driver_name, tk.plate_no, o.order_no,
                c.name_ar as customer_name_ar, c.name_en as customer_name_en
           from trip_cost_lines tcl
           join trips t on t.id = tcl.trip_id
           left join trucks tk on tk.id = t.truck_id
           left join orders o on o.id = tcl.order_id
           left join customers c on c.id = o.customer_id
          where tcl.company_id = $1 and tcl.trip_id = $2`,
        [context.tenant.companyId, tripId],
      );
      if (!rows[0]) throw new M1Error('not_found', 404, 'trip cost not found; recompute first');
      return { ...rows[0], missing_fields: parseMissing(rows[0].missing_fields) };
    });
  }

  async listTripCosts(context: B1Context, tripIds: string[] = []): Promise<Row[]> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select trip_id, order_id, distance_km::text as distance_km, load_m3::text as load_m3,
                fuel_cost::text as fuel_cost, driver_cost::text as driver_cost,
                depreciation_cost::text as depreciation_cost, maintenance_cost::text as maintenance_cost,
                waiting_cost::text as waiting_cost, waiting_minutes::text as waiting_minutes,
                waiting_flagged, total_cost::text as total_cost, cost_per_m3::text as cost_per_m3,
                status, missing_fields
           from trip_cost_lines
          where company_id = $1 and ($2::text[] = '{}'::text[] or trip_id = any($2::text[]))`,
        [context.tenant.companyId, tripIds],
      );
      return rows.map((row) => ({ ...row, missing_fields: parseMissing(row.missing_fields) }));
    });
  }

  async report(
    context: B1Context,
    filters: { dimension: string; from?: string; to?: string; plantId?: string },
  ): Promise<Row[]> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select cs.*, c.name_ar as customer_name_ar, c.name_en as customer_name_en,
                md.code as mix_code, md.name_ar as mix_name_ar, md.name_en as mix_name_en
           from cost_snapshots cs
           left join customers c on c.id = cs.dimension_id and cs.dimension = 'customer'
           left join mix_designs md on md.id = cs.dimension_id and cs.dimension = 'mix'
          where cs.company_id = $1 and cs.dimension = $2
            and ($3::date is null or cs.period_start >= date_trunc('month', $3::date)::date)
            and ($4::date is null or cs.period_start <= $4::date)
            and ($5::text = '' or cs.plant_id = $5)
          order by cs.margin asc, cs.period_start desc`,
        [context.tenant.companyId, filters.dimension, filters.from || null, filters.to || null, filters.plantId ?? ''],
      );
      return rows;
    });
  }

  async dashboard(context: B1Context, month: string, plantId = ''): Promise<Row> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const plantFilter = plantId;
      const period = monthOf(month || today());
      const summary = await tx.unsafe<Row>(
        `select coalesce(sum(revenue),0)::text as revenue, coalesce(sum(cost),0)::text as cost,
                coalesce(sum(m3),0)::text as m3
           from cost_snapshots
          where company_id = $1 and dimension = 'order' and period_start = $2::date
            and ($3::text = '' or plant_id = $3)`,
        [context.tenant.companyId, period, plantFilter],
      );
      const batches = await tx.unsafe<Row>(
        `select coalesce(sum(material_cost + moisture_adjustment),0)::text as material,
                coalesce(sum(production_cost),0)::text as production,
                coalesce(sum(overhead_cost),0)::text as overhead,
                coalesce(sum(billed_m3),0)::text as m3
           from batch_costs
          where company_id = $1
            and date_trunc('month', computed_at) = $2::date
            and ($3::text = '' or plant_id = $3)`,
        [context.tenant.companyId, period, plantFilter],
      );
      const trips = await tx.unsafe<Row>(
        `select coalesce(sum(total_cost),0)::text as transport,
                coalesce(sum(load_m3),0)::text as m3
           from trip_cost_lines
          where company_id = $1
            and date_trunc('month', computed_at) = $2::date
            and ($3::text = '' or plant_id = $3)`,
        [context.tenant.companyId, period, plantFilter],
      );
      const topLoss = await tx.unsafe<Row>(
        `select cs.dimension_id, cs.margin, cs.margin_pct, cs.revenue, cs.cost, cs.m3, o.order_no,
                c.name_ar as customer_name_ar, c.name_en as customer_name_en
           from cost_snapshots cs
           left join orders o on o.id = cs.dimension_id
           left join customers c on c.id = o.customer_id
          where cs.company_id = $1 and cs.dimension = 'order' and cs.period_start = $2::date
            and ($3::text = '' or cs.plant_id = $3)
          order by cs.margin asc limit 5`,
        [context.tenant.companyId, period, plantFilter],
      );
      const variances = await tx.unsafe<Row>(
        `select bcl.material_id, m.material_code, m.name_ar, m.name_en,
                avg(abs(bcl.variance_pct))::text as avg_abs_variance_pct, count(*)::text as lines
           from batch_cost_lines bcl
           join materials m on m.id = bcl.material_id
          where bcl.company_id = $1 and bcl.line_type = 'material' and bcl.variance_pct is not null
            and date_trunc('month', bcl.created_at) = $2::date
            and ($3::text = '' or bcl.plant_id = $3)
          group by bcl.material_id, m.material_code, m.name_ar, m.name_en
          order by avg(abs(bcl.variance_pct)) desc limit 5`,
        [context.tenant.companyId, period, plantFilter],
      );
      const material = num(batches[0]?.material);
      const production = num(batches[0]?.production);
      const overhead = num(batches[0]?.overhead);
      const transport = num(trips[0]?.transport);
      const totalCost = material + production + overhead + transport;
      const totalM3 = num(batches[0]?.m3) || num(trips[0]?.m3) || num(summary[0]?.m3);
      const revenue = num(summary[0]?.revenue);
      /* One consistent cost: the same component total shown in the breakdown. */
      const cost = totalCost;
      return {
        period,
        mode: 'demo',
        kpis: {
          revenue: roundMoney(revenue),
          cost: roundMoney(cost),
          margin: roundMoney(revenue - cost),
          marginPct: revenue > 0 ? roundQty(((revenue - cost) / revenue) * 100) : null,
          m3: roundQty(totalM3),
          costPerM3: totalM3 > 0 ? roundMoney(totalCost / totalM3) : null,
          revenuePerM3: totalM3 > 0 ? roundMoney(revenue / totalM3) : null,
          marginPerM3: totalM3 > 0 ? roundMoney((revenue - cost) / totalM3) : null,
        },
        breakdown: [
          { key: 'material', value: roundMoney(material), perM3: totalM3 > 0 ? roundMoney(material / totalM3) : 0 },
          { key: 'production', value: roundMoney(production), perM3: totalM3 > 0 ? roundMoney(production / totalM3) : 0 },
          { key: 'transport', value: roundMoney(transport), perM3: totalM3 > 0 ? roundMoney(transport / totalM3) : 0 },
          { key: 'overhead', value: roundMoney(overhead), perM3: totalM3 > 0 ? roundMoney(overhead / totalM3) : 0 },
        ],
        topLoss,
        variances,
      };
    });
  }
}
