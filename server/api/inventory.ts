/** M6 inventory API. Every route re-checks the level and the plant scope in the service. */
import type { MaterialCategory, MovementType, ValuationMethod } from '../../src/core/inventory';
import { M1Error } from '../services/m1';
import { InventoryService } from '../services/inventory';
import { contextFor, type B1Deps } from './b1';
import type { RoleLevel } from '../../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  json({ error: code, ...extra }, status);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const num = (value: unknown): number => numOrNull(value) ?? Number.NaN;

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

const lines = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object')) : [];

export const handleInventory = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (path !== '/api/inventory' && !path.startsWith('/api/inventory/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'Inventory needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres.',
    });
  }

  const inventory = new InventoryService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/inventory/materials' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const materials = await inventory.listMaterials(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        category: url.searchParams.get('category') ?? '',
        lowStock: url.searchParams.get('lowStock') === 'true',
        q: url.searchParams.get('q') ?? '',
      });
      return json({ materials, total: materials.length, storage: 'postgres' });
    }

    if (path === '/api/inventory/materials' && method === 'POST') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const material = await inventory.createMaterial(context, {
        plantId: str(payload.plantId),
        materialCode: str(payload.materialCode),
        nameAr: str(payload.nameAr),
        nameEn: str(payload.nameEn),
        category: str(payload.category) as MaterialCategory,
        unitOfMeasure: str(payload.unitOfMeasure),
        isBulk: payload.isBulk === true,
        valuationMethod: (str(payload.valuationMethod) || null) as ValuationMethod | null,
        minStockLevel: numOrNull(payload.minStockLevel),
        maxStockLevel: numOrNull(payload.maxStockLevel),
        reorderPoint: numOrNull(payload.reorderPoint),
      });
      return json({ material }, 201);
    }

    const materialMatch = /^\/api\/inventory\/materials\/([^/]+)$/.exec(path);
    if (materialMatch && method === 'PATCH') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const material = await inventory.updateMaterial(
        context,
        decodeURIComponent(materialMatch[1] ?? ''),
        {
          nameAr: payload.nameAr === undefined ? undefined : str(payload.nameAr),
          nameEn: payload.nameEn === undefined ? undefined : str(payload.nameEn),
          category: payload.category === undefined ? undefined : (str(payload.category) as MaterialCategory),
          unitOfMeasure: payload.unitOfMeasure === undefined ? undefined : str(payload.unitOfMeasure),
          isBulk: payload.isBulk === undefined ? undefined : payload.isBulk === true,
          valuationMethod:
            payload.valuationMethod === undefined
              ? undefined
              : ((str(payload.valuationMethod) || null) as ValuationMethod | null),
          minStockLevel: payload.minStockLevel === undefined ? undefined : numOrNull(payload.minStockLevel),
          maxStockLevel: payload.maxStockLevel === undefined ? undefined : numOrNull(payload.maxStockLevel),
          reorderPoint: payload.reorderPoint === undefined ? undefined : numOrNull(payload.reorderPoint),
          status: payload.status === undefined ? undefined : (str(payload.status) as 'active' | 'inactive'),
        },
      );
      return json({ material });
    }

    if (path === '/api/inventory/stock' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const materials = await inventory.listMaterials(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        category: url.searchParams.get('category') ?? '',
        lowStock: url.searchParams.get('lowStock') === 'true',
        q: url.searchParams.get('q') ?? '',
      });
      return json({ stock: materials, storage: 'postgres' });
    }

    if (path === '/api/inventory/movements' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const movements = await inventory.listMovements(context, {
        materialId: url.searchParams.get('materialId') ?? '',
        plantId: url.searchParams.get('plantId') ?? '',
        limit: numOrNull(url.searchParams.get('limit')) ?? 100,
      });
      return json({ movements, storage: 'postgres' });
    }

    if (path === '/api/inventory/movements' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const movement = await inventory.postMovement(context, {
        plantId: str(payload.plantId),
        materialId: str(payload.materialId),
        quantity: num(payload.quantity),
        unit: str(payload.unit),
        movementType: str(payload.movementType) as MovementType,
        unitCost: numOrNull(payload.unitCost),
        referenceType: str(payload.referenceType) || 'manual',
        referenceId: str(payload.referenceId) || null,
        lotNo: str(payload.lotNo),
        reason: str(payload.reason),
        moistureReadingId: str(payload.moistureReadingId) || null,
        batchId: str(payload.batchId) || null,
      });
      return json({ movement }, 201);
    }

    if (path === '/api/inventory/suppliers' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ suppliers: await inventory.listSuppliers(context) });
    }

    if (path === '/api/inventory/suppliers' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          supplier: await inventory.createSupplier(context, {
            plantId: str(payload.plantId),
            supplierCode: str(payload.supplierCode),
            nameAr: str(payload.nameAr),
            nameEn: str(payload.nameEn),
            contact: str(payload.contact),
            paymentTerms: str(payload.paymentTerms),
            creditDays: numOrNull(payload.creditDays),
            rating: numOrNull(payload.rating),
          }),
        },
        201,
      );
    }

    if (path === '/api/inventory/purchase-requests' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const requests = await inventory.listPurchaseRequests(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
      });
      return json({ purchaseRequests: requests, storage: 'postgres' });
    }

    if (path === '/api/inventory/purchase-requests' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const purchaseRequest = await inventory.createPurchaseRequest(context, {
        plantId: str(payload.plantId),
        materialId: str(payload.materialId),
        quantityRequested: num(payload.quantityRequested),
        reason: str(payload.reason),
        prNo: str(payload.prNo),
      });
      return json({ purchaseRequest }, 201);
    }

    const prActionMatch = /^\/api\/inventory\/purchase-requests\/([^/]+)\/(submit|approve|reject|convert)$/.exec(path);
    if (prActionMatch && method === 'POST') {
      const action = prActionMatch[2];
      const context = await guarded(action === 'submit' ? 3 : 4);
      if (context instanceof Response) return context;
      const id = decodeURIComponent(prActionMatch[1] ?? '');
      if (action === 'submit') return json({ purchaseRequest: await inventory.submitPurchaseRequest(context, id) });
      if (action === 'approve' || action === 'reject') {
        return json({ purchaseRequest: await inventory.decidePurchaseRequest(context, id, action === 'approve' ? 'approved' : 'rejected') });
      }
      const payload = await body(request);
      return json(
        {
          purchaseOrder: await inventory.convertPurchaseRequest(context, id, {
            supplierId: str(payload.supplierId),
            unitPrice: num(payload.unitPrice),
            taxRate: numOrNull(payload.taxRate) ?? 0,
            expectedDeliveryAt: str(payload.expectedDeliveryAt) || null,
          }),
        },
        201,
      );
    }

    if (path === '/api/inventory/purchase-orders' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const orders = await inventory.listPurchaseOrders(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
      });
      return json({ purchaseOrders: orders, storage: 'postgres' });
    }

    if (path === '/api/inventory/purchase-orders' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const purchaseOrder = await inventory.createPurchaseOrder(context, {
        plantId: str(payload.plantId),
        supplierId: str(payload.supplierId),
        poNo: str(payload.poNo),
        prId: str(payload.prId) || null,
        expectedDeliveryAt: str(payload.expectedDeliveryAt) || null,
        items: lines(payload.items).map((item) => ({
          materialId: str(item.materialId),
          quantityOrdered: num(item.quantityOrdered),
          unitPrice: num(item.unitPrice),
          taxRate: numOrNull(item.taxRate) ?? 0,
          discountPct: numOrNull(item.discountPct) ?? 0,
        })),
      });
      return json({ purchaseOrder }, 201);
    }

    const poActionMatch = /^\/api\/inventory\/purchase-orders\/([^/]+)\/(confirm|cancel)$/.exec(path);
    if (poActionMatch && method === 'POST') {
      const action = poActionMatch[2];
      const context = await guarded(action === 'confirm' ? 4 : 5);
      if (context instanceof Response) return context;
      const id = decodeURIComponent(poActionMatch[1] ?? '');
      if (action === 'confirm') return json({ purchaseOrder: await inventory.confirmPurchaseOrder(context, id) });
      const payload = await body(request);
      return json({ purchaseOrder: await inventory.cancelPurchaseOrder(context, id, str(payload.reason)) });
    }

    if (path === '/api/inventory/goods-receipts' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const receipts = await inventory.listGoodsReceipts(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
      });
      return json({ goodsReceipts: receipts, storage: 'postgres' });
    }

    if (path === '/api/inventory/goods-receipts' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const goodsReceipt = await inventory.createGoodsReceipt(context, {
        poId: str(payload.poId),
        receivedAt: str(payload.receivedAt) || null,
        receiptNo: str(payload.receiptNo),
        items: lines(payload.items).map((item) => ({
          poItemId: str(item.poItemId),
          quantityReceived: num(item.quantityReceived),
          unitCost: num(item.unitCost),
          lotNo: str(item.lotNo),
          expiryDate: str(item.expiryDate) || null,
          weightInKg: numOrNull(item.weightInKg),
        })),
      });
      return json({ goodsReceipt }, 201);
    }

    const grnActionMatch = /^\/api\/inventory\/goods-receipts\/([^/]+)\/(confirm|void)$/.exec(path);
    if (grnActionMatch && method === 'POST') {
      const action = grnActionMatch[2];
      const context = await guarded(action === 'confirm' ? 3 : 5);
      if (context instanceof Response) return context;
      const id = decodeURIComponent(grnActionMatch[1] ?? '');
      const payload = await body(request);
      if (action === 'confirm') {
        return json({ goodsReceipt: await inventory.confirmGoodsReceipt(context, id, str(payload.reason)) });
      }
      return json({ goodsReceipt: await inventory.voidGoodsReceipt(context, id, str(payload.reason)) });
    }

    if (path === '/api/inventory/exceptions' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const exceptions = await inventory.listExceptions(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
      });
      return json({ exceptions, storage: 'postgres' });
    }

    const exceptionMatch = /^\/api\/inventory\/exceptions\/([^/]+)\/decision$/.exec(path);
    if (exceptionMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const decision = str(payload.decision) === 'rejected' ? 'rejected' : 'approved';
      const status = str(payload.status) === 'escalated' ? 'escalated' : 'resolved';
      return json({
        exception: await inventory.decideException(context, decodeURIComponent(exceptionMatch[1] ?? ''), {
          decision,
          status,
        }),
      });
    }

    if (path === '/api/inventory/snapshots' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          snapshot: await inventory.generateSnapshot(context, {
            plantId: str(payload.plantId),
            materialId: str(payload.materialId),
            date: str(payload.date) || new Date().toISOString().slice(0, 10),
          }),
        },
        201,
      );
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE inventory] unhandled error', error);
    return fail(500, 'internal_error');
  }
};
