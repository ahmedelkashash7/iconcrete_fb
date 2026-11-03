/** M3 batching API: list/read at level 1, plan/start/complete/moisture at level 3, hold/release/cancel at level 4, engineering-hold release at level 5. */

import { M1Error } from '../services/m1';
import { BatchingService } from '../services/batching';
import { contextFor, type B1Deps } from './b1';
import type { RoleLevel } from '../../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response => json({ error: code, ...extra }, status);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const numOr = (value: unknown, fallback: number): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

export const handleBatches = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (path !== '/api/batches' && !path.startsWith('/api/batches/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'Batching needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres and DATABASE_URL.',
    });
  }

  const batches = new BatchingService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/batches' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const rows = await batches.list(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
      });
      return json({ batches: rows, total: rows.length, storage: 'postgres' });
    }

    if (path === '/api/batches' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const created = await batches.create(context, {
        plantId: str(payload.plantId),
        batchNo: str(payload.batchNo),
        orderId: payload.orderId === null || payload.orderId === undefined ? null : str(payload.orderId),
        mixVersionId: str(payload.mixVersionId),
        plannedVolume: numOr(payload.plannedVolume, Number.NaN),
        operatorId: payload.operatorId === null || payload.operatorId === undefined ? null : str(payload.operatorId),
      });
      return json({ batch: created }, 201);
    }

    if (path === '/api/batches' && method === 'PATCH') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const id = str(payload.id);
      if (!id) return fail(422, 'validation_error', { field: 'id' });
      const operatorId =
        payload.operatorId === null || payload.operatorId === undefined ? null : str(payload.operatorId);
      return json({ batch: await batches.start(context, id, { operatorId }) });
    }

    const completeMatch = /^\/api\/batches\/([^/]+)\/complete$/.exec(path);
    if (completeMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const rawComponents = Array.isArray(payload.components) ? payload.components : [];
      const components = rawComponents.map((raw) => {
        const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        return {
          materialId: str(row.materialId),
          targetWeight: numOrNull(row.targetWeight),
          actualWeight: numOrNull(row.actualWeight),
          unit: str(row.unit) || 'kg',
          tolerancePct: numOrNull(row.tolerancePct),
        };
      });
      return json({ batch: await batches.complete(context, decodeURIComponent(completeMatch[1] ?? ''), {
        actualVolume: numOr(payload.actualVolume, Number.NaN),
        components,
      }) });
    }

    const holdMatch = /^\/api\/batches\/([^/]+)\/hold$/.exec(path);
    if (holdMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({ batch: await batches.hold(context, decodeURIComponent(holdMatch[1] ?? ''), str(payload.reason)) });
    }

    const releaseMatch = /^\/api\/batches\/([^/]+)\/release$/.exec(path);
    if (releaseMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      return json({ batch: await batches.release(context, decodeURIComponent(releaseMatch[1] ?? '')) });
    }

    const engineeringMatch = /^\/api\/batches\/([^/]+)\/engineering-hold$/.exec(path);
    if (engineeringMatch && method === 'POST') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({ batch: await batches.releaseEngineeringHold(context, decodeURIComponent(engineeringMatch[1] ?? ''), str(payload.reason)) });
    }

    const cancelMatch = /^\/api\/batches\/([^/]+)\/cancel$/.exec(path);
    if (cancelMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      return json({ batch: await batches.cancel(context, decodeURIComponent(cancelMatch[1] ?? '')) });
    }

    const moistureMatch = /^\/api\/batches\/([^/]+)\/moisture$/.exec(path);
    if (moistureMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({ reading: await batches.recordMoisture(context, decodeURIComponent(moistureMatch[1] ?? ''), {
        materialId: str(payload.materialId),
        basis: str(payload.basis) as 'dry' | 'wet',
        moisturePct: numOrNull(payload.moisturePct),
        absorptionPct: numOrNull(payload.absorptionPct),
        validUntil: payload.validUntil === null || payload.validUntil === undefined ? null : str(payload.validUntil),
      }) });
    }

    const overrideMatch = /^\/api\/batches\/([^/]+)\/override$/.exec(path);
    if (overrideMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({ override: await batches.override(context, decodeURIComponent(overrideMatch[1] ?? ''), {
        ruleId: str(payload.ruleId),
        ruleCode: str(payload.ruleCode),
        entityType: str(payload.entityType),
        entityId: str(payload.entityId),
        reason: str(payload.reason),
        decision: str(payload.decision) as 'approved' | 'rejected',
      }) });
    }

    const detailMatch = /^\/api\/batches\/([^/]+)$/.exec(path);
    if (detailMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ batch: await batches.get(context, decodeURIComponent(detailMatch[1] ?? '')) });
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE batches] unhandled error', error);
    return fail(500, 'internal_error');
  }
};
