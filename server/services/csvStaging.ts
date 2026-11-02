/**
 * B2 CSV staging service.
 *
 * Lifecycle: stage (upload) → preview → reject → edit → commit. A commit re-validates the
 * stored payload, writes the target rows inside one tenant transaction, and records an
 * audit event for the upload and for every committed row. Invalid rows never reach a
 * business table: they are reported instead (spec §7, §48).
 *
 * Every statement runs inside db.withTenant() (RLS) and also carries an explicit
 * company_id predicate plus plant narrowing, so the tenant scope does not depend on RLS
 * alone.
 */
import { csvEscape } from '../csv';
import type { Db, Executor, TenantContext } from '../db/client';
import { M1Error, type Actor } from './m1';

export interface CsvContext {
  tenant: TenantContext;
  actor: Actor;
}

export const CSV_TARGETS = ['customers'] as const;
export type CsvTarget = (typeof CSV_TARGETS)[number];
export type CsvStatus = 'pending' | 'rejected' | 'committed';

export const CSV_COLUMNS = [
  'customer_id',
  'name_ar',
  'name_en',
  'tax_id',
  'phone',
  'email',
  'address',
  'priority_tier',
  'credit_limit_egp',
  'credit_days',
  'status',
  'plant_id',
] as const;

export type CsvRow = Record<string, string>;

export interface CsvIssue {
  row: number;
  column: string;
  code: string;
  message_ar: string;
  message_en: string;
  value: string;
}

export interface CsvUpload {
  staging_id: string;
  status: CsvStatus;
  target: CsvTarget;
  plant_id: string;
  file_name: string;
  file_hash: string;
  uploaded_at: string;
  row_count: number;
  error_count: number;
  sample_rows: CsvRow[];
  rows: CsvRow[];
  errors: CsvIssue[];
}

export interface CsvCommitSummary {
  staging_id: string;
  target: CsvTarget;
  committed_rows: number;
  skipped_rows: number;
  created_customers: string[];
  audit_events: number;
}

export interface CsvStageInput {
  fileName: string;
  target: CsvTarget;
  fileHash: string;
  plantId: string | null;
  rows: CsvRow[];
}

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** jsonb comes back as an object from Bun SQL on some versions and as text on others. */
const asJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};
const DECIMAL = /^\d{1,12}(\.\d{1,2})?$/;
const INTEGER = /^\d{1,4}$/;
const TIERS = ['A', 'B', 'C'];
const CUSTOMER_STATUSES = ['active', 'suspended', 'archived'];

const uniqueId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const asTarget = (value: string): CsvTarget => {
  if ((CSV_TARGETS as readonly string[]).includes(value)) return value as CsvTarget;
  throw new M1Error('invalid_target', 422, `target must be one of ${CSV_TARGETS.join(', ')}`, {
    target: value,
  });
};

const audit = async (
  tx: Executor,
  context: CsvContext,
  action: string,
  recordId: string,
  details: Record<string, unknown>,
): Promise<void> => {
  await tx.unsafe(
    `insert into audit_log (company_id, plant_id, user_id, username, action, table_name, record_id,
       ip_address, request_id, details)
     values ($1,$2,$3,$4,$5,'csv_staging',$6,$7,$8,$9::jsonb)`,
    [
      context.tenant.companyId,
      context.tenant.plantIds[0] ?? null,
      context.actor.userId,
      context.actor.username,
      action,
      recordId,
      context.actor.ip ?? null,
      context.actor.requestId ?? null,
      JSON.stringify(details),
    ],
  );
};

/** Row-level validation for the customers target. */
export const validateCustomerRows = (rows: CsvRow[], context: CsvContext): CsvIssue[] => {
  const issues: CsvIssue[] = [];
  const seenTaxIds = new Set<string>();

  rows.forEach((record, index) => {
    const line = index + 2; // line 1 is the header row
    const add = (column: string, code: string, messageAr: string, messageEn: string, value: string): void => {
      issues.push({ row: line, column, code, message_ar: messageAr, message_en: messageEn, value });
    };

    const nameAr = (record.name_ar ?? '').trim();
    const nameEn = (record.name_en ?? '').trim();
    if (!nameAr) add('name_ar', 'REQUIRED', 'الاسم العربي مطلوب', 'Arabic name is required', nameAr);
    if (!nameEn) add('name_en', 'REQUIRED', 'الاسم الإنجليزي مطلوب', 'English name is required', nameEn);

    const limit = (record.credit_limit_egp ?? '').trim();
    if (limit && !DECIMAL.test(limit)) {
      add('credit_limit_egp', 'INVALID_DECIMAL', 'حد الائتمان رقم عشري موجب', 'Credit limit must be a positive decimal', limit);
    }

    const days = (record.credit_days ?? '').trim();
    if (days && (!INTEGER.test(days) || Number(days) > 365)) {
      add('credit_days', 'OUT_OF_RANGE', 'أيام الائتمان بين 0 و365', 'Credit days must be between 0 and 365', days);
    }

    const tier = (record.priority_tier ?? '').trim();
    if (tier && !TIERS.includes(tier)) {
      add('priority_tier', 'INVALID_ENUM', 'الفئة A أو B أو C', 'Tier must be A, B or C', tier);
    }

    const status = (record.status ?? '').trim();
    if (status && !CUSTOMER_STATUSES.includes(status)) {
      add('status', 'INVALID_ENUM', 'حالة غير معروفة', 'Unknown status', status);
    }

    const plant = (record.plant_id ?? '').trim();
    if (plant && context.tenant.plantIds.length > 0 && !context.tenant.plantIds.includes(plant)) {
      add('plant_id', 'FORBIDDEN_PLANT', 'المصنع خارج نطاقك', 'Plant is outside your scope', plant);
    }

    const taxId = (record.tax_id ?? '').trim();
    if (taxId && seenTaxIds.has(taxId)) {
      add('tax_id', 'DUPLICATE', 'الرقم الضريبي مكرر في الملف', 'Duplicate tax id in this file', taxId);
    }
    if (taxId) seenTaxIds.add(taxId);
  });

  return issues;
};

const mapUpload = (row: Row): CsvUpload => {
  const payload = asJson<{ fileName?: string; rows?: CsvRow[]; target?: string }>(row.json_payload, {});
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const stored = asJson<CsvIssue[]>(row.error_details, []);
  const errors = Array.isArray(stored) ? stored : [];

  return {
    staging_id: str(row.id),
    status: str(row.status) as CsvStatus,
    target: (payload.target ?? 'customers') as CsvTarget,
    plant_id: str(row.plant_id),
    file_name: payload.fileName ?? '',
    file_hash: str(row.file_hash),
    uploaded_at: str(row.upload_timestamp),
    row_count: rows.length,
    error_count: errors.filter((issue) => issue.code).length,
    sample_rows: rows.slice(0, 5),
    rows,
    errors,
  };
};

export class CsvStagingService {
  constructor(private readonly db: Db) {}

  async stage(context: CsvContext, input: CsvStageInput): Promise<CsvUpload> {
    const target = asTarget(input.target);
    if (input.rows.length === 0) throw new M1Error('no_rows', 422, 'the uploaded file contains no data rows');
    if (input.plantId && context.tenant.plantIds.length > 0 && !context.tenant.plantIds.includes(input.plantId)) {
      throw new M1Error('forbidden_plant', 403, `plant ${input.plantId} is outside the caller's scope`);
    }

    const issues = validateCustomerRows(input.rows, context);
    const id = uniqueId('CSV');

    try {
      await this.db.withTenant(context.tenant, async (tx) => {
        await tx.unsafe(
          `insert into csv_staging (id, company_id, plant_id, file_hash, json_payload, status,
             error_details, created_by)
           values ($1,$2,$3,$4,$5::jsonb,'pending',$6::jsonb,$7)`,
          [
            id,
            context.tenant.companyId,
            input.plantId,
            input.fileHash,
            JSON.stringify({ fileName: input.fileName, target, rows: input.rows }),
            JSON.stringify(issues),
            context.actor.username,
          ],
        );
        await audit(tx, context, 'csv.staged', id, {
          fileName: input.fileName,
          target,
          fileHash: input.fileHash,
          rowCount: input.rows.length,
          errorCount: issues.length,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('duplicate key value')) {
        throw new M1Error('duplicate_upload', 409, 'this exact file is already staged for this company', {
          fileHash: input.fileHash,
        });
      }
      throw error;
    }

    return this.preview(context, id);
  }

  async list(context: CsvContext, limit = 50): Promise<CsvUpload[]> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, plant_id, upload_timestamp, file_hash, json_payload, status, error_details
           from csv_staging
          where company_id = $1
            and ($2::text[] = '{}'::text[] or plant_id = any($2::text[]))
          order by upload_timestamp desc
          limit $3`,
        [context.tenant.companyId, context.tenant.plantIds, limit],
      );
      return rows.map(mapUpload);
    });
  }

  async preview(context: CsvContext, id: string): Promise<CsvUpload> {
    const row = await this.load(context, id);
    return mapUpload(row);
  }

  async reject(context: CsvContext, id: string, reason = ''): Promise<CsvUpload> {
    await this.load(context, id);
    await this.db.withTenant(context.tenant, async (tx) => {
      const updated = await tx.unsafe<{ id: string }>(
        `update csv_staging set status = 'rejected'
          where company_id = $1 and id = $2 and status <> 'committed'
          returning id`,
        [context.tenant.companyId, id],
      );
      if (!updated[0]) throw new M1Error('not_discardable', 409, 'a committed upload cannot be rejected');
      await audit(tx, context, 'csv.rejected', id, { reason });
    });
    return this.preview(context, id);
  }

  /** Replaces the staged rows and re-validates them; the status returns to pending. */
  async editRows(context: CsvContext, id: string, rows: CsvRow[]): Promise<CsvUpload> {
    const current = await this.load(context, id);
    if (str(current.status) === 'committed') {
      throw new M1Error('already_committed', 409, 'a committed upload cannot be edited');
    }
    const payload = asJson<{ fileName?: string; target?: string; rows?: CsvRow[] }>(current.json_payload, {});
    const issues = validateCustomerRows(rows, context);

    await this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `update csv_staging
            set json_payload = $3::jsonb, error_details = $4::jsonb, status = 'pending'
          where company_id = $1 and id = $2 and status <> 'committed'`,
        [
          context.tenant.companyId,
          id,
          JSON.stringify({ fileName: payload.fileName ?? '', target: payload.target ?? 'customers', rows }),
          JSON.stringify(issues),
        ],
      );
      await audit(tx, context, 'csv.edited', id, {
        rowCount: rows.length,
        errorCount: issues.length,
        previousStatus: str(current.status),
      });
    });

    return this.preview(context, id);
  }

  async commit(context: CsvContext, id: string): Promise<CsvCommitSummary> {
    const upload = await this.preview(context, id);
    if (upload.status === 'committed') {
      throw new M1Error('already_committed', 409, `upload ${id} was already committed`);
    }

    const issues = validateCustomerRows(upload.rows, context);
    if (issues.length > 0) {
      await this.db.withTenant(context.tenant, async (tx) => {
        await tx.unsafe(
          `update csv_staging set status = 'rejected', error_details = $3::jsonb
            where company_id = $1 and id = $2 and status <> 'committed'`,
          [context.tenant.companyId, id, JSON.stringify(issues)],
        );
        await audit(tx, context, 'csv.rejected', id, { reason: 'validation_failed', errorCount: issues.length });
      });
      throw new M1Error('validation_failed', 409, `${issues.length} rows are still invalid`, {
        staging_id: id,
        error_count: issues.length,
        errors: issues.slice(0, 20),
      });
    }

    const created: string[] = [];
    let skipped = 0;
    let auditEvents = 0;

    await this.db.withTenant(context.tenant, async (tx) => {
      for (const record of upload.rows) {
        const customerId = uniqueId('CUS');
        const limit = (record.credit_limit_egp ?? '').trim();
        const inserted = await tx.unsafe<{ id: string }>(
          `insert into customers (id, company_id, plant_id, name_ar, name_en, tax_id, phone, email,
             address, priority_tier, credit_days, status, data_source, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'import',$13,$13)
           on conflict (id) do nothing
           returning id`,
          [
            customerId,
            context.tenant.companyId,
            (record.plant_id ?? '').trim() || upload.plant_id || null,
            (record.name_ar ?? '').trim(),
            (record.name_en ?? '').trim(),
            (record.tax_id ?? '').trim(),
            (record.phone ?? '').trim(),
            (record.email ?? '').trim(),
            (record.address ?? '').trim(),
            TIERS.includes((record.priority_tier ?? '').trim()) ? (record.priority_tier ?? '').trim() : 'A',
            Number((record.credit_days ?? '').trim() || 0),
            CUSTOMER_STATUSES.includes((record.status ?? '').trim()) ? (record.status ?? '').trim() : 'active',
            context.actor.username,
          ],
        );
        const createdId = inserted[0]?.id;
        if (!createdId) {
          skipped += 1;
          continue;
        }
        created.push(createdId);

        if (limit) {
          await tx.unsafe(
            `insert into customer_credit_limits (id, company_id, customer_id, credit_limit, effective_from, created_by)
             values ($1,$2,$3,$4::numeric,current_date,$5)`,
            [uniqueId('CCL'), context.tenant.companyId, createdId, limit, context.actor.username],
          );
        }

        if (auditEvents < 50) {
          await audit(tx, context, 'csv.row_committed', id, { customerId: createdId, row: created.length });
          auditEvents += 1;
        }
      }

      await audit(tx, context, 'csv.committed', id, {
        committedRows: created.length,
        skippedRows: skipped,
        customers: created.slice(0, 50),
      });

      const summary: CsvCommitSummary = {
        staging_id: id,
        target: upload.target,
        committed_rows: created.length,
        skipped_rows: skipped,
        created_customers: created,
        audit_events: auditEvents + 1,
      };

      await tx.unsafe(
        `update csv_staging
            set status = 'committed', committed_at = now(), committed_summary = $3::jsonb
          where company_id = $1 and id = $2 and status <> 'committed'`,
        [context.tenant.companyId, id, JSON.stringify(summary)],
      );
    });

    const stored = await this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<{ committed_summary: unknown }>(
        `select committed_summary from csv_staging where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      return asJson<CsvCommitSummary | null>(rows[0]?.committed_summary, null);
    });

    return (
      stored ?? {
        staging_id: id,
        target: upload.target,
        committed_rows: created.length,
        skipped_rows: skipped,
        created_customers: created,
        audit_events: auditEvents,
      }
    );
  }

  /** Bilingual CSV error report for a staged upload. */
  async errorReport(context: CsvContext, id: string): Promise<{ fileName: string; csv: string }> {
    const upload = await this.preview(context, id);
    const lines = [
      ['staging_id', 'file', 'row', 'column', 'code', 'severity', 'message_ar', 'message_en', 'value'].join(','),
    ];
    upload.errors.forEach((issue) => {
      lines.push(
        [
          upload.staging_id,
          upload.file_name,
          String(issue.row),
          issue.column,
          issue.code,
          'error',
          issue.message_ar,
          issue.message_en,
          issue.value,
        ]
          .map((value) => csvEscape(String(value)))
          .join(','),
      );
    });
    return { fileName: `ICONCRETE_csv_errors_${id}.csv`, csv: `\uFEFF${lines.join('\r\n')}\r\n` };
  }

  private async load(context: CsvContext, id: string): Promise<Row> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, plant_id, upload_timestamp, file_hash, json_payload, status, error_details
           from csv_staging
          where company_id = $1 and id = $2
            and ($3::text[] = '{}'::text[] or plant_id = any($3::text[]))`,
        [context.tenant.companyId, id, context.tenant.plantIds],
      );
      const row = rows[0];
      if (!row) throw new M1Error('not_found', 404, `csv upload ${id} was not found in this company`);
      return row;
    });
  }
}
