/**
 * M5 — fleet and dispatch.
 *
 * The pure block pins the classifications and lifecycles. The database block proves what only
 * PostgreSQL and the repository can: a truck in maintenance blocks dispatch and leaves the
 * assignment proposed, the partial unique index refuses a second open trip, an expired licence
 * is refused until renewal, over-capacity fails while the soft limit warns with the reason
 * recorded, a volume difference needs an approved override with all five evidence fields,
 * cancelling releases the truck and aborts the trip in one call, retired trucks never dispatch,
 * and RLS keeps tenants apart.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { FleetService } from '../../server/services/fleet';
import type { B1Context } from '../../server/services/projects';
import {
  canAssignmentTransition,
  canTripTransition,
  canTruckTransition,
  checkCapacity,
  checkGpsCorrection,
  checkLicenceValid,
  checkOpenTrip,
  checkPlantScope,
  checkSiteWait,
  checkTruckServiceable,
  checkVolumeBand,
} from '../../src/core/fleet';

const ctx = (companyId: string, roleLevel = 5): B1Context => ({
  tenant: { companyId, plantIds: [], userId: 'USR-M5', requestId: 'm5-test' },
  actor: { userId: 'USR-M5', username: 'admin', roleLevel, ip: '127.0.0.1', requestId: 'm5-test' },
});

describe('fleet core', () => {
  test('lifecycles only allow the documented transitions', () => {
    expect(canTruckTransition('available', 'assigned')).toBe(true);
    expect(canTruckTransition('assigned', 'en_route')).toBe(true);
    expect(canTruckTransition('maintenance', 'available')).toBe(true);
    expect(canTruckTransition('retired', 'available')).toBe(false);
    expect(canAssignmentTransition('proposed', 'confirmed')).toBe(true);
    expect(canAssignmentTransition('confirmed', 'dispatched')).toBe(true);
    expect(canAssignmentTransition('closed', 'cancelled')).toBe(false);
    expect(canTripTransition('planned', 'departed')).toBe(true);
    expect(canTripTransition('returned', 'aborted')).toBe(false);
  });

  test('capacity is a hard failure and a plant crossing is refused', () => {
    expect(checkCapacity(12, 12).outcome).toBe('pass');
    expect(checkCapacity(12, 12.1).outcome).toBe('failure');
    expect(checkCapacity(12, 12.1).classification).toBe('mandatory_failure');
    expect(checkPlantScope('PLT-1', 'PLT-2').outcome).toBe('failure');
    expect(checkPlantScope('PLT-1', 'PLT-1', null).outcome).toBe('pass');
  });

  test('maintenance and retired trucks are never serviceable', () => {
    expect(checkTruckServiceable('available').outcome).toBe('pass');
    expect(checkTruckServiceable('maintenance').outcome).toBe('failure');
    const retired = checkTruckServiceable('retired');
    expect(retired.outcome).toBe('failure');
    expect(retired.reasonKey).toBe('fleet.truck_retired');
  });

  test('licence validity has no grace default', () => {
    const now = new Date('2026-11-03T08:00:00Z');
    const lapsed = new Date('2026-11-01T08:00:00Z');
    const valid = new Date('2027-01-01T08:00:00Z');
    expect(checkLicenceValid(valid, now, null).outcome).toBe('pass');
    expect(checkLicenceValid(lapsed, now, null).outcome).toBe('failure');
    expect(checkLicenceValid(lapsed, now, 0).outcome).toBe('failure');
    expect(checkLicenceValid(lapsed, now, 30).outcome).toBe('pass');
    expect(checkLicenceValid(null, now, 30).outcome).toBe('failure');
  });

  test('one open trip, and warnings rather than silent passes', () => {
    expect(checkOpenTrip(0).outcome).toBe('pass');
    expect(checkOpenTrip(1).classification).toBe('mandatory_failure');
    expect(checkSiteWait(null, 30).outcome).toBe('approval_required');
    expect(checkGpsCorrection('mock', '').outcome).toBe('pass');
    expect(checkGpsCorrection('manual', '').outcome).toBe('override_required');
    expect(checkGpsCorrection('manual', 'corrected after tunnel loss').outcome).toBe('pass');
  });

  test('an unconfigured volume band never passes', () => {
    expect(checkVolumeBand(null, 10, 9.9).outcome).toBe('approval_required');
    expect(checkVolumeBand(null, 0, 9.9).outcome).toBe('approval_required');
  });
});

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run fleet tests.';

if (SKIP_REASON) console.warn(`[M5 fleet tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const expectM1 = async (run: () => Promise<unknown>, code: string, status?: number): Promise<M1Error> => {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(M1Error);
  const m1 = caught as M1Error;
  expect(m1.code).toBe(code);
  if (status !== undefined) expect(m1.status).toBe(status);
  return m1;
};

describeDb('fleet repository', () => {
  let admin: Db;
  let app: Db;
  let fleet: FleetService;
  let plantId = '';
  let otherPlantId = '';

  const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
  const day = 86_400_000;

  const newTruck = async (overrides: Record<string, unknown> = {}) =>
    fleet.createTruck(ctx('CMP-0001', 4), {
      plantId,
      plateNo: `M5-${tag}-${Math.random().toString(36).slice(2, 6)}`,
      capacityM3: 12,
      mixerType: 'drum',
      odometerKm: 120_000,
      ownership: 'owned',
      insuranceExpiresAt: iso(180 * day),
      ...overrides,
    } as never);

  const newDriver = async (overrides: Record<string, unknown> = {}) =>
    fleet.createDriver(ctx('CMP-0001', 4), {
      plantId,
      employeeRef: `EMP-${Math.random().toString(36).slice(2, 6)}`,
      fullName: 'Mahmoud Salem',
      phone: '+201000000000',
      licenceNo: `LIC-${tag}-${Math.random().toString(36).slice(2, 6)}`,
      licenceClass: 'heavy',
      licenceExpiresAt: iso(200 * day),
      ...overrides,
    } as never);

  const newAssignment = async (truckId: string, driverId: string, plant = plantId) =>
    fleet.proposeAssignment(ctx('CMP-0001', 3), {
      plantId: plant,
      orderId: null,
      truckId,
      driverId,
      sequenceNo: 1,
    });

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    fleet = new FleetService(app);

    const plants = await admin.unsafe<{ id: string }>(
      `select id from plants where company_id = 'CMP-0001' and deleted_at is null order by id`,
    );
    plantId = plants[0]?.id ?? '';
    otherPlantId = plants[1]?.id ?? '';
    expect(plantId).not.toBe('');
    expect(otherPlantId).not.toBe('');

    // Configured only for these tests: the band and the soft limit are configuration, never
    // code defaults, and each carries its source note.
    await admin.unsafe(
      `update rule_definitions
          set value = 2, unit = '%', source_note = 'internal dispatch tolerance (test fixture)'
        where company_id = 'CMP-0001' and code = 'fleet.volume_difference_band'`,
    );
    await admin.unsafe(
      `update rule_definitions
          set value = 90, unit = '%', source_note = 'internal soft load limit (test fixture)'
        where company_id = 'CMP-0001' and code = 'fleet.load_soft_limit_pct'`,
    );
  });

  afterAll(async () => {
    await app?.close();
    await admin?.close();
  });

  dbTest('a truck in maintenance is blocked and the assignment stays proposed', async () => {
    const truck = await newTruck();
    const driver = await newDriver();
    const assignment = await newAssignment(truck.id, driver.id);

    const maintenance = await fleet.openMaintenance(ctx('CMP-0001', 4), {
      truckId: truck.id,
      maintenanceType: 'brake service',
      odometerKm: 120_500,
      notes: 'scheduled',
    });
    expect(maintenance.status).toBe('open');

    const blocked = await expectM1(
      () => fleet.dispatchAssignment(ctx('CMP-0001', 3), assignment.id, { loadedVolumeM3: 8, batchId: null }),
      'mandatory_failure',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('truckServiceable');

    const still = await fleet.listAssignments(ctx('CMP-0001'));
    expect(still.find((row) => row.id === assignment.id)?.status).toBe('proposed');

    await fleet.closeMaintenance(ctx('CMP-0001', 4), maintenance.id, { costAmount: 750, odometerKm: 120_510 });
    const trucks = await fleet.listTrucks(ctx('CMP-0001'));
    expect(trucks.find((row) => row.id === truck.id)?.status).toBe('available');
  });

  dbTest('a second open trip is refused by the partial unique index', async () => {
    const truck = await newTruck();
    const driver = await newDriver();
    const assignment = await newAssignment(truck.id, driver.id);

    await admin.unsafe(
      `insert into trips (id, company_id, plant_id, assignment_id, truck_id, status, created_by)
       values ($1, 'CMP-0001', $2, $3, $4, 'planned', 'test')`,
      [`TRP-${tag}-A`, plantId, assignment.id, truck.id],
    );

    let refused = false;
    try {
      await admin.unsafe(
        `insert into trips (id, company_id, plant_id, assignment_id, truck_id, status, created_by)
         values ($1, 'CMP-0001', $2, $3, $4, 'planned', 'test')`,
        [`TRP-${tag}-B`, plantId, assignment.id, truck.id],
      );
    } catch (error) {
      refused = true;
      expect(String(error)).toContain('trips_open_per_truck_idx');
    }
    expect(refused).toBe(true);

    const blocked = await expectM1(
      () => fleet.dispatchAssignment(ctx('CMP-0001', 3), assignment.id, { loadedVolumeM3: 8, batchId: null }),
      'mandatory_failure',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('openTrip');
  });

  dbTest('an expired licence blocks dispatch until renewal, which is audited', async () => {
    const truck = await newTruck();
    const driver = await newDriver({ licenceExpiresAt: iso(-10 * day) });
    const assignment = await newAssignment(truck.id, driver.id);

    const blocked = await expectM1(
      () => fleet.dispatchAssignment(ctx('CMP-0001', 3), assignment.id, { loadedVolumeM3: 9, batchId: null }),
      'mandatory_failure',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('licenceValid');

    const catalogue = await admin.unsafe<{ value: string | null; source_note: string }>(
      `select value::text as value, source_note from rule_definitions
        where company_id = 'CMP-0001' and code = 'fleet.licence_grace_days'`,
    );
    expect(catalogue[0]?.value).toBeNull();
    expect(catalogue[0]?.source_note).toBe('');

    const renewed = await fleet.renewLicence(ctx('CMP-0001', 4), driver.id, iso(365 * day));
    expect(renewed.licence_expires_at).not.toBeNull();
    const audits = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from audit_log
        where action = 'driver.licence_renewed' and record_id = $1`,
      [driver.id],
    );
    expect(audits[0]?.n).toBe(1);

    const dispatched = await fleet.dispatchAssignment(ctx('CMP-0001', 3), assignment.id, {
      loadedVolumeM3: 9,
      batchId: null,
    });
    expect(dispatched.assignment.status).toBe('dispatched');
    expect(dispatched.trip.status).toBe('planned');
  });

  dbTest('over-capacity fails and the soft limit warns with the reason recorded', async () => {
    const truck = await newTruck();
    const driver = await newDriver();
    const heavy = await newAssignment(truck.id, driver.id);

    const blocked = await expectM1(
      () => fleet.dispatchAssignment(ctx('CMP-0001', 3), heavy.id, { loadedVolumeM3: 13, batchId: null }),
      'mandatory_failure',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('capacity');
    const trips = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from trips where company_id = 'CMP-0001' and assignment_id = $1`,
      [heavy.id],
    );
    expect(trips[0]?.n).toBe(0);

    const soft = await newAssignment(truck.id, driver.id);
    const dispatched = await fleet.dispatchAssignment(ctx('CMP-0001', 3), soft.id, {
      loadedVolumeM3: 11.5,
      batchId: null,
    });
    expect(dispatched.assignment.status).toBe('dispatched');

    const audit = await admin.unsafe<{ d: string }>(
      `select details::text as d from audit_log
        where action = 'dispatch.dispatched' and record_id = $1`,
      [soft.id],
    );
    expect(audit[0]?.d).toContain('softLoad');
  });

  dbTest('a volume difference needs approval_required and an override with all five fields', async () => {
    const truck = await newTruck();
    const driver = await newDriver();
    const assignment = await newAssignment(truck.id, driver.id);
    const dispatched = await fleet.dispatchAssignment(ctx('CMP-0001', 3), assignment.id, {
      loadedVolumeM3: 10,
      batchId: null,
    });
    const tripId = dispatched.trip.id;
    await fleet.departTrip(ctx('CMP-0001', 3), tripId);

    const blocked = await expectM1(
      () => fleet.recordDelivery(ctx('CMP-0001', 3), tripId, { deliveredVolumeM3: 8.5, reason: 'site spillage' }),
      'approval_required',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('volumeBand');

    const override = await fleet.addOverride(ctx('CMP-0001', 4), tripId, {
      ruleCode: 'fleet.volume_difference_band',
      reason: 'site rejected 1.5 m3 after a pump failure',
      decision: 'approved',
    });
    expect(override.rule_code).toBe('fleet.volume_difference_band');
    expect(override.id).not.toBe('');
    expect(override.actor).toBe('admin');
    expect(override.reason.length).toBeGreaterThanOrEqual(5);
    expect(override.decision).toBe('approved');
    expect(override.decided_at).not.toBe('');

    const stored = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from dispatch_overrides
        where company_id = 'CMP-0001' and entity_id = $1 and rule_code = 'fleet.volume_difference_band'
          and actor = 'admin' and decision = 'approved' and decided_at is not null
          and char_length(btrim(reason)) >= 5`,
      [tripId],
    );
    expect(stored[0]?.n).toBe(1);

    const delivered = await fleet.recordDelivery(ctx('CMP-0001', 3), tripId, {
      deliveredVolumeM3: 8.5,
      reason: 'site rejected 1.5 m3 after a pump failure',
    });
    expect(delivered.delivered_volume_m3).toBe(8.5);
    expect(delivered.volume_diff_reason).toContain('pump failure');
  });

  dbTest('cancelling releases the truck and aborts the trip in one call', async () => {
    const truck = await newTruck();
    const driver = await newDriver();
    const assignment = await newAssignment(truck.id, driver.id);
    const dispatched = await fleet.dispatchAssignment(ctx('CMP-0001', 3), assignment.id, {
      loadedVolumeM3: 7,
      batchId: null,
    });

    const cancelled = await fleet.cancelAssignment(
      ctx('CMP-0001', 4),
      assignment.id,
      'plant stopped production for the day',
    );
    expect(cancelled.status).toBe('cancelled');

    const trucks = await fleet.listTrucks(ctx('CMP-0001'));
    expect(trucks.find((row) => row.id === truck.id)?.status).toBe('available');
    const trip = await fleet.getTrip(ctx('CMP-0001'), dispatched.trip.id);
    expect(trip.status).toBe('aborted');
    expect(trip.aborted_reason).toContain('production');

    await expectM1(
      () => fleet.cancelAssignment(ctx('CMP-0001', 3), assignment.id, 'again with a reason'),
      'forbidden',
      403,
    );
  });

  dbTest('a retired truck cannot be dispatched', async () => {
    const truck = await newTruck();
    const driver = await newDriver();
    const assignment = await newAssignment(truck.id, driver.id);

    await fleet.retireTruck(ctx('CMP-0001', 5), truck.id);
    const blocked = await expectM1(
      () => fleet.dispatchAssignment(ctx('CMP-0001', 3), assignment.id, { loadedVolumeM3: 6, batchId: null }),
      'mandatory_failure',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('truckServiceable');

    const spare = await newTruck();
    await expectM1(
      () => fleet.retireTruck(ctx('CMP-0001', 4), spare.id),
      'forbidden',
      403,
    );
  });

  dbTest('a cross-plant dispatch is refused', async () => {
    const truck = await newTruck();
    const driver = await newDriver();
    const blocked = await expectM1(
      () => newAssignment(truck.id, driver.id, otherPlantId),
      'mandatory_failure',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('plantScope');
  });

  dbTest('keeps tenants and plants apart: no foreign trucks, drivers or trips', async () => {
    const truck = await newTruck();
    const driver = await newDriver();
    const assignment = await newAssignment(truck.id, driver.id);
    const dispatched = await fleet.dispatchAssignment(ctx('CMP-0001', 3), assignment.id, {
      loadedVolumeM3: 5,
      batchId: null,
    });

    const foreignTrucks = await fleet.listTrucks(ctx('CMP-0002'));
    expect(foreignTrucks.some((row) => row.id === truck.id)).toBe(false);
    const foreignDrivers = await fleet.listDrivers(ctx('CMP-0002'));
    expect(foreignDrivers.some((row) => row.id === driver.id)).toBe(false);
    await expectM1(() => fleet.getTrip(ctx('CMP-0002'), dispatched.trip.id), 'trip_not_found', 404);

    const scoped = await app.withTenant({ companyId: 'CMP-0002', plantIds: [], userId: 'USR-M5' }, (tx) =>
      tx.unsafe<{ n: number }>(`select count(*)::int as n from trips where id = $1`, [dispatched.trip.id]),
    );
    expect(scoped[0]?.n).toBe(0);

    const otherPlant = await fleet.listTrucks(ctx('CMP-0001'), { plantId: otherPlantId });
    expect(otherPlant.every((row) => row.plant_id === otherPlantId)).toBe(true);
    expect(otherPlant.some((row) => row.id === truck.id)).toBe(false);
  });
});
