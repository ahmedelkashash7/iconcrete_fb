/**
 * Database-backed dashboard/report read models (gap G2).
 *
 * Proves that the dataset used by /api/dashboard and /api/reports comes from tenant tables
 * under RLS, and that plant scope and company isolation hold.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { loadDatasetForTenant } from '../../server/db/datasetRepo';
import { computeKpis } from '../../src/core/metrics';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? '';
const SKIP_REASON =
  ADMIN_URL && RLS_URL
    ? null
    : 'PostgreSQL not configured: set DATABASE_URL and ICONCRETE_RLS_URL to run read-model tests.';

if (SKIP_REASON) console.warn(`[dataset read-model tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

let admin: Db;
let app: Db;
const fixtureIds: string[] = [];

describeDb('database-backed read models', () => {
  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
  });

  afterAll(async () => {
    for (const id of fixtureIds) {
      await admin?.unsafe(`delete from customers where id = $1`, [id]);
    }
    await app?.close();
    await admin?.close();
  });

  dbTest('loads the demo tenant from PostgreSQL instead of the in-memory dataset', async () => {
    const dataset = await loadDatasetForTenant(app, { companyId: 'CMP-0001', plantIds: [] });
    expect(dataset.company.id).toBe('CMP-0001');
    expect(dataset.plants.length).toBeGreaterThan(0);
    expect(dataset.customers.length).toBeGreaterThan(0);

    const kpis = computeKpis(dataset);
    expect(Number.isFinite(kpis.creditUtilizationPct)).toBe(true);
    expect(Number.isFinite(kpis.overdueReceivables)).toBe(true);
  });

  dbTest('keeps companies isolated through RLS', async () => {
    const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const id = `CUS-XT-${tag.toUpperCase()}`;
    fixtureIds.push(id);
    await admin.unsafe(
      `insert into customers (id, company_id, name_ar, name_en)
       values ($1, 'CMP-0002', $2, $2)`,
      [id, 'Isolation Fixture'],
    );

    const one = await loadDatasetForTenant(app, { companyId: 'CMP-0001', plantIds: [] });
    const two = await loadDatasetForTenant(app, { companyId: 'CMP-0002', plantIds: [] });

    expect(one.customers.some((customer) => customer.id === id)).toBe(false);
    expect(two.customers.some((customer) => customer.id === id)).toBe(true);
    expect(two.company.id).toBe('CMP-0002');
  });

  dbTest('applies plant scope to the read model', async () => {
    const dataset = await loadDatasetForTenant(app, {
      companyId: 'CMP-0001',
      plantIds: ['PLT-0001'],
    });
    for (const customer of dataset.customers) {
      expect(customer.plant_id === '' || customer.plant_id === 'PLT-0001').toBe(true);
    }
    for (const invoice of dataset.invoices) {
      expect(invoice.plant_id === '' || invoice.plant_id === 'PLT-0001').toBe(true);
    }
  });

  dbTest('refuses a company that does not exist', async () => {
    await expect(
      loadDatasetForTenant(app, { companyId: 'CMP-9999', plantIds: [] }),
    ).rejects.toThrow(/not found or is not visible/);
  });
});
