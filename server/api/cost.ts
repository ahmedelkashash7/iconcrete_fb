/** M12 cost API. Reads are level 1; settings/recompute are level 4; demo seeding is level 5. */
import { M1Error } from '../services/m1';
import { CostService } from '../services/cost';
import { contextFor, type B1Deps } from './b1';
import type { RoleLevel } from '../../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response => json({ error: code, ...extra }, status);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

const DIMENSIONS = ['order', 'customer', 'mix', 'plant', 'month'] as const;

export const handleCost = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();
  if (path !== '/api/cost' && !path.startsWith('/api/cost/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'Actual cost needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres.',
    });
  }

  const service = new CostService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/cost/settings' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json(
        await service.settings(
          context,
          url.searchParams.get('plantId') ?? '',
          url.searchParams.get('asOf') ?? undefined,
        ),
      );
    }

    if (path === '/api/cost/settings' && (method === 'POST' || method === 'PUT')) {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        await service.upsertSetting(context, {
          plantId: str(payload.plantId),
          key: str(payload.key),
          value: num(payload.value),
          effectiveFrom: str(payload.effectiveFrom),
          unit: str(payload.unit),
        }),
      );
    }

    if (path === '/api/cost/material-prices' && (method === 'POST' || method === 'PUT')) {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        await service.upsertMaterialPrice(context, {
          plantId: str(payload.plantId),
          materialId: str(payload.materialId),
          pricePerUnit: num(payload.pricePerUnit),
          baseUnit: str(payload.baseUnit) || 'kg',
          effectiveFrom: str(payload.effectiveFrom),
        }),
      );
    }

    if (path === '/api/cost/seed-demo' && method === 'POST') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      return json({ seeded: await service.seedDemo(context) }, 201);
    }

    if (path === '/api/cost/seed-demo-batches' && method === 'POST') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const specs = Array.isArray(payload.batches) ? payload.batches : [];
      const batches = specs.map((raw) => {
        const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const components = Array.isArray(row.components) ? row.components : [];
        const moistures = Array.isArray(row.moistures) ? row.moistures : [];
        return {
          batchNo: str(row.batchNo),
          plantId: str(row.plantId),
          orderId: str(row.orderId),
          mixVersionId: str(row.mixVersionId),
          volume: num(row.volume),
          components: components.map((entry) => {
            const component = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
            return {
              materialId: str(component.materialId),
              targetWeight: num(component.targetWeight),
              actualWeight: num(component.actualWeight),
              unit: str(component.unit),
            };
          }),
          moistures: moistures.map((entry) => {
            const moisture = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
            return { materialId: str(moisture.materialId), moisturePct: num(moisture.moisturePct) };
          }),
        };
      });
      return json({ seeded: await service.seedDemoBatches(context, batches) }, 201);
    }

    if (path === '/api/cost/recompute' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      return json({ recomputed: await service.recomputeAll(context) });
    }

    if (path === '/api/cost/batches' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const rows = await service.listBatches(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        from: url.searchParams.get('from') ?? '',
        to: url.searchParams.get('to') ?? '',
        limit: Number(url.searchParams.get('limit') ?? 200),
      });
      return json({ batches: rows, total: rows.length, storage: 'postgres' });
    }

    const batchMatch = /^\/api\/cost\/batches\/([^/]+)$/.exec(path);
    if (batchMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ batch: await service.getBatch(context, decodeURIComponent(batchMatch[1] ?? '')) });
    }

    const recomputeBatch = /^\/api\/cost\/batches\/([^/]+)\/recompute$/.exec(path);
    if (recomputeBatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      return json({ batch: await service.recomputeBatch(context, decodeURIComponent(recomputeBatch[1] ?? '')) });
    }

    if (path === '/api/cost/trips' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const ids = (url.searchParams.get('ids') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const rows = await service.listTripCosts(context, ids);
      return json({ trips: rows, total: rows.length });
    }

    const tripMatch = /^\/api\/cost\/trips\/([^/]+)$/.exec(path);
    if (tripMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ trip: await service.getTripCost(context, decodeURIComponent(tripMatch[1] ?? '')) });
    }

    const recomputeTrip = /^\/api\/cost\/trips\/([^/]+)\/recompute$/.exec(path);
    if (recomputeTrip && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      return json({ trip: await service.recomputeTrip(context, decodeURIComponent(recomputeTrip[1] ?? '')) });
    }

    if (path === '/api/cost/report' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const dimension = url.searchParams.get('dimension') ?? 'order';
      if (!(DIMENSIONS as readonly string[]).includes(dimension)) {
        return fail(422, 'validation_error', { field: 'dimension' });
      }
      const rows = await service.report(context, {
        dimension,
        from: url.searchParams.get('from') ?? '',
        to: url.searchParams.get('to') ?? '',
        plantId: url.searchParams.get('plantId') ?? '',
      });
      return json({ rows, total: rows.length, dimension });
    }

    if (path === '/api/cost/dashboard' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json(
        await service.dashboard(
          context,
          url.searchParams.get('month') ?? '',
          url.searchParams.get('plantId') ?? '',
        ),
      );
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, { message: error.message });
    throw error;
  }
};
