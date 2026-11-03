/**
 * R1 rule API: catalogue, level-5 value change, override decision.
 *
 * The catalogue is readable from level 2 and always states where a value came from; an
 * empty source note is reported as "not specified in the supplied reference" rather than
 * being hidden. Only a level-5 user may set a value, and every change is audited.
 */
import { MISSING_REFERENCE, type LimitComparator, type OverrideDecision } from '../../src/core/rules';
import { M1Error } from '../services/m1';
import { RuleService } from '../services/rules';
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

const parseValue = (raw: unknown): number | null | 'invalid' => {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 'invalid';
};

export const handleRules = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (path !== '/api/rules' && !path.startsWith('/api/rules/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message:
        'Rules need the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres and DATABASE_URL.',
    });
  }

  const rules = new RuleService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/rules' && method === 'GET') {
      const context = await guarded(2);
      if (context instanceof Response) return context;
      const rows = await rules.list(context, {
        module: url.searchParams.get('module') ?? '',
        status: url.searchParams.get('status') ?? '',
      });
      return json({
        rules: rows,
        total: rows.length,
        storage: 'postgres',
        missingReference: MISSING_REFERENCE,
      });
    }

    const overrideMatch = /^\/api\/rules\/([^/]+)\/override$/.exec(path);
    if (overrideMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const override = await rules.override(context, decodeURIComponent(overrideMatch[1] ?? ''), {
        entityType: str(payload.entityType),
        entityId: str(payload.entityId),
        reason: str(payload.reason),
        decision: str(payload.decision) as OverrideDecision,
      });
      return json({ override }, 201);
    }

    const ruleMatch = /^\/api\/rules\/([^/]+)$/.exec(path);
    if (ruleMatch && method === 'GET') {
      const context = await guarded(2);
      if (context instanceof Response) return context;
      return json({ rule: await rules.get(context, decodeURIComponent(ruleMatch[1] ?? '')) });
    }

    if (ruleMatch && (method === 'PUT' || method === 'PATCH')) {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const value = parseValue(payload.value);
      if (value === 'invalid') {
        return fail(422, 'validation_error', { field: 'value', message: 'value must be a number' });
      }
      const rule = await rules.updateValue(context, decodeURIComponent(ruleMatch[1] ?? ''), {
        value,
        unit: str(payload.unit),
        sourceNote: str(payload.sourceNote ?? payload.source_note),
        ...(str(payload.approvedBy) ? { approvedBy: str(payload.approvedBy) } : {}),
      });
      return json({ rule });
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE rules] unhandled error', error);
    return fail(500, 'internal_error');
  }
};

export type RuleComparator = LimitComparator;
