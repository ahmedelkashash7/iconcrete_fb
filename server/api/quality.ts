/** M4 quality API: read at level 1, results at 3, verify/close at 4, hold release/revoke/CAPA at 5. */
import { M1Error } from '../services/m1';
import { QualityService } from '../services/quality';
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

export const handleQuality = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (path !== '/api/quality' && !path.startsWith('/api/quality/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'Quality needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres.',
    });
  }

  const quality = new QualityService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/quality/tests' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const rows = await quality.listTests(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
        testType: url.searchParams.get('testType') ?? '',
      });
      return json({ tests: rows, total: rows.length, storage: 'postgres' });
    }

    if (path === '/api/quality/tests' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          test: await quality.createTest(context, {
            plantId: str(payload.plantId),
            batchId: payload.batchId === null || payload.batchId === undefined ? null : str(payload.batchId),
            mixVersionId:
              payload.mixVersionId === null || payload.mixVersionId === undefined
                ? null
                : str(payload.mixVersionId),
            testType: str(payload.testType),
            sampledAt: str(payload.sampledAt) || new Date().toISOString(),
            ageDays: numOrNull(payload.ageDays),
            requiredSpecimenCount: numOrNull(payload.requiredSpecimenCount),
            equipmentId:
              payload.equipmentId === null || payload.equipmentId === undefined
                ? null
                : str(payload.equipmentId),
            specMin: numOrNull(payload.specMin),
            specMax: numOrNull(payload.specMax),
            specSourceNote: str(payload.specSourceNote),
          }),
        },
        201,
      );
    }

    const specimenMatch = /^\/api\/quality\/tests\/([^/]+)\/specimens$/.exec(path);
    if (specimenMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        test: await quality.addSpecimen(context, decodeURIComponent(specimenMatch[1] ?? ''), {
          specimenNo: numOrNull(payload.specimenNo) ?? 1,
          castAt: payload.castAt === null || payload.castAt === undefined ? null : str(payload.castAt),
          curedUntil:
            payload.curedUntil === null || payload.curedUntil === undefined ? null : str(payload.curedUntil),
        }),
      });
    }

    const resultMatch = /^\/api\/quality\/tests\/([^/]+)\/result$/.exec(path);
    if (resultMatch && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        test: await quality.recordResult(context, decodeURIComponent(resultMatch[1] ?? ''), {
          resultValue: numOrNull(payload.resultValue) ?? Number.NaN,
          resultUnit: str(payload.resultUnit),
          testedAt: str(payload.testedAt) || new Date().toISOString(),
          ageDays: numOrNull(payload.ageDays),
        }),
      });
    }

    const verifyMatch = /^\/api\/quality\/tests\/([^/]+)\/verify$/.exec(path);
    if (verifyMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      return json({ test: await quality.verifyTest(context, decodeURIComponent(verifyMatch[1] ?? '')) });
    }

    const certifyMatch = /^\/api\/quality\/tests\/([^/]+)\/certificate$/.exec(path);
    if (certifyMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const issued = await quality.issueCertificate(context, decodeURIComponent(certifyMatch[1] ?? ''));
      return json({ certificate: issued.certificate, test: issued.test }, 201);
    }

    const testMatch = /^\/api\/quality\/tests\/([^/]+)$/.exec(path);
    if (testMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ test: await quality.getTest(context, decodeURIComponent(testMatch[1] ?? '')) });
    }

    if (path === '/api/quality/equipment' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ equipment: await quality.listEquipment(context) });
    }

    if (path === '/api/quality/equipment' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          equipment: await quality.createEquipment(context, {
            plantId: str(payload.plantId),
            equipmentCode: str(payload.equipmentCode),
            name: str(payload.name),
            serial: str(payload.serial),
            intervalDays: numOrNull(payload.intervalDays),
          }),
        },
        201,
      );
    }

    const calibrationMatch = /^\/api\/quality\/equipment\/([^/]+)\/calibration$/.exec(path);
    if (calibrationMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        equipment: await quality.recordCalibration(
          context,
          decodeURIComponent(calibrationMatch[1] ?? ''),
          {
            provider: str(payload.provider),
            calibratedAt: str(payload.calibratedAt) || new Date().toISOString(),
            expiresAt: str(payload.expiresAt) || new Date().toISOString(),
            certificateRef: str(payload.certificateRef),
          },
        ),
      });
    }

    const capaVerifyMatch = /^\/api\/quality\/capa\/([^/]+)\/verify$/.exec(path);
    if (capaVerifyMatch && method === 'POST') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        capa: await quality.verifyCapa(
          context,
          decodeURIComponent(capaVerifyMatch[1] ?? ''),
          str(payload.effectivenessCheck),
        ),
      });
    }

    const capaMatch = /^\/api\/quality\/ncr\/([^/]+)\/capa$/.exec(path);
    if (capaMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        {
          ncr: await quality.addCapa(context, decodeURIComponent(capaMatch[1] ?? ''), {
            actionType: str(payload.actionType) === 'preventive' ? 'preventive' : 'corrective',
            description: str(payload.description),
            ownerId: str(payload.ownerId),
            dueDate: payload.dueDate === null || payload.dueDate === undefined ? null : str(payload.dueDate),
          }),
        },
        201,
      );
    }

    const ncrStatusMatch = /^\/api\/quality\/ncr\/([^/]+)\/status$/.exec(path);
    if (ncrStatusMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        ncr: await quality.transitionNcr(
          context,
          decodeURIComponent(ncrStatusMatch[1] ?? ''),
          str(payload.status) as never,
          { reason: str(payload.reason), rootCause: str(payload.rootCause) },
        ),
      });
    }

    const ncrMatch = /^\/api\/quality\/ncr\/([^/]+)$/.exec(path);
    if (ncrMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ ncr: await quality.getNcr(context, decodeURIComponent(ncrMatch[1] ?? '')) });
    }

    const revokeMatch = /^\/api\/quality\/certificates\/([^/]+)\/revoke$/.exec(path);
    if (revokeMatch && method === 'POST') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        certificate: await quality.revokeCertificate(
          context,
          decodeURIComponent(revokeMatch[1] ?? ''),
          str(payload.reason),
        ),
      });
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE quality] unhandled error', error);
    return fail(500, 'internal_error');
  }
};
