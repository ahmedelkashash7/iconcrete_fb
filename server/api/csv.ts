/**
 * B2 CSV API: upload → preview → reject/edit → commit → error report.
 *
 * Every route is level 4 (plant manager) and writes only through the durable adapter.
 * Files are parsed once; the parsed payload and its validation result live in csv_staging
 * until an explicit commit moves rows into the target table.
 */
import { parseCsv } from '../csv';
import { M1Error } from '../services/m1';
import {
  CsvStagingService,
  CSV_COLUMNS,
  CSV_TARGETS,
  type CsvRow,
  type CsvTarget,
} from '../services/csvStaging';
import { contextFor, type B1Deps } from './b1';
import type { RoleLevel } from '../../src/types';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  json({ error: code, ...extra }, status);

const CSV_ALIASES: Record<string, string> = {
  customer_id: 'customer_id',
  name_ar: 'name_ar',
  name_en: 'name_en',
  tax_id: 'tax_id',
  phone: 'phone',
  email: 'email',
  address: 'address',
  priority_tier: 'priority_tier',
  credit_limit_egp: 'credit_limit_egp',
  credit_days: 'credit_days',
  status: 'status',
  plant_id: 'plant_id',
};

const canonicalHeader = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s|-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const toRows = (headers: string[], raw: string[][]): { rows: CsvRow[]; unknownHeaders: string[] } => {
  const mapped = headers.map((header) => CSV_ALIASES[canonicalHeader(header)] ?? '');
  const unknownHeaders = headers.filter((_, index) => !mapped[index]).map((header) => header.trim());
  const rows = raw.map((values) => {
    const record: CsvRow = {};
    mapped.forEach((key, index) => {
      if (key) record[key] = (values[index] ?? '').trim();
    });
    return record;
  });
  return { rows, unknownHeaders };
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export const handleCsv = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (path !== '/api/csv' && !path.startsWith('/api/csv/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'CSV staging needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres and DATABASE_URL.',
    });
  }

  const service = new CsvStagingService(deps.db);

  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/csv/upload' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;

      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) return fail(400, 'file_required');
      if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'file_too_large');
      if (!file.name.toLowerCase().endsWith('.csv')) return fail(415, 'unsupported_type');

      const target = str(form?.get('target') || 'customers');
      if (!(CSV_TARGETS as readonly string[]).includes(target)) return fail(422, 'invalid_target');
      const plantId = str(form?.get('plantId')) || null;

      const parsed = parseCsv(await file.text());
      if (parsed.rows.length === 0) return fail(422, 'no_rows');
      const { rows, unknownHeaders } = toRows(parsed.headers, parsed.rows);
      const recognised = Object.keys(rows[0] ?? {}).length;
      if (recognised === 0) {
        return fail(422, 'invalid_headers', { unknownHeaders, expected: [...CSV_COLUMNS] });
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileHash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      const staged = await service.stage(context, {
        fileName: file.name,
        target: target as CsvTarget,
        fileHash,
        plantId,
        rows,
      });
      return json({ ...staged, unknown_headers: unknownHeaders }, 201);
    }

    if (path === '/api/csv/staging' && method === 'GET') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const uploads = await service.list(context);
      return json({ uploads, total: uploads.length });
    }

    const stagingMatch = /^\/api\/csv\/staging\/([^/]+)$/.exec(path);
    if (stagingMatch && method === 'GET') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      return json(await service.preview(context, stagingMatch[1] ?? ''));
    }

    if (stagingMatch && (method === 'PUT' || method === 'PATCH')) {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = (await request.json().catch(() => ({}))) as { rows?: unknown };
      if (!Array.isArray(payload.rows)) return fail(400, 'rows_required');
      const rows: CsvRow[] = payload.rows.map((entry) => {
        const record: CsvRow = {};
        if (entry && typeof entry === 'object') {
          for (const key of CSV_COLUMNS) {
            const value = (entry as Record<string, unknown>)[key];
            record[key] = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
          }
        }
        return record;
      });
      return json(await service.editRows(context, stagingMatch[1] ?? '', rows));
    }

    const rejectMatch = /^\/api\/csv\/staging\/([^/]+)\/reject$/.exec(path);
    if (rejectMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = (await request.json().catch(() => ({}))) as { reason?: unknown };
      return json(await service.reject(context, rejectMatch[1] ?? '', str(payload.reason)));
    }

    const auditMatch = /^\/api\/csv\/staging\/([^/]+)\/audit$/.exec(path);
    if (auditMatch && method === 'GET') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const entries = await deps.db.withTenant(context.tenant, async (tx) =>
        tx.unsafe(`select id, action, table_name, record_id, username, created_at, details
                     from audit_log
                    where company_id = $1 and record_id = $2
                    order by created_at desc
                    limit 50`, [context.tenant.companyId, auditMatch[1] ?? '']),
      );
      return json({ entries, total: entries.length });
    }

    const commitMatch = /^\/api\/csv\/commit\/([^/]+)$/.exec(path);
    if (commitMatch && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const summary = await service.commit(context, commitMatch[1] ?? '');
      return json({ commit_summary: summary });
    }

    const errorsMatch = /^\/api\/csv\/errors\/([^/]+?)(\.csv)?$/.exec(path);
    if (errorsMatch && method === 'GET') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const report = await service.errorReport(context, errorsMatch[1] ?? '');
      return new Response(report.csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${report.fileName}"`,
          'cache-control': 'no-store',
        },
      });
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE CSV] unhandled error', error);
    return fail(500, 'internal_error');
  }
};
