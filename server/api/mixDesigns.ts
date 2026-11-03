/**
 * M2 mix design API: catalogue and detail reads from level 1, draft writes at level 4,
 * approval and supersede at level 5. Rule refusals answer with the classification the
 * engine produced (mandatory_failure, approval_required), so a client never has to guess
 * whether a write was rejected for a rule or for a field.
 */
import { M1Error } from '../services/m1';
import { MixDesignService } from '../services/mixDesign';
import type { MixComponentInput, MixStrengthTestInput } from '../../src/core/mixDesign';
import { contextFor, type B1Deps } from './b1';
import type { RoleLevel } from '../../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  json({ error: code, ...extra }, status);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

const numberOr = (value: unknown, fallback: number): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseComponents = (raw: unknown): MixComponentInput[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      materialId: str(row.materialId ?? row.material_id),
      role: str(row.role),
      qtyPerM3: numberOr(row.qtyPerM3 ?? row.qty_per_m3, Number.NaN),
      unit: str(row.unit) || 'kg',
      moistureBasis: str(row.moistureBasis ?? row.moisture_basis),
    };
  });
};

const parseStrengthTests = (raw: unknown): MixStrengthTestInput[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const target = row.targetMinMpa ?? row.target_min_mpa;
    return {
      ageDays: numberOr(row.ageDays ?? row.age_days, Number.NaN),
      targetMinMpa:
        target === null || target === undefined || target === '' ? null : numberOr(target, Number.NaN),
      sourceNote: str(row.sourceNote ?? row.source_note),
    };
  });
};

export const handleMixDesigns = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (path !== '/api/mix-designs' && !path.startsWith('/api/mix-designs/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message:
        'Mix designs need the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres and DATABASE_URL.',
    });
  }

  const designs = new MixDesignService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/mix-designs' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const rows = await designs.list(context, { plantId: url.searchParams.get('plantId') ?? '' });
      // The create form needs plant options, and /api/plants is level 5, so the catalogue
      // carries them for every reader instead of sending a level-4 user to a 403.
      const plants = await deps.db.withTenant(context.tenant, (tx) =>
        tx.unsafe<{ id: string; name_ar: string; name_en: string }>(
          `select id, name_ar, name_en from plants
            where company_id = $1 and deleted_at is null order by id`,
          [context.tenant.companyId],
        ),
      );
      return json({ designs: rows, total: rows.length, plants, storage: 'postgres' });
    }

    if (path === '/api/mix-designs' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const design = await designs.create(context, {
        plantId: str(payload.plantId),
        code: str(payload.code),
        nameAr: str(payload.nameAr),
        nameEn: str(payload.nameEn),
        strengthClass: str(payload.strengthClass),
        components: parseComponents(payload.components),
        strengthTests: parseStrengthTests(payload.strengthTests),
      });
      return json({ design }, 201);
    }

    const actionMatch = /^\/api\/mix-designs\/([^/]+)\/versions\/(\d+)\/(submit|approve|supersede)$/.exec(path);
    if (actionMatch) {
      const [, rawId, rawNo, action] = actionMatch;
      const id = decodeURIComponent(rawId ?? '');
      const versionNo = Number(rawNo);
      const payload = await body(request);

      if (action === 'submit' && method === 'POST') {
        const context = await guarded(4);
        if (context instanceof Response) return context;
        return json({ version: await designs.submit(context, id, versionNo) });
      }
      if (action === 'approve' && method === 'POST') {
        const context = await guarded(5);
        if (context instanceof Response) return context;
        return json({ version: await designs.approve(context, id, versionNo) });
      }
      if (action === 'supersede' && method === 'POST') {
        const context = await guarded(5);
        if (context instanceof Response) return context;
        const result = await designs.supersede(context, id, versionNo, str(payload.reason));
        return json({ version: result.version, override: result.override });
      }
      return fail(404, 'not_found');
    }

    const versionMatch = /^\/api\/mix-designs\/([^/]+)\/versions\/(\d+)$/.exec(path);
    if (versionMatch && (method === 'PATCH' || method === 'PUT')) {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const version = await designs.updateDraft(
        context,
        decodeURIComponent(versionMatch[1] ?? ''),
        Number(versionMatch[2]),
        {
          ...(payload.strengthClass === undefined ? {} : { strengthClass: str(payload.strengthClass) }),
          ...(payload.notes === undefined ? {} : { notes: str(payload.notes) }),
          ...(payload.components === undefined ? {} : { components: parseComponents(payload.components) }),
          ...(payload.strengthTests === undefined
            ? {}
            : { strengthTests: parseStrengthTests(payload.strengthTests) }),
        },
      );
      return json({ version });
    }

    const designMatch = /^\/api\/mix-designs\/([^/]+)$/.exec(path);
    if (designMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ design: await designs.get(context, decodeURIComponent(designMatch[1] ?? '')) });
    }

    if (designMatch && (method === 'PATCH' || method === 'PUT')) {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const design = await designs.updateDesign(context, decodeURIComponent(designMatch[1] ?? ''), {
        ...(payload.code === undefined ? {} : { code: str(payload.code) }),
        ...(payload.nameAr === undefined ? {} : { nameAr: str(payload.nameAr) }),
        ...(payload.nameEn === undefined ? {} : { nameEn: str(payload.nameEn) }),
        ...(payload.plantId === undefined ? {} : { plantId: str(payload.plantId) }),
      });
      return json({ design });
    }

    if (designMatch && method === 'DELETE') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      await designs.remove(context, decodeURIComponent(designMatch[1] ?? ''));
      return json({ deleted: true });
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE mix designs] unhandled error', error);
    return fail(500, 'internal_error');
  }
};
