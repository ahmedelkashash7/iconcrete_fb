/** M5 fleet and dispatch repository. Tenant-scoped; every decision goes through src/core/fleet. */
import {
  canAssignmentTransition,
  canTripTransition,
  canTruckTransition,
  checkCapacity,
  checkDrumAge,
  checkGpsCorrection,
  checkLicenceValid,
  checkOpenTrip,
  checkPlantScope,
  checkSiteWait,
  checkSoftLoad,
  checkTruckServiceable,
  checkVolumeBand,
  FLEET_RULE_CODES,
  type AssignmentStatus,
  type FleetCatalogueKey,
  type TripStatus,
  type TruckStatus,
} from '../../src/core/fleet';
import { isRuleConfigured, MIN_OVERRIDE_REASON, type RuleDefinition } from '../../src/core/rules';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));

const newId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

export interface TruckRow {
  id: string;
  plant_id: string;
  plate_no: string;
  capacity_m3: number;
  mixer_type: string;
  status: TruckStatus;
  odometer_km: number | null;
  ownership: string;
  insurance_expires_at: string | null;
}

export interface DriverRow {
  id: string;
  plant_id: string;
  employee_ref: string | null;
  full_name: string;
  phone: string | null;
  licence_no: string;
  licence_class: string | null;
  licence_expires_at: string | null;
  status: string;
}

export interface AssignmentRow {
  id: string;
  plant_id: string;
  order_id: string | null;
  truck_id: string;
  truck_plate: string;
  driver_id: string;
  driver_name: string;
  sequence_no: number;
  status: AssignmentStatus;
  proposed_at: string;
  confirmed_at: string | null;
  dispatched_at: string | null;
  closed_at: string | null;
  cancelled_reason: string | null;
  trip_id: string | null;
}

export interface TripRow {
  id: string;
  plant_id: string;
  assignment_id: string;
  truck_id: string;
  batch_id: string | null;
  loaded_volume_m3: number | null;
  delivered_volume_m3: number | null;
  departed_at: string | null;
  arrived_at: string | null;
  returned_at: string | null;
  site_wait_minutes: number | null;
  volume_diff_reason: string | null;
  status: TripStatus;
  aborted_reason: string | null;
}

export interface MaintenanceRow {
  id: string;
  plant_id: string;
  truck_id: string;
  truck_plate: string;
  maintenance_type: string;
  opened_at: string;
  closed_at: string | null;
  odometer_km: number | null;
  cost_amount: number | null;
  notes: string;
  status: string;
}

const toTruck = (row: Row): TruckRow => ({
  id: str(row.id),
  plant_id: str(row.plant_id),
  plate_no: str(row.plate_no),
  capacity_m3: num(row.capacity_m3),
  mixer_type: str(row.mixer_type),
  status: str(row.status) as TruckStatus,
  odometer_km: numOrNull(row.odometer_km),
  ownership: str(row.ownership),
  insurance_expires_at: nullable(row.insurance_expires_at),
});

const toDriver = (row: Row): DriverRow => ({
  id: str(row.id),
  plant_id: str(row.plant_id),
  employee_ref: nullable(row.employee_ref),
  full_name: str(row.full_name),
  phone: nullable(row.phone),
  licence_no: str(row.licence_no),
  licence_class: nullable(row.licence_class),
  licence_expires_at: nullable(row.licence_expires_at),
  status: str(row.status),
});

const toTrip = (row: Row): TripRow => ({
  id: str(row.id),
  plant_id: str(row.plant_id),
  assignment_id: str(row.assignment_id),
  truck_id: str(row.truck_id),
  batch_id: nullable(row.batch_id),
  loaded_volume_m3: numOrNull(row.loaded_volume_m3),
  delivered_volume_m3: numOrNull(row.delivered_volume_m3),
  departed_at: nullable(row.departed_at),
  arrived_at: nullable(row.arrived_at),
  returned_at: nullable(row.returned_at),
  site_wait_minutes: numOrNull(row.site_wait_minutes),
  volume_diff_reason: nullable(row.volume_diff_reason),
  status: str(row.status) as TripStatus,
  aborted_reason: nullable(row.aborted_reason),
});

const toMaintenance = (row: Row): MaintenanceRow => ({
  id: str(row.id),
  plant_id: str(row.plant_id),
  truck_id: str(row.truck_id),
  truck_plate: str(row.truck_plate),
  maintenance_type: str(row.maintenance_type),
  opened_at: str(row.opened_at),
  closed_at: nullable(row.closed_at),
  odometer_km: numOrNull(row.odometer_km),
  cost_amount: numOrNull(row.cost_amount),
  notes: str(row.notes),
  status: str(row.status),
});

const ASSIGNMENT_SELECT = `
  select a.id, a.plant_id, a.order_id, a.truck_id, t.plate_no as truck_plate,
         a.driver_id, d.full_name as driver_name, a.sequence_no, a.status, a.proposed_at,
         a.confirmed_at, a.dispatched_at, a.closed_at, a.cancelled_reason,
         (select tr.id from trips tr where tr.company_id = a.company_id
             and tr.assignment_id = a.id order by tr.created_at desc limit 1) as trip_id
    from dispatch_assignments a
    join trucks t on t.id = a.truck_id
    join drivers d on d.id = a.driver_id`;

export class FleetService {
  constructor(private readonly db: Db) {}

  private level = (context: B1Context, min: number, what: string): void => {
    if (context.actor.roleLevel < min) {
      throw new M1Error('forbidden', 403, `only a level-${min} user may ${what}`);
    }
  };

  private rules = async (tx: Executor, companyId: string): Promise<Map<string, RuleDefinition>> => {
    const rows = await tx.unsafe<Row>(
      `select code, classification, value::text as value, unit, source_note, status
         from rule_definitions where company_id = $1 and module = 'fleet'`,
      [companyId],
    );
    const rules = new Map<string, RuleDefinition>();
    for (const row of rows) {
      rules.set(str(row.code), {
        code: str(row.code),
        module: 'fleet',
        classification: str(row.classification) as RuleDefinition['classification'],
        value: numOrNull(row.value),
        unit: str(row.unit),
        sourceNote: str(row.source_note),
        status: str(row.status) === 'retired' ? 'retired' : 'active',
      });
    }
    return rules;
  };

  private ruleFor = (rules: Map<string, RuleDefinition>, key: FleetCatalogueKey): RuleDefinition | null =>
    rules.get(FLEET_RULE_CODES[key]) ?? null;

  listTrucks = async (
    context: B1Context,
    filters: { plantId?: string; status?: string } = {},
  ): Promise<TruckRow[]> => {
    this.level(context, 1, 'read trucks');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select id, plant_id, plate_no, capacity_m3::text as capacity_m3, mixer_type, status,
                odometer_km::text as odometer_km, ownership, insurance_expires_at
           from trucks
          where company_id = $1 and deleted_at is null
            and ($2::text = '' or plant_id = $2)
            and ($3::text = '' or status = $3)
          order by plate_no`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? ''],
      ),
    );
    return rows.map(toTruck);
  };

  createTruck = async (
    context: B1Context,
    payload: {
      plantId: string;
      plateNo: string;
      capacityM3: number;
      mixerType: string;
      odometerKm: number | null;
      ownership: string;
      insuranceExpiresAt: string | null;
    },
  ): Promise<TruckRow> => {
    this.level(context, 4, 'register a truck');
    if (!payload.plateNo.trim()) {
      throw new M1Error('validation_error', 422, 'plateNo is required', { field: 'plateNo' });
    }
    if (!Number.isFinite(payload.capacityM3) || payload.capacityM3 <= 0) {
      throw new M1Error('validation_error', 422, 'capacityM3 must be greater than zero', {
        field: 'capacityM3',
      });
    }
    const id = newId('TRK');
    await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe(
        `insert into trucks (id, company_id, plant_id, plate_no, capacity_m3, mixer_type,
            odometer_km, ownership, insurance_expires_at, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.plateNo.trim(),
          payload.capacityM3,
          payload.mixerType,
          payload.odometerKm,
          payload.ownership,
          payload.insuranceExpiresAt,
          context.actor.username,
        ],
      ),
    );
    const all = await this.listTrucks(context);
    const created = all.find((truck) => truck.id === id);
    if (!created) throw new M1Error('truck_not_found', 404, 'truck could not be read back');
    return created;
  };

  retireTruck = async (context: B1Context, truckId: string): Promise<TruckRow> => {
    this.level(context, 5, 'retire a truck');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, status from trucks where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, truckId],
      );
      const row = rows[0];
      if (!row) throw new M1Error('truck_not_found', 404, `truck ${truckId} does not exist`);
      if (!canTruckTransition(str(row.status) as TruckStatus, 'retired')) {
        throw new M1Error('invalid_transition', 409, `truck ${truckId} is ${row.status}`, {
          from: row.status,
          to: 'retired',
        });
      }
      await tx.unsafe(
        `update trucks set status = 'retired', updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, truckId, context.actor.username],
      );
      await audit(tx, context, 'truck.retired', truckId, {});
      const after = await tx.unsafe<Row>(
        `select id, plant_id, plate_no, capacity_m3::text as capacity_m3, mixer_type, status,
                odometer_km::text as odometer_km, ownership, insurance_expires_at
           from trucks where company_id = $1 and id = $2`,
        [context.tenant.companyId, truckId],
      );
      return toTruck(after[0] ?? {});
    });
  };

  listDrivers = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; licenceExpiredBefore?: string } = {},
  ): Promise<DriverRow[]> => {
    this.level(context, 3, 'read driver records');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select id, plant_id, employee_ref, full_name, phone, licence_no, licence_class,
                licence_expires_at, status
           from drivers
          where company_id = $1 and deleted_at is null
            and ($2::text = '' or plant_id = $2)
            and ($3::text = '' or status = $3)
            and ($4::text = '' or (licence_expires_at is not null and licence_expires_at < $4::timestamptz))
          order by full_name`,
        [
          context.tenant.companyId,
          filters.plantId ?? '',
          filters.status ?? '',
          filters.licenceExpiredBefore ?? '',
        ],
      ),
    );
    return rows.map(toDriver);
  };

  createDriver = async (
    context: B1Context,
    payload: {
      plantId: string;
      employeeRef: string;
      fullName: string;
      phone: string;
      licenceNo: string;
      licenceClass: string;
      licenceExpiresAt: string | null;
    },
  ): Promise<DriverRow> => {
    this.level(context, 4, 'register a driver');
    if (!payload.fullName.trim() || !payload.licenceNo.trim()) {
      throw new M1Error('validation_error', 422, 'fullName and licenceNo are required', {
        field: payload.fullName.trim() ? 'licenceNo' : 'fullName',
      });
    }
    const id = newId('DRV');
    await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe(
        `insert into drivers (id, company_id, plant_id, employee_ref, full_name, phone, licence_no,
            licence_class, licence_expires_at, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.employeeRef,
          payload.fullName.trim(),
          payload.phone,
          payload.licenceNo.trim(),
          payload.licenceClass,
          payload.licenceExpiresAt,
          context.actor.username,
        ],
      ),
    );
    const all = await this.listDrivers(context);
    const created = all.find((driver) => driver.id === id);
    if (!created) throw new M1Error('driver_not_found', 404, 'driver could not be read back');
    return created;
  };

  /** Level 4. Renewal is audited with the before/after expiry. */
  renewLicence = async (context: B1Context, driverId: string, expiresAt: string): Promise<DriverRow> => {
    this.level(context, 4, 'renew a driver licence');
    return this.db.withTenant(context.tenant, async (tx) => {
      const before = await tx.unsafe<Row>(
        `select id, licence_expires_at from drivers where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, driverId],
      );
      if (!before[0]) throw new M1Error('driver_not_found', 404, `driver ${driverId} does not exist`);
      const rows = await tx.unsafe<Row>(
        `update drivers set licence_expires_at = $3, status = 'active', updated_by = $4
          where company_id = $1 and id = $2
          returning id, plant_id, employee_ref, full_name, phone, licence_no, licence_class,
                    licence_expires_at, status`,
        [context.tenant.companyId, driverId, expiresAt, context.actor.username],
      );
      await audit(tx, context, 'driver.licence_renewed', driverId, {
        before: before[0]?.licence_expires_at ?? null,
        after: expiresAt,
      });
      return toDriver(rows[0] ?? {});
    });
  };

  listAssignments = async (
    context: B1Context,
    filters: { plantId?: string; status?: string } = {},
  ): Promise<AssignmentRow[]> => {
    this.level(context, 1, 'read dispatch assignments');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `${ASSIGNMENT_SELECT}
          where a.company_id = $1
            and ($2::text = '' or a.plant_id = $2)
            and ($3::text = '' or a.status = $3)
          order by a.proposed_at desc`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? ''],
      ),
    );
    return rows.map((row) => ({
      id: str(row.id),
      plant_id: str(row.plant_id),
      order_id: nullable(row.order_id),
      truck_id: str(row.truck_id),
      truck_plate: str(row.truck_plate),
      driver_id: str(row.driver_id),
      driver_name: str(row.driver_name),
      sequence_no: num(row.sequence_no),
      status: str(row.status) as AssignmentStatus,
      proposed_at: str(row.proposed_at),
      confirmed_at: nullable(row.confirmed_at),
      dispatched_at: nullable(row.dispatched_at),
      closed_at: nullable(row.closed_at),
      cancelled_reason: nullable(row.cancelled_reason),
      trip_id: nullable(row.trip_id),
    }));
  };

  proposeAssignment = async (
    context: B1Context,
    payload: { plantId: string; orderId: string | null; truckId: string; driverId: string; sequenceNo: number },
  ): Promise<AssignmentRow> => {
    this.level(context, 3, 'propose a dispatch assignment');
    return this.db.withTenant(context.tenant, async (tx) => {
      const truck = await tx.unsafe<Row>(
        `select id, plant_id, status from trucks where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.truckId],
      );
      if (!truck[0]) throw new M1Error('truck_not_found', 404, `truck ${payload.truckId} does not exist`);
      const driver = await tx.unsafe<Row>(
        `select id, plant_id from drivers where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.driverId],
      );
      if (!driver[0]) throw new M1Error('driver_not_found', 404, `driver ${payload.driverId} does not exist`);

      const scope = checkPlantScope(payload.plantId, str(truck[0].plant_id), str(driver[0].plant_id));
      if (scope.outcome !== 'pass') {
        throw new M1Error(scope.classification, 422, 'truck and driver must belong to the plant', {
          check: scope.key,
          classification: scope.classification,
        });
      }

      const id = newId('ASG');
      await tx.unsafe(
        `insert into dispatch_assignments (id, company_id, plant_id, order_id, truck_id, driver_id,
            sequence_no, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.orderId,
          payload.truckId,
          payload.driverId,
          payload.sequenceNo,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'dispatch.proposed', id, {
        truckId: payload.truckId,
        driverId: payload.driverId,
      });
      return this.readAssignment(tx, context, id);
    });
  };

  private readAssignment = async (tx: Executor, context: B1Context, id: string): Promise<AssignmentRow> => {
    const rows = await tx.unsafe<Row>(`${ASSIGNMENT_SELECT} where a.company_id = $1 and a.id = $2`, [
      context.tenant.companyId,
      id,
    ]);
    const row = rows[0];
    if (!row) throw new M1Error('assignment_not_found', 404, `assignment ${id} does not exist`);
    return {
      id: str(row.id),
      plant_id: str(row.plant_id),
      order_id: nullable(row.order_id),
      truck_id: str(row.truck_id),
      truck_plate: str(row.truck_plate),
      driver_id: str(row.driver_id),
      driver_name: str(row.driver_name),
      sequence_no: num(row.sequence_no),
      status: str(row.status) as AssignmentStatus,
      proposed_at: str(row.proposed_at),
      confirmed_at: nullable(row.confirmed_at),
      dispatched_at: nullable(row.dispatched_at),
      closed_at: nullable(row.closed_at),
      cancelled_reason: nullable(row.cancelled_reason),
      trip_id: nullable(row.trip_id),
    };
  };

  confirmAssignment = async (context: B1Context, id: string): Promise<AssignmentRow> => {
    this.level(context, 3, 'confirm a dispatch assignment');
    return this.db.withTenant(context.tenant, async (tx) => {
      const assignment = await this.readAssignment(tx, context, id);
      if (!canAssignmentTransition(assignment.status, 'confirmed')) {
        throw new M1Error('invalid_transition', 409, `assignment ${id} is ${assignment.status}`, {
          from: assignment.status,
          to: 'confirmed',
        });
      }
      const truck = await tx.unsafe<Row>(
        `select id, status from trucks where company_id = $1 and id = $2`,
        [context.tenant.companyId, assignment.truck_id],
      );
      const status = str(truck[0]?.status) as TruckStatus;
      if (!canTruckTransition(status, 'assigned')) {
        const check = checkTruckServiceable(status);
        throw new M1Error(check.classification, 422, `truck ${assignment.truck_plate} is ${status}`, {
          check: check.key,
          classification: check.classification,
        });
      }
      await tx.unsafe(
        `update trucks set status = 'assigned', updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, assignment.truck_id, context.actor.username],
      );
      await tx.unsafe(
        `update dispatch_assignments set status = 'confirmed', confirmed_at = now(), updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'dispatch.confirmed', id, { truckId: assignment.truck_id });
      return this.readAssignment(tx, context, id);
    });
  };

  dispatchAssignment = async (
    context: B1Context,
    id: string,
    payload: { loadedVolumeM3: number; batchId: string | null },
  ): Promise<{ assignment: AssignmentRow; trip: TripRow }> => {
    this.level(context, 3, 'dispatch a truck');
    return this.db.withTenant(context.tenant, async (tx) => {
      const assignment = await this.readAssignment(tx, context, id);
      if (assignment.status !== 'proposed' && assignment.status !== 'confirmed') {
        throw new M1Error('invalid_transition', 409, `assignment ${id} is ${assignment.status}`, {
          from: assignment.status,
          to: 'dispatched',
        });
      }

      const trucks = await tx.unsafe<Row>(
        `select id, plant_id, plate_no, capacity_m3::text as capacity_m3, status
           from trucks where company_id = $1 and id = $2`,
        [context.tenant.companyId, assignment.truck_id],
      );
      const truck = trucks[0];
      if (!truck) throw new M1Error('truck_not_found', 404, `truck ${assignment.truck_id} does not exist`);
      const truckStatus = str(truck.status) as TruckStatus;

      const serviceable = checkTruckServiceable(truckStatus);
      if (serviceable.outcome !== 'pass') {
        throw new M1Error(serviceable.classification, 422, `truck ${assignment.truck_plate} is ${truckStatus}`, {
          check: serviceable.key,
          classification: serviceable.classification,
        });
      }

      const drivers = await tx.unsafe<Row>(
        `select id, plant_id, licence_expires_at from drivers where company_id = $1 and id = $2`,
        [context.tenant.companyId, assignment.driver_id],
      );
      const driver = drivers[0];
      if (!driver) throw new M1Error('driver_not_found', 404, 'driver does not exist');

      const rules = await this.rules(tx, context.tenant.companyId);
      const grace = this.ruleFor(rules, 'licenceGrace');
      const licence = checkLicenceValid(
        driver.licence_expires_at ? new Date(str(driver.licence_expires_at)) : null,
        new Date(),
        grace && isRuleConfigured(grace) ? grace.value : null,
      );
      if (licence.outcome !== 'pass') {
        throw new M1Error(licence.classification, 422, 'the driver licence is not valid', {
          check: licence.key,
          classification: licence.classification,
        });
      }

      const capacity = checkCapacity(num(truck.capacity_m3), payload.loadedVolumeM3);
      if (capacity.outcome !== 'pass') {
        throw new M1Error(capacity.classification, 422, 'the load exceeds the truck capacity', {
          check: capacity.key,
          classification: capacity.classification,
          capacityM3: num(truck.capacity_m3),
        });
      }

      let batchPlant: string | null = null;
      let drumMinutes: number | null = null;
      if (payload.batchId) {
        const batch = await tx.unsafe<Row>(
          `select plant_id, produced_at from batches where company_id = $1 and id = $2`,
          [context.tenant.companyId, payload.batchId],
        );
        if (!batch[0]) throw new M1Error('batch_not_found', 404, `batch ${payload.batchId} does not exist`);
        batchPlant = str(batch[0].plant_id);
        const producedAt = new Date(str(batch[0].produced_at)).getTime();
        if (Number.isFinite(producedAt)) {
          drumMinutes = Math.max(0, (Date.now() - producedAt) / 60_000);
        }
      }
      const scope = checkPlantScope(
        assignment.plant_id,
        str(truck.plant_id),
        str(driver.plant_id),
        batchPlant,
      );
      if (scope.outcome !== 'pass') {
        throw new M1Error(scope.classification, 422, 'the dispatch crosses a plant boundary', {
          check: scope.key,
          classification: scope.classification,
        });
      }

      const open = await tx.unsafe<{ n: number }>(
        `select count(*)::int as n from trips
          where company_id = $1 and truck_id = $2 and status in ('planned', 'departed', 'arrived')`,
        [context.tenant.companyId, assignment.truck_id],
      );
      const openTrip = checkOpenTrip(open[0]?.n ?? 0);
      if (openTrip.outcome !== 'pass') {
        throw new M1Error(openTrip.classification, 422, 'this truck already has an open trip', {
          check: openTrip.key,
          classification: openTrip.classification,
        });
      }

      // A soft load limit is a warning only, and only when a value is configured.
      const softRule = this.ruleFor(rules, 'softLoad');
      const warnings: string[] = [];
      if (softRule && isRuleConfigured(softRule)) {
        const soft = checkSoftLoad(softRule, num(truck.capacity_m3), payload.loadedVolumeM3);
        if (soft.outcome === 'warning') warnings.push(soft.key);
      }
      const drumRule = this.ruleFor(rules, 'drumAge');
      if (drumRule && isRuleConfigured(drumRule) && drumMinutes !== null) {
        const drum = checkDrumAge(drumRule, drumMinutes);
        if (drum.outcome === 'warning') warnings.push(drum.key);
      }

      const tripId = newId('TRP');
      try {
        await tx.unsafe(
          `insert into trips (id, company_id, plant_id, assignment_id, truck_id, batch_id,
              loaded_volume_m3, status, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,'planned',$8,$8)`,
          [
            tripId,
            context.tenant.companyId,
            assignment.plant_id,
            id,
            assignment.truck_id,
            payload.batchId,
            payload.loadedVolumeM3,
            context.actor.username,
          ],
        );
      } catch (error) {
        if (String(error).includes('trips_open_per_truck_idx') || String(error).includes('duplicate key')) {
          throw new M1Error('mandatory_failure', 409, 'this truck already has an open trip', {
            check: 'openTrip',
            classification: 'mandatory_failure',
          });
        }
        throw error;
      }

      await tx.unsafe(
        `update dispatch_assignments set status = 'dispatched', dispatched_at = now(), updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await tx.unsafe(
        `update trucks set status = 'en_route', updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, assignment.truck_id, context.actor.username],
      );
      await audit(tx, context, 'dispatch.dispatched', id, {
        tripId,
        loadedVolumeM3: payload.loadedVolumeM3,
        warnings,
      });
      return { assignment: await this.readAssignment(tx, context, id), trip: await this.readTrip(tx, context, tripId) };
    });
  };

  /** Level 4. Cancelling releases the truck and aborts the open trip in the same transaction. */
  cancelAssignment = async (context: B1Context, id: string, reason: string): Promise<AssignmentRow> => {
    this.level(context, 4, 'cancel a dispatch assignment');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, {
        field: 'reason',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const assignment = await this.readAssignment(tx, context, id);
      if (!canAssignmentTransition(assignment.status, 'cancelled')) {
        throw new M1Error('invalid_transition', 409, `assignment ${id} is ${assignment.status}`, {
          from: assignment.status,
          to: 'cancelled',
        });
      }
      await tx.unsafe(
        `update trips set status = 'aborted', aborted_reason = $3, updated_by = $4
          where company_id = $1 and assignment_id = $2 and status in ('planned', 'departed', 'arrived')`,
        [context.tenant.companyId, id, reason.trim(), context.actor.username],
      );
      await tx.unsafe(
        `update dispatch_assignments
            set status = 'cancelled', cancelled_reason = $3, updated_by = $4
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason.trim(), context.actor.username],
      );
      await tx.unsafe(
        `update trucks set status = 'available', updated_by = $3
          where company_id = $1 and id = $2 and status in ('assigned', 'en_route', 'at_site', 'returning')`,
        [context.tenant.companyId, assignment.truck_id, context.actor.username],
      );
      await audit(tx, context, 'dispatch.cancelled', id, {
        reason: reason.trim(),
        releasedTruck: assignment.truck_id,
      });
      return this.readAssignment(tx, context, id);
    });
  };

  getTrip = async (context: B1Context, id: string): Promise<TripRow> => {
    this.level(context, 1, 'read a trip');
    return this.db.withTenant(context.tenant, (tx) => this.readTrip(tx, context, id));
  };

  private readTrip = async (tx: Executor, context: B1Context, id: string): Promise<TripRow> => {
    const rows = await tx.unsafe<Row>(
      `select id, plant_id, assignment_id, truck_id, batch_id, loaded_volume_m3::text as loaded_volume_m3,
              delivered_volume_m3::text as delivered_volume_m3, departed_at, arrived_at, returned_at,
              site_wait_minutes, volume_diff_reason, status, aborted_reason
         from trips where company_id = $1 and id = $2`,
      [context.tenant.companyId, id],
    );
    const row = rows[0];
    if (!row) throw new M1Error('trip_not_found', 404, `trip ${id} does not exist`);
    return toTrip(row);
  };

  departTrip = async (context: B1Context, id: string): Promise<TripRow> => {
    this.level(context, 3, 'depart a trip');
    return this.moveTrip(context, id, 'departed');
  };

  arriveTrip = async (
    context: B1Context,
    id: string,
    payload: { siteWaitMinutes: number | null } = { siteWaitMinutes: null },
  ): Promise<TripRow> => {
    this.level(context, 3, 'arrive a trip');
    return this.moveTrip(context, id, 'arrived', payload);
  };

  returnTrip = async (context: B1Context, id: string): Promise<TripRow> => {
    this.level(context, 3, 'return a trip');
    return this.moveTrip(context, id, 'returned');
  };

  private moveTrip = async (
    context: B1Context,
    id: string,
    to: TripStatus,
    payload: { siteWaitMinutes?: number | null } = {},
  ): Promise<TripRow> =>
    this.db.withTenant(context.tenant, async (tx) => {
      const trip = await this.readTrip(tx, context, id);
      if (!canTripTransition(trip.status, to)) {
        throw new M1Error('invalid_transition', 409, `trip ${id} is ${trip.status}`, {
          from: trip.status,
          to,
        });
      }
      const stamp =
        to === 'departed' ? 'departed_at' : to === 'arrived' ? 'arrived_at' : 'returned_at';
      await tx.unsafe(
        `update trips set status = $3, ${stamp} = now(), site_wait_minutes = coalesce($4, site_wait_minutes),
            updated_by = $5
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, to, payload.siteWaitMinutes ?? null, context.actor.username],
      );

      const warnings: string[] = [];
      if (to === 'arrived' && payload.siteWaitMinutes !== null && payload.siteWaitMinutes !== undefined) {
        const rules = await this.rules(tx, context.tenant.companyId);
        const waitRule = this.ruleFor(rules, 'siteWait');
        if (waitRule && isRuleConfigured(waitRule)) {
          const wait = checkSiteWait(waitRule, payload.siteWaitMinutes);
          if (wait.outcome === 'warning') warnings.push(wait.key);
        }
      }

      if (to === 'returned') {
        await tx.unsafe(
          `update dispatch_assignments set status = 'closed', closed_at = now(), updated_by = $3
            where company_id = $1 and id = $2 and status in ('dispatched', 'delivered')`,
          [context.tenant.companyId, trip.assignment_id, context.actor.username],
        );
        await tx.unsafe(
          `update trucks set status = 'available', updated_by = $3
            where company_id = $1 and id = $2
              and status in ('assigned', 'en_route', 'at_site', 'returning')`,
          [context.tenant.companyId, trip.truck_id, context.actor.username],
        );
      }

      await audit(tx, context, `trip.${to}`, id, { to, warnings });
      return this.readTrip(tx, context, id);
    });

  abortTrip = async (context: B1Context, id: string, reason: string): Promise<TripRow> => {
    this.level(context, 3, 'abort a trip');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, {
        field: 'reason',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const trip = await this.readTrip(tx, context, id);
      if (!canTripTransition(trip.status, 'aborted')) {
        throw new M1Error('invalid_transition', 409, `trip ${id} is ${trip.status}`, {
          from: trip.status,
          to: 'aborted',
        });
      }
      await tx.unsafe(
        `update trips set status = 'aborted', aborted_reason = $3, updated_by = $4
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason.trim(), context.actor.username],
      );
      await audit(tx, context, 'trip.aborted', id, { reason: reason.trim() });
      return this.readTrip(tx, context, id);
    });
  };

  /**
   * Delivers a trip. A difference beyond the configured band is approval_required and only an
   * approved override for this trip lets it through; the reason is stored on the trip.
   */
  recordDelivery = async (
    context: B1Context,
    tripId: string,
    payload: { deliveredVolumeM3: number; reason: string },
  ): Promise<TripRow> => {
    this.level(context, 3, 'record a delivery');
    return this.db.withTenant(context.tenant, async (tx) => {
      const trip = await this.readTrip(tx, context, tripId);
      if (trip.status !== 'departed' && trip.status !== 'arrived') {
        throw new M1Error('invalid_transition', 409, `trip ${tripId} is ${trip.status}`, {
          from: trip.status,
          to: 'returned',
        });
      }
      const loaded = trip.loaded_volume_m3 ?? 0;
      const rules = await this.rules(tx, context.tenant.companyId);
      const band = checkVolumeBand(this.ruleFor(rules, 'volumeBand'), loaded, payload.deliveredVolumeM3);

      if (band.outcome !== 'pass') {
        const overridden = await tx.unsafe<{ n: number }>(
          `select count(*)::int as n from dispatch_overrides
            where company_id = $1 and entity_id = $2 and rule_code = $3 and decision = 'approved'`,
          [context.tenant.companyId, tripId, FLEET_RULE_CODES.volumeBand],
        );
        if ((overridden[0]?.n ?? 0) === 0) {
          throw new M1Error(band.classification, 422, 'the delivered volume is outside the band', {
            check: band.key,
            classification: band.classification,
            ruleCode: FLEET_RULE_CODES.volumeBand,
            outcome: band.outcome,
          });
        }
      }

      await tx.unsafe(
        `update trips
            set delivered_volume_m3 = $3, volume_diff_reason = $4, status = 'arrived',
                arrived_at = coalesce(arrived_at, now()), updated_by = $5
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, tripId, payload.deliveredVolumeM3, payload.reason.trim(), context.actor.username],
      );
      await tx.unsafe(
        `update dispatch_assignments set status = 'delivered', updated_by = $3
          where company_id = $1 and id = $2 and status = 'dispatched'`,
        [context.tenant.companyId, trip.assignment_id, context.actor.username],
      );
      await audit(tx, context, 'dispatch.delivered', tripId, {
        deliveredVolumeM3: payload.deliveredVolumeM3,
        bandOutcome: band.outcome,
        reason: payload.reason.trim(),
      });
      return this.readTrip(tx, context, tripId);
    });
  };

  listMaintenance = async (context: B1Context): Promise<MaintenanceRow[]> => {
    this.level(context, 1, 'read maintenance records');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select m.id, m.plant_id, m.truck_id, t.plate_no as truck_plate, m.maintenance_type,
                m.opened_at, m.closed_at, m.odometer_km::text as odometer_km,
                m.cost_amount::text as cost_amount, coalesce(m.notes, '') as notes, m.status
           from truck_maintenance m join trucks t on t.id = m.truck_id
          where m.company_id = $1
          order by m.opened_at desc`,
        [context.tenant.companyId],
      ),
    );
    return rows.map(toMaintenance);
  };

  openMaintenance = async (
    context: B1Context,
    payload: { truckId: string; maintenanceType: string; odometerKm: number | null; notes: string },
  ): Promise<MaintenanceRow> => {
    this.level(context, 4, 'open maintenance');
    return this.db.withTenant(context.tenant, async (tx) => {
      const trucks = await tx.unsafe<Row>(
        `select id, plant_id, plate_no, status from trucks where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.truckId],
      );
      const truck = trucks[0];
      if (!truck) throw new M1Error('truck_not_found', 404, `truck ${payload.truckId} does not exist`);
      const status = str(truck.status) as TruckStatus;
      if (!canTruckTransition(status, 'maintenance')) {
        throw new M1Error('invalid_transition', 409, `truck ${payload.truckId} is ${status}`, {
          from: status,
          to: 'maintenance',
        });
      }
      const id = newId('MNT');
      await tx.unsafe(
        `insert into truck_maintenance (id, company_id, plant_id, truck_id, maintenance_type,
            odometer_km, notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          id,
          context.tenant.companyId,
          str(truck.plant_id),
          payload.truckId,
          payload.maintenanceType,
          payload.odometerKm,
          payload.notes,
          context.actor.username,
        ],
      );
      await tx.unsafe(
        `update trucks set status = 'maintenance', updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, payload.truckId, context.actor.username],
      );
      await audit(tx, context, 'truck.maintenance_opened', payload.truckId, { maintenanceId: id });
      const rows = await tx.unsafe<Row>(
        `select m.id, m.plant_id, m.truck_id, t.plate_no as truck_plate, m.maintenance_type,
                m.opened_at, m.closed_at, m.odometer_km::text as odometer_km,
                m.cost_amount::text as cost_amount, coalesce(m.notes, '') as notes, m.status
           from truck_maintenance m join trucks t on t.id = m.truck_id
          where m.company_id = $1 and m.id = $2`,
        [context.tenant.companyId, id],
      );
      return toMaintenance(rows[0] ?? {});
    });
  };

  closeMaintenance = async (
    context: B1Context,
    id: string,
    payload: { costAmount: number | null; odometerKm: number | null } = { costAmount: null, odometerKm: null },
  ): Promise<MaintenanceRow> => {
    this.level(context, 4, 'close maintenance');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, truck_id, status from truck_maintenance where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      const row = rows[0];
      if (!row) throw new M1Error('maintenance_not_found', 404, `maintenance ${id} does not exist`);
      if (str(row.status) !== 'open') {
        throw new M1Error('invalid_transition', 409, `maintenance ${id} is already closed`, {
          from: str(row.status),
          to: 'closed',
        });
      }
      await tx.unsafe(
        `update truck_maintenance
            set status = 'closed', closed_at = now(), cost_amount = $3, odometer_km = coalesce($4, odometer_km),
                updated_by = $5
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, payload.costAmount, payload.odometerKm, context.actor.username],
      );
      await tx.unsafe(
        `update trucks set status = 'available', odometer_km = coalesce($3, odometer_km), updated_by = $4
          where company_id = $1 and id = $2 and status = 'maintenance'`,
        [context.tenant.companyId, str(row.truck_id), payload.odometerKm, context.actor.username],
      );
      await audit(tx, context, 'truck.maintenance_closed', str(row.truck_id), { maintenanceId: id });
      const after = await tx.unsafe<Row>(
        `select m.id, m.plant_id, m.truck_id, t.plate_no as truck_plate, m.maintenance_type,
                m.opened_at, m.closed_at, m.odometer_km::text as odometer_km,
                m.cost_amount::text as cost_amount, coalesce(m.notes, '') as notes, m.status
           from truck_maintenance m join trucks t on t.id = m.truck_id
          where m.company_id = $1 and m.id = $2`,
        [context.tenant.companyId, id],
      );
      return toMaintenance(after[0] ?? {});
    });
  };

  recordGps = async (
    context: B1Context,
    payload: { truckId: string; lat: number; lng: number; source: string; reason: string },
  ): Promise<{ id: string; recorded_at: string }> => {
    this.level(context, 3, 'record a GPS position');
    const correction = checkGpsCorrection(payload.source, payload.reason);
    if (correction.outcome !== 'pass') {
      throw new M1Error(correction.classification, 422, 'a manual correction needs a reason', {
        check: correction.key,
        classification: correction.classification,
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const truck = await tx.unsafe<Row>(
        `select id, plant_id from trucks where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.truckId],
      );
      if (!truck[0]) throw new M1Error('truck_not_found', 404, `truck ${payload.truckId} does not exist`);
      const id = newId('GPS');
      const rows = await tx.unsafe<Row>(
        `insert into gps_positions (id, company_id, plant_id, truck_id, lat, lng, source,
            correction_reason, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning recorded_at`,
        [
          id,
          context.tenant.companyId,
          str(truck[0].plant_id),
          payload.truckId,
          payload.lat,
          payload.lng,
          payload.source,
          payload.reason.trim() || null,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'truck.gps_recorded', payload.truckId, {
        source: payload.source,
        reason: payload.reason.trim() || null,
      });
      return { id, recorded_at: str(rows[0]?.recorded_at) };
    });
  };

  /** Level 4: records an approved override with all five evidence fields. */
  addOverride = async (
    context: B1Context,
    entityId: string,
    payload: { ruleCode: string; reason: string; decision: 'approved' | 'rejected' },
  ): Promise<{ id: string; actor: string; reason: string; decision: string; decided_at: string; rule_code: string }> => {
    this.level(context, 4, 'decide a dispatch override');
    if (payload.reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, {
        field: 'reason',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const rule = await tx.unsafe<Row>(
        `select id from rule_definitions where company_id = $1 and code = $2`,
        [context.tenant.companyId, payload.ruleCode],
      );
      const ruleId = str(rule[0]?.id);
      if (!ruleId) throw new M1Error('rule_not_found', 404, `rule ${payload.ruleCode} does not exist`);
      const rows = await tx.unsafe<Row>(
        `insert into dispatch_overrides (company_id, rule_id, rule_code, entity_type, entity_id,
            actor, reason, decision)
         values ($1,$2,$3,'trip',$4,$5,$6,$7)
         returning id::text as id, actor, reason, decision, decided_at, rule_code`,
        [
          context.tenant.companyId,
          ruleId,
          payload.ruleCode,
          entityId,
          context.actor.username,
          payload.reason.trim(),
          payload.decision,
        ],
      );
      await audit(tx, context, 'dispatch.override', entityId, {
        ruleCode: payload.ruleCode,
        decision: payload.decision,
        reason: payload.reason.trim(),
      });
      const row = rows[0] ?? {};
      return {
        id: str(row.id),
        actor: str(row.actor),
        reason: str(row.reason),
        decision: str(row.decision),
        decided_at: str(row.decided_at),
        rule_code: str(row.rule_code),
      };
    });
  };
}

const audit = async (
  tx: Executor,
  context: B1Context,
  action: string,
  recordId: string,
  details: Record<string, unknown>,
): Promise<void> => {
  await tx.unsafe(
    `insert into audit_log (company_id, plant_id, user_id, username, action, table_name, record_id,
       ip_address, request_id, details)
     values ($1,$2,$3,$4,$5,'fleet',$6,$7,$8,$9::jsonb)`,
    [
      context.tenant.companyId,
      context.tenant.plantIds[0] ?? null,
      context.actor.userId,
      context.actor.username,
      action,
      recordId,
      context.actor.ip ?? null,
      context.actor.requestId ?? null,
      JSON.stringify(details),
    ],
  );
};
