/**
 * Durable Excel import staging (gap G1) against a real PostgreSQL server.
 *
 * The application role (iconcrete_app) is used for every repository call so row level
 * security is genuinely exercised; the owner connection is used only for assertions and
 * fixtures that intentionally bypass RLS.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { PgImportRepository } from '../../server/db/importRepo';
import type { ValidationResult } from '../../src/core/validation';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? '';
const SKIP_REASON =
  ADMIN_URL && RLS_URL
    ? null
    : 'PostgreSQL not configured: set DATABASE_URL and ICONCRETE_RLS_URL to run durable import tests.';

if (SKIP_REASON) console.warn(`[durable import tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

let admin: Db;
let app: Db;
let repo: PgImportRepository;
const createdCustomers: string[] = [];

const ctx = (companyId: string) => ({ companyId, plantIds: [], userId: 'USR-0001' });

const resultFor = (customerId: string): ValidationResult => ({
  templateId: 'customers',
  templateVersion: '1.1.0',
  rows: [
    {
      rowNumber: 2,
      values: {
        customer_id: customerId,
        name_ar: 'عميل اختبار',
        name_en: 'Test Customer',
        priority_tier: 'A',
        credit_limit_egp: '100000',
        credit_days: '30',
        status: 'active',
        plant_id: 'PLT-0001',
      },
      issues: [],
    },
  ],
  summary: {
    totalRows: 1,
    validRows: 1,
    errorRows: 0,
    errorCount: 0,
    warningCount: 0,
    duplicateIds: [],
  },
});

const suffix = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describeDb('durable staged imports', () => {
  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    repo = new PgImportRepository(app);
  });

  afterAll(async () => {
    for (const id of createdCustomers) {
      await admin.unsafe(`delete from customer_credit_limits where customer_id = $1`, [id]);
      await admin.unsafe(`delete from customers where id = $1`, [id]);
    }
    await admin?.unsafe(
      `delete from import_records where staged_id in (select id from staged_imports where file_name like 'durable-%')`,
    );
    await admin?.unsafe(`delete from staged_imports where file_name like 'durable-%'`);
    await app?.close();
    await admin?.close();
  });

  dbTest('persists the validation result so a restart cannot lose it', async () => {
    const tag = suffix();
    const saved = await repo.saveStaged(ctx('CMP-0001'), {
      templateId: 'customers',
      templateVersion: '1.1.0',
      fileName: `durable-${tag}.xlsx`,
      checksum: `sha-${tag}`,
      bytes: 2048,
      result: resultFor(`CUS-${tag.toUpperCase()}`),
    });
    expect(saved.duplicate).toBe(false);

    // A fresh connection proves the row is on disk, not in process memory.
    const second = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    const viewed = await new PgImportRepository(second).getStaged(ctx('CMP-0001'), saved.record.id);
    await second.close();
    expect(viewed?.id).toBe(saved.record.id);
    expect(viewed?.checksum).toBe(`sha-${tag}`);
    expect(viewed?.result.summary.validRows).toBe(1);
    expect(viewed?.committed).toBe(false);
  });

  dbTest('commits rows into import_records and the customer table', async () => {
    const tag = suffix();
    const customerId = `CUS-${tag.toUpperCase()}`;
    createdCustomers.push(customerId);
    const saved = await repo.saveStaged(ctx('CMP-0001'), {
      templateId: 'customers',
      templateVersion: '1.1.0',
      fileName: `durable-${tag}.xlsx`,
      checksum: `sha-${tag}`,
      bytes: 1024,
      result: resultFor(customerId),
    });

    const outcome = await repo.commit(ctx('CMP-0001'), saved.record.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.importedRows).toBe(1);
    expect(outcome.skippedRows).toBe(0);

    const records = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from import_records where staged_id = $1`,
      [saved.record.id],
    );
    expect(records[0]?.n).toBe(1);

    const customers = await admin.unsafe<{ id: string }>(`select id from customers where id = $1`, [customerId]);
    expect(customers).toHaveLength(1);

    const limits = await admin.unsafe<{ credit_limit: string }>(
      `select credit_limit from customer_credit_limits where customer_id = $1`,
      [customerId],
    );
    expect(Number(limits[0]?.credit_limit)).toBe(100000);

    const staged = await repo.getStaged(ctx('CMP-0001'), saved.record.id);
    expect(staged?.committed).toBe(true);
    expect(staged?.importedRows).toBe(1);
  });

  dbTest('refuses a second commit of the same staged upload', async () => {
    const tag = suffix();
    const saved = await repo.saveStaged(ctx('CMP-0001'), {
      templateId: 'fleet',
      templateVersion: '1.1.0',
      fileName: `durable-${tag}.xlsx`,
      checksum: `sha-${tag}`,
      bytes: 512,
      result: {
        ...resultFor('CUS-UNUSED'),
        templateId: 'fleet',
        rows: [
          {
            rowNumber: 2,
            values: { truck_id: `TRK-${tag.toUpperCase()}`, code: 'TRK-X' },
            issues: [],
          },
        ],
      },
    });

    const first = await repo.commit(ctx('CMP-0001'), saved.record.id);
    expect(first.ok).toBe(true);
    const second = await repo.commit(ctx('CMP-0001'), saved.record.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('already_committed');
  });

  dbTest('discards an uncommitted upload and blocks committing it', async () => {
    const tag = suffix();
    const saved = await repo.saveStaged(ctx('CMP-0001'), {
      templateId: 'suppliers',
      templateVersion: '1.1.0',
      fileName: `durable-${tag}.xlsx`,
      checksum: `sha-${tag}`,
      bytes: 256,
      result: { ...resultFor('CUS-UNUSED'), templateId: 'suppliers' },
    });

    expect(await repo.discard(ctx('CMP-0001'), saved.record.id)).toBe(true);
    const viewed = await repo.getStaged(ctx('CMP-0001'), saved.record.id);
    expect(viewed?.discardedAt).not.toBeNull();

    const outcome = await repo.commit(ctx('CMP-0001'), saved.record.id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('discarded');
  });

  dbTest('does not leak a staged upload to another tenant', async () => {
    const tag = suffix();
    const stagedId = `STG-XT-${tag}`;
    await admin.unsafe(
      `insert into staged_imports
         (id, company_id, template_id, template_version, file_name, checksum, byte_size, result)
       values ($1, 'CMP-0002', 'customers', '1.1.0', 'durable-xt.xlsx', $2, 10, $3::jsonb)`,
      [stagedId, `sha-xt-${tag}`, JSON.stringify(resultFor('CUS-XT-ONLY'))],
    );

    expect(await repo.getStaged(ctx('CMP-0001'), stagedId)).toBeNull();
    const foreignCommit = await repo.commit(ctx('CMP-0001'), stagedId);
    expect(foreignCommit.ok).toBe(false);
    if (!foreignCommit.ok) expect(foreignCommit.code).toBe('not_found');

    const own = await repo.getStaged(ctx('CMP-0002'), stagedId);
    expect(own?.id).toBe(stagedId);
  });
});
