/**
 * B2 — CSV staging lifecycle and tenant isolation.
 *
 * Upload → preview → reject → edit → commit is enforced by csv_staging and the service,
 * together with RLS, so these are database tests. The in-memory adapter cannot prove them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db, type TenantContext } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { CsvStagingService, type CsvContext, type CsvRow } from '../../server/services/csvStaging';
import { M1Error } from '../../server/services/m1';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? '';
const SKIP_REASON =
  ADMIN_URL && RLS_URL
    ? null
    : 'PostgreSQL not configured: set DATABASE_URL and ICONCRETE_RLS_URL to run CSV staging tests.';

if (SKIP_REASON) console.warn(`[B2 CSV tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

let admin: Db;
let app: Db;
let service: CsvStagingService;

const stagedIds: string[] = [];
const createdCustomers: string[] = [];

const ctx = (companyId: string, plantIds: string[] = []): CsvContext => ({
  tenant: { companyId, plantIds, userId: 'USR-ADMIN', requestId: 'b2-csv-test' } as TenantContext,
  actor: { userId: 'USR-ADMIN', username: 'admin', roleLevel: 5, ip: '127.0.0.1' },
});

const plantIdsFor = async (companyId: string): Promise<string[]> => {
  const rows = await admin.unsafe<{ id: string }>(
    `select id from plants where company_id = $1 and deleted_at is null order by id`,
    [companyId],
  );
  return rows.map((row) => row.id);
};

const badRows = (): CsvRow[] => [
  {
    name_ar: 'شركة بيانات خاطئة',
    name_en: '',
    credit_limit_egp: 'abc',
    credit_days: '900',
    priority_tier: 'Z',
    status: 'weird',
  },
  {
    name_ar: 'شركة سليمة',
    name_en: 'B2 CSV Valid Co',
    credit_limit_egp: '150000.00',
    credit_days: '30',
    priority_tier: 'A',
    status: 'active',
  },
];

const fixedRows = (tag: string): CsvRow[] => [
  {
    name_ar: 'شركة تصحيح',
    name_en: `B2 CSV Fixed ${tag}`,
    credit_limit_egp: '250000.00',
    credit_days: '45',
    priority_tier: 'B',
    status: 'active',
  },
  {
    name_ar: 'شركة تصحيح ثانية',
    name_en: `B2 CSV Fixed Two ${tag}`,
    credit_limit_egp: '90000.00',
    credit_days: '15',
    priority_tier: 'C',
    status: 'active',
  },
];

describeDb('B2 CSV staging lifecycle', () => {
  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    service = new CsvStagingService(app);
  });

  afterAll(async () => {
    for (const id of createdCustomers) {
      await admin?.unsafe(`delete from customer_credit_limits where customer_id = $1`, [id]);
      await admin?.unsafe(`delete from customers where id = $1`, [id]);
    }
    // audit_log is append-only by design; the staging evidence is what the test owns.
    for (const id of stagedIds) {
      await admin?.unsafe(`delete from csv_staging where id = $1`, [id]);
    }
    await app?.close();
    await admin?.close();
  });

  dbTest('upload → preview → reject → edit → commit, with audit events and an error report', async () => {
    const [plantId] = await plantIdsFor('CMP-0001');
    const tag = Date.now().toString(36);
    const hash = `hash-${tag}`;

    const staged = await service.stage(ctx('CMP-0001'), {
      fileName: `customers_${tag}.csv`,
      target: 'customers',
      fileHash: hash,
      plantId: plantId ?? null,
      rows: badRows(),
    });
    stagedIds.push(staged.staging_id);

    expect(staged.status).toBe('pending');
    expect(staged.row_count).toBe(2);
    expect(staged.error_count).toBeGreaterThan(0);
    expect(staged.sample_rows).toHaveLength(2);
    expect(staged.errors.some((issue) => issue.column === 'name_en')).toBe(true);
    expect(staged.errors.some((issue) => issue.column === 'priority_tier')).toBe(true);

    const preview = await service.preview(ctx('CMP-0001'), staged.staging_id);
    expect(preview.row_count).toBe(2);
    expect(preview.error_count).toBe(staged.error_count);

    const report = await service.errorReport(ctx('CMP-0001'), staged.staging_id);
    const reportLines = report.csv.trim().split('\r\n');
    expect(reportLines[0]).toContain('message_ar');
    expect(reportLines.length).toBeGreaterThan(1);
    expect(report.csv).toContain('name_en');

    const rejected = await service.reject(ctx('CMP-0001'), staged.staging_id, 'fixing the file');
    expect(rejected.status).toBe('rejected');

    let commitWhileRejected: unknown = null;
    try {
      await service.commit(ctx('CMP-0001'), staged.staging_id);
    } catch (error) {
      commitWhileRejected = error;
    }
    expect(commitWhileRejected instanceof M1Error).toBe(true);
    expect((commitWhileRejected as M1Error).code).toBe('validation_failed');

    const edited = await service.editRows(ctx('CMP-0001'), staged.staging_id, fixedRows(tag));
    expect(edited.status).toBe('pending');
    expect(edited.error_count).toBe(0);
    expect(edited.row_count).toBe(2);

    const summary = await service.commit(ctx('CMP-0001'), staged.staging_id);
    expect(summary.committed_rows).toBe(2);
    expect(summary.skipped_rows).toBe(0);
    expect(summary.created_customers).toHaveLength(2);
    expect(summary.audit_events).toBeGreaterThanOrEqual(3);
    createdCustomers.push(...summary.created_customers);

    const stored = await admin.unsafe<{ status: string; committed_summary: unknown }>(
      `select status, committed_summary from csv_staging where id = $1`,
      [staged.staging_id],
    );
    const storedSummary = (
      typeof stored[0]?.committed_summary === 'string'
        ? JSON.parse(stored[0].committed_summary as string)
        : stored[0]?.committed_summary
    ) as { committed_rows: number };
    expect(stored[0]?.status).toBe('committed');
    expect(storedSummary.committed_rows).toBe(2);

    const customers = await admin.unsafe<{ id: string; name_en: string; data_source: string }>(
      `select id, name_en, data_source from customers
        where company_id = 'CMP-0001' and name_en like $1 order by name_en`,
      [`B2 CSV Fixed%${tag}%`],
    );
    expect(customers).toHaveLength(2);
    expect(customers.every((row) => row.data_source === 'import')).toBe(true);

    const actions = await admin.unsafe<{ action: string }>(
      `select action from audit_log where record_id = $1 order by created_at`,
      [staged.staging_id],
    );
    const seen = actions.map((row) => row.action);
    expect(seen).toContain('csv.staged');
    expect(seen).toContain('csv.rejected');
    expect(seen).toContain('csv.edited');
    expect(seen).toContain('csv.committed');
    expect(seen).toContain('csv.row_committed');

    let secondCommit: unknown = null;
    try {
      await service.commit(ctx('CMP-0001'), staged.staging_id);
    } catch (error) {
      secondCommit = error;
    }
    expect(secondCommit instanceof M1Error).toBe(true);
    expect((secondCommit as M1Error).code).toBe('already_committed');

    // The same checksum is only reusable once the open attempt is committed.
    const uploadedAgain = await service.stage(ctx('CMP-0001'), {
      fileName: `customers_${tag}_again.csv`,
      target: 'customers',
      fileHash: hash,
      plantId: plantId ?? null,
      rows: badRows(),
    });
    stagedIds.push(uploadedAgain.staging_id);
    expect(uploadedAgain.status).toBe('pending');
  });

  dbTest('refuses a duplicate open checksum instead of staging it twice', async () => {
    const tag = `dup-${Date.now().toString(36)}`;
    const first = await service.stage(ctx('CMP-0001'), {
      fileName: `duplicate_${tag}.csv`,
      target: 'customers',
      fileHash: tag,
      plantId: null,
      rows: fixedRows(tag),
    });
    stagedIds.push(first.staging_id);

    let caught: unknown = null;
    try {
      await service.stage(ctx('CMP-0001'), {
        fileName: `duplicate_${tag}_copy.csv`,
        target: 'customers',
        fileHash: tag,
        plantId: null,
        rows: fixedRows(tag),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof M1Error).toBe(true);
    expect((caught as M1Error).code).toBe('duplicate_upload');
    expect((caught as M1Error).status).toBe(409);
  });

  dbTest("keeps another company's staged upload invisible and uncommittable", async () => {
    const [plantId] = await plantIdsFor('CMP-0001');
    const tag = `iso-${Date.now().toString(36)}`;
    const staged = await service.stage(ctx('CMP-0001'), {
      fileName: `isolation_${tag}.csv`,
      target: 'customers',
      fileHash: tag,
      plantId: plantId ?? null,
      rows: fixedRows(tag),
    });
    stagedIds.push(staged.staging_id);

    const foreignPreview = await service.list(ctx('CMP-0002'));
    expect(foreignPreview.some((upload) => upload.staging_id === staged.staging_id)).toBe(false);

    let caughtPreview: unknown = null;
    try {
      await service.preview(ctx('CMP-0002'), staged.staging_id);
    } catch (error) {
      caughtPreview = error;
    }
    expect(caughtPreview instanceof M1Error).toBe(true);
    expect((caughtPreview as M1Error).status).toBe(404);

    let caughtCommit: unknown = null;
    try {
      await service.commit(ctx('CMP-0002'), staged.staging_id);
    } catch (error) {
      caughtCommit = error;
    }
    expect(caughtCommit instanceof M1Error).toBe(true);
    expect((caughtCommit as M1Error).status).toBe(404);

    // RLS proof: the restricted role sees nothing even without the explicit predicate.
    const visible = await app.withTenant({ companyId: 'CMP-0002', plantIds: [] }, async (tx) =>
      tx.unsafe<{ id: string }>(`select id from csv_staging where id = $1`, [staged.staging_id]),
    );
    expect(visible).toHaveLength(0);

    const stillPending = await admin.unsafe<{ status: string }>(
      `select status from csv_staging where id = $1`,
      [staged.staging_id],
    );
    expect(stillPending[0]?.status).toBe('pending');
  });

  dbTest("hides another plant's staged upload from a plant-scoped caller", async () => {
    const plants = await plantIdsFor('CMP-0001');
    expect(plants.length).toBeGreaterThan(1);
    const [plantOne, plantTwo] = plants as [string, string];

    const tag = `plant-${Date.now().toString(36)}`;
    const staged = await service.stage(ctx('CMP-0001'), {
      fileName: `plant_scope_${tag}.csv`,
      target: 'customers',
      fileHash: tag,
      plantId: plantOne,
      rows: fixedRows(tag),
    });
    stagedIds.push(staged.staging_id);

    const scopedList = await service.list(ctx('CMP-0001', [plantTwo]));
    expect(scopedList.some((upload) => upload.staging_id === staged.staging_id)).toBe(false);

    let caught: unknown = null;
    try {
      await service.preview(ctx('CMP-0001', [plantTwo]), staged.staging_id);
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof M1Error).toBe(true);
    expect((caught as M1Error).status).toBe(404);

    const ownList = await service.list(ctx('CMP-0001', [plantOne]));
    expect(ownList.some((upload) => upload.staging_id === staged.staging_id)).toBe(true);
  });
});
