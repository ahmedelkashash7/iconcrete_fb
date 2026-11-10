import { TEST_ADMIN_PASSWORD } from '../helpers/credentials';
/**
 * M11 — dispatch and trips.
 *
 * Pure tests pin the status graph, board grouping and KPI arithmetic. The HTTP block proves
 * the mounted /api/trips and /api/trucks routes, server-generated timestamps, capacity and
 * open-truck refusals, the closed/cancelled order guard, the append-only event trail and
 * tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp, type App } from '../../server/index';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { BRAND } from '../../src/brand';
import type { AppEnv } from '../../server/store';
import type { StorageSettings } from '../../server/db/mode';
import {
  canAdvanceTrip,
  cycleMinutes,
  dispatchKpis,
  groupTrips,
  isWaitFlagged,
  minutesBetween,
  nextTripStatus,
  siteWaitMinutes,
  truckDayKpis,
} from '../../src/core/dispatch';

describe('dispatch core', () => {
  test('the operating lifecycle only moves forward, with cancel available until done', () => {
    expect(nextTripStatus('queued')).toBe('loading');
    expect(nextTripStatus('loading')).toBe('loaded');
    expect(nextTripStatus('loaded')).toBe('traveling');
    expect(nextTripStatus('traveling')).toBe('unloading');
    expect(nextTripStatus('unloading')).toBe('unloaded');
    expect(nextTripStatus('unloaded')).toBe('returned');
    expect(nextTripStatus('returned')).toBeNull();
    expect(canAdvanceTrip('cancelled')).toBe(false);
  });

  test('the four board columns contain every status and nothing is dropped', () => {
    const groups = groupTrips([
      { status: 'queued' },
      { status: 'loading' },
      { status: 'loaded' },
      { status: 'traveling' },
      { status: 'unloading' },
      { status: 'unloaded' },
      { status: 'returned' },
      { status: 'cancelled' },
    ]);
    expect(groups.queued).toHaveLength(3);
    expect(groups.on_road).toHaveLength(1);
    expect(groups.unloading).toHaveLength(2);
    expect(groups.done).toHaveLength(2);
  });

  test('cycle and site wait are whole minutes and the red flag is strictly over 30', () => {
    expect(minutesBetween('2026-11-10T05:00:00Z', '2026-11-10T05:42:30Z')).toBe(42);
    expect(cycleMinutes(null, '2026-11-10T05:42:00Z')).toBeNull();
    expect(siteWaitMinutes('2026-11-10T05:00:00Z', '2026-11-10T05:31:00Z')).toBe(31);
    expect(isWaitFlagged(30)).toBe(false);
    expect(isWaitFlagged(31)).toBe(true);
  });

  test('the board KPIs are reproducible from the same trip rows', () => {
    const kpis = dispatchKpis(
      [
        { status: 'queued', loaded_m3: null },
        { status: 'traveling', loaded_m3: null },
        { status: 'unloaded', loaded_m3: 7.5 },
        { status: 'returned', loaded_m3: 8 },
        { status: 'cancelled', loaded_m3: 99 },
      ],
      3,
    );
    expect(kpis).toEqual({ tripsCount: 4, deliveredM3: 15.5, inProgress: 1, trucksAvailable: 3 });
    const perTruck = truckDayKpis([
      { truck_id: 'T1', status: 'returned', loaded_m3: 8 },
      { truck_id: 'T1', status: 'unloaded', loaded_m3: 7.5 },
      { truck_id: 'T2', status: 'queued', loaded_m3: null },
      { truck_id: null, status: 'queued', loaded_m3: null },
    ]);
    expect(perTruck.get('T1')).toEqual({ trips: 2, m3: 15.5 });
    expect(perTruck.get('T2')).toEqual({ trips: 1, m3: 0 });
  });
});

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run M11 API tests.';

if (SKIP_REASON) console.warn(`[M11 dispatch tests skipped] ${SKIP_REASON}`);

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

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
let counter = 0;
const suffix = (): string => `${tag}-${++counter}`;
const today = new Date().toISOString().slice(0, 10);

interface Json {
  [key: string]: unknown;
}

const call = async (
  app: App,
  method: string,
  path: string,
  token = '',
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

const login = async (app: App, username: string, company: string): Promise<string> => {
  const response = await call(app, 'POST', '/api/auth/login', '', {
    company,
    username,
    password: TEST_ADMIN_PASSWORD,
  });
  expect(response.status).toBe(200);
  return String(response.body.token ?? '');
};

describeDb('dispatch API', () => {
  let app: App;
  let admin: Db;
  let adminToken = '';
  let dispatcherToken = '';
  let customerId = '';
  let otherCompanyToken = '';

  const createOrder = async (status = 'draft'): Promise<string> => {
    const response = await call(app, 'POST', '/api/orders', adminToken, {
      customerId,
      projectId: null,
      orderNo: `M11-${suffix()}`,
      concreteGrade: 'C35/45',
      quantityM3: '20',
      unitPrice: '1000',
      plantId: 'PLT-0001',
      deliveryDate: today,
      pourWindowStart: '05:00',
      pourWindowEnd: '10:00',
      notes: 'M11 API fixture',
    });
    expect(response.status).toBe(201);
    const order = response.body.order as { id: string };
    if (status === 'closed' || status === 'cancelled') {
      // The order state machine has no draft→closed shortcut; place the fixture in the
      // terminal state directly, exactly as the business would after acceptance.
      await admin.unsafe(`update orders set status = $1 where company_id = 'CMP-0001' and id = $2`, [
        status,
        order.id,
      ]);
    } else if (status !== 'draft') {
      const transitioned = await call(app, 'POST', `/api/orders/${encodeURIComponent(order.id)}/transition`, adminToken, {
        to: status,
      });
      expect(transitioned.status).toBe(200);
    }
    return order.id;
  };

  const createTruck = async (capacity = 12): Promise<{ id: string; plateNo: string }> => {
    const plateNo = `M11-${suffix()}`;
    const response = await call(app, 'POST', '/api/trucks', adminToken, {
      plantId: 'PLT-0001',
      plateNo,
      capacityM3: capacity,
      odometerKm: 1000,
    });
    expect(response.status).toBe(201);
    return { id: String((response.body.truck as Json).id), plateNo };
  };

  const createTrip = async (
    orderId: string,
    truckId: string,
    targetM3 = 8,
  ): Promise<{ status: number; body: Json }> =>
    call(app, 'POST', '/api/trips', dispatcherToken, {
      orderId,
      truckId,
      driverName: 'M11 Driver',
      targetM3,
      plantId: 'PLT-0001',
    });

  const advance = async (tripId: string, loadedM3?: number): Promise<Json> => {
    const response = await call(
      app,
      'POST',
      `/api/trips/${encodeURIComponent(tripId)}/advance`,
      dispatcherToken,
      loadedM3 === undefined ? {} : { loadedM3 },
    );
    expect(response.status).toBe(200);
    return response.body.trip as Json;
  };

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
    await migrate(admin);
    const customers = await admin.unsafe<{ id: string }>(
      `select id from customers where company_id = 'CMP-0001' and deleted_at is null order by id limit 1`,
    );
    customerId = customers[0]?.id ?? '';
    expect(customerId).not.toBe('');
    app = await createApp(ENV, SETTINGS);
    adminToken = await login(app, 'admin', BRAND.demoCompany.en);
    dispatcherToken = await login(app, 'dispatcher', BRAND.demoCompany.en);
    otherCompanyToken = await login(app, 'admin2', 'IConcrete Isolation Demo Company');
    expect(dispatcherToken).not.toBe('');
    expect(otherCompanyToken).not.toBe('');
  });

  afterAll(async () => {
    await app?.db?.close();
    await admin?.close();
  });

  dbTest('the happy path records server timestamps and every status event', async () => {
    const orderId = await createOrder('confirmed');
    const truck = await createTruck(12);
    const created = await createTrip(orderId, truck.id, 8);
    expect(created.status).toBe(201);
    const trip = created.body.trip as Json;
    const tripId = String(trip.id);
    expect(trip.status).toBe('queued');
    expect(trip.departure_time).toBeNull();
    expect(trip.arrive_site_time).toBeNull();

    const loading = await advance(tripId);
    expect(loading.status).toBe('loading');
    expect(loading.departure_time).toBeNull();

    const loaded = await advance(tripId, 7.5);
    expect(loaded.status).toBe('loaded');
    expect(loaded.loaded_m3).toBe(7.5);

    const traveling = await advance(tripId);
    expect(traveling.status).toBe('traveling');
    expect(traveling.departure_time).not.toBeNull();

    const unloading = await advance(tripId);
    expect(unloading.status).toBe('unloading');
    expect(unloading.arrive_site_time).not.toBeNull();

    const unloaded = await advance(tripId);
    expect(unloaded.status).toBe('unloaded');
    expect(unloaded.finish_unload_time).not.toBeNull();
    expect(unloaded.wait_min_at_site).toBeGreaterThanOrEqual(0);

    const returned = await advance(tripId);
    expect(returned.status).toBe('returned');
    expect(returned.return_time).not.toBeNull();
    expect(returned.cycle_minutes).not.toBeNull();
    expect(Number(returned.cycle_minutes)).toBeGreaterThanOrEqual(0);

    const events = await call(app, 'GET', `/api/trips/${encodeURIComponent(tripId)}/events`, dispatcherToken);
    expect(events.status).toBe(200);
    const eventRows = events.body.events as Array<{ event: string; actor: string }>;
    expect(eventRows.map((row) => row.event)).toEqual([
      'queued',
      'loading',
      'loaded',
      'traveling',
      'unloading',
      'unloaded',
      'returned',
    ]);
    expect(eventRows.every((row) => row.actor === 'dispatcher')).toBe(true);

    const board = await call(app, 'GET', '/api/trips', dispatcherToken);
    expect(board.status).toBe(200);
    const kpis = board.body.kpis as { deliveredM3: number; tripsCount: number };
    expect(kpis.deliveredM3).toBeGreaterThanOrEqual(7.5);
    expect(kpis.tripsCount).toBeGreaterThanOrEqual(1);
    const boardTrips = board.body.trips as Array<{ id: string; group: string }>;
    expect(boardTrips.find((row) => row.id === tripId)?.group).toBe('done');
    const trucks = board.body.trucks as Array<{ id: string; status: string }>;
    expect(trucks.find((row) => row.id === truck.id)?.status).toBe('available');
  });

  dbTest('a load above the truck capacity is refused and the trip stays loaded=false', async () => {
    const orderId = await createOrder('confirmed');
    const truck = await createTruck(12);
    const created = await createTrip(orderId, truck.id, 10);
    const tripId = String((created.body.trip as Json).id);
    await advance(tripId);
    const refused = await call(
      app,
      'POST',
      `/api/trips/${encodeURIComponent(tripId)}/advance`,
      dispatcherToken,
      { loadedM3: 12.5 },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('capacity_exceeded');
    expect(refused.body.capacityM3).toBe(12);

    const read = await call(app, 'GET', `/api/trips/${encodeURIComponent(tripId)}`, dispatcherToken);
    expect((read.body.trip as Json).status).toBe('loading');
    expect((read.body.trip as Json).loaded_m3).toBeNull();
  });

  dbTest('a truck already on an open trip is refused by the API', async () => {
    const orderId = await createOrder('confirmed');
    const secondOrderId = await createOrder('confirmed');
    const truck = await createTruck();
    const first = await createTrip(orderId, truck.id, 8);
    expect(first.status).toBe(201);
    const refused = await createTrip(secondOrderId, truck.id, 8);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('truck_busy');
    expect(refused.body.check).toBe('openTrip');
  });

  dbTest('closed and cancelled orders are refused before a trip is created', async () => {
    const closed = await createOrder('closed');
    const truck = await createTruck();
    const closedResponse = await createTrip(closed, truck.id, 8);
    expect(closedResponse.status).toBe(422);
    expect(closedResponse.body.error).toBe('order_closed');

    const cancelled = await createOrder('cancelled');
    const cancelledResponse = await createTrip(cancelled, truck.id, 8);
    expect(cancelledResponse.status).toBe(422);
    expect(cancelledResponse.body.error).toBe('order_closed');
  });

  dbTest('a duplicate plate is refused by the truck endpoint', async () => {
    const truck = await createTruck();
    const response = await call(app, 'POST', '/api/trucks', adminToken, {
      plantId: 'PLT-0001',
      plateNo: truck.plateNo,
      capacityM3: 10,
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('duplicate_plate');
  });

  dbTest('a site wait over 30 minutes is flagged and measured from server timestamps', async () => {
    const orderId = await createOrder('confirmed');
    const truck = await createTruck();
    const created = await createTrip(orderId, truck.id, 6);
    const tripId = String((created.body.trip as Json).id);
    await advance(tripId);
    await advance(tripId, 6);
    await advance(tripId);
    await advance(tripId);
    await admin.unsafe(
      `update trips set arrive_site_time = now() - interval '45 minutes'
        where company_id = 'CMP-0001' and id = $1`,
      [tripId],
    );
    const unloaded = await advance(tripId);
    expect(unloaded.status).toBe('unloaded');
    expect(Number(unloaded.wait_min_at_site)).toBeGreaterThanOrEqual(44);
    expect(unloaded.wait_flagged).toBe(true);
  });

  dbTest('another company cannot read the trip or its events', async () => {
    const orderId = await createOrder('confirmed');
    const truck = await createTruck();
    const created = await createTrip(orderId, truck.id, 4);
    const tripId = String((created.body.trip as Json).id);

    const foreignTrip = await call(app, 'GET', `/api/trips/${encodeURIComponent(tripId)}`, otherCompanyToken);
    expect(foreignTrip.status).toBe(404);
    const foreignEvents = await call(app, 'GET', `/api/trips/${encodeURIComponent(tripId)}/events`, otherCompanyToken);
    expect(foreignEvents.status).toBe(404);
    const foreignBoard = await call(app, 'GET', '/api/trips', otherCompanyToken);
    expect(foreignBoard.status).toBe(200);
    expect((foreignBoard.body.trips as Array<{ id: string }>).some((row) => row.id === tripId)).toBe(false);
  });
});
