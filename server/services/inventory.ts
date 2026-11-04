/** M6 inventory repository. Tenant-scoped; every decision goes through src/core/inventory. */
import {
  applyWeightedAverage,
  buildSnapshot,
  canExceptionTransition,
  canGoodsReceiptTransition,
  canMaterialTransition,
  canPurchaseOrderTransition,
  canPurchaseRequestTransition,
  checkDuplicateDocument,
  checkFifoOnBulk,
  checkMaterialCode,
  checkOverReceipt,
  checkPositiveQuantity,
  checkPurchaseOrderQuantity,
  checkRequiredReferences,
  checkUnitCostBand,
  checkUnitMatch,
  checkValuationLocked,
  checkValuationSelected,
  consumeFifoLayers,
  INVENTORY_LEVELS,
  INVENTORY_RULE_CODES,
  MOVEMENT_SIGNS,
  negativeStockDecision,
  type CostLayer,
  type ExceptionStatus,
  type GoodsReceiptStatus,
  type InventoryCatalogueKey,
  type MaterialCategory,
  type MaterialStatus,
  type MissingSourceCandidate,
  type MovementType,
  type PurchaseOrderStatus,
  type PurchaseRequestStatus,
  type ValuationMethod,
} from '../../src/core/inventory';
import { MIN_OVERRIDE_REASON, type RuleDefinition } from '../../src/core/rules';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));

const newId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

const documentNo = (prefix: string): string => {
  const year = new Date().getUTCFullYear();
  const tail = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${prefix}-${year}-${tail}`;
};

const balanceExpression = (alias: string): string => `
  coalesce((
    select sum(case when sm.movement_type in ('issue', 'consumption', 'transfer_out')
                    then -sm.quantity else sm.quantity end)
      from stock_movements sm
     where sm.company_id = ${alias}.company_id
       and sm.material_id = ${alias}.id
       and sm.plant_id = ${alias}.plant_id), 0)`;

const averageCostExpression = (alias: string): string => `
  coalesce((
    select case when sum(case when sm.movement_type in ('issue', 'consumption', 'transfer_out')
                              then -sm.quantity else sm.quantity end) <> 0
                then sum(case when sm.movement_type in ('issue', 'consumption', 'transfer_out')
                              then -coalesce(sm.total_cost, 0) else coalesce(sm.total_cost, 0) end)
                     / sum(case when sm.movement_type in ('issue', 'consumption', 'transfer_out')
                                then -sm.quantity else sm.quantity end)
                else 0 end
      from stock_movements sm
     where sm.company_id = ${alias}.company_id
       and sm.material_id = ${alias}.id
       and sm.plant_id = ${alias}.plant_id), 0)`;

export interface MaterialRow {
  id: string;
  plant_id: string;
  material_code: string;
  name_ar: string;
  name_en: string;
  category: MaterialCategory;
  unit_of_measure: string;
  is_bulk: boolean;
  valuation_method: ValuationMethod | null;
  min_stock_level: number | null;
  max_stock_level: number | null;
  reorder_point: number | null;
  status: MaterialStatus;
  balance: number;
  average_cost: number;
}

export interface SupplierRow {
  id: string;
  plant_id: string | null;
  supplier_code: string | null;
  name_ar: string;
  name_en: string;
  contact: string;
  payment_terms: string;
  credit_days: number | null;
  rating: number | null;
  status: string;
}

export interface PurchaseRequestRow {
  id: string;
  plant_id: string;
  pr_no: string;
  material_id: string;
  material_code: string;
  material_name: string;
  quantity_requested: number;
  unit_of_measure: string;
  reason: string;
  requested_by: string;
  requested_at: string;
  status: PurchaseRequestStatus;
}

export interface PurchaseOrderRow {
  id: string;
  plant_id: string;
  po_no: string;
  supplier_id: string;
  supplier_name: string;
  pr_id: string | null;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  status: PurchaseOrderStatus;
  ordered_at: string | null;
  expected_delivery_at: string | null;
  items: PurchaseOrderItemRow[];
}

export interface PurchaseOrderItemRow {
  id: string;
  material_id: string;
  material_code: string;
  material_name: string;
  unit_of_measure: string;
  unit_price: number;
  quantity_ordered: number;
  quantity_received: number;
  tax_rate: number;
  discount_pct: number;
}

export interface GoodsReceiptRow {
  id: string;
  plant_id: string;
  receipt_no: string;
  po_id: string;
  po_no: string;
  received_at: string;
  received_by: string;
  status: GoodsReceiptStatus;
  void_reason: string | null;
  items: GoodsReceiptItemRow[];
}

export interface GoodsReceiptItemRow {
  id: string;
  po_item_id: string;
  material_id: string;
  material_code: string;
  quantity_received: number;
  unit_cost: number;
  lot_no: string;
  expiry_date: string | null;
  weight_in_kg: number | null;
}

export interface MovementRow {
  movement_id: string;
  plant_id: string;
  material_id: string;
  material_code: string;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  total_cost: number | null;
  movement_type: MovementType;
  reference_type: string;
  reference_id: string | null;
  lot_no: string;
  reason: string;
  occurred_at: string;
  created_by: string;
}

export interface ExceptionRow {
  exception_id: string;
  plant_id: string;
  material_id: string;
  material_code: string;
  quantity: number;
  available_quantity: number;
  reason: string;
  severity: string;
  status: string;
  suggested_source_type: string;
  suggested_source_id: string | null;
  suggestion_note: string;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  decision: string | null;
}

const toMaterial = (row: Row): MaterialRow => ({
  id: str(row.id),
  plant_id: str(row.plant_id),
  material_code: str(row.material_code),
  name_ar: str(row.name_ar),
  name_en: str(row.name_en),
  category: str(row.category) as MaterialCategory,
  unit_of_measure: str(row.unit_of_measure),
  is_bulk: row.is_bulk === true || row.is_bulk === 't',
  valuation_method: (nullable(row.valuation_method) as ValuationMethod | null) ?? null,
  min_stock_level: numOrNull(row.min_stock_level),
  max_stock_level: numOrNull(row.max_stock_level),
  reorder_point: numOrNull(row.reorder_point),
  status: str(row.status) as MaterialStatus,
  balance: num(row.balance),
  average_cost: num(row.average_cost),
});

const toMovement = (row: Row): MovementRow => ({
  movement_id: str(row.movement_id),
  plant_id: str(row.plant_id),
  material_id: str(row.material_id),
  material_code: str(row.material_code),
  quantity: num(row.quantity),
  unit: str(row.unit),
  unit_cost: numOrNull(row.unit_cost),
  total_cost: numOrNull(row.total_cost),
  movement_type: str(row.movement_type) as MovementType,
  reference_type: str(row.reference_type),
  reference_id: nullable(row.reference_id),
  lot_no: str(row.lot_no),
  reason: str(row.reason),
  occurred_at: str(row.occurred_at),
  created_by: str(row.created_by),
});

const toException = (row: Row): ExceptionRow => ({
  exception_id: str(row.exception_id),
  plant_id: str(row.plant_id),
  material_id: str(row.material_id),
  material_code: str(row.material_code),
  quantity: num(row.quantity),
  available_quantity: num(row.available_quantity),
  reason: str(row.reason),
  severity: str(row.severity),
  status: str(row.status),
  suggested_source_type: str(row.suggested_source_type),
  suggested_source_id: nullable(row.suggested_source_id),
  suggestion_note: str(row.suggestion_note),
  opened_by: str(row.opened_by),
  opened_at: str(row.opened_at),
  closed_by: nullable(row.closed_by),
  closed_at: nullable(row.closed_at),
  decision: nullable(row.decision),
});

interface MovementPayload {
  plantId: string;
  materialId: string;
  quantity: number;
  unit?: string;
  movementType: MovementType;
  unitCost?: number | null;
  referenceType?: string;
  referenceId?: string | null;
  lotNo?: string;
  reason?: string;
  batchId?: string | null;
  moistureReadingId?: string | null;
  correctionOf?: string | null;
  linkedReceiptId?: string | null;
  expiryDate?: string | null;
}

export class InventoryService {
  constructor(private readonly db: Db) {}

  private level = (context: B1Context, min: number, what: string): void => {
    if (context.actor.roleLevel < min) {
      throw new M1Error('forbidden', 403, `only a level-${min} user may ${what}`);
    }
  };

  private rules = async (tx: Executor, companyId: string): Promise<Map<string, RuleDefinition>> => {
    const rows = await tx.unsafe<Row>(
      `select code, classification, value::text as value, unit, source_note, status
         from rule_definitions where company_id = $1 and module = 'inventory'`,
      [companyId],
    );
    const rules = new Map<string, RuleDefinition>();
    for (const row of rows) {
      rules.set(str(row.code), {
        code: str(row.code),
        module: 'inventory',
        classification: str(row.classification) as RuleDefinition['classification'],
        value: numOrNull(row.value),
        unit: str(row.unit),
        sourceNote: str(row.source_note),
        status: str(row.status) === 'retired' ? 'retired' : 'active',
      });
    }
    return rules;
  };

  private ruleFor = (
    rules: Map<string, RuleDefinition>,
    key: InventoryCatalogueKey,
  ): RuleDefinition | null => rules.get(INVENTORY_RULE_CODES[key]) ?? null;

  // --------------------------------------------------------------- material master

  listMaterials = async (
    context: B1Context,
    filters: { plantId?: string; category?: string; lowStock?: boolean; q?: string } = {},
  ): Promise<MaterialRow[]> => {
    this.level(context, INVENTORY_LEVELS.read, 'read materials');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select mt.id, mt.plant_id, mt.material_code, mt.name_ar, mt.name_en, mt.category,
                mt.unit_of_measure, mt.is_bulk, mt.valuation_method,
                mt.min_stock_level::text as min_stock_level,
                mt.max_stock_level::text as max_stock_level,
                mt.reorder_point::text as reorder_point, mt.status,
                (${balanceExpression('mt')})::text as balance,
                (${averageCostExpression('mt')})::text as average_cost
           from materials mt
          where mt.company_id = $1 and mt.deleted_at is null
            and ($2::text = '' or mt.plant_id = $2)
            and ($3::text = '' or mt.category = $3)
            and ($4::text = '' or mt.material_code ilike '%' || $4 || '%'
                 or mt.name_ar ilike '%' || $4 || '%' or mt.name_en ilike '%' || $4 || '%')
          order by mt.material_code`,
        [
          context.tenant.companyId,
          filters.plantId ?? '',
          filters.category ?? '',
          filters.q ?? '',
        ],
      ),
    );
    const materials = rows.map(toMaterial);
    if (!filters.lowStock) return materials;
    return materials.filter(
      (material) => material.reorder_point !== null && material.balance <= material.reorder_point,
    );
  };

  createMaterial = async (
    context: B1Context,
    payload: {
      plantId: string;
      materialCode: string;
      nameAr: string;
      nameEn: string;
      category: MaterialCategory;
      unitOfMeasure: string;
      isBulk: boolean;
      valuationMethod: ValuationMethod | null;
      minStockLevel: number | null;
      maxStockLevel: number | null;
      reorderPoint: number | null;
    },
  ): Promise<MaterialRow> => {
    this.level(context, INVENTORY_LEVELS.materialMaster, 'create a material');
    if (!payload.nameAr.trim()) {
      throw new M1Error('validation_error', 422, 'nameAr is required', { field: 'nameAr' });
    }
    const fifo = checkFifoOnBulk(payload.isBulk, payload.valuationMethod);
    if (fifo.outcome !== 'pass') {
      throw new M1Error(fifo.classification, 422, 'a bulk material cannot use FIFO', {
        check: fifo.key,
      });
    }
    const id = newId('MAT');
    return this.db.withTenant(context.tenant, async (tx) => {
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from materials where company_id = $1 and material_code = $2 and deleted_at is null`,
            [context.tenant.companyId, payload.materialCode.trim()],
          )
        ).length > 0;
      const code = checkMaterialCode(payload.materialCode, duplicate);
      if (code.outcome !== 'pass') {
        throw new M1Error('validation_error', 422, 'material code must be unique', {
          check: code.key,
          reason: code.reasonKey,
        });
      }
      await tx.unsafe(
        `insert into materials (id, company_id, plant_id, material_code, name_ar, name_en, category,
            unit_of_measure, is_bulk, valuation_method, min_stock_level, max_stock_level,
            reorder_point, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.materialCode.trim(),
          payload.nameAr.trim(),
          payload.nameEn.trim(),
          payload.category,
          payload.unitOfMeasure.trim(),
          payload.isBulk,
          payload.valuationMethod,
          payload.minStockLevel,
          payload.maxStockLevel,
          payload.reorderPoint,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'inventory.material_created', id, {
        materialCode: payload.materialCode.trim(),
        valuationMethod: payload.valuationMethod,
      });
      return this.readMaterial(tx, context, id);
    });
  };

  updateMaterial = async (
    context: B1Context,
    id: string,
    payload: {
      nameAr?: string;
      nameEn?: string;
      category?: MaterialCategory;
      unitOfMeasure?: string;
      isBulk?: boolean;
      valuationMethod?: ValuationMethod | null;
      minStockLevel?: number | null;
      maxStockLevel?: number | null;
      reorderPoint?: number | null;
      status?: MaterialStatus;
    },
  ): Promise<MaterialRow> => {
    this.level(context, INVENTORY_LEVELS.materialMaster, 'change a material');
    return this.db.withTenant(context.tenant, async (tx) => {
      const before = await this.readMaterial(tx, context, id);
      if (payload.status && payload.status !== before.status) {
        if (!canMaterialTransition(before.status, payload.status)) {
          throw new M1Error('invalid_transition', 409, `material ${id} is ${before.status}`, {
            from: before.status,
            to: payload.status,
          });
        }
      }
      const nextMethod =
        payload.valuationMethod === undefined ? before.valuation_method : payload.valuationMethod;
      const nextBulk = payload.isBulk === undefined ? before.is_bulk : payload.isBulk;
      const fifo = checkFifoOnBulk(nextBulk, nextMethod);
      if (fifo.outcome !== 'pass') {
        throw new M1Error(fifo.classification, 422, 'a bulk material cannot use FIFO', {
          check: fifo.key,
        });
      }
      const movements = await tx.unsafe<Row>(
        `select count(*)::text as count from stock_movements
          where company_id = $1 and material_id = $2`,
        [context.tenant.companyId, id],
      );
      const lock = checkValuationLocked(
        before.valuation_method,
        nextMethod,
        num(movements[0]?.count),
      );
      if (lock.outcome !== 'pass') {
        throw new M1Error(lock.classification, 409, 'valuation method is locked after posting', {
          check: lock.key,
        });
      }
      await tx.unsafe(
        `update materials set
            name_ar = coalesce($3, name_ar), name_en = coalesce($4, name_en),
            category = coalesce($5, category), unit_of_measure = coalesce($6, unit_of_measure),
            is_bulk = coalesce($7, is_bulk), valuation_method = $8,
            min_stock_level = $9, max_stock_level = $10, reorder_point = $11,
            status = coalesce($12, status), updated_by = $13
          where company_id = $1 and id = $2`,
        [
          context.tenant.companyId,
          id,
          payload.nameAr ?? null,
          payload.nameEn ?? null,
          payload.category ?? null,
          payload.unitOfMeasure ?? null,
          payload.isBulk ?? null,
          nextMethod,
          payload.minStockLevel === undefined ? before.min_stock_level : payload.minStockLevel,
          payload.maxStockLevel === undefined ? before.max_stock_level : payload.maxStockLevel,
          payload.reorderPoint === undefined ? before.reorder_point : payload.reorderPoint,
          payload.status ?? null,
          context.actor.username,
        ],
      );
      if (nextMethod !== before.valuation_method) {
        await audit(tx, context, 'inventory.valuation_method_set', id, {
          before: before.valuation_method,
          after: nextMethod,
        });
      }
      await audit(tx, context, 'inventory.material_updated', id, {});
      return this.readMaterial(tx, context, id);
    });
  };

  private readMaterial = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<MaterialRow> => {
    const rows = await tx.unsafe<Row>(
      `select mt.id, mt.plant_id, mt.material_code, mt.name_ar, mt.name_en, mt.category,
              mt.unit_of_measure, mt.is_bulk, mt.valuation_method,
              mt.min_stock_level::text as min_stock_level,
              mt.max_stock_level::text as max_stock_level,
              mt.reorder_point::text as reorder_point, mt.status,
              (${balanceExpression('mt')})::text as balance,
              (${averageCostExpression('mt')})::text as average_cost
         from materials mt
        where mt.company_id = $1 and mt.id = $2 and mt.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('material_not_found', 404, `material ${id} does not exist`);
    return toMaterial(rows[0]);
  };

  // --------------------------------------------------------------------- suppliers

  listSuppliers = async (context: B1Context): Promise<SupplierRow[]> => {
    this.level(context, INVENTORY_LEVELS.read, 'read suppliers');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select id, plant_id, supplier_code, name_ar, name_en, contact, payment_terms,
                credit_days::text as credit_days, rating::text as rating, status
           from suppliers where company_id = $1 and deleted_at is null order by name_ar`,
        [context.tenant.companyId],
      ),
    );
    return rows.map((row) => ({
      id: str(row.id),
      plant_id: nullable(row.plant_id),
      supplier_code: nullable(row.supplier_code),
      name_ar: str(row.name_ar),
      name_en: str(row.name_en),
      contact: str(row.contact),
      payment_terms: str(row.payment_terms),
      credit_days: numOrNull(row.credit_days),
      rating: numOrNull(row.rating),
      status: str(row.status),
    }));
  };

  createSupplier = async (
    context: B1Context,
    payload: {
      plantId: string;
      supplierCode: string;
      nameAr: string;
      nameEn: string;
      contact: string;
      paymentTerms: string;
      creditDays: number | null;
      rating: number | null;
    },
  ): Promise<SupplierRow> => {
    this.level(context, INVENTORY_LEVELS.approvePurchaseRequest, 'register a supplier');
    if (!payload.nameAr.trim()) {
      throw new M1Error('validation_error', 422, 'nameAr is required', { field: 'nameAr' });
    }
    const id = newId('SUP');
    return this.db.withTenant(context.tenant, async (tx) => {
      if (payload.supplierCode.trim()) {
        const duplicate =
          (
            await tx.unsafe<Row>(
              `select 1 from suppliers where company_id = $1 and supplier_code = $2 and deleted_at is null`,
              [context.tenant.companyId, payload.supplierCode.trim()],
            )
          ).length > 0;
        if (duplicate) {
          throw new M1Error('validation_error', 422, 'supplier code must be unique', {
            field: 'supplierCode',
          });
        }
      }
      await tx.unsafe(
        `insert into suppliers (id, company_id, plant_id, supplier_code, name_ar, name_en,
            contact, payment_terms, credit_days, rating, category, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'services',$11,$11)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.supplierCode.trim() || null,
          payload.nameAr.trim(),
          payload.nameEn.trim(),
          payload.contact,
          payload.paymentTerms,
          payload.creditDays,
          payload.rating,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'supplier.created', id, {});
      const rows = await tx.unsafe<Row>(
        `select id, plant_id, supplier_code, name_ar, name_en, contact, payment_terms,
                credit_days::text as credit_days, rating::text as rating, status
           from suppliers where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      const row = rows[0] ?? {};
      return {
        id: str(row.id),
        plant_id: nullable(row.plant_id),
        supplier_code: nullable(row.supplier_code),
        name_ar: str(row.name_ar),
        name_en: str(row.name_en),
        contact: str(row.contact),
        payment_terms: str(row.payment_terms),
        credit_days: numOrNull(row.credit_days),
        rating: numOrNull(row.rating),
        status: str(row.status),
      };
    });
  };

  // ---------------------------------------------------------------- purchase requests

  listPurchaseRequests = async (
    context: B1Context,
    filters: { plantId?: string; status?: string } = {},
  ): Promise<PurchaseRequestRow[]> => {
    this.level(context, INVENTORY_LEVELS.read, 'read purchase requests');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select pr.id, pr.plant_id, pr.pr_no, pr.material_id, mt.material_code,
                coalesce(nullif(mt.name_en, ''), mt.name_ar) as material_name,
                pr.quantity_requested::text as quantity_requested, mt.unit_of_measure,
                pr.reason, pr.requested_by, pr.requested_at, pr.status
           from purchase_requests pr
           join materials mt on mt.id = pr.material_id and mt.company_id = pr.company_id
          where pr.company_id = $1 and pr.deleted_at is null
            and ($2::text = '' or pr.plant_id = $2)
            and ($3::text = '' or pr.status = $3)
          order by pr.requested_at desc`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? ''],
      ),
    );
    return rows.map((row) => ({
      id: str(row.id),
      plant_id: str(row.plant_id),
      pr_no: str(row.pr_no),
      material_id: str(row.material_id),
      material_code: str(row.material_code),
      material_name: str(row.material_name),
      quantity_requested: num(row.quantity_requested),
      unit_of_measure: str(row.unit_of_measure),
      reason: str(row.reason),
      requested_by: str(row.requested_by),
      requested_at: str(row.requested_at),
      status: str(row.status) as PurchaseRequestStatus,
    }));
  };

  createPurchaseRequest = async (
    context: B1Context,
    payload: { plantId: string; materialId: string; quantityRequested: number; reason: string; prNo?: string },
  ): Promise<PurchaseRequestRow> => {
    this.level(context, INVENTORY_LEVELS.raisePurchaseRequest, 'raise a purchase request');
    const quantity = checkPositiveQuantity(payload.quantityRequested);
    if (quantity.outcome !== 'pass') {
      throw new M1Error('validation_error', 422, 'quantity must be greater than zero', {
        field: 'quantityRequested',
      });
    }
    const id = newId('PR');
    const prNo = payload.prNo?.trim() || documentNo('PR');
    await this.db.withTenant(context.tenant, async (tx) =>
      tx.unsafe(
        `insert into purchase_requests (id, company_id, plant_id, pr_no, material_id,
            quantity_requested, reason, requested_by, status, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$9)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          prNo,
          payload.materialId,
          payload.quantityRequested,
          payload.reason,
          context.actor.username,
          context.actor.username,
        ],
      ),
    );
    const rows = await this.listPurchaseRequests(context);
    const created = rows.find((row) => row.id === id);
    if (!created) throw new M1Error('purchase_request_not_found', 404, 'request could not be read back');
    return created;
  };

  submitPurchaseRequest = async (context: B1Context, id: string): Promise<PurchaseRequestRow> => {
    this.level(context, INVENTORY_LEVELS.raisePurchaseRequest, 'submit a purchase request');
    return this.movePurchaseRequest(context, id, 'submitted');
  };

  decidePurchaseRequest = async (
    context: B1Context,
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<PurchaseRequestRow> => {
    this.level(context, INVENTORY_LEVELS.approvePurchaseRequest, 'approve a purchase request');
    return this.movePurchaseRequest(context, id, decision);
  };

  private movePurchaseRequest = async (
    context: B1Context,
    id: string,
    status: PurchaseRequestStatus,
  ): Promise<PurchaseRequestRow> => {
    await this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, status from purchase_requests
          where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      const row = rows[0];
      if (!row) throw new M1Error('purchase_request_not_found', 404, `request ${id} does not exist`);
      if (!canPurchaseRequestTransition(str(row.status) as PurchaseRequestStatus, status)) {
        throw new M1Error('invalid_transition', 409, `request ${id} is ${row.status}`, {
          from: row.status,
          to: status,
        });
      }
      await tx.unsafe(
        `update purchase_requests set status = $3, updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, status, context.actor.username],
      );
      await audit(tx, context, `purchase_request.${status}`, id, {});
    });
    const rows = await this.listPurchaseRequests(context);
    const updated = rows.find((row) => row.id === id);
    if (!updated) throw new M1Error('purchase_request_not_found', 404, `request ${id} does not exist`);
    return updated;
  };

  convertPurchaseRequest = async (
    context: B1Context,
    id: string,
    payload: {
      supplierId: string;
      unitPrice: number;
      taxRate: number;
      expectedDeliveryAt: string | null;
    },
  ): Promise<PurchaseOrderRow> => {
    this.level(context, INVENTORY_LEVELS.approvePurchaseRequest, 'convert a request to a PO');
    const poId = newId('PO');
    const poNo = documentNo('PO');
    await this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, plant_id, material_id, quantity_requested::text as quantity_requested, status
           from purchase_requests where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      const pr = rows[0];
      if (!pr) throw new M1Error('purchase_request_not_found', 404, `request ${id} does not exist`);
      if (!canPurchaseRequestTransition(str(pr.status) as PurchaseRequestStatus, 'converted_to_po')) {
        throw new M1Error('invalid_transition', 409, `request ${id} is ${pr.status}`, {
          from: pr.status,
          to: 'converted_to_po',
        });
      }
      const quantity = num(pr.quantity_requested);
      const tax = (quantity * payload.unitPrice * payload.taxRate) / 100;
      await tx.unsafe(
        `insert into purchase_orders (id, company_id, plant_id, po_no, supplier_id, pr_id,
            subtotal, tax_amount, total, status, expected_delivery_at, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$7 + $8,'draft',$9,$10,$10)`,
        [
          poId,
          context.tenant.companyId,
          str(pr.plant_id),
          poNo,
          payload.supplierId,
          id,
          quantity * payload.unitPrice,
          tax,
          payload.expectedDeliveryAt,
          context.actor.username,
        ],
      );
      await tx.unsafe(
        `insert into po_items (id, company_id, plant_id, po_id, material_id, unit_price,
            quantity_ordered, tax_rate, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          newId('POI'),
          context.tenant.companyId,
          str(pr.plant_id),
          poId,
          str(pr.material_id),
          payload.unitPrice,
          quantity,
          payload.taxRate,
          context.actor.username,
        ],
      );
      await tx.unsafe(
        `update purchase_requests set status = 'converted_to_po', updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'purchase_request.converted', id, { poId, poNo });
    });
    const order = await this.readPurchaseOrder(context, poId);
    return order;
  };

  // ----------------------------------------------------------------- purchase orders

  listPurchaseOrders = async (
    context: B1Context,
    filters: { plantId?: string; status?: string } = {},
  ): Promise<PurchaseOrderRow[]> => {
    this.level(context, INVENTORY_LEVELS.read, 'read purchase orders');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select po.id, po.plant_id, po.po_no, po.supplier_id,
                coalesce(nullif(s.name_en, ''), s.name_ar) as supplier_name, po.pr_id,
                po.total::text as total_amount, po.tax_amount::text as tax_amount,
                po.discount_amount::text as discount_amount, po.status, po.ordered_at,
                po.expected_delivery_at
           from purchase_orders po
           join suppliers s on s.id = po.supplier_id and s.company_id = po.company_id
          where po.company_id = $1 and po.deleted_at is null
            and ($2::text = '' or po.plant_id = $2)
            and ($3::text = '' or po.status = $3)
          order by po.created_at desc`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? ''],
      ),
    );
    const orders: PurchaseOrderRow[] = [];
    for (const row of rows) {
      orders.push(await this.hydrateOrder(context, row));
    }
    return orders;
  };

  private readPurchaseOrder = async (
    context: B1Context,
    id: string,
  ): Promise<PurchaseOrderRow> => {
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select po.id, po.plant_id, po.po_no, po.supplier_id,
                coalesce(nullif(s.name_en, ''), s.name_ar) as supplier_name, po.pr_id,
                po.total::text as total_amount, po.tax_amount::text as tax_amount,
                po.discount_amount::text as discount_amount, po.status, po.ordered_at,
                po.expected_delivery_at
           from purchase_orders po
           join suppliers s on s.id = po.supplier_id and s.company_id = po.company_id
          where po.company_id = $1 and po.id = $2 and po.deleted_at is null`,
        [context.tenant.companyId, id],
      ),
    );
    if (!rows[0]) throw new M1Error('purchase_order_not_found', 404, `order ${id} does not exist`);
    return this.hydrateOrder(context, rows[0]);
  };

  private hydrateOrder = async (context: B1Context, row: Row): Promise<PurchaseOrderRow> => {
    const items = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select pi.id, pi.material_id, mt.material_code,
                coalesce(nullif(mt.name_en, ''), mt.name_ar) as material_name, mt.unit_of_measure,
                pi.unit_price::text as unit_price, pi.quantity_ordered::text as quantity_ordered,
                pi.quantity_received::text as quantity_received, pi.tax_rate::text as tax_rate,
                pi.discount_pct::text as discount_pct
           from po_items pi
           join materials mt on mt.id = pi.material_id and mt.company_id = pi.company_id
          where pi.company_id = $1 and pi.po_id = $2 order by mt.material_code`,
        [context.tenant.companyId, str(row.id)],
      ),
    );
    return {
      id: str(row.id),
      plant_id: str(row.plant_id),
      po_no: str(row.po_no),
      supplier_id: str(row.supplier_id),
      supplier_name: str(row.supplier_name),
      pr_id: nullable(row.pr_id),
      total_amount: num(row.total_amount),
      tax_amount: num(row.tax_amount),
      discount_amount: num(row.discount_amount),
      status: str(row.status) as PurchaseOrderStatus,
      ordered_at: nullable(row.ordered_at),
      expected_delivery_at: nullable(row.expected_delivery_at),
      items: items.map((item) => ({
        id: str(item.id),
        material_id: str(item.material_id),
        material_code: str(item.material_code),
        material_name: str(item.material_name),
        unit_of_measure: str(item.unit_of_measure),
        unit_price: num(item.unit_price),
        quantity_ordered: num(item.quantity_ordered),
        quantity_received: num(item.quantity_received),
        tax_rate: num(item.tax_rate),
        discount_pct: num(item.discount_pct),
      })),
    };
  };

  createPurchaseOrder = async (
    context: B1Context,
    payload: {
      plantId: string;
      supplierId: string;
      poNo?: string;
      prId: string | null;
      expectedDeliveryAt: string | null;
      items: Array<{
        materialId: string;
        quantityOrdered: number;
        unitPrice: number;
        taxRate: number;
        discountPct: number;
      }>;
    },
  ): Promise<PurchaseOrderRow> => {
    this.level(context, INVENTORY_LEVELS.approvePurchaseRequest, 'create a purchase order');
    const references = checkRequiredReferences({
      supplierId: payload.supplierId,
      materialIds: payload.items.map((item) => item.materialId),
    });
    if (references.outcome !== 'pass') {
      throw new M1Error('validation_error', 422, 'supplier and materials are required', {
        check: references.key,
      });
    }
    if (payload.items.length === 0) {
      throw new M1Error('validation_error', 422, 'at least one line is required', {
        field: 'items',
      });
    }
    for (const item of payload.items) {
      if (checkPositiveQuantity(item.quantityOrdered).outcome !== 'pass') {
        throw new M1Error('validation_error', 422, 'quantity must be greater than zero', {
          field: 'quantityOrdered',
        });
      }
      if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
        throw new M1Error('validation_error', 422, 'unitPrice must not be negative', {
          field: 'unitPrice',
        });
      }
    }
    const id = newId('PO');
    const poNo = payload.poNo?.trim() || documentNo('PO');
    await this.db.withTenant(context.tenant, async (tx) => {
      const suppliers = await tx.unsafe<Row>(
        `select id from suppliers where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.supplierId],
      );
      if (!suppliers[0]) {
        throw new M1Error('supplier_not_found', 404, `supplier ${payload.supplierId} does not exist`);
      }
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from purchase_orders where company_id = $1 and po_no = $2`,
            [context.tenant.companyId, poNo],
          )
        ).length > 0;
      if (checkDuplicateDocument(duplicate, 'po').outcome !== 'pass') {
        throw new M1Error('duplicate_po', 422, `purchase order ${poNo} already exists`, {
          field: 'poNo',
        });
      }
      let total = 0;
      let taxTotal = 0;
      let discountTotal = 0;
      const orderWarnings: string[] = [];
      for (const item of payload.items) {
        const gross = item.quantityOrdered * item.unitPrice;
        const discount = (gross * item.discountPct) / 100;
        const net = gross - discount;
        total += net;
        discountTotal += discount;
        taxTotal += (net * item.taxRate) / 100;
        const material = await tx.unsafe<Row>(
          `select reorder_point::text as reorder_point from materials
            where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, item.materialId],
        );
        if (!material[0]) {
          throw new M1Error('material_not_found', 404, `material ${item.materialId} does not exist`);
        }
        const aboveReorder = checkPurchaseOrderQuantity(
          item.quantityOrdered,
          numOrNull(material[0].reorder_point),
        );
        if (aboveReorder.outcome === 'warning') orderWarnings.push(aboveReorder.reasonKey);
      }
      await tx.unsafe(
        `insert into purchase_orders (id, company_id, plant_id, po_no, supplier_id, pr_id,
            subtotal, tax_amount, total, discount_amount, status, expected_delivery_at,
            created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$7 + $8,$9,'draft',$10,$11,$11)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          poNo,
          payload.supplierId,
          payload.prId,
          total,
          taxTotal,
          discountTotal,
          payload.expectedDeliveryAt,
          context.actor.username,
        ],
      );
      for (const item of payload.items) {
        await tx.unsafe(
          `insert into po_items (id, company_id, plant_id, po_id, material_id, unit_price,
              quantity_ordered, tax_rate, discount_pct, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [
            newId('POI'),
            context.tenant.companyId,
            payload.plantId,
            id,
            item.materialId,
            item.unitPrice,
            item.quantityOrdered,
            item.taxRate,
            item.discountPct,
            context.actor.username,
          ],
        );
      }
      await audit(tx, context, 'purchase_order.created', id, {
        poNo,
        lines: payload.items.length,
        warnings: orderWarnings,
      });
    });
    return this.readPurchaseOrder(context, id);
  };

  confirmPurchaseOrder = async (context: B1Context, id: string): Promise<PurchaseOrderRow> => {
    this.level(context, INVENTORY_LEVELS.approvePurchaseRequest, 'confirm a purchase order');
    await this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, status, po_no from purchase_orders
          where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      const row = rows[0];
      if (!row) throw new M1Error('purchase_order_not_found', 404, `order ${id} does not exist`);
      if (!canPurchaseOrderTransition(str(row.status) as PurchaseOrderStatus, 'confirmed')) {
        throw new M1Error('invalid_transition', 409, `order ${id} is ${row.status}`, {
          from: row.status,
          to: 'confirmed',
        });
      }
      const items = await tx.unsafe<Row>(
        `select pi.id from po_items pi where pi.company_id = $1 and pi.po_id = $2`,
        [context.tenant.companyId, id],
      );
      if (items.length === 0) {
        throw new M1Error('validation_error', 422, 'a purchase order needs at least one line', {
          field: 'items',
        });
      }
      await tx.unsafe(
        `update purchase_orders set status = 'confirmed', ordered_by = $3, ordered_at = now(),
            updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'purchase_order.confirmed', id, {});
    });
    return this.readPurchaseOrder(context, id);
  };

  cancelPurchaseOrder = async (
    context: B1Context,
    id: string,
    reason: string,
  ): Promise<PurchaseOrderRow> => {
    this.level(context, INVENTORY_LEVELS.voidDocument, 'cancel a purchase order');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a cancellation reason is required', {
        field: 'reason',
      });
    }
    await this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, status from purchase_orders
          where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      const row = rows[0];
      if (!row) throw new M1Error('purchase_order_not_found', 404, `order ${id} does not exist`);
      if (!canPurchaseOrderTransition(str(row.status) as PurchaseOrderStatus, 'cancelled')) {
        throw new M1Error('invalid_transition', 409, `order ${id} is ${row.status}`, {
          from: row.status,
          to: 'cancelled',
        });
      }
      await tx.unsafe(
        `update purchase_orders set status = 'cancelled', cancelled_reason = $3, updated_by = $4
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason.trim(), context.actor.username],
      );
      await audit(tx, context, 'purchase_order.cancelled', id, { reason: reason.trim() });
    });
    return this.readPurchaseOrder(context, id);
  };

  // ----------------------------------------------------------------- goods receipts

  listGoodsReceipts = async (
    context: B1Context,
    filters: { plantId?: string; status?: string } = {},
  ): Promise<GoodsReceiptRow[]> => {
    this.level(context, INVENTORY_LEVELS.read, 'read goods receipts');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select gr.id, gr.plant_id, gr.receipt_no, gr.purchase_order_id as po_id, po.po_no,
                gr.received_at, gr.received_by, gr.status, gr.void_reason
           from goods_receipts gr
           join purchase_orders po on po.id = gr.purchase_order_id and po.company_id = gr.company_id
          where gr.company_id = $1 and gr.deleted_at is null
            and ($2::text = '' or gr.plant_id = $2)
            and ($3::text = '' or gr.status = $3)
          order by gr.received_at desc`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? ''],
      ),
    );
    const receipts: GoodsReceiptRow[] = [];
    for (const row of rows) {
      const items = await this.db.withTenant(context.tenant, (tx) =>
        tx.unsafe<Row>(
          `select ri.id, ri.po_item_id, pi.material_id, mt.material_code,
                  ri.quantity_received::text as quantity_received, ri.unit_cost::text as unit_cost,
                  ri.lot_no, ri.expiry_date, ri.weight_in_kg::text as weight_in_kg
             from receipt_items ri
             join po_items pi on pi.id = ri.po_item_id and pi.company_id = ri.company_id
             join materials mt on mt.id = pi.material_id and mt.company_id = ri.company_id
            where ri.company_id = $1 and ri.receipt_id = $2 order by mt.material_code`,
          [context.tenant.companyId, str(row.id)],
        ),
      );
      receipts.push({
        id: str(row.id),
        plant_id: str(row.plant_id),
        receipt_no: str(row.receipt_no),
        po_id: str(row.po_id),
        po_no: str(row.po_no),
        received_at: str(row.received_at),
        received_by: str(row.received_by),
        status: str(row.status) as GoodsReceiptStatus,
        void_reason: nullable(row.void_reason),
        items: items.map((item) => ({
          id: str(item.id),
          po_item_id: str(item.po_item_id),
          material_id: str(item.material_id),
          material_code: str(item.material_code),
          quantity_received: num(item.quantity_received),
          unit_cost: num(item.unit_cost),
          lot_no: str(item.lot_no),
          expiry_date: nullable(item.expiry_date),
          weight_in_kg: numOrNull(item.weight_in_kg),
        })),
      });
    }
    return receipts;
  };

  createGoodsReceipt = async (
    context: B1Context,
    payload: {
      poId: string;
      receivedAt: string | null;
      receiptNo?: string;
      items: Array<{
        poItemId: string;
        quantityReceived: number;
        unitCost: number;
        lotNo: string;
        expiryDate: string | null;
        weightInKg: number | null;
      }>;
    },
  ): Promise<GoodsReceiptRow> => {
    this.level(context, INVENTORY_LEVELS.receiveGoods, 'record a goods receipt');
    if (payload.items.length === 0) {
      throw new M1Error('validation_error', 422, 'at least one line is required', {
        field: 'items',
      });
    }
    for (const item of payload.items) {
      if (checkPositiveQuantity(item.quantityReceived).outcome !== 'pass') {
        throw new M1Error('validation_error', 422, 'quantity must be greater than zero', {
          field: 'quantityReceived',
        });
      }
      if (!Number.isFinite(item.unitCost) || item.unitCost < 0) {
        throw new M1Error('validation_error', 422, 'unitCost must not be negative', {
          field: 'unitCost',
        });
      }
    }
    const id = newId('GRN');
    const receiptNo = payload.receiptNo?.trim() || documentNo('GRN');
    const plantId = await this.db.withTenant(context.tenant, async (tx) => {
      const orders = await tx.unsafe<Row>(
        `select id, plant_id, status from purchase_orders
          where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.poId],
      );
      const order = orders[0];
      if (!order) throw new M1Error('purchase_order_not_found', 404, `order ${payload.poId} does not exist`);
      if (str(order.status) !== 'confirmed' && str(order.status) !== 'partially_received') {
        throw new M1Error('invalid_transition', 409, `order ${payload.poId} is ${order.status}`, {
          from: order.status,
          to: 'receipt',
        });
      }
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from goods_receipts where company_id = $1 and receipt_no = $2`,
            [context.tenant.companyId, receiptNo],
          )
        ).length > 0;
      const dupCheck = checkDuplicateDocument(duplicate, 'receipt');
      if (dupCheck.outcome !== 'pass') {
        throw new M1Error('duplicate_receipt', 422, `receipt ${receiptNo} already exists`, {
          check: dupCheck.key,
        });
      }
      const lines = await tx.unsafe<Row>(
        `select pi.id, pi.po_id, pi.material_id, pi.quantity_ordered::text as quantity_ordered,
                pi.quantity_received::text as quantity_received, mt.unit_of_measure
           from po_items pi
           join materials mt on mt.id = pi.material_id and mt.company_id = pi.company_id
          where pi.company_id = $1 and pi.po_id = $2`,
        [context.tenant.companyId, payload.poId],
      );
      const byId = new Map(lines.map((line) => [str(line.id), line]));
      for (const item of payload.items) {
        const line = byId.get(item.poItemId);
        if (!line) {
          throw new M1Error('validation_error', 422, `line ${item.poItemId} is not on this order`, {
            field: 'items',
          });
        }
      }
      await tx.unsafe(
        `insert into goods_receipts (id, company_id, plant_id, receipt_no, purchase_order_id,
            received_at, received_by, status, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$8)`,
        [
          id,
          context.tenant.companyId,
          str(order.plant_id),
          receiptNo,
          payload.poId,
          payload.receivedAt ?? new Date().toISOString(),
          context.actor.username,
          context.actor.username,
        ],
      );
      for (const item of payload.items) {
        await tx.unsafe(
          `insert into receipt_items (id, company_id, plant_id, receipt_id, po_item_id,
              quantity_received, unit_cost, lot_no, expiry_date, weight_in_kg)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            newId('RCI'),
            context.tenant.companyId,
            str(order.plant_id),
            id,
            item.poItemId,
            item.quantityReceived,
            item.unitCost,
            item.lotNo.trim(),
            item.expiryDate,
            item.weightInKg,
          ],
        );
      }
      await audit(tx, context, 'inventory.receipt_drafted', id, { receiptNo });
      return str(order.plant_id);
    });
    void plantId;
    const receipts = await this.listGoodsReceipts(context);
    const created = receipts.find((receipt) => receipt.id === id);
    if (!created) throw new M1Error('receipt_not_found', 404, 'receipt could not be read back');
    return created;
  };

  confirmGoodsReceipt = async (
    context: B1Context,
    id: string,
    approvalReason = '',
  ): Promise<GoodsReceiptRow> => {
    this.level(context, INVENTORY_LEVELS.receiveGoods, 'confirm a goods receipt');
    await this.db.withTenant(context.tenant, async (tx) => {
      const headers = await tx.unsafe<Row>(
        `select id, plant_id, purchase_order_id as po_id, status from goods_receipts
          where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      const header = headers[0];
      if (!header) throw new M1Error('receipt_not_found', 404, `receipt ${id} does not exist`);
      if (!canGoodsReceiptTransition(str(header.status) as GoodsReceiptStatus, 'confirmed')) {
        throw new M1Error('invalid_transition', 409, `receipt ${id} is ${header.status}`, {
          from: header.status,
          to: 'confirmed',
        });
      }
      const items = await tx.unsafe<Row>(
        `select ri.id, ri.po_item_id, ri.quantity_received::text as quantity_received,
                ri.unit_cost::text as unit_cost, ri.lot_no, ri.expiry_date,
                pi.quantity_ordered::text as quantity_ordered,
                pi.quantity_received::text as already_received, pi.material_id,
                mt.unit_of_measure
           from receipt_items ri
           join po_items pi on pi.id = ri.po_item_id and pi.company_id = ri.company_id
           join materials mt on mt.id = pi.material_id and mt.company_id = ri.company_id
          where ri.company_id = $1 and ri.receipt_id = $2`,
        [context.tenant.companyId, id],
      );
      if (items.length === 0) {
        throw new M1Error('validation_error', 422, 'a receipt needs at least one line', {
          field: 'items',
        });
      }

      const rules = await this.rules(tx, context.tenant.companyId);
      let needsApproval = false;
      for (const item of items) {
        const over = checkOverReceipt(
          num(item.quantity_ordered),
          num(item.already_received),
          num(item.quantity_received),
        );
        if (over.outcome !== 'pass') needsApproval = true;
        const baseline = await this.recentCostBaseline(tx, context, str(item.material_id));
        const band = checkUnitCostBand(
          this.ruleFor(rules, 'unitCostBand'),
          num(item.unit_cost),
          baseline,
        );
        if (band.outcome === 'approval_required') needsApproval = true;
      }
      if (needsApproval) {
        if (context.actor.roleLevel < INVENTORY_LEVELS.approvePurchaseRequest) {
          throw new M1Error('approval_required', 403, 'receiving this quantity needs level-4 approval', {
            classification: 'approval_required',
          });
        }
        if (approvalReason.trim().length < MIN_OVERRIDE_REASON) {
          throw new M1Error('validation_error', 422, 'an approval reason is required', {
            field: 'reason',
          });
        }
      }

      for (const item of items) {
        await this.postMovementTx(tx, context, {
          plantId: str(header.plant_id),
          materialId: str(item.material_id),
          quantity: num(item.quantity_received),
          unit: str(item.unit_of_measure),
          movementType: 'receipt',
          unitCost: num(item.unit_cost),
          referenceType: 'goods_receipt',
          referenceId: id,
          lotNo: str(item.lot_no),
          reason: approvalReason.trim(),
          linkedReceiptId: id,
          expiryDate: nullable(item.expiry_date),
        });
        await tx.unsafe(
          `update po_items set quantity_received = quantity_received + $3, updated_by = $4
            where company_id = $1 and id = $2`,
          [context.tenant.companyId, str(item.po_item_id), num(item.quantity_received), context.actor.username],
        );
        await audit(tx, context, 'inventory.lot_received', str(item.id), {
          receiptId: id,
          lotNo: str(item.lot_no),
          quantity: num(item.quantity_received),
        });
      }

      await tx.unsafe(
        `update goods_receipts set status = 'confirmed', confirmed_at = now(), confirmed_by = $3,
            updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );

      const open = await tx.unsafe<Row>(
        `select
           count(*) filter (where pi.quantity_received < pi.quantity_ordered)::text as open_lines
         from po_items pi where pi.company_id = $1 and pi.po_id = $2`,
        [context.tenant.companyId, str(header.po_id)],
      );
      const fully = num(open[0]?.open_lines) === 0;
      await tx.unsafe(
        `update purchase_orders set status = $3, updated_by = $4
          where company_id = $1 and id = $2 and status in ('confirmed', 'partially_received')`,
        [
          context.tenant.companyId,
          str(header.po_id),
          fully ? 'fully_received' : 'partially_received',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'inventory.receipt_confirmed', id, {
        poId: str(header.po_id),
        approvedOverReceipt: needsApproval,
      });
    });

    const receipts = await this.listGoodsReceipts(context);
    const confirmed = receipts.find((receipt) => receipt.id === id);
    if (!confirmed) throw new M1Error('receipt_not_found', 404, `receipt ${id} does not exist`);
    return confirmed;
  };

  voidGoodsReceipt = async (
    context: B1Context,
    id: string,
    reason: string,
  ): Promise<GoodsReceiptRow> => {
    this.level(context, INVENTORY_LEVELS.voidDocument, 'void a goods receipt');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a void reason is required', { field: 'reason' });
    }
    await this.db.withTenant(context.tenant, async (tx) => {
      const headers = await tx.unsafe<Row>(
        `select id, plant_id, purchase_order_id as po_id, status from goods_receipts
          where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      const header = headers[0];
      if (!header) throw new M1Error('receipt_not_found', 404, `receipt ${id} does not exist`);
      if (!canGoodsReceiptTransition(str(header.status) as GoodsReceiptStatus, 'voided')) {
        throw new M1Error('invalid_transition', 409, `receipt ${id} is ${header.status}`, {
          from: header.status,
          to: 'voided',
        });
      }
      const layers = await tx.unsafe<Row>(
        `select layer_id, quantity_received::text as quantity_received,
                quantity_remaining::text as quantity_remaining, material_id, unit_cost::text as unit_cost
           from cost_layers where company_id = $1 and linked_receipt_id = $2`,
        [context.tenant.companyId, id],
      );
      for (const layer of layers) {
        if (Math.abs(num(layer.quantity_remaining) - num(layer.quantity_received)) > 1e-6) {
          throw new M1Error('receipt_consumed', 409, 'receipt stock has already been issued', {
            layerId: str(layer.layer_id),
          });
        }
      }
      const movements = await tx.unsafe<Row>(
        `select movement_id, material_id, quantity::text as quantity, unit_cost::text as unit_cost
           from stock_movements
          where company_id = $1 and reference_type = 'goods_receipt' and reference_id = $2
            and movement_type = 'receipt'`,
        [context.tenant.companyId, id],
      );
      for (const movement of movements) {
        const material = await tx.unsafe<Row>(
          `select unit_of_measure from materials where company_id = $1 and id = $2`,
          [context.tenant.companyId, str(movement.material_id)],
        );
        await this.postMovementTx(tx, context, {
          plantId: str(header.plant_id),
          materialId: str(movement.material_id),
          quantity: num(movement.quantity),
          unit: str(material[0]?.unit_of_measure),
          movementType: 'issue',
          referenceType: 'receipt_void',
          referenceId: id,
          reason: reason.trim(),
          correctionOf: str(movement.movement_id),
        });
      }
      await tx.unsafe(
        `update cost_layers set quantity_remaining = 0, closed_at = now()
          where company_id = $1 and linked_receipt_id = $2`,
        [context.tenant.companyId, id],
      );
      await tx.unsafe(
        `update goods_receipts set status = 'voided', voided_at = now(), void_reason = $3,
            updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason.trim()],
      );
      await audit(tx, context, 'inventory.movement_reversed', id, { reason: reason.trim() });
    });
    const receipts = await this.listGoodsReceipts(context);
    const voided = receipts.find((receipt) => receipt.id === id);
    if (!voided) throw new M1Error('receipt_not_found', 404, `receipt ${id} does not exist`);
    return voided;
  };

  // ---------------------------------------------------------------------- movements

  listMovements = async (
    context: B1Context,
    filters: { materialId?: string; plantId?: string; limit?: number } = {},
  ): Promise<MovementRow[]> => {
    this.level(context, INVENTORY_LEVELS.read, 'read stock movements');
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select sm.movement_id, sm.plant_id, sm.material_id, mt.material_code,
                sm.quantity::text as quantity, sm.unit, sm.unit_cost::text as unit_cost,
                sm.total_cost::text as total_cost, sm.movement_type, sm.reference_type,
                sm.reference_id, sm.lot_no, sm.reason, sm.occurred_at, sm.created_by
           from stock_movements sm
           join materials mt on mt.id = sm.material_id and mt.company_id = sm.company_id
          where sm.company_id = $1
            and ($2::text = '' or sm.material_id = $2)
            and ($3::text = '' or sm.plant_id = $3)
          order by sm.occurred_at desc, sm.created_at desc
          limit $4`,
        [context.tenant.companyId, filters.materialId ?? '', filters.plantId ?? '', limit],
      ),
    );
    return rows.map(toMovement);
  };

  postMovement = async (context: B1Context, payload: MovementPayload): Promise<MovementRow> => {
    const minLevel =
      payload.movementType === 'adjustment'
        ? INVENTORY_LEVELS.adjustStock
        : INVENTORY_LEVELS.postMovement;
    this.level(context, minLevel, 'post a stock movement');
    return this.db.withTenant(context.tenant, (tx) => this.postMovementTx(tx, context, payload));
  };

  private recentCostBaseline = async (
    tx: Executor,
    context: B1Context,
    materialId: string,
  ): Promise<number | null> => {
    const rows = await tx.unsafe<Row>(
      `select avg(ri.unit_cost)::text as baseline
         from (select unit_cost from receipt_items ri2
                 join po_items pi on pi.id = ri2.po_item_id and pi.company_id = ri2.company_id
                where ri2.company_id = $1 and pi.material_id = $2
                order by ri2.created_at desc limit 10) ri`,
      [context.tenant.companyId, materialId],
    );
    return numOrNull(rows[0]?.baseline);
  };

  private currentState = async (
    tx: Executor,
    context: B1Context,
    plantId: string,
    materialId: string,
  ): Promise<{ quantity: number; value: number }> => {
    const rows = await tx.unsafe<Row>(
      `select coalesce(sum(case when movement_type in ('issue', 'consumption', 'transfer_out')
                                then -quantity else quantity end), 0)::text as quantity,
              coalesce(sum(case when movement_type in ('issue', 'consumption', 'transfer_out')
                                then -coalesce(total_cost, 0) else coalesce(total_cost, 0) end), 0)::text as value
         from stock_movements
        where company_id = $1 and plant_id = $2 and material_id = $3`,
      [context.tenant.companyId, plantId, materialId],
    );
    return { quantity: num(rows[0]?.quantity), value: num(rows[0]?.value) };
  };

  private openLayers = async (
    tx: Executor,
    context: B1Context,
    plantId: string,
    materialId: string,
  ): Promise<CostLayer[]> => {
    const rows = await tx.unsafe<Row>(
      `select layer_id, received_at::text as received_at,
              quantity_remaining::text as quantity_remaining, unit_cost::text as unit_cost
         from cost_layers
        where company_id = $1 and plant_id = $2 and material_id = $3 and quantity_remaining > 0
        order by received_at, layer_id`,
      [context.tenant.companyId, plantId, materialId],
    );
    return rows.map((row) => ({
      layerId: str(row.layer_id),
      receivedAt: str(row.received_at),
      quantityRemaining: num(row.quantity_remaining),
      unitCost: num(row.unit_cost),
    }));
  };

  /** The single posting path: validation, valuation, balance and exceptions live here. */
  private postMovementTx = async (
    tx: Executor,
    context: B1Context,
    payload: MovementPayload,
  ): Promise<MovementRow> => {
    const materials = await tx.unsafe<Row>(
      `select id, plant_id, material_code, unit_of_measure, is_bulk, valuation_method, reorder_point::text as reorder_point
         from materials
        where company_id = $1 and id = $2 and deleted_at is null
        for update`,
      [context.tenant.companyId, payload.materialId],
    );
    const material = materials[0];
    if (!material) {
      throw new M1Error('material_not_found', 404, `material ${payload.materialId} does not exist`);
    }
    if (str(material.plant_id) !== payload.plantId) {
      throw new M1Error('plant_scope', 422, 'material and movement must belong to the same plant', {
        check: 'plantScope',
      });
    }
    if (checkPositiveQuantity(payload.quantity).outcome !== 'pass') {
      throw new M1Error('validation_error', 422, 'quantity must be greater than zero', {
        field: 'quantity',
      });
    }
    const unit = payload.unit?.trim() || str(material.unit_of_measure);
    if (checkUnitMatch(str(material.unit_of_measure), unit).outcome !== 'pass') {
      throw new M1Error('unit_mismatch', 422, `movement unit must be ${str(material.unit_of_measure)}`, {
        field: 'unit',
      });
    }
    const method = (nullable(material.valuation_method) as ValuationMethod | null) ?? null;
    const selected = checkValuationSelected(method);
    if (selected.outcome !== 'pass') {
      throw new M1Error('approval_required', 409, 'choose a valuation method before posting', {
        check: selected.key,
        reason: selected.reasonKey,
      });
    }
    const fifo = checkFifoOnBulk(material.is_bulk === true || material.is_bulk === 't', method);
    if (fifo.outcome !== 'pass') {
      throw new M1Error('fifo_on_bulk', 422, 'a bulk material is valued at weighted average', {
        check: fifo.key,
      });
    }

    const direction: 'in' | 'out' = MOVEMENT_SIGNS[payload.movementType] === 1 ? 'in' : 'out';
    const state = await this.currentState(tx, context, payload.plantId, payload.materialId);
    const balanceAfter =
      direction === 'in' ? state.quantity + payload.quantity : state.quantity - payload.quantity;

    let exceptionDraft: ReturnType<typeof negativeStockDecision>['exception'] = null;
    if (balanceAfter < -1e-9) {
      const decision = negativeStockDecision({
        level: context.actor.roleLevel,
        balanceBefore: state.quantity,
        quantity: payload.quantity,
        reason: payload.reason ?? '',
        candidates: await this.missingSourceCandidates(tx, context, payload),
      });
      if (decision.outcome === 'refused') {
        throw new M1Error('negative_stock', 422, 'stock would go below zero', {
          check: decision.check.key,
          reason: decision.check.reasonKey,
          available: state.quantity,
        });
      }
      exceptionDraft = decision.exception;
    }

    let unitCost: number;
    let totalCost: number;
    let layerTakes: { layerId: string; quantity: number }[] = [];

    if (method === 'fifo') {
      if (direction === 'in') {
        if (!Number.isFinite(Number(payload.unitCost ?? NaN))) {
          throw new M1Error('validation_error', 422, 'a receipt needs a unit cost', {
            field: 'unitCost',
          });
        }
        unitCost = Math.max(0, Number(payload.unitCost));
        totalCost = Math.round(payload.quantity * unitCost * 10000) / 10000;
      } else {
        const consumed = consumeFifoLayers(
          await this.openLayers(tx, context, payload.plantId, payload.materialId),
          payload.quantity,
        );
        if (consumed.shortage > 1e-9 && balanceAfter >= -1e-9) {
          throw new M1Error('cost_layers_insufficient', 409, 'open FIFO layers cannot cover the issue', {
            shortage: consumed.shortage,
          });
        }
        unitCost = payload.quantity > 0 ? Math.round((consumed.totalCost / payload.quantity) * 10000) / 10000 : 0;
        totalCost = consumed.totalCost;
        layerTakes = consumed.takes.map((take) => ({ layerId: take.layerId, quantity: take.quantity }));
      }
    } else {
      const average = state.quantity > 0 ? state.value / state.quantity : 0;
      const valued = applyWeightedAverage(
        { quantity: state.quantity, value: state.value, averageCost: average },
        { quantity: payload.quantity, unitCost: payload.unitCost ?? average },
        direction,
      );
      unitCost = valued.unitCost;
      totalCost = valued.amount;
    }

    const movementId = newId('MOV');
    await tx.unsafe(
      `insert into stock_movements (movement_id, company_id, plant_id, material_id, quantity, unit,
          unit_cost, total_cost, movement_type, reference_type, reference_id, batch_id,
          moisture_reading_id, lot_no, reason, correction_of, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        movementId,
        context.tenant.companyId,
        payload.plantId,
        payload.materialId,
        payload.quantity,
        unit,
        unitCost,
        totalCost,
        payload.movementType,
        payload.referenceType ?? 'manual',
        payload.referenceId ?? null,
        payload.batchId ?? null,
        payload.moistureReadingId ?? null,
        payload.lotNo ?? '',
        payload.reason ?? '',
        payload.correctionOf ?? null,
        context.actor.username,
      ],
    );

    if (method === 'fifo') {
      if (direction === 'in') {
        await tx.unsafe(
          `insert into cost_layers (layer_id, company_id, plant_id, material_id, quantity_received,
              quantity_remaining, unit_cost, expiry_date, linked_receipt_id, source_movement_id,
              created_by)
           values ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10)`,
          [
            newId('LYR'),
            context.tenant.companyId,
            payload.plantId,
            payload.materialId,
            payload.quantity,
            unitCost,
            payload.expiryDate ?? null,
            payload.linkedReceiptId ?? null,
            movementId,
            context.actor.username,
          ],
        );
      } else if (balanceAfter >= -1e-9) {
        for (const take of layerTakes) {
          await tx.unsafe(
            `update cost_layers
                set quantity_remaining = quantity_remaining - $3,
                    closed_at = case when quantity_remaining - $3 <= 0 then now() else closed_at end
              where company_id = $1 and layer_id = $2`,
            [context.tenant.companyId, take.layerId, take.quantity],
          );
        }
      }
    }

    if (exceptionDraft) {
      await tx.unsafe(
        `insert into inventory_exceptions (exception_id, company_id, plant_id, material_id,
            movement_id, exception_type, quantity, available_quantity, reason, severity, status,
            suggested_source_type, suggested_source_id, suggestion_note, opened_by)
         values ($1,$2,$3,$4,$5,'negative_stock',$6,$7,$8,'high','open',$9,$10,$11,$12)`,
        [
          newId('EXC'),
          context.tenant.companyId,
          payload.plantId,
          payload.materialId,
          movementId,
          exceptionDraft.quantity,
          exceptionDraft.availableQuantity,
          exceptionDraft.reason,
          exceptionDraft.suggestedSourceType,
          exceptionDraft.suggestedSourceId,
          exceptionDraft.suggestionNote,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'inventory.exception_approved', movementId, {
        reason: exceptionDraft.reason,
        available: exceptionDraft.availableQuantity,
        requested: exceptionDraft.quantity,
      });
    }

    await audit(tx, context, 'inventory.movement_posted', movementId, {
      materialId: payload.materialId,
      movementType: payload.movementType,
      quantity: payload.quantity,
      unitCost,
      value: totalCost,
      balanceAfter,
    });

    return {
      movement_id: movementId,
      plant_id: payload.plantId,
      material_id: payload.materialId,
      material_code: str(material.material_code),
      quantity: payload.quantity,
      unit,
      unit_cost: unitCost,
      total_cost: totalCost,
      movement_type: payload.movementType,
      reference_type: payload.referenceType ?? 'manual',
      reference_id: payload.referenceId ?? null,
      lot_no: payload.lotNo ?? '',
      reason: payload.reason ?? '',
      occurred_at: new Date().toISOString(),
      created_by: context.actor.username,
    };
  };

  private missingSourceCandidates = async (
    tx: Executor,
    context: B1Context,
    payload: MovementPayload,
  ): Promise<MissingSourceCandidate[]> => {
    const rows = await tx.unsafe<Row>(
      `select po.id, po.po_no, pi.quantity_ordered::text as quantity_ordered,
              pi.quantity_received::text as quantity_received
         from purchase_orders po
         join po_items pi on pi.po_id = po.id and pi.company_id = po.company_id
        where po.company_id = $1 and pi.material_id = $2
          and po.status in ('confirmed', 'partially_received')
          and pi.quantity_received < pi.quantity_ordered
        order by po.expected_delivery_at nulls last limit 5`,
      [context.tenant.companyId, payload.materialId],
    );
    const candidates: MissingSourceCandidate[] = rows.map((row) => ({
      type: 'purchase_order',
      id: str(row.id),
      note: `open PO ${str(row.po_no)}: ${num(row.quantity_received)} of ${num(row.quantity_ordered)} received`,
    }));
    const expected = await tx.unsafe<Row>(
      `select gr.id, gr.receipt_no from goods_receipts gr
         join purchase_orders po on po.id = gr.purchase_order_id and po.company_id = gr.company_id
         join po_items pi on pi.po_id = po.id and pi.company_id = po.company_id
        where gr.company_id = $1 and pi.material_id = $2 and gr.status = 'draft'
        order by gr.received_at limit 5`,
      [context.tenant.companyId, payload.materialId],
    );
    for (const row of expected) {
      candidates.push({
        type: 'goods_receipt',
        id: str(row.id),
        note: `draft receipt ${str(row.receipt_no)} is waiting to be confirmed`,
      });
    }
    return candidates;
  };

  // ------------------------------------------------------------------- snapshots

  generateSnapshot = async (
    context: B1Context,
    payload: { plantId: string; materialId: string; date: string },
  ): Promise<{ snapshotId: string; closingQty: number; closingValue: number; agrees: boolean }> => {
    this.level(context, INVENTORY_LEVELS.postMovement, 'generate a stock snapshot');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select
           coalesce(sum(case when occurred_at < $4::date then
             case when movement_type in ('issue', 'consumption', 'transfer_out') then -quantity else quantity end
           else 0 end), 0)::text as opening,
           coalesce(sum(case when occurred_at >= $4::date and occurred_at < ($4::date + interval '1 day')
             and movement_type not in ('issue', 'consumption', 'transfer_out') then quantity else 0 end), 0)::text as receipts,
           coalesce(sum(case when occurred_at >= $4::date and occurred_at < ($4::date + interval '1 day')
             and movement_type in ('issue', 'consumption', 'transfer_out') then quantity else 0 end), 0)::text as issues
         from stock_movements
        where company_id = $1 and plant_id = $2 and material_id = $3`,
        [context.tenant.companyId, payload.plantId, payload.materialId, payload.date],
      );
      const state = await this.currentState(tx, context, payload.plantId, payload.materialId);
      const average = state.quantity > 0 ? state.value / state.quantity : 0;
      const figures = buildSnapshot({
        openingQty: num(rows[0]?.opening),
        receipts: num(rows[0]?.receipts),
        issues: num(rows[0]?.issues),
        closingQty: 0,
        averageCost: average,
      });
      const derived =
        (
          await tx.unsafe<Row>(
            `select coalesce(sum(case when movement_type in ('issue', 'consumption', 'transfer_out')
                                      then -quantity else quantity end), 0)::text as quantity
               from stock_movements
              where company_id = $1 and plant_id = $2 and material_id = $3`,
            [context.tenant.companyId, payload.plantId, payload.materialId],
          )
        )[0]?.quantity ?? 0;
      const agrees = Math.abs(num(derived) - state.quantity) <= 1e-6;
      const snapshotId = newId('SNP');
      await tx.unsafe(
        `insert into inventory_snapshots (id, company_id, plant_id, material_id, snapshot_date,
            opening_qty, receipts, issues, closing_qty, avg_cost, closing_value, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (company_id, plant_id, material_id, snapshot_date) do update set
           opening_qty = excluded.opening_qty, receipts = excluded.receipts,
           issues = excluded.issues, closing_qty = excluded.closing_qty,
           avg_cost = excluded.avg_cost, closing_value = excluded.closing_value,
           generated_at = now()`,
        [
          snapshotId,
          context.tenant.companyId,
          payload.plantId,
          payload.materialId,
          payload.date,
          figures.openingQty,
          figures.receipts,
          figures.issues,
          figures.closingQty,
          figures.averageCost,
          figures.closingValue,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'inventory.snapshot_generated', snapshotId, {
        materialId: payload.materialId,
        date: payload.date,
        agrees,
      });
      return {
        snapshotId,
        closingQty: figures.closingQty,
        closingValue: figures.closingValue,
        agrees,
      };
    });
  };

  // ------------------------------------------------------------------ exceptions

  listExceptions = async (
    context: B1Context,
    filters: { plantId?: string; status?: string } = {},
  ): Promise<ExceptionRow[]> => {
    this.level(context, INVENTORY_LEVELS.read, 'read inventory exceptions');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select ex.exception_id, ex.plant_id, ex.material_id, mt.material_code,
                ex.quantity::text as quantity, ex.available_quantity::text as available_quantity,
                ex.reason, ex.severity, ex.status, ex.suggested_source_type,
                ex.suggested_source_id, ex.suggestion_note, ex.opened_by, ex.opened_at,
                ex.closed_by, ex.closed_at, ex.decision
           from inventory_exceptions ex
           join materials mt on mt.id = ex.material_id and mt.company_id = ex.company_id
          where ex.company_id = $1
            and ($2::text = '' or ex.plant_id = $2)
            and ($3::text = '' or ex.status = $3)
          order by ex.opened_at desc`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? ''],
      ),
    );
    return rows.map(toException);
  };

  decideException = async (
    context: B1Context,
    id: string,
    payload: { decision: 'approved' | 'rejected'; status: 'resolved' | 'escalated' },
  ): Promise<ExceptionRow> => {
    this.level(context, INVENTORY_LEVELS.closeException, 'decide an inventory exception');
    await this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select exception_id, status from inventory_exceptions
          where company_id = $1 and exception_id = $2`,
        [context.tenant.companyId, id],
      );
      const row = rows[0];
      if (!row) throw new M1Error('exception_not_found', 404, `exception ${id} does not exist`);
      if (!canExceptionTransition(str(row.status) as ExceptionStatus, payload.status)) {
        throw new M1Error('invalid_transition', 409, `exception ${id} is ${row.status}`, {
          from: row.status,
          to: payload.status,
        });
      }
      await tx.unsafe(
        `update inventory_exceptions set status = $3, decision = $4, closed_by = $5,
            closed_at = now() where company_id = $1 and exception_id = $2`,
        [context.tenant.companyId, id, payload.status, payload.decision, context.actor.username],
      );
      await audit(tx, context, 'inventory.exception_approved', id, {
        decision: payload.decision,
        status: payload.status,
      });
    });
    const rows = await this.listExceptions(context);
    const updated = rows.find((row) => row.exception_id === id);
    if (!updated) throw new M1Error('exception_not_found', 404, `exception ${id} does not exist`);
    return updated;
  };
}

const audit = async (
  tx: Executor,
  context: B1Context,
  action: string,
  recordId: string,
  details: Record<string, unknown>,
): Promise<void> => {
  await tx.unsafe(
    `insert into audit_log (company_id, plant_id, user_id, username, action, table_name, record_id,
       ip_address, request_id, details)
     values ($1,$2,$3,$4,$5,'inventory',$6,$7,$8,$9::jsonb)`,
    [
      context.tenant.companyId,
      context.tenant.plantIds[0] ?? null,
      context.actor.userId,
      context.actor.username,
      action,
      recordId,
      context.actor.ip ?? null,
      context.actor.requestId ?? null,
      JSON.stringify(details),
    ],
  );
};
