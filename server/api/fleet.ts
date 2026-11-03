/** M5 fleet API: read at level 1, assign/trip at 3, cancel/maintenance/override at 4, retire at 5. */
import { M1Error } from '../services/m1';
import { FleetService } from '../services/fleet';
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

export const handleFleet = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (path !== '/api/fleet' && !path.startsWith('/api/fleet/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'Fleet needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres.',
    });
  }

  const fleet = new FleetService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/fleet/trucks' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const trucks = await fleet.listTrucks(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
      });
      return json({ trucks, total: trucks.length, storage: 'postgres' });
    }

    if (path === '/api/fleet/trucks' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          truck: await fleet.createTruck(context, {
            plantId: str(payload.plantId),
            plateNo: str(payload.plateNo),
            capacityM3: numOrNull(payload.capacityM3) ?? 0,
            mixerType: str(payload.mixerType) || 'drum',
            odometerKm: numOrNull(payload.odometerKm),
            ownership: str(payload.ownership) || 'owned',
            insuranceExpiresAt:
              payload.insuranceExpiresAt === null || payload.insuranceExpiresAt === undefined
                ? null
                : str(payload.insuranceExpiresAt),
          }),
        },
        201,
      );
    }

    const retireMatch = /^\/api\/fleet\/trucks\/([^/]+)\/retire$/.exec(path);
    if (retireMatch && method === 'POST') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      return json({ truck: await fleet.retireTruck(context, decodeURIComponent(retireMatch[1] ?? '')) });
    }

    if (path === '/api/fleet/drivers' && method === 'GET') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      return json({
        drivers: await fleet.listDrivers(context, {
          plantId: url.searchParams.get('plantId') ?? '',
          status: url.searchParams.get('status') ?? '',
          licenceExpiredBefore: url.searchParams.get('licenceExpiredBefore') ?? '',
        }),
      });
    }

    if (path === '/api/fleet/drivers' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          driver: await fleet.createDriver(context, {
            plantId: str(payload.plantId),
            employeeRef: str(payload.employeeRef),
            fullName: str(payload.fullName),
            phone: str(payload.phone),
            licenceNo: str(payload.licenceNo),
            licenceClass: str(payload.licenceClass),
            licenceExpiresAt:
              payload.licenceExpiresAt === null || payload.licenceExpiresAt === undefined
                ? null
                : str(payload.licenceExpiresAt),
          }),
        },
        201,
      );
    }

    const renewMatch = /^\/api\/fleet\/drivers\/([^/]+)\/licence$/.exec(path);
    if (renewMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        driver: await fleet.renewLicence(
          context,
          decodeURIComponent(renewMatch[1] ?? ''),
          str(payload.expiresAt),
        ),
      });
    }

    if (path === '/api/fleet/assignments' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({
        assignments: await fleet.listAssignments(context, {
          plantId: url.searchParams.get('plantId') ?? '',
          status: url.searchParams.get('status') ?? '',
        }),
      });
    }

    if (path === '/api/fleet/assignments' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          assignment: await fleet.proposeAssignment(context, {
            plantId: str(payload.plantId),
            orderId: payload.orderId === null || payload.orderId === undefined ? null : str(payload.orderId),
            truckId: str(payload.truckId),
            driverId: str(payload.driverId),
            sequenceNo: numOrNull(payload.sequenceNo) ?? 1,
          }),
        },
        201,
      );
    }

    const confirmMatch = /^\/api\/fleet\/assignments\/([^/]+)\/confirm$/.exec(path);
    if (confirmMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      return json({ assignment: await fleet.confirmAssignment(context, decodeURIComponent(confirmMatch[1] ?? '')) });
    }

    const dispatchMatch = /^\/api\/fleet\/assignments\/([^/]+)\/dispatch$/.exec(path);
    if (dispatchMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const result = await fleet.dispatchAssignment(context, decodeURIComponent(dispatchMatch[1] ?? ''), {
        loadedVolumeM3: numOrNull(payload.loadedVolumeM3) ?? 0,
        batchId: payload.batchId === null || payload.batchId === undefined ? null : str(payload.batchId),
      });
      return json({ assignment: result.assignment, trip: result.trip }, 201);
    }

    const cancelMatch = /^\/api\/fleet\/assignments\/([^/]+)\/cancel$/.exec(path);
    if (cancelMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        assignment: await fleet.cancelAssignment(
          context,
          decodeURIComponent(cancelMatch[1] ?? ''),
          str(payload.reason),
        ),
      });
    }

    if (path === '/api/fleet/trips' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({
        assignments: await fleet.listAssignments(context, {
          plantId: url.searchParams.get('plantId') ?? '',
          status: url.searchParams.get('status') ?? '',
        }),
      });
    }

    if (path === '/api/fleet/maintenance' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ maintenance: await fleet.listMaintenance(context) });
    }

    if (path === '/api/fleet/maintenance' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          maintenance: await fleet.openMaintenance(context, {
            truckId: str(payload.truckId),
            maintenanceType: str(payload.maintenanceType) || 'service',
            odometerKm: numOrNull(payload.odometerKm),
            notes: str(payload.notes),
          }),
        },
        201,
      );
    }

    const closeMaintenanceMatch = /^\/api\/fleet\/maintenance\/([^/]+)\/close$/.exec(path);
    if (closeMaintenanceMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        maintenance: await fleet.closeMaintenance(
          context,
          decodeURIComponent(closeMaintenanceMatch[1] ?? ''),
          { costAmount: numOrNull(payload.costAmount), odometerKm: numOrNull(payload.odometerKm) },
        ),
      });
    }

    if (path === '/api/fleet/gps' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          position: await fleet.recordGps(context, {
            truckId: str(payload.truckId),
            lat: numOrNull(payload.lat) ?? Number.NaN,
            lng: numOrNull(payload.lng) ?? Number.NaN,
            source: str(payload.source) || 'mock',
            reason: str(payload.reason),
          }),
        },
        201,
      );
    }

    const overrideMatch = /^\/api\/fleet\/trips\/([^/]+)\/override$/.exec(path);
    if (overrideMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          override: await fleet.addOverride(context, decodeURIComponent(overrideMatch[1] ?? ''), {
            ruleCode: str(payload.ruleCode),
            reason: str(payload.reason),
            decision: str(payload.decision) === 'rejected' ? 'rejected' : 'approved',
          }),
        },
        201,
      );
    }

    const departMatch = /^\/api\/fleet\/trips\/([^/]+)\/depart$/.exec(path);
    if (departMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      return json({ trip: await fleet.departTrip(context, decodeURIComponent(departMatch[1] ?? '')) });
    }

    const arriveMatch = /^\/api\/fleet\/trips\/([^/]+)\/arrive$/.exec(path);
    if (arriveMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        trip: await fleet.arriveTrip(context, decodeURIComponent(arriveMatch[1] ?? ''), {
          siteWaitMinutes: numOrNull(payload.siteWaitMinutes),
        }),
      });
    }

    const returnMatch = /^\/api\/fleet\/trips\/([^/]+)\/return$/.exec(path);
    if (returnMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      return json({ trip: await fleet.returnTrip(context, decodeURIComponent(returnMatch[1] ?? '')) });
    }

    const abortMatch = /^\/api\/fleet\/trips\/([^/]+)\/abort$/.exec(path);
    if (abortMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        trip: await fleet.abortTrip(context, decodeURIComponent(abortMatch[1] ?? ''), str(payload.reason)),
      });
    }

    const deliveryMatch = /^\/api\/fleet\/trips\/([^/]+)\/delivery$/.exec(path);
    if (deliveryMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        trip: await fleet.recordDelivery(context, decodeURIComponent(deliveryMatch[1] ?? ''), {
          deliveredVolumeM3: numOrNull(payload.deliveredVolumeM3) ?? Number.NaN,
          reason: str(payload.reason),
        }),
      });
    }

    const tripMatch = /^\/api\/fleet\/trips\/([^/]+)$/.exec(path);
    if (tripMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ trip: await fleet.getTrip(context, decodeURIComponent(tripMatch[1] ?? '')) });
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE fleet] unhandled error', error);
    return fail(500, 'internal_error');
  }
};
