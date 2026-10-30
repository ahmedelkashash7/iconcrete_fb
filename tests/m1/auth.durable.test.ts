/**
 * Durable authentication, session lifecycle, audit persistence and tenant isolation.
 *
 * These tests drive the real HTTP surface (`createApp`) against a real PostgreSQL
 * server. Nothing is mocked: sessions, lockouts and audit rows are read back from the
 * database, and a second `createApp` instance stands in for a process restart.
 *
 *   DATABASE_URL        owner connection used to inspect/clean the database
 *   ICONCRETE_RLS_URL   restricted role (iconcrete_app) used for RLS negative tests
 *
 * Without DATABASE_URL every test is reported as skipped with the exact reason.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp, type App } from '../../server/index';
import { createDb, type Db } from '../../server/db/client';
import type { StorageSettings } from '../../server/db/mode';
import type { AppEnv } from '../../server/store';
import { BRAND } from '../../src/brand';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? DATABASE_URL;

const SKIP_REASON = DATABASE_URL
  ? null
  : 'No PostgreSQL available: set DATABASE_URL (and ICONCRETE_RLS_URL for the restricted role) to run these tests.';

if (SKIP_REASON) console.warn(`[M1 durable auth tests skipped] ${SKIP_REASON}`);

const dbTest = SKIP_REASON ? test.skip : test;
const describeDb = SKIP_REASON ? describe.skip : describe;

const SETTINGS: StorageSettings = {
  mode: 'postgres',
  environment: 'development',
  databaseUrl: DATABASE_URL,
};

const ENV: AppEnv = {
  environment: 'development',
  adminPassword: 'Demo@2026',
  idleMinutes: 30,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  maxUploadBytes: 2 * 1024 * 1024,
};

const DEMO_COMPANY = BRAND.demoCompany.ar;
const SECOND_COMPANY = 'شركة العزل التجريبية';

const hashToken = (token: string): string =>
  new Bun.CryptoHasher('sha256').update(token).digest('hex');

const login = async (
  app: App,
  company: string,
  username: string,
  password: string,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await app.handle(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company, username, password }),
    }),
  );
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
};

const post = async (app: App, path: string, body: unknown, token?: string) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
};

const get = async (app: App, path: string, token?: string) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
};

describeDb('durable authentication', () => {
  let owner: Db;
  let restricted: Db;

  beforeAll(async () => {
    owner = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
    restricted = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
  });

  afterAll(async () => {
    await owner?.close();
    if (restricted && restricted !== owner) await restricted.close();
  });

  dbTest('login stores only a hashed token and the session survives a restart', async () => {
    const first = await createApp(ENV, SETTINGS);
    const result = await login(first, DEMO_COMPANY, 'admin', 'Demo@2026');
    expect(result.status).toBe(200);

    const token = String(result.body.token ?? '');
    expect(token.startsWith('ic_')).toBe(true);
    expect(token.length).toBeGreaterThan(30);

    const rows = await owner.unsafe<{ id: string; token_hash: string }>(
      `select id, token_hash from sessions
        where user_id = 'USR-0001' and revoked_at is null
        order by created_at desc limit 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toHaveLength(64);
    expect(rows[0]?.token_hash).not.toBe(token);
    expect(rows[0]?.token_hash).toBe(hashToken(token));

    // The raw token is nowhere in the database.
    const raw = await owner.unsafe(`select token_hash from sessions where token_hash = $1`, [token]);
    expect(raw).toHaveLength(0);
    await first.db?.close();

    // Simulated restart: a brand new app instance with a brand new pool.
    const second = await createApp(ENV, SETTINGS);
    const me = await get(second, '/api/auth/me', token);
    expect(me.status).toBe(200);
    expect((me.body.user as { username: string }).username).toBe('admin');
    expect((me.body.user as { company_id: string }).company_id).toBe('CMP-0001');
    await second.db?.close();
  });

  dbTest('logout revokes the durable session and a restart keeps it revoked', async () => {
    const first = await createApp(ENV, SETTINGS);
    const token = String((await login(first, DEMO_COMPANY, 'admin', 'Demo@2026')).body.token ?? '');

    const session = await owner.unsafe<{ id: string }>(
      `select id from sessions where token_hash = $1`,
      [hashToken(token)],
    );
    const sessionId = session[0]?.id ?? '';

    const out = await post(first, '/api/auth/logout', {}, token);
    expect(out.status).toBe(200);
    await first.db?.close();

    const revoked = await owner.unsafe<{ revoked_at: Date | null }>(
      `select revoked_at from sessions where id = $1`,
      [sessionId],
    );
    expect(revoked[0]?.revoked_at).not.toBeNull();

    const second = await createApp(ENV, SETTINGS);
    expect((await get(second, '/api/auth/me', token)).status).toBe(401);
    expect((await get(second, '/api/m1/trial-balance', token)).status).toBe(401);
    await second.db?.close();

    // Durable audit: both events exist and survived the restart.
    const audit = await owner.unsafe<{ action: string }>(
      `select action from audit_log where record_id = $1 order by id`,
      [sessionId],
    );
    const actions = audit.map((row) => row.action);
    expect(actions).toContain('auth.logout');
    expect(actions).toContain('auth.session.revoked');
    expect(actions).toContain('auth.login.success');
  });

  dbTest('expired sessions are rejected server-side and audited', async () => {
    const first = await createApp(ENV, SETTINGS);
    const token = String((await login(first, DEMO_COMPANY, 'admin', 'Demo@2026')).body.token ?? '');
    const session = await owner.unsafe<{ id: string }>(`select id from sessions where token_hash = $1`, [
      hashToken(token),
    ]);
    const sessionId = session[0]?.id ?? '';

    await owner.unsafe(`update sessions set expires_at = now() - interval '1 minute' where id = $1`, [
      sessionId,
    ]);
    await first.db?.close();

    const second = await createApp(ENV, SETTINGS);
    expect((await get(second, '/api/auth/me', token)).status).toBe(401);
    await second.db?.close();

    const audit = await owner.unsafe<{ action: string }>(
      `select action from audit_log where record_id = $1`,
      [sessionId],
    );
    expect(audit.map((row) => row.action)).toContain('auth.session.expired');
  });

  dbTest('missing, malformed and unknown tokens are rejected without leaking', async () => {
    const app = await createApp(ENV, SETTINGS);
    expect((await get(app, '/api/auth/me')).status).toBe(401);
    expect(((await get(app, '/api/auth/me')).body as { error: string }).error).toBe('unauthorized');
    expect((await get(app, '/api/auth/me', 'not-a-real-token')).status).toBe(401);
    expect((await get(app, '/api/auth/me', 'ic_00000000-0000-0000-0000-000000000000')).status).toBe(401);
    expect((await get(app, '/api/dashboard', 'ic_unknown')).status).toBe(401);
    await app.db?.close();
  });

  dbTest('failed logins persist, lock the account and are audited across a restart', async () => {
    const userId = 'USR-SEC-TEST';
    await owner.unsafe(`delete from sessions where user_id = $1`, [userId]);
    await owner.transaction(async (tx) => {
      await tx.unsafe(`select set_config('app.audit_purge', 'on', true)`);
      await tx.unsafe(`delete from audit_log where user_id = $1`, [userId]);
      await tx.unsafe(`delete from user_roles where user_id = $1`, [userId]);
      await tx.unsafe(`delete from users where id = $1`, [userId]);
    });
    await owner.unsafe(
      `insert into users (id, company_id, username, password_hash, full_name_ar, full_name_en,
         role_level, assigned_plant_ids)
       values ($1, 'CMP-0001', 'sec_test', $2, 'اختبار أمني', 'Security test', 4, '{PLT-0001}')`,
      [userId, await Bun.password.hash('Test@2026!', { algorithm: 'argon2id' })],
    );

    const lockedEnv: AppEnv = { ...ENV, maxFailedLogins: 3, lockoutMinutes: 5 };
    const first = await createApp(lockedEnv, SETTINGS);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      statuses.push((await login(first, DEMO_COMPANY, 'sec_test', 'wrong-password')).status);
    }
    expect(statuses).toEqual([401, 401, 423]);
    await first.db?.close();

    const audit = await owner.unsafe<{ action: string; details: Record<string, unknown> }>(
      `select action, details from audit_log where user_id = $1 order by id`,
      [userId],
    );
    const actions = audit.map((row) => row.action);
    expect(actions.filter((action) => action === 'auth.login.failure').length).toBeGreaterThanOrEqual(3);
    expect(actions).toContain('auth.lockout');
    // No password material in any audit row.
    const leak = await owner.unsafe(
      `select details from audit_log where details::text ilike '%Test@2026%' or details::text ilike '%wrong-password%'`,
    );
    expect(leak).toHaveLength(0);

    // Restart: the lock lives in the database, not in the process.
    const second = await createApp(lockedEnv, SETTINGS);
    const locked = await login(second, DEMO_COMPANY, 'sec_test', 'Test@2026!');
    expect(locked.status).toBe(423);
    await second.db?.close();

    await owner.unsafe(`delete from sessions where user_id = $1`, [userId]);
    await owner.transaction(async (tx) => {
      await tx.unsafe(`select set_config('app.audit_purge', 'on', true)`);
      await tx.unsafe(`delete from audit_log where user_id = $1`, [userId]);
      await tx.unsafe(`delete from user_roles where user_id = $1`, [userId]);
      await tx.unsafe(`delete from users where id = $1`, [userId]);
    });
  });

  dbTest('a second company cannot read the demo tenant dataset (API-level isolation)', async () => {
    const app = await createApp(ENV, SETTINGS);
    const second = await login(app, SECOND_COMPANY, 'admin2', 'Demo@2026');
    expect(second.status).toBe(200);
    const token = String(second.body.token ?? '');

    // Read models are database-backed now: the second company reads its own rows instead of
    // the demo dataset. It must still never see the demo tenant's company or its people.
    const customers = await get(app, '/api/customers', token);
    expect(customers.status).toBe(200);
    const rows = (customers.body.customers ?? []) as Array<{ id: string }>;
    expect(rows.every((row) => !row.id.startsWith('CUS-0000'))).toBe(true);

    const dashboard = await get(app, '/api/dashboard', token);
    expect(dashboard.status).toBe(200);
    const dashboardCompany = (dashboard.body as { company?: { name_ar?: string } }).company;
    expect(dashboardCompany?.name_ar).not.toBe('شركة آي كونكريت التجريبية');

    expect((await get(app, '/api/reports/general_balance', token)).status).toBe(200);
    expect((await get(app, '/api/export/customers.xlsx', token)).status).toBe(200);
    // Users are still served by the demo read model, so the guard continues to apply there.
    expect((await get(app, '/api/users', token)).status).toBe(403);
    await app.db?.close();
  });

  dbTest('the API ledger is scoped to the signed-in company', async () => {
    const app = await createApp(ENV, SETTINGS);
    const first = String((await login(app, DEMO_COMPANY, 'admin', 'Demo@2026')).body.token ?? '');
    const second = String((await login(app, SECOND_COMPANY, 'admin2', 'Demo@2026')).body.token ?? '');

    const demoCompany = await get(app, '/api/m1/trial-balance', first);
    const otherCompany = await get(app, '/api/m1/trial-balance', second);
    expect(demoCompany.status).toBe(200);
    expect(otherCompany.status).toBe(200);

    // The seeded isolation company only has its single 114,000 invoice entry.
    expect((otherCompany.body as { creditTotal: number }).creditTotal).toBe(114000);
    expect((demoCompany.body as { creditTotal: number }).creditTotal).toBeGreaterThan(114000);
    await app.db?.close();
  });

  dbTest('audit rows are append-only and hidden without tenant context', async () => {
    const rows = await owner.unsafe<{ id: string; company_id: string }>(
      `select id, company_id from audit_log where company_id = 'CMP-0001' order by id limit 1`,
    );
    const id = rows[0]?.id;
    const companyId = rows[0]?.company_id ?? 'CMP-0001';
    expect(id).toBeDefined();

    // RLS already hides the row from a connection without tenant context.
    const hidden = await restricted.unsafe<{ n: string }>(
      `select count(*)::text as n from audit_log where id = $1`,
      [id],
    );
    expect(hidden[0]?.n).toBe('0');

    // With a valid tenant context the append-only trigger refuses both writes.
    await expect(
      restricted.withTenant({ companyId, plantIds: [] }, (tx) =>
        tx.unsafe(`update audit_log set action = 'tampered' where id = $1`, [id]),
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      restricted.withTenant({ companyId, plantIds: [] }, (tx) =>
        tx.unsafe(`delete from audit_log where id = $1`, [id]),
      ),
    ).rejects.toThrow(/append-only/);

    const after = await owner.unsafe<{ action: string }>(`select action from audit_log where id = $1`, [id]);
    expect(after[0]?.action).not.toBe('tampered');
  });

  dbTest('demo mode keeps sessions in memory and never touches the database', async () => {
    const before = await owner.unsafe<{ n: string }>(`select count(*)::text as n from sessions`);
    const demo = await createApp(ENV, { mode: 'demo', environment: 'development', databaseUrl: null });
    expect(demo.db).toBeNull();

    const health = await get(demo, '/api/health');
    const storage = (health.body as { storage: Record<string, unknown> }).storage;
    expect(storage.mode).toBe('demo');
    expect(storage.durableSessions).toBe(false);
    expect(storage.authAdapter).toBe('memory');

    const result = await login(demo, DEMO_COMPANY, 'admin', 'Demo@2026');
    expect(result.status).toBe(200);
    expect((await get(demo, '/api/auth/me', String(result.body.token))).status).toBe(200);

    const after = await owner.unsafe<{ n: string }>(`select count(*)::text as n from sessions`);
    expect(after[0]?.n).toBe(before[0]?.n ?? '0');
  });
});
