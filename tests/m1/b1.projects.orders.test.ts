/**
 * B1 — projects, orders, lifecycle and customer writes (spec §7, §20, §22, §57.6).
 *
 * These are database tests: RLS, plant narrowing and the lifecycle guard are enforced by
 * the schema and the service together, so the in-memory adapter cannot prove them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db, type TenantContext } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { loadDatasetForTenant } from '../../server/db/datasetRepo';
import { CustomerService, ProjectsService, type B1Context } from '../../server/services/projects';
import { M1Error, M1Service } from '../../server/services/m1';
import { ORDER_STATUSES } from '../../src/core/orders';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? '';
const SKIP_REASON =
  ADMIN_URL && RLS_URL
    ? null
    : 'PostgreSQL not configured: set DATABASE_URL and ICONCRETE_RLS_URL to run B1 tests.';

if (SKIP_REASON) console.warn(`[B1 tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

let admin: Db;
let app: Db;
let projects: ProjectsService;
let customers: CustomerService;

const createdOrders: string[] = [];
const createdProjects: string[] = [];
const createdCustomers: string[] = [];

const ctx = (companyId: string, plantIds: string[] = []): B1Context => ({
  tenant: { companyId, plantIds, userId: 'USR-ADMIN', requestId: 'b1-test' } as TenantContext,
  actor: { userId: 'USR-ADMIN', username: 'admin', roleLevel: 5, ip: '127.0.0.1' },
});

const firstPlantIds = async (companyId: string): Promise<string[]> => {
  const rows = await admin.unsafe<{ id: string }>(
    `select id from plants where company_id = $1 and deleted_at is null order by id`,
    [companyId],
  );
  return rows.map((row) => row.id);
};

const seedCustomer = async (companyId: string, plantId: string | null): Promise<string> => {
  const rows = await admin.unsafe<{ id: string }>(
    `select id from customers
      where company_id = $1 and deleted_at is null
        and ($2::text is null or plant_id = $2)
      order by id limit 1`,
    [companyId, plantId],
  );
  const existing = rows[0]?.id;
  if (existing) return existing;

  const id = `CUS-B1-${companyId}-${plantId ?? 'HQ'}`;
  await admin.unsafe(
    `insert into customers (id, company_id, plant_id, name_ar, name_en)
     values ($1,$2,$3,'عميل اختبار','B1 Fixture Customer')
     on conflict (id) do nothing`,
    [id, companyId, plantId],
  );
  createdCustomers.push(id);
  return id;
};

describeDb('B1 projects, orders and customer writes', () => {
  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    projects = new ProjectsService(app);
    customers = new CustomerService(app);
  });

  afterAll(async () => {
    for (const id of createdOrders) await admin?.unsafe(`delete from orders where id = $1`, [id]);
    for (const id of createdProjects) await admin?.unsafe(`delete from projects where id = $1`, [id]);
    for (const id of createdCustomers) {
      await admin?.unsafe(`delete from customer_credit_limits where customer_id = $1`, [id]);
      await admin?.unsafe(`delete from customers where id = $1`, [id]);
    }
    await app?.close();
    await admin?.close();
  });

  dbTest('accepts every valid lifecycle transition, in order', async () => {
    const [plantId] = await firstPlantIds('CMP-0001');
    const customerId = await seedCustomer('CMP-0001', plantId ?? null);
    const order = await projects.createOrder(ctx('CMP-0001'), {
      customerId,
      projectId: null,
      orderNo: `ORD-B1-${Date.now().toString(36)}`,
      concreteGrade: 'C35',
      quantityM3: '12.5',
      unitPrice: '1450.00',
      plantId: plantId ?? null,
      deliveryDate: '2026-11-15',
      pourWindowStart: '06:00',
      pourWindowEnd: '09:30',
    });
    createdOrders.push(order.id);

    expect(order.status).toBe('draft');
    // numeric, never float (spec §7): the repository returns decimal strings.
    expect(order.quantity_m3).toBe('12.500');
    expect(order.unit_price).toBe('1450.00');
    expect(order.total_value).toBe('18125.00');

    let current = order;
    for (const next of ORDER_STATUSES.slice(1)) {
      current = await projects.transitionOrder(ctx('CMP-0001'), order.id, next);
      expect(current.status).toBe(next);
    }

    const audits = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from audit_log
        where table_name = 'orders' and record_id = $1 and action = 'order.transitioned'`,
      [order.id],
    );
    expect(audits[0]?.n).toBe(ORDER_STATUSES.length - 1);
  });

  dbTest('rejects an invalid lifecycle transition instead of coercing it', async () => {
    const [plantId] = await firstPlantIds('CMP-0001');
    const customerId = await seedCustomer('CMP-0001', plantId ?? null);
    const order = await projects.createOrder(ctx('CMP-0001'), {
      customerId,
      projectId: null,
      orderNo: `ORD-B1-BAD-${Date.now().toString(36)}`,
      concreteGrade: 'C25',
      quantityM3: '3',
      unitPrice: '1300',
      plantId: plantId ?? null,
    });
    createdOrders.push(order.id);

    let caught: unknown = null;
    try {
      await projects.transitionOrder(ctx('CMP-0001'), order.id, 'delivered');
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof M1Error).toBe(true);
    expect((caught as M1Error).code).toBe('invalid_transition');
    expect((caught as M1Error).details?.allowed).toEqual(['confirmed']);

    const reloaded = await projects.getOrder(ctx('CMP-0001'), order.id);
    expect(reloaded.status).toBe('draft');
  });

  dbTest("keeps company A's projects and orders invisible to company B", async () => {
    const [plantId] = await firstPlantIds('CMP-0001');
    const customerId = await seedCustomer('CMP-0001', plantId ?? null);
    const project = await projects.createProject(ctx('CMP-0001'), {
      customerId,
      code: `PRJ-B1-${Date.now().toString(36)}`,
      nameAr: 'مشروع اختبار',
      nameEn: 'B1 Isolation Project',
      siteLocation: 'Cairo',
      plantId: plantId ?? null,
    });
    createdProjects.push(project.id);

    const otherPlant = (await firstPlantIds('CMP-0002'))[0] ?? null;
    const otherCustomer = await seedCustomer('CMP-0002', otherPlant);

    const visibleToOne = await projects.listProjects(ctx('CMP-0001'));
    expect(visibleToOne.some((row) => row.id === project.id)).toBe(true);

    const visibleToTwo = await projects.listProjects(ctx('CMP-0002'));
    expect(visibleToTwo.some((row) => row.id === project.id)).toBe(false);

    let caught: unknown = null;
    try {
      await projects.getProject(ctx('CMP-0002'), project.id);
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof M1Error).toBe(true);
    expect((caught as M1Error).status).toBe(404);

    const order = await projects.createOrder(ctx('CMP-0001'), {
      customerId: otherCustomer === '' ? customerId : customerId,
      projectId: project.id,
      orderNo: `ORD-B1-ISO-${Date.now().toString(36)}`,
      concreteGrade: 'C30',
      quantityM3: '9',
      unitPrice: '1500',
      plantId: plantId ?? null,
    });
    createdOrders.push(order.id);

    const ordersTwo = await projects.listOrders(ctx('CMP-0002'));
    expect(ordersTwo.some((row) => row.id === order.id)).toBe(false);
  });

  dbTest("does not expose another plant's orders to a plant-scoped caller", async () => {
    const plantIds = await firstPlantIds('CMP-0001');
    expect(plantIds.length).toBeGreaterThan(1);
    const [plantOne, plantTwo] = plantIds as [string, string];

    const customerOne = await seedCustomer('CMP-0001', plantOne);
    const customerTwo = await seedCustomer('CMP-0001', plantTwo);

    const first = await projects.createOrder(ctx('CMP-0001'), {
      customerId: customerOne,
      projectId: null,
      orderNo: `ORD-B1-P1-${Date.now().toString(36)}`,
      concreteGrade: 'C40',
      quantityM3: '6',
      unitPrice: '1600',
      plantId: plantOne,
    });
    const second = await projects.createOrder(ctx('CMP-0001'), {
      customerId: customerTwo,
      projectId: null,
      orderNo: `ORD-B1-P2-${Date.now().toString(36)}`,
      concreteGrade: 'C40',
      quantityM3: '6',
      unitPrice: '1600',
      plantId: plantTwo,
    });
    createdOrders.push(first.id, second.id);

    const companyWide = await projects.listOrders(ctx('CMP-0001'));
    expect(companyWide.some((row) => row.id === first.id)).toBe(true);
    expect(companyWide.some((row) => row.id === second.id)).toBe(true);

    const scoped = await projects.listOrders(ctx('CMP-0001', [plantTwo]));
    expect(scoped.some((row) => row.id === first.id)).toBe(false);
    expect(scoped.some((row) => row.id === second.id)).toBe(true);
    expect(scoped.every((row) => row.plant_id === plantTwo)).toBe(true);

    let caught: unknown = null;
    try {
      await projects.getOrder(ctx('CMP-0001', [plantTwo]), first.id);
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof M1Error).toBe(true);
    expect((caught as M1Error).status).toBe(404);
  });

  dbTest('customer create and edit reach the list, the detail and the statement', async () => {
    const name = `B1 Renamed Customer ${Date.now().toString(36)}`;
    const created = await customers.createCustomer(ctx('CMP-0001'), {
      nameAr: 'عميل بي1',
      nameEn: 'B1 Created Customer',
      phone: '+201000000123',
      creditLimitEgp: '250000.00',
    });
    createdCustomers.push(created.id);

    // list
    const list = await loadDatasetForTenant(app, { companyId: 'CMP-0001', plantIds: [] });
    expect(list.customers.some((row) => row.id === created.id)).toBe(true);

    // detail
    const detail = list.customers.find((row) => row.id === created.id);
    expect(detail?.name_en).toBe('B1 Created Customer');
    expect(detail?.credit_limit_egp).toBe(250000);

    // statement
    const statement = await new M1Service(app).customerStatement(
      ctx('CMP-0001'),
      created.id,
      {},
    );
    expect(JSON.stringify(statement)).toContain(created.id);

    await customers.updateCustomer(ctx('CMP-0001'), created.id, {
      nameEn: name,
      creditLimitEgp: '300000.00',
    });

    const after = await loadDatasetForTenant(app, { companyId: 'CMP-0001', plantIds: [] });
    const edited = after.customers.find((row) => row.id === created.id);
    expect(edited?.name_en).toBe(name);
    expect(edited?.credit_limit_egp).toBe(300000);

    const statementAfter = await new M1Service(app).customerStatement(
      ctx('CMP-0001'),
      created.id,
      {},
    );
    expect(JSON.stringify(statementAfter)).toContain(name);
  });
});
