/**
 * Durable Excel audit read model (gap G2).
 *
 * The eight documented lifecycle events are written through the same SECURITY DEFINER
 * function the API uses, then read back through RLS. The feed must carry the actor,
 * company, request id, checksum/staged id and safe details — never a password or token.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { PgAuthRepository } from '../../server/db/authRepo';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? '';
const SKIP_REASON =
  ADMIN_URL && RLS_URL
    ? null
    : 'PostgreSQL not configured: set DATABASE_URL and ICONCRETE_RLS_URL to run Excel audit tests.';

if (SKIP_REASON) console.warn(`[excel audit tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const ACTIONS = [
  'excel.validation_started',
  'excel.validation_completed',
  'excel.row_rejected',
  'excel.error_report_download',
  'excel.staged_created',
  'excel.staged_discarded',
  'excel.staged_committed',
  'excel.duplicate_rejected',
] as const;

let admin: Db;
let app: Db;
let repo: PgAuthRepository;
const tag = `G2-${Date.now().toString(36)}`;

const ctx = (companyId: string) => ({ companyId, plantIds: [] as string[], userId: 'USR-0001' });

interface AuditRow {
  action: string;
  username: string | null;
  company_id: string;
  record_id: string | null;
  request_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

describeDb('durable Excel audit feed', () => {
  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    repo = new PgAuthRepository(app);

    let index = 0;
    for (const action of ACTIONS) {
      index += 1;
      await repo.audit({
        user_id: 'USR-0001',
        username: 'g2.auditor',
        company_id: 'CMP-0001',
        action,
        table_name: 'excel_imports',
        record_id: `AUD-${tag}-${index}`,
        ip_address: '203.0.113.9',
        request_id: `REQ-${tag}-${index}`,
        details: {
          templateId: 'customers',
          templateVersion: '1.1.0',
          checksum: `sha-${tag}-${index}`,
          stagedId: `STG-${tag}-${index}`,
          fileName: 'g2.xlsx',
          validRows: 3,
          errorRows: 1,
        },
      });
    }
  });

  afterAll(async () => {
    // audit_log is append-only by design; the tagged fixture rows stay as evidence.
    await app?.close();
    await admin?.close();
  });

  dbTest('persists every documented lifecycle event for the tenant', async () => {
    const entries = (await repo.listExcelAudit(ctx('CMP-0001'), 200)) as unknown as AuditRow[];
    const actions = new Set(entries.map((entry) => entry.action));

    for (const action of ACTIONS) expect(actions.has(action)).toBe(true);

    const own = entries.filter((entry) => String(entry.record_id ?? '').startsWith(`AUD-${tag}-`));
    expect(own).toHaveLength(ACTIONS.length);
    expect(own.every((entry) => entry.company_id === 'CMP-0001')).toBe(true);
    expect(own.every((entry) => entry.username === 'g2.auditor')).toBe(true);
    expect(own.every((entry) => String(entry.request_id ?? '').startsWith(`REQ-${tag}`))).toBe(true);
    expect(own.every((entry) => typeof entry.details?.checksum === 'string')).toBe(true);
    expect(Date.parse(own[0]?.created_at ?? '')).toBeGreaterThan(0);
  });

  dbTest('never carries a password or a session token', async () => {
    const entries = await repo.listExcelAudit(ctx('CMP-0001'), 50);
    const serialized = JSON.stringify(entries).toLowerCase();
    expect(serialized.includes('password')).toBe(false);
    expect(serialized.includes('token')).toBe(false);
    expect(serialized.includes('demo@2026')).toBe(false);
    expect(serialized.includes('bearer')).toBe(false);
  });

  dbTest('does not leak the feed to another tenant', async () => {
    const other = (await repo.listExcelAudit(ctx('CMP-0002'), 200)) as unknown as AuditRow[];
    expect(other.filter((entry) => String(entry.record_id ?? '').startsWith(`AUD-${tag}-`))).toHaveLength(0);
  });

  dbTest('survives a restart', async () => {
    const fresh = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    const entries = (await new PgAuthRepository(fresh).listExcelAudit(
      ctx('CMP-0001'),
      200,
    )) as unknown as AuditRow[];
    await fresh.close();
    expect(entries.filter((entry) => String(entry.record_id ?? '').startsWith(`AUD-${tag}-`))).toHaveLength(
      ACTIONS.length,
    );
  });
});
