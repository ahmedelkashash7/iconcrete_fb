import { TEST_ADMIN_PASSWORD } from '../helpers/credentials';
/**
 * R1 — rule API over HTTP: catalogue, level guard, audited value change, override.
 *
 * The service tests prove the repository; this file proves the route wiring and that the
 * catalogue the UI will read states the reference honestly when no value exists.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp, type App } from '../../server/index';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { MISSING_REFERENCE } from '../../src/core/rules';
import { BRAND } from '../../src/brand';
import type { AppEnv } from '../../server/store';
import type { StorageSettings } from '../../server/db/mode';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run rule API tests.';

if (SKIP_REASON) console.warn(`[R1 rule API tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const SETTINGS: StorageSettings = { mode: 'postgres', environment: 'development', databaseUrl: RLS_URL };
const ENV: AppEnv = {
  environment: 'development',
  adminPassword: TEST_ADMIN_PASSWORD,
  idleMinutes: 30,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  maxUploadBytes: 2 * 1024 * 1024,
};

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fixtureCode = `test.r1_http.${tag}`;
const fixtureId = `RUL-HTTP-${tag.toUpperCase()}`;

interface Json {
  [key: string]: unknown;
}

const login = async (app: App, username: string): Promise<string> => {
  const response = await app.handle(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company: BRAND.demoCompany.ar,
        username,
        password: TEST_ADMIN_PASSWORD,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as Json;
  return String(body.token ?? '');
};

const call = async (
  app: App,
  method: string,
  path: string,
  token: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: Json }> => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }),
  );
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Json };
};

describeDb('rule API', () => {
  let app: App;
  let admin: Db;
  let adminToken = '';
  let managerToken = '';

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
    await migrate(admin);
    await admin.withTenant({ companyId: 'CMP-0001', plantIds: [] }, async (tx) => {
      await tx.unsafe(
        `insert into rule_definitions (id, company_id, code, module, classification, unit)
         values ($1, 'CMP-0001', $2, 'batching', 'warning', '%')`,
        [fixtureId, fixtureCode],
      );
    });
    app = await createApp(ENV, SETTINGS);
    adminToken = await login(app, 'admin');
    managerToken = await login(app, 'manager');
  });

  afterAll(async () => {
    await app?.db?.close();
    await admin?.close();
  });

  dbTest('the catalogue names a missing reference instead of showing a blank limit', async () => {
    const response = await call(app, 'GET', '/api/rules', adminToken);
    expect(response.status).toBe(200);
    const rules = response.body.rules as Array<{ code: string; value_display: string; configured: boolean }>;
    expect(rules.length).toBeGreaterThanOrEqual(10);
    expect(response.body.missingReference).toBe(MISSING_REFERENCE);

    const seeded = rules.find((rule) => rule.code === 'batch.water_ratio_max');
    expect(seeded?.configured).toBe(false);
    expect(seeded?.value_display).toBe(MISSING_REFERENCE);
  });

  dbTest('level 4 cannot change a rule value', async () => {
    const response = await call(app, 'PUT', `/api/rules/${fixtureCode}`, managerToken, {
      value: 1,
      unit: '%',
      sourceNote: 'manager attempt',
    });
    expect(response.status).toBe(403);

    const stored = await admin.unsafe<{ value: string | null }>(
      `select value::text as value from rule_definitions where id = $1`,
      [fixtureId],
    );
    expect(stored[0]?.value).toBeNull();
  });

  dbTest('level 5 changes a value and the change is audited', async () => {
    const response = await call(app, 'PUT', `/api/rules/${fixtureCode}`, adminToken, {
      value: 0.5,
      unit: 'ratio',
      sourceNote: 'client specification rev 1',
    });
    expect(response.status).toBe(200);
    const rule = response.body.rule as { value: number; configured: boolean; approved_by: string };
    expect(rule.value).toBe(0.5);
    expect(rule.configured).toBe(true);
    expect(rule.approved_by).toBe('admin');

    const audits = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from audit_log
        where action = 'rule.value_changed' and record_id = $1`,
      [fixtureId],
    );
    expect(audits[0]?.n).toBe(1);
  });

  dbTest('an override needs a reason and records the actor when it has one', async () => {
    const refused = await call(app, 'POST', `/api/rules/${fixtureCode}/override`, adminToken, {
      entityType: 'batch',
      entityId: 'BAT-HTTP-1',
      reason: ' ',
      decision: 'approved',
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('validation_error');

    const accepted = await call(app, 'POST', `/api/rules/${fixtureCode}/override`, adminToken, {
      entityType: 'batch',
      entityId: 'BAT-HTTP-1',
      reason: 'client engineer approved the delay in writing',
      decision: 'approved',
    });
    expect(accepted.status).toBe(201);
    const override = accepted.body.override as {
      actor: string;
      decision: string;
      ruleCode: string;
    };
    expect(override.actor).toBe('admin');
    expect(override.decision).toBe('approved');
    expect(override.ruleCode).toBe(fixtureCode);
  });
});
