import { TEST_ADMIN_PASSWORD } from '../helpers/credentials';
/**
 * G2 closure — the HTTP read path (dashboard + reports + customers) is database-backed.
 *
 * These tests drive the real HTTP surface (`createApp`) in postgres mode. A fixture customer
 * and invoice are written straight into tenant tables, so a demo-backed read path cannot see
 * them: if the endpoint still served the in-memory dataset, both assertions below would fail.
 *
 * RLS itself is proved separately in `dataset.readmodel.test.ts` with the restricted role;
 * here the point is that `/api/dashboard`, `/api/reports/*` and `/api/customers` read the
 * database and stay tenant-scoped.
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
  : 'No PostgreSQL available: set DATABASE_URL (and ICONCRETE_RLS_URL for the restricted role) to run read-model HTTP tests.';

if (SKIP_REASON) console.warn(`[G2 read-model HTTP tests skipped] ${SKIP_REASON}`);

const dbTest = SKIP_REASON ? test.skip : test;
const describeDb = SKIP_REASON ? describe.skip : describe;

const SETTINGS: StorageSettings = {
  mode: 'postgres',
  environment: 'development',
  databaseUrl: RLS_URL,
};

const ENV: AppEnv = {
  environment: 'development',
  adminPassword: TEST_ADMIN_PASSWORD,
  idleMinutes: 30,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  maxUploadBytes: 2 * 1024 * 1024,
};

const DEMO_COMPANY = BRAND.demoCompany.ar;
const SECOND_COMPANY = 'شركة العزل التجريبية';

interface Json {
  [key: string]: unknown;
}

const login = async (app: App, company: string, username: string) => {
  const response = await app.handle(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company, username, password: TEST_ADMIN_PASSWORD }),
    }),
  );
  const body = (await response.json().catch(() => ({}))) as Json;
  return { status: response.status, body };
};

const get = async (app: App, path: string, token: string) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }),
  );
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Json };
};

describeDb('database-backed reads over HTTP', () => {
  let app: App;
  let owner: Db;
  let adminToken = '';
  let secondToken = '';
  let baselineOverdue = 0;

  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const fixtureCustomer = `CUS-G2-${tag}`;
  const fixtureInvoice = `INV-G2-${tag}`;
  const fixtureAmount = 1000;

  beforeAll(async () => {
    owner = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
    app = await createApp(ENV, SETTINGS);

    const admin = await login(app, DEMO_COMPANY, 'admin');
    expect(admin.status).toBe(200);
    adminToken = String(admin.body.token ?? '');

    const second = await login(app, SECOND_COMPANY, 'admin2');
    expect(second.status).toBe(200);
    secondToken = String(second.body.token ?? '');

    const baseline = await get(app, '/api/dashboard', adminToken);
    expect(baseline.status).toBe(200);
    baselineOverdue = Number(
      ((baseline.body.kpis as { overdueReceivables?: number } | undefined)?.overdueReceivables ?? NaN),
    );
    expect(Number.isFinite(baselineOverdue)).toBe(true);
  });

  afterAll(async () => {
    await owner?.unsafe(`delete from invoices where id = $1`, [fixtureInvoice]);
    await owner?.unsafe(`delete from customers where id = $1`, [fixtureCustomer]);
    await app?.db?.close();
    await owner?.close();
  });

  dbTest('dashboard declares PostgreSQL as its source in postgres mode', async () => {
    const response = await get(app, '/api/dashboard', adminToken);
    expect(response.status).toBe(200);
    expect(response.body.storageMode).toBe('postgres');
    const source = response.body.dataSource as { adapter?: string; tables?: string } | undefined;
    expect(source?.adapter).toBe('postgres');
    expect(source?.tables).toBe('tenant_rls');
  });

  dbTest('a row written to tenant tables changes the dashboard KPI', async () => {
    const plant = await owner.unsafe<{ id: string }>(
      `select id from plants where company_id = 'CMP-0001' and deleted_at is null order by id limit 1`,
    );
    const plantId = plant[0]?.id;
    expect(typeof plantId).toBe('string');

    await owner.unsafe(
      `insert into customers (id, company_id, plant_id, name_ar, name_en, status, data_source)
       values ($1, 'CMP-0001', $2, 'عميل اختبار G2', 'G2 Fixture Customer', 'active', 'manual')`,
      [fixtureCustomer, plantId],
    );
    await owner.unsafe(
      `insert into invoices
         (id, company_id, plant_id, customer_id, invoice_no, issue_date, due_date,
          subtotal, tax_percent, grand_total, status)
       values ($1, 'CMP-0001', $2, $3, $4, current_date - 40, current_date - 10,
               $5, 0, $5, 'overdue')`,
      [fixtureInvoice, plantId, fixtureCustomer, fixtureInvoice, fixtureAmount],
    );

    const after = await get(app, '/api/dashboard', adminToken);
    expect(after.status).toBe(200);
    const overdue = Number(
      ((after.body.kpis as { overdueReceivables?: number } | undefined)?.overdueReceivables ?? NaN),
    );
    // The invoice was written to PostgreSQL only; a demo-backed read path would not move.
    expect(overdue).toBeCloseTo(baselineOverdue + fixtureAmount, 2);
  });

  dbTest('reports read the new invoice for the tenant', async () => {
    const response = await get(
      app,
      `/api/reports/customer_statement?from=2020-01-01&to=2030-12-31&customerId=${fixtureCustomer}`,
      adminToken,
    );
    expect(response.status).toBe(200);
    const report = response.body.report as
      | { rows?: Array<Record<string, string | number>>; totals?: Record<string, number> }
      | undefined;
    expect(report?.rows?.length).toBe(1);
    const source = response.body.dataSource as { adapter?: string; report?: string } | undefined;
    expect(source?.adapter).toBe('postgres');
    expect(source?.report).toBe('customer_statement');
    expect(Number(report?.totals?.debit ?? 0)).toBe(fixtureAmount);
  });

  dbTest('the customers list counts the tenant table, not the demo array', async () => {
    const counted = await owner.unsafe<{ n: string }>(
      `select count(*)::text as n from customers where company_id = 'CMP-0001' and deleted_at is null`,
    );
    const response = await get(app, '/api/customers', adminToken);
    expect(response.status).toBe(200);
    const body = response.body as {
      customers?: Array<{ id: string }>;
      total?: number;
    };
    expect(body.total).toBe(Number(counted[0]?.n));
    expect(body.customers?.some((row) => row.id === fixtureCustomer)).toBe(true);
  });

  dbTest('a second tenant does not see the fixture', async () => {
    const list = await get(app, '/api/customers', secondToken);
    expect(list.status).toBe(200);
    const rows = (list.body as { customers?: Array<{ id: string }> }).customers ?? [];
    expect(rows.some((row) => row.id === fixtureCustomer)).toBe(false);

    const report = await get(
      app,
      `/api/reports/customer_statement?from=2020-01-01&to=2030-12-31&customerId=${fixtureCustomer}`,
      secondToken,
    );
    expect(report.status).toBe(200);
    const reportRows =
      ((report.body.report as { rows?: unknown[] } | undefined)?.rows ?? []) as unknown[];
    expect(reportRows.length).toBe(0);
  });
});
