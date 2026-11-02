/**
 * Durable Excel import staging (gap G1).
 *
 * The validation result, checksum and lifecycle of an upload live in `staged_imports`;
 * committed rows live in `import_records`. Both are tenant tables under RLS, so a session
 * from another company cannot read or commit somebody else's upload — even if it guesses
 * the staged id.
 */
import type { Db, Executor, TenantContext } from './client';
import type { ValidationResult } from '../../src/core/validation';
import { applyTemplateRow } from './excelCommit';

export interface StagedImportInput {
  id?: string;
  templateId: string;
  templateVersion: string;
  fileName: string;
  checksum: string;
  bytes: number;
  result: ValidationResult;
  plantId?: string | null;
}

export interface StagedImportView {
  id: string;
  templateId: string;
  templateVersion: string;
  fileName: string;
  checksum: string;
  bytes: number;
  createdAt: string;
  createdBy: string;
  result: ValidationResult;
  committed: boolean;
  importedRows: number;
  discardedAt: string | null;
}

export type CommitOutcome =
  | { ok: true; importedRows: number; skippedRows: number; templateId: string; fileName: string }
  | { ok: false; status: number; code: string };

interface StagedRow {
  id: string;
  plant_id: string | null;
  template_id: string;
  template_version: string;
  file_name: string;
  checksum: string;
  byte_size: number;
  created_at: string;
  created_by: string | null;
  result: ValidationResult;
  committed: boolean;
  imported_rows: number;
  discarded_at: string | null;
}

const SELECT_STAGED = `select id, plant_id, template_id, template_version, file_name, checksum,
         byte_size, created_at, created_by, result, committed, imported_rows, discarded_at
    from staged_imports`;

// Bun's PostgreSQL client returns jsonb as text in some configurations; normalise both.
const parseResult = (value: unknown): ValidationResult =>
  typeof value === 'string' ? (JSON.parse(value) as ValidationResult) : (value as ValidationResult);

const view = (row: StagedRow): StagedImportView => ({
  id: row.id,
  templateId: row.template_id,
  templateVersion: row.template_version,
  fileName: row.file_name,
  checksum: row.checksum,
  bytes: row.byte_size,
  createdAt: new Date(row.created_at).toISOString(),
  createdBy: row.created_by ?? '',
  result: parseResult(row.result),
  committed: row.committed,
  importedRows: row.imported_rows,
  discardedAt: row.discarded_at ? new Date(row.discarded_at).toISOString() : null,
});

const insertCustomer = async (
  tx: Executor,
  ctx: TenantContext,
  values: Record<string, string>,
): Promise<void> => {
  const id = values.customer_id ?? '';
  if (!id) return;

  await tx.unsafe(
    `insert into customers
       (id, company_id, plant_id, name_ar, name_en, tax_id, phone, email, address,
        priority_tier, credit_days, status, data_source, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'import',$13)
     on conflict (id) do nothing`,
    [
      id,
      ctx.companyId,
      values.plant_id || null,
      values.name_ar || id,
      values.name_en || values.name_ar || id,
      values.tax_id ?? '',
      values.phone ?? '',
      values.email ?? '',
      values.address ?? '',
      ['A', 'B', 'C'].includes(values.priority_tier ?? '') ? (values.priority_tier as 'A' | 'B' | 'C') : 'A',
      Number(values.credit_days ?? 0),
      ['active', 'suspended', 'archived'].includes(values.status ?? '')
        ? (values.status as 'active' | 'suspended' | 'archived')
        : 'active',
      ctx.userId ?? null,
    ],
  );

  const limit = Number(values.credit_limit_egp ?? 0);
  if (Number.isFinite(limit) && limit >= 0) {
    await tx.unsafe(
      `insert into customer_credit_limits (id, company_id, customer_id, credit_limit, created_by)
       values ($1,$2,$3,$4,$5)
       on conflict (id) do nothing`,
      [`${id}-CL-IMPORT`, ctx.companyId, id, limit, ctx.userId ?? null],
    );
  }
};

export class PgImportRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async saveStaged(
    ctx: TenantContext,
    input: StagedImportInput,
  ): Promise<{ record: StagedImportView; duplicate: boolean }> {
    return this.#db.withTenant(ctx, async (tx) => {
      const id = input.id ?? `STG-${crypto.randomUUID().slice(0, 12)}`;
      const inserted = await tx.unsafe<StagedRow>(
        `insert into staged_imports
           (id, company_id, plant_id, template_id, template_version, file_name, checksum,
            byte_size, result, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         on conflict (company_id, template_id, checksum) do nothing
         returning id, plant_id, template_id, template_version, file_name, checksum,
                   byte_size, created_at, created_by, result, committed, imported_rows, discarded_at`,
        [
          id,
          ctx.companyId,
          input.plantId ?? null,
          input.templateId,
          input.templateVersion,
          input.fileName,
          input.checksum,
          input.bytes,
          JSON.stringify(input.result),
          ctx.userId ?? null,
        ],
      );
      if (inserted[0]) return { record: view(inserted[0]), duplicate: false };

      const existing = await tx.unsafe<StagedRow>(
        `${SELECT_STAGED} where company_id = $1 and template_id = $2 and checksum = $3`,
        [ctx.companyId, input.templateId, input.checksum],
      );
      if (!existing[0]) throw new Error('staged import disappeared after a checksum conflict');
      return { record: view(existing[0]), duplicate: true };
    });
  }

  async getStaged(ctx: TenantContext, id: string): Promise<StagedImportView | null> {
    return this.#db.withTenant(ctx, async (tx) => {
      const rows = await tx.unsafe<StagedRow>(`${SELECT_STAGED} where id = $1`, [id]);
      return rows[0] ? view(rows[0]) : null;
    });
  }

  async listStaged(ctx: TenantContext, limit = 50): Promise<StagedImportView[]> {
    return this.#db.withTenant(ctx, async (tx) => {
      const rows = await tx.unsafe<StagedRow>(
        `${SELECT_STAGED} order by created_at desc limit $1`,
        [limit],
      );
      return rows.map(view);
    });
  }

  async commit(ctx: TenantContext, id: string): Promise<CommitOutcome> {
    return this.#db.withTenant(ctx, async (tx) => {
      const rows = await tx.unsafe<StagedRow>(`${SELECT_STAGED} where id = $1 for update`, [id]);
      const staged = rows[0];
      if (!staged) return { ok: false, status: 404, code: 'not_found' };
      if (staged.discarded_at) return { ok: false, status: 409, code: 'discarded' };
      if (staged.committed) return { ok: false, status: 409, code: 'already_committed' };

      const result = parseResult(staged.result);
      const valid = result.rows.filter(
        (row) => !row.issues.some((issue) => issue.severity === 'error'),
      );
      if (valid.length === 0) return { ok: false, status: 409, code: 'no_valid_rows' };

      for (const row of valid) {
        await tx.unsafe(
          `insert into import_records
             (id, company_id, plant_id, staged_id, template_id, values, imported_by)
           values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
          [
            `IMP-${crypto.randomUUID().slice(0, 12)}`,
            ctx.companyId,
            staged.plant_id,
            staged.id,
            staged.template_id,
            JSON.stringify(row.values),
            ctx.userId ?? null,
          ],
        );
        // Customers keep their dedicated handler (it also writes the credit limit);
        // every other template with a domain table goes through the shared dispatcher.
        if (staged.template_id === 'customers') await insertCustomer(tx, ctx, row.values);
        else await applyTemplateRow(tx, ctx, staged.template_id, row.values);
      }

      await tx.unsafe(`update staged_imports set committed = true, imported_rows = $2 where id = $1`, [
        id,
        valid.length,
      ]);

      return {
        ok: true,
        importedRows: valid.length,
        skippedRows: result.summary.errorRows,
        templateId: staged.template_id,
        fileName: staged.file_name,
      };
    });
  }

  /** Discard closes a staged upload without deleting evidence. Returns false when not found. */
  async discard(ctx: TenantContext, id: string): Promise<boolean> {
    return this.#db.withTenant(ctx, async (tx) => {
      const rows = await tx.unsafe(
        `update staged_imports
            set discarded_at = now(), discarded_by = $2
          where id = $1 and committed = false and discarded_at is null
          returning id`,
        [id, ctx.userId ?? null],
      );
      return rows.length > 0;
    });
  }
}
