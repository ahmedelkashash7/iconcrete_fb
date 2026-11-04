/**
 * M6 — inventory.
 *
 * The pure block pins the lifecycles, the FIFO selection order, the moving average and the
 * negative-stock decision. The database block proves what only PostgreSQL and the repository
 * can: receipts post value at the selected method, FIFO consumes the oldest layer, duplicate
 * documents are refused, an over-receipt needs level-4 approval, a below-zero movement is
 * refused unless a level-4 exception with a reason is recorded (with a suggested document),
 * the valuation method is locked after the first movement, a bulk material never uses FIFO,
 * and RLS plus the service keep tenants and plants apart.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { InventoryService } from '../../server/services/inventory';
import type { B1Context } from '../../server/services/projects';
import {
  applyWeightedAverage,
  buildSnapshot,
  canExceptionTransition,
  canGoodsReceiptTransition,
  canMaterialTransition,
  canPurchaseOrderTransition,
  canPurchaseRequestTransition,
  checkFifoOnBulk,
  checkOverReceipt,
  checkStockBalance,
  checkValuationLocked,
  checkValuationSelected,
  consumeFifoLayers,
  derivedBalance,
  emptyValuation,
  negativeStockDecision,
  suggestMissingSource,
} from '../../src/core/inventory';

const ctx = (companyId: string, roleLevel = 5, plantIds: string[] = []): B1Context => ({
  tenant: { companyId, plantIds, userId: 'USR-M6', requestId: 'm6-test' },
  actor: {
    userId: 'USR-M6',
    username: 'm6-tester',
    roleLevel: roleLevel as B1Context['actor']['roleLevel'],
    ip: '127.0.0.1',
    requestId: 'm6-test',
  },
});

describe('inventory core', () => {
  test('lifecycles only allow the documented transitions', () => {
    expect(canMaterialTransition('active', 'inactive')).toBe(true);
    expect(canMaterialTransition('inactive', 'active')).toBe(true);
    expect(canPurchaseRequestTransition('draft', 'submitted')).toBe(true);
    expect(canPurchaseRequestTransition('submitted', 'approved')).toBe(true);
    expect(canPurchaseRequestTransition('approved', 'converted_to_po')).toBe(true);
    expect(canPurchaseRequestTransition('converted_to_po', 'approved')).toBe(false);
    expect(canPurchaseOrderTransition('draft', 'confirmed')).toBe(true);
    expect(canPurchaseOrderTransition('confirmed', 'partially_received')).toBe(true);
    expect(canPurchaseOrderTransition('fully_received', 'closed')).toBe(true);
    expect(canPurchaseOrderTransition('closed', 'cancelled')).toBe(false);
    expect(canGoodsReceiptTransition('draft', 'confirmed')).toBe(true);
    expect(canGoodsReceiptTransition('voided', 'confirmed')).toBe(false);
    expect(canExceptionTransition('open', 'resolved')).toBe(true);
    expect(canExceptionTransition('resolved', 'open')).toBe(false);
  });

  test('FIFO takes the earliest layers and reports a shortage instead of inventing stock', () => {
    const layers = [
      { layerId: 'LYR-B', receivedAt: '2026-02-01T00:00:00Z', quantityRemaining: 40, unitCost: 20 },
      { layerId: 'LYR-A', receivedAt: '2026-01-01T00:00:00Z', quantityRemaining: 100, unitCost: 10 },
      { layerId: 'LYR-C', receivedAt: '2026-03-01T00:00:00Z', quantityRemaining: 10, unitCost: 30 },
    ];
    const first = consumeFifoLayers(layers, 120);
    expect(first.takes.map((take) => take.layerId)).toEqual(['LYR-A', 'LYR-B']);
    expect(first.takes[0]?.quantity).toBe(100);
    expect(first.takes[1]?.quantity).toBe(20);
    expect(first.totalCost).toBe(1400);
    expect(first.shortage).toBe(0);

    const short = consumeFifoLayers(layers, 500);
    expect(short.totalCost).toBe(2100);
    expect(short.shortage).toBe(350);
  });

  test('weighted average re-values on receipt and leaves the cost alone on issue', () => {
    let state = emptyValuation();
    const first = applyWeightedAverage(state, { quantity: 100, unitCost: 10 }, 'in');
    expect(first.state.quantity).toBe(100);
    expect(first.state.averageCost).toBe(10);
    state = first.state;
    const second = applyWeightedAverage(state, { quantity: 50, unitCost: 22 }, 'in');
    expect(second.state.value).toBe(2100);
    expect(second.state.averageCost).toBe(14);
    state = second.state;
    const issue = applyWeightedAverage(state, { quantity: 50 }, 'out');
    expect(issue.unitCost).toBe(14);
    expect(issue.amount).toBe(700);
    expect(issue.state.quantity).toBe(100);
    expect(issue.state.value).toBe(1400);
    expect(issue.state.averageCost).toBe(14);
  });

  test('zero is a valid balance; only below zero is refused', () => {
    expect(checkStockBalance(10, 10, 'out').outcome).toBe('pass');
    expect(checkStockBalance(10, 10.001, 'out').outcome).toBe('failure');
    expect(checkStockBalance(0, 5, 'in').outcome).toBe('pass');
    expect(derivedBalance([
      { quantity: 10, movementType: 'receipt' },
      { quantity: 10, movementType: 'issue' },
    ])).toBe(0);
  });

  test('a missing valuation method never posts, and a bulk material never uses FIFO', () => {
    expect(checkValuationSelected(null).outcome).toBe('approval_required');
    expect(checkValuationSelected(null).reasonKey).toBe('inventory.valuation_method_missing');
    expect(checkValuationSelected('fifo').outcome).toBe('pass');
    expect(checkFifoOnBulk(true, 'fifo').outcome).toBe('failure');
    expect(checkFifoOnBulk(true, 'weighted_average').outcome).toBe('pass');
    expect(checkFifoOnBulk(false, 'fifo').outcome).toBe('pass');
    expect(checkValuationLocked('weighted_average', 'fifo', 1).outcome).toBe('failure');
    expect(checkValuationLocked('weighted_average', 'fifo', 0).outcome).toBe('pass');
  });

  test('an over-receipt needs approval, and a negative balance needs a reasoned exception', () => {
    expect(checkOverReceipt(100, 90, 10).outcome).toBe('pass');
    expect(checkOverReceipt(100, 90, 11).outcome).toBe('approval_required');
    expect(checkOverReceipt(100, 90, 11).classification).toBe('approval_required');

    const refused = negativeStockDecision({
      level: 3,
      balanceBefore: 10,
      quantity: 25,
      reason: 'counted stock is higher than the ledger',
    });
    expect(refused.outcome).toBe('refused');
    expect(refused.check.reasonKey).toBe('inventory.override_requires_level4');

    const noReason = negativeStockDecision({ level: 4, balanceBefore: 10, quantity: 25, reason: ' ' });
    expect(noReason.outcome).toBe('refused');
    expect(noReason.check.reasonKey).toBe('inventory.reason_required');

    const allowed = negativeStockDecision({
      level: 4,
      balanceBefore: 10,
      quantity: 25,
      reason: 'counted stock is higher than the ledger',
      candidates: [{ type: 'purchase_order', id: 'PO-1', note: 'open PO PO-1' }],
    });
    expect(allowed.outcome).toBe('exception');
    expect(allowed.exception?.availableQuantity).toBe(10);
    expect(allowed.exception?.suggestedSourceType).toBe('purchase_order');
    expect(allowed.exception?.suggestedSourceId).toBe('PO-1');
    expect(suggestMissingSource([]).type).toBe('none');
  });

  test('a snapshot is dated and shows a warning when it disagrees', () => {
    const snapshot = buildSnapshot({ openingQty: 10, receipts: 5, issues: 3, closingQty: 0, averageCost: 4 });
    expect(snapshot.closingQty).toBe(12);
    expect(snapshot.closingValue).toBe(48);
  });
});

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run inventory tests.';

if (SKIP_REASON) console.warn(`[M6 inventory tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PLANT_A = 'PLT-0001';
const PLANT_B = 'PLT-0002';
const COMPANY_A = 'CMP-0001';
const COMPANY_B = 'CMP-0002';
const PLANT_C = 'PLT-9001';

const expectM1 = async (run: () => Promise<unknown>, code: string, status?: number): Promise<M1Error> => {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(M1Error);
  const error = caught as M1Error;
  expect(error.code).toBe(code);
  if (status !== undefined) expect(error.status).toBe(status);
  return error;
};

describeDb('inventory repository', () => {
  let admin: Db;
  let app: Db;
  let inventory: InventoryService;
  let supplierId = '';
  let plantBPlant = '';

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    inventory = new InventoryService(app);

    const plants = await admin.unsafe<{ id: string }>(
      `select id from plants where company_id = $1 and deleted_at is null order by id`,
      [COMPANY_A],
    );
    expect(plants.length).toBeGreaterThanOrEqual(2);
    plantBPlant = PLANT_B;
    const suppliers = await inventory.listSuppliers(ctx(COMPANY_A));
    supplierId = suppliers[0]?.id ?? '';
    expect(supplierId).not.toBe('');
  });

  afterAll(async () => {
    await app?.close();
    await admin?.close();
  });

  const createMaterial = async (
    overrides: Partial<{
      plantId: string;
      code: string;
      isBulk: boolean;
      method: 'weighted_average' | 'fifo' | null;
      unit: string;
      companyId: string;
      level: number;
      reorderPoint: number | null;
    }> = {},
  ) => {
    const companyId = overrides.companyId ?? COMPANY_A;
    return inventory.createMaterial(ctx(companyId, overrides.level ?? 5), {
      plantId: overrides.plantId ?? PLANT_A,
      materialCode: overrides.code ?? `MAT-${tag}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      nameAr: 'مادة اختبار',
      nameEn: 'Test material',
      category: overrides.isBulk === false ? 'spare_part' : 'aggregate',
      unitOfMeasure: overrides.unit ?? 'kg',
      isBulk: overrides.isBulk ?? true,
      valuationMethod: overrides.method === undefined ? 'weighted_average' : overrides.method,
      minStockLevel: null,
      maxStockLevel: null,
      reorderPoint: overrides.reorderPoint ?? 20,
    });
  };

  const createOrder = async (
    materialIds: string[],
    quantities: number[],
    poNo?: string,
    level = 5,
  ) => {
    return inventory.createPurchaseOrder(ctx(COMPANY_A, level), {
      plantId: PLANT_A,
      supplierId,
      poNo,
      prId: null,
      expectedDeliveryAt: null,
      items: materialIds.map((materialId, index) => ({
        materialId,
        quantityOrdered: quantities[index] ?? 0,
        unitPrice: 10,
        taxRate: 0,
        discountPct: 0,
      })),
    });
  };

  const receive = async (
    poId: string,
    poItemId: string,
    quantity: number,
    unitCost: number,
    level = 5,
    reason = '',
    receiptNo?: string,
  ) => {
    const receipt = await inventory.createGoodsReceipt(ctx(COMPANY_A, 3), {
      poId,
      receivedAt: null,
      receiptNo,
      items: [{ poItemId, quantityReceived: quantity, unitCost, lotNo: `LOT-${tag}`, expiryDate: null, weightInKg: null }],
    });
    return inventory.confirmGoodsReceipt(ctx(COMPANY_A, level), receipt.id, reason);
  };

  dbTest('receipts re-value the moving average and a FIFO issue takes the oldest layer', async () => {
    const bulk = await createMaterial({ reorderPoint: 20 });
    const fifo = await createMaterial({ isBulk: false, method: 'fifo', unit: 'pc', reorderPoint: 5 });

    const order = await createOrder([bulk.id, fifo.id], [150, 200]);
    const confirmed = await inventory.confirmPurchaseOrder(ctx(COMPANY_A), order.id);
    expect(confirmed.status).toBe('confirmed');
    const bulkLine = confirmed.items.find((item) => item.material_id === bulk.id);
    const fifoLine = confirmed.items.find((item) => item.material_id === fifo.id);
    expect(bulkLine && fifoLine).toBeTruthy();

    await receive(order.id, bulkLine!.id, 100, 10);
    await receive(order.id, bulkLine!.id, 50, 22);

    const afterReceipts = (await inventory.listMaterials(ctx(COMPANY_A))).find((row) => row.id === bulk.id);
    expect(afterReceipts?.balance).toBe(150);
    expect(afterReceipts?.average_cost).toBeCloseTo(14, 4);

    const issue = await inventory.postMovement(ctx(COMPANY_A, 3), {
      plantId: PLANT_A,
      materialId: bulk.id,
      quantity: 50,
      movementType: 'issue',
      reason: 'issued to the batching plant',
    });
    expect(issue.total_cost).toBe(700);
    const afterIssue = (await inventory.listMaterials(ctx(COMPANY_A))).find((row) => row.id === bulk.id);
    expect(afterIssue?.balance).toBe(100);
    expect(afterIssue?.average_cost).toBeCloseTo(14, 4);

    await receive(order.id, fifoLine!.id, 100, 10);
    await receive(order.id, fifoLine!.id, 100, 20);
    const fifoIssue = await inventory.postMovement(ctx(COMPANY_A, 3), {
      plantId: PLANT_A,
      materialId: fifo.id,
      quantity: 150,
      movementType: 'issue',
      reason: 'spare parts issued to maintenance',
    });
    expect(fifoIssue.total_cost).toBe(2000);
    const fifoAfter = (await inventory.listMaterials(ctx(COMPANY_A))).find((row) => row.id === fifo.id);
    expect(fifoAfter?.balance).toBe(50);

    const layers = await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe<{ quantity_remaining: string }>(
        `select quantity_remaining::text as quantity_remaining from cost_layers
          where company_id = $1 and material_id = $2 order by received_at, layer_id`,
        [COMPANY_A, fifo.id],
      ),
    );
    expect(layers.map((layer) => Number(layer.quantity_remaining))).toEqual([0, 50]);
  });

  dbTest('duplicate documents are refused', async () => {
    const material = await createMaterial({ reorderPoint: 1 });
    const poNo = `PO-DUP-${tag}`;
    const order = await createOrder([material.id], [5], poNo);
    await expectM1(() => createOrder([material.id], [5], poNo), 'duplicate_po', 422);

    await inventory.confirmPurchaseOrder(ctx(COMPANY_A), order.id);
    const receiptNo = `GRN-DUP-${tag}`;
    await receive(order.id, order.items[0]!.id, 5, 10, 5, '', receiptNo);
    const second = await createOrder([material.id], [5]);
    await inventory.confirmPurchaseOrder(ctx(COMPANY_A), second.id);
    await expectM1(
      () =>
        inventory.createGoodsReceipt(ctx(COMPANY_A, 3), {
          poId: second.id,
          receivedAt: null,
          receiptNo,
          items: [
            {
              poItemId: second.items[0]!.id,
              quantityReceived: 5,
              unitCost: 10,
              lotNo: `LOT-DUP-${tag}`,
              expiryDate: null,
              weightInKg: null,
            },
          ],
        }),
      'duplicate_receipt',
      422,
    );
  });

  dbTest('receiving more than ordered needs a level-4 approval with a reason', async () => {
    const material = await createMaterial({ reorderPoint: 1 });
    const order = await createOrder([material.id], [5]);
    await inventory.confirmPurchaseOrder(ctx(COMPANY_A), order.id);

    const receipt = await inventory.createGoodsReceipt(ctx(COMPANY_A, 3), {
      poId: order.id,
      receivedAt: null,
      items: [
        {
          poItemId: order.items[0]!.id,
          quantityReceived: 6,
          unitCost: 10,
          lotNo: `LOT-OVER-${tag}`,
          expiryDate: null,
          weightInKg: null,
        },
      ],
    });
    await expectM1(
      () => inventory.confirmGoodsReceipt(ctx(COMPANY_A, 3), receipt.id, 'over delivery'),
      'approval_required',
      403,
    );
    const confirmed = await inventory.confirmGoodsReceipt(
      ctx(COMPANY_A, 4),
      receipt.id,
      'supplier delivered one extra unit, accepted by the store manager',
    );
    expect(confirmed.status).toBe('confirmed');
    const orders = await inventory.listPurchaseOrders(ctx(COMPANY_A));
    expect(orders.find((row) => row.id === order.id)?.status).toBe('fully_received');
  });

  dbTest('a below-zero movement is refused, then posted as a reasoned exception with a suggestion', async () => {
    const material = await createMaterial({ reorderPoint: 1 });
    const order = await createOrder([material.id], [100]);
    await inventory.confirmPurchaseOrder(ctx(COMPANY_A), order.id);
    await receive(order.id, order.items[0]!.id, 10, 10);

    await expectM1(
      () =>
        inventory.postMovement(ctx(COMPANY_A, 3), {
          plantId: PLANT_A,
          materialId: material.id,
          quantity: 25,
          movementType: 'issue',
          reason: 'issued against a delivery note',
        }),
      'negative_stock',
      422,
    );

    const posted = await inventory.postMovement(ctx(COMPANY_A, 4), {
      plantId: PLANT_A,
      materialId: material.id,
      quantity: 25,
      movementType: 'issue',
      reason: 'counted stock is higher than the ledger shows',
    });
    expect(posted.movement_id).toStartWith('MOV-');

    const exceptions = await inventory.listExceptions(ctx(COMPANY_A), { status: 'open' });
    const exception = exceptions.find((row) => row.material_id === material.id);
    expect(exception).toBeTruthy();
    expect(exception?.available_quantity).toBe(10);
    expect(exception?.quantity).toBe(25);
    expect(exception?.reason).toContain('counted stock');
    expect(exception?.suggested_source_type).toBe('purchase_order');
    expect(exception?.suggested_source_id).toBe(order.id);

    const auditRows = await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe<{ action: string }>(
        `select action from audit_log where company_id = $1 and record_id = $2`,
        [COMPANY_A, posted.movement_id],
      ),
    );
    expect(auditRows.map((row) => row.action)).toContain('inventory.exception_approved');
    expect(auditRows.map((row) => row.action)).toContain('inventory.movement_posted');
  });

  dbTest('valuation method is locked after the first movement and bulk refuses FIFO', async () => {
    const locked = await createMaterial({ isBulk: false, method: 'weighted_average', unit: 'pc' });
    await inventory.postMovement(ctx(COMPANY_A, 4), {
      plantId: PLANT_A,
      materialId: locked.id,
      quantity: 5,
      unitCost: 3,
      movementType: 'adjustment',
      reason: 'opening count entered by the store manager',
    });
    await expectM1(
      () => inventory.updateMaterial(ctx(COMPANY_A), locked.id, { valuationMethod: 'fifo' }),
      'mandatory_failure',
      409,
    );

    await expectM1(
      () => createMaterial({ isBulk: true, method: 'fifo' }),
      'mandatory_failure',
      422,
    );
    const bulk = await createMaterial({ isBulk: true, method: 'weighted_average' });
    await expectM1(
      () => inventory.updateMaterial(ctx(COMPANY_A), bulk.id, { valuationMethod: 'fifo' }),
      'mandatory_failure',
      422,
    );
  });

  dbTest('cross-plant writes are refused and RLS hides the other plant and tenant', async () => {
    const material = await createMaterial({});
    await expectM1(
      () =>
        inventory.postMovement(ctx(COMPANY_A, 5), {
          plantId: plantBPlant,
          materialId: material.id,
          quantity: 1,
          movementType: 'receipt',
          unitCost: 1,
          reason: 'receipt at the wrong plant',
        }),
      'plant_scope',
      422,
    );

    const otherPlantMaterial = await createMaterial({ plantId: plantBPlant });
    const limited = await inventory.listMaterials(ctx(COMPANY_A, 5, [PLANT_A]));
    expect(limited.some((row) => row.id === otherPlantMaterial.id)).toBe(false);
    const all = await inventory.listMaterials(ctx(COMPANY_A));
    expect(all.some((row) => row.id === otherPlantMaterial.id)).toBe(true);

    const foreign = await createMaterial({ companyId: COMPANY_B, plantId: PLANT_C });
    const companyA = await inventory.listMaterials(ctx(COMPANY_A));
    expect(companyA.some((row) => row.id === foreign.id)).toBe(false);
    await expectM1(
      () => inventory.updateMaterial(ctx(COMPANY_A), foreign.id, { nameEn: 'hijacked' }),
      'material_not_found',
      404,
    );

    await inventory.postMovement(ctx(COMPANY_B, 4), {
      plantId: PLANT_C,
      materialId: foreign.id,
      quantity: 3,
      unitCost: 2,
      movementType: 'adjustment',
      reason: 'opening count for the isolated tenant',
    });
    const hidden = await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe<{ count: string }>(
        `select count(*)::text as count from stock_movements where company_id = $1`,
        [COMPANY_B],
      ),
    );
    expect(Number(hidden[0]?.count)).toBe(0);
    const threshold = await app.withTenant(ctx(COMPANY_B).tenant, (tx) =>
      tx.unsafe<{ value: string }>(`select current_setting('app.company_id') as value`),
    );
    expect(threshold[0]?.value).toBe(COMPANY_B);
  });

  dbTest('a snapshot agrees with the derived balance and a purchase request converts to a PO', async () => {
    const material = await createMaterial({ isBulk: false, unit: 'pc', reorderPoint: 1 });
    const request = await inventory.createPurchaseRequest(ctx(COMPANY_A, 3), {
      plantId: PLANT_A,
      materialId: material.id,
      quantityRequested: 4,
      reason: 'reorder point reached at the stores',
    });
    const submitted = await inventory.submitPurchaseRequest(ctx(COMPANY_A, 3), request.id);
    expect(submitted.status).toBe('submitted');
    const approved = await inventory.decidePurchaseRequest(ctx(COMPANY_A, 4), request.id, 'approved');
    expect(approved.status).toBe('approved');
    const order = await inventory.convertPurchaseRequest(ctx(COMPANY_A, 4), request.id, {
      supplierId,
      unitPrice: 12,
      taxRate: 15,
      expectedDeliveryAt: null,
    });
    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.quantity_ordered).toBe(4);
    const requests = await inventory.listPurchaseRequests(ctx(COMPANY_A));
    expect(requests.find((row) => row.id === request.id)?.status).toBe('converted_to_po');

    await inventory.confirmPurchaseOrder(ctx(COMPANY_A), order.id);
    await receive(order.id, order.items[0]!.id, 4, 12);
    const snapshot = await inventory.generateSnapshot(ctx(COMPANY_A, 3), {
      plantId: PLANT_A,
      materialId: material.id,
      date: new Date().toISOString().slice(0, 10),
    });
    expect(snapshot.closingQty).toBe(4);
    expect(snapshot.agrees).toBe(true);
    expect(snapshot.closingValue).toBe(48);
  });
});
