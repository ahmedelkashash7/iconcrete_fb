/** M11 dispatch API: board reads at level 1, operating writes at level 3, trucks at level 4. */
import { M1Error } from '../services/m1';
import { DispatchService } from '../services/dispatch';
import { CostService } from '../services/cost';
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

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

export const handleDispatch = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (
    path !== '/api/trips' &&
    !path.startsWith('/api/trips/') &&
    path !== '/api/trucks' &&
    !path.startsWith('/api/trucks/')
  ) {
    return null;
  }

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'Dispatch needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres.',
    });
  }

  const dispatch = new DispatchService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/trips' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const board = await dispatch.getBoard(context, {
        date: url.searchParams.get('date') ?? '',
        plantId: url.searchParams.get('plantId') ?? '',
      });
      return json({ ...board, storage: 'postgres' });
    }

    if (path === '/api/trips' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const trip = await dispatch.createTrip(context, {
        orderId: str(payload.orderId),
        truckId: payload.truckId === null || payload.truckId === undefined ? undefined : str(payload.truckId),
        driverName: str(payload.driverName),
        mixDesignId:
          payload.mixDesignId === null || payload.mixDesignId === undefined
            ? undefined
            : str(payload.mixDesignId),
        targetM3: numOrNull(payload.targetM3) ?? 0,
        plantId: payload.plantId === null || payload.plantId === undefined ? undefined : str(payload.plantId),
        date: payload.date === null || payload.date === undefined ? undefined : str(payload.date),
      });
      return json({ trip }, 201);
    }

    const advanceMatch = /^\/api\/trips\/([^/]+)\/advance$/.exec(path);
    if (advanceMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const trip = await dispatch.advanceTrip(context, decodeURIComponent(advanceMatch[1] ?? ''), {
        loadedM3: numOrNull(payload.loadedM3),
      });
      let costWarning: string | undefined;
      try {
        await new CostService(deps.db).recomputeTrip(context, trip.id);
      } catch (error) {
        costWarning = error instanceof Error ? error.message : 'cost_recompute_failed';
      }
      return json({ trip, ...(costWarning ? { costWarning } : {}) });
    }

    const assignMatch = /^\/api\/trips\/([^/]+)\/assign$/.exec(path);
    if (assignMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        trip: await dispatch.assignTruck(
          context,
          decodeURIComponent(assignMatch[1] ?? ''),
          str(payload.truckId),
        ),
      });
    }

    const cancelMatch = /^\/api\/trips\/([^/]+)\/cancel$/.exec(path);
    if (cancelMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        trip: await dispatch.cancelTrip(
          context,
          decodeURIComponent(cancelMatch[1] ?? ''),
          str(payload.reason),
        ),
      });
    }

    const eventsMatch = /^\/api\/trips\/([^/]+)\/events$/.exec(path);
    if (eventsMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const events = await dispatch.getTripEvents(context, decodeURIComponent(eventsMatch[1] ?? ''));
      return json({ events, total: events.length });
    }

    const tripMatch = /^\/api\/trips\/([^/]+)$/.exec(path);
    if (tripMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ trip: await dispatch.getTrip(context, decodeURIComponent(tripMatch[1] ?? '')) });
    }

    if (path === '/api/trucks' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const board = await dispatch.getBoard(context, {
        date: url.searchParams.get('date') ?? '',
        plantId: url.searchParams.get('plantId') ?? '',
      });
      return json({ trucks: board.trucks, total: board.trucks.length });
    }

    if (path === '/api/trucks' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          truck: await dispatch.createTruck(context, {
            plantId: str(payload.plantId),
            plateNo: str(payload.plateNo),
            capacityM3: numOrNull(payload.capacityM3) ?? 0,
            odometerKm: numOrNull(payload.odometerKm),
          }),
        },
        201,
      );
    }

    const truckStatusMatch = /^\/api\/trucks\/([^/]+)\/status$/.exec(path);
    if (truckStatusMatch && (method === 'PATCH' || method === 'POST')) {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        truck: await dispatch.updateTruckStatus(
          context,
          decodeURIComponent(truckStatusMatch[1] ?? ''),
          str(payload.status),
        ),
      });
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE dispatch] unhandled error', error);
    return fail(500, 'internal_error');
  }
};
