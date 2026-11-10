import { TEST_ADMIN_PASSWORD } from '../helpers/credentials';
/**
 * M2 — mix design API over HTTP: level guards, lifecycle, rule refusals, override.
 *
 * The service tests prove the repository; this file proves the route wiring — reads from
 * level 1, draft writes at level 4, approval and supersede at level 5 — and that the rules
 * card the UI reads still reports the missing reference honestly.
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
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run mix design API tests.';

if (SKIP_REASON) console.warn(`[M2 mix design API tests skipped] ${SKIP_REASON}`);

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
const fixtureCode = `test.m2_http.${tag}`;

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
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }),
  );
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Json };
};

describeDb('mix design API', () => {
  let app: App;
  let admin: Db;
  let viewerToken = '';
  let managerToken = '';
  let adminToken = '';
  let designId = '';
  let plantId = '';

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
    await migrate(admin);
    const plants = await admin.unsafe<{ id: string }>(
      `select id from plants where company_id = 'CMP-0001' and deleted_at is null order by id limit 1`,
    );
    plantId = plants[0]?.id ?? '';
    app = await createApp(ENV, SETTINGS);
    viewerToken = await login(app, 'viewer');
    managerToken = await login(app, 'manager');
    adminToken = await login(app, 'admin');
  });

  afterAll(async () => {
    await app?.db?.close();
    await admin?.close();
  });

  dbTest('the catalogue answers level 1 with plant options and refuses anonymous readers', async () => {
    const anonymous = await call(app, 'GET', '/api/mix-designs', '');
    expect(anonymous.status).toBe(401);

    const response = await call(app, 'GET', '/api/mix-designs', viewerToken);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.designs)).toBe(true);
    const plants = response.body.plants as Array<{ id: string }>;
    expect(plants.length).toBeGreaterThan(0);
    expect(plants.some((plant) => plant.id === plantId)).toBe(true);
  });

  dbTest('a level-1 reader cannot create and a level-4 manager can', async () => {
    const refused = await call(app, 'POST', '/api/mix-designs', viewerToken, {
      plantId,
      code: `test.m2_http.viewer.${tag}`,
      nameAr: 'خلط',
      nameEn: 'Mix',
      strengthClass: 'C35/45',
      components: [{ materialId: 'MAT-001', role: 'cement', qtyPerM3: 350, unit: 'kg', moistureBasis: '' }],
      strengthTests: [{ ageDays: 28, targetMinMpa: 30, sourceNote: 'client specification rev 1' }],
    });
    expect(refused.status).toBe(403);

    const created = await call(app, 'POST', '/api/mix-designs', managerToken, {
      plantId,
      code: fixtureCode,
      nameAr: 'خلط الاختبار',
      nameEn: 'Test mix',
      strengthClass: 'C35/45',
      components: [{ materialId: 'MAT-001', role: 'cement', qtyPerM3: 350, unit: 'kg', moistureBasis: '' }],
      strengthTests: [{ ageDays: 28, targetMinMpa: 30, sourceNote: 'client specification rev 1' }],
    });
    expect(created.status).toBe(201);
    const design = created.body.design as { id: string; current_status: string };
    designId = design.id;
    expect(design.current_status).toBe('draft');
  });

  dbTest('a duplicate code answers with the mandatory_failure classification', async () => {
    const response = await call(app, 'POST', '/api/mix-designs', managerToken, {
      plantId,
      code: fixtureCode,
      nameAr: 'خلط',
      nameEn: 'Mix',
      strengthClass: 'C35/45',
      components: [],
      strengthTests: [],
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('mandatory_failure');
    expect(response.body.check).toBe('code_unique');
  });

  dbTest('a level-4 manager submits but cannot approve; level 5 approves', async () => {
    const submitted = await call(
      app,
      'POST',
      `/api/mix-designs/${designId}/versions/1/submit`,
      managerToken,
    );
    expect(submitted.status).toBe(200);
    expect((submitted.body.version as { status: string }).status).toBe('submitted');

    const refusedApprove = await call(
      app,
      'POST',
      `/api/mix-designs/${designId}/versions/1/approve`,
      managerToken,
    );
    expect(refusedApprove.status).toBe(403);

    const approved = await call(app, 'POST', `/api/mix-designs/${designId}/versions/1/approve`, adminToken);
    expect(approved.status).toBe(200);
    expect((approved.body.version as { status: string }).status).toBe('approved');
  });

  dbTest('editing the approved version over HTTP answers mandatory_failure', async () => {
    const response = await call(app, 'PATCH', `/api/mix-designs/${designId}/versions/1`, managerToken, {
      components: [{ materialId: 'MAT-002', role: 'sand', qtyPerM3: 700, unit: 'kg', moistureBasis: '' }],
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('mandatory_failure');
    expect(response.body.check).toBe('version_editable');
  });

  dbTest('supersede needs a reason, then records the override', async () => {
    const noReason = await call(
      app,
      'POST',
      `/api/mix-designs/${designId}/versions/1/supersede`,
      adminToken,
      { reason: '' },
    );
    expect(noReason.status).toBe(422);
    expect(noReason.body.error).toBe('validation_error');
    expect(noReason.body.field).toBe('reason');

    const superseded = await call(
      app,
      'POST',
      `/api/mix-designs/${designId}/versions/1/supersede`,
      adminToken,
      { reason: 'client changed the specification in writing' },
    );
    expect(superseded.status).toBe(200);
    const override = superseded.body.override as { actor: string; decision: string; ruleCode: string };
    expect(override.actor).toBe('admin');
    expect(override.decision).toBe('approved');
    expect(override.ruleCode).toBe('mix.approved_version_edit');
    expect((superseded.body.version as { version_no: number; status: string }).version_no).toBe(2);
    expect((superseded.body.version as { status: string }).status).toBe('draft');
  });

  dbTest('the detail carries the rule checks and the mix rules still state the missing reference', async () => {
    const detail = await call(app, 'GET', `/api/mix-designs/${designId}`, viewerToken);
    expect(detail.status).toBe(200);
    const design = detail.body.design as { checks: Array<{ key: string; outcome: string }>; versions: unknown[] };
    expect(design.versions.length).toBe(2);
    expect(design.checks.some((check) => check.key === 'version_editable')).toBe(true);

    // The rule catalogue itself is a level-2 read (R1), so a level-1 viewer gets 403 here.
    const rules = await call(app, 'GET', '/api/rules?module=mix_design', managerToken);
    expect(rules.status).toBe(200);
    expect(rules.body.missingReference).toBe(MISSING_REFERENCE);
    const catalogue = rules.body.rules as Array<{ code: string; configured: boolean; value_display: string }>;
    const seeded = catalogue.find((rule) => rule.code === 'mix.cementitious_min');
    expect(seeded?.configured).toBe(false);
    expect(seeded?.value_display).toBe(MISSING_REFERENCE);
    expect(catalogue.some((rule) => rule.code === 'mix.approved_version_edit')).toBe(true);
  });
});
