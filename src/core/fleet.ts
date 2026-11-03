/**
 * M5 — fleet and dispatch. Pure functions: no database, no IO, no clock.
 *
 * The numeric decisions (volume band, drum age, site wait, soft load, licence grace) run through
 * the R1 engine against configured values. ECP 203-2007 does not define any of these limits in
 * the supplied reference, so the catalogue entries are seeded empty and an unconfigured rule
 * never passes.
 */
import {
  evaluateRule,
  type RuleClassification,
  type RuleDefinition,
  type RuleEvaluation,
  type RuleOutcome,
} from './rules';

export type TruckStatus =
  | 'available'
  | 'assigned'
  | 'loading'
  | 'en_route'
  | 'at_site'
  | 'returning'
  | 'maintenance'
  | 'retired';

export type AssignmentStatus =
  | 'proposed'
  | 'confirmed'
  | 'dispatched'
  | 'delivered'
  | 'closed'
  | 'cancelled';

export type TripStatus = 'planned' | 'departed' | 'arrived' | 'returned' | 'aborted';

export type FleetRuleKey =
  | 'capacity'
  | 'truckServiceable'
  | 'licenceValid'
  | 'plantScope'
  | 'openTrip'
  | 'volumeBand'
  | 'drumAge'
  | 'siteWait'
  | 'softLoad'
  | 'gpsCorrection';

/** The M5 rules, each bound to its §26 classification. */
export const FLEET_RULES: Record<FleetRuleKey, RuleClassification> = {
  capacity: 'mandatory_failure',
  truckServiceable: 'mandatory_failure',
  licenceValid: 'mandatory_failure',
  plantScope: 'mandatory_failure',
  openTrip: 'mandatory_failure',
  volumeBand: 'approval_required',
  drumAge: 'warning',
  siteWait: 'warning',
  softLoad: 'warning',
  gpsCorrection: 'authorized_override',
};

export interface FleetCheck {
  key: FleetRuleKey;
  classification: RuleClassification;
  outcome: RuleOutcome;
  reasonKey: string;
}

/** Catalogue codes the measured M5 rules read. */
export const FLEET_RULE_CODES = {
  volumeBand: 'fleet.volume_difference_band',
  drumAge: 'fleet.drum_age_minutes',
  siteWait: 'fleet.site_wait_threshold',
  softLoad: 'fleet.load_soft_limit_pct',
  licenceGrace: 'fleet.licence_grace_days',
} as const;

export type FleetCatalogueKey = keyof typeof FLEET_RULE_CODES;

const outcomeFor = (classification: RuleClassification): RuleOutcome => {
  switch (classification) {
    case 'warning':
      return 'warning';
    case 'mandatory_failure':
      return 'failure';
    case 'approval_required':
      return 'approval_required';
    case 'engineering_hold':
      return 'engineering_hold';
    case 'authorized_override':
      return 'override_required';
  }
};

const verdict = (key: FleetRuleKey, satisfied: boolean, reasonKey: string): FleetCheck => ({
  key,
  classification: FLEET_RULES[key],
  outcome: satisfied ? 'pass' : outcomeFor(FLEET_RULES[key]),
  reasonKey,
});

const fromEvaluation = (key: FleetRuleKey, evaluation: RuleEvaluation): FleetCheck => ({
  key,
  classification: evaluation.classification,
  outcome: evaluation.outcome,
  reasonKey: evaluation.reasonKey,
});

export const missingFleetRule = (key: FleetCatalogueKey): RuleDefinition => ({
  code: FLEET_RULE_CODES[key],
  module: 'fleet',
  classification: FLEET_RULES[
    key === 'volumeBand'
      ? 'volumeBand'
      : key === 'drumAge'
        ? 'drumAge'
        : key === 'siteWait'
          ? 'siteWait'
          : key === 'softLoad'
            ? 'softLoad'
            : 'licenceValid'
  ],
  value: null,
  unit: '',
  sourceNote: '',
  status: 'active',
});

/** A load may not exceed the truck's rated capacity. */
export const checkCapacity = (capacityM3: number, loadedM3: number): FleetCheck =>
  verdict('capacity', Number.isFinite(capacityM3) && loadedM3 <= capacityM3, 'fleet.capacity_exceeded');

/** A truck in maintenance or retired cannot be dispatched. */
export const checkTruckServiceable = (status: TruckStatus): FleetCheck =>
  verdict(
    'truckServiceable',
    status !== 'maintenance' && status !== 'retired',
    status === 'retired' ? 'fleet.truck_retired' : 'fleet.truck_in_maintenance',
  );

/**
 * The driver licence must be valid at dispatch time. The grace period is configuration with no
 * default: an unconfigured grace means no extension.
 */
export const checkLicenceValid = (
  expiresAt: Date | null,
  at: Date,
  graceDays: number | null,
): FleetCheck => {
  if (expiresAt === null || Number.isNaN(expiresAt.getTime())) {
    return verdict('licenceValid', false, 'fleet.licence_missing');
  }
  const daysLeft = (expiresAt.getTime() - at.getTime()) / 86_400_000;
  const grace = graceDays !== null && Number.isFinite(graceDays) ? Math.max(0, graceDays) : 0;
  return verdict('licenceValid', daysLeft + grace >= 0, 'fleet.licence_expired');
};

/** A dispatch and its trip stay inside one plant. */
export const checkPlantScope = (assignmentPlant: string, ...others: (string | null)[]): FleetCheck =>
  verdict(
    'plantScope',
    others.every((plant) => plant === null || plant === assignmentPlant),
    'fleet.cross_plant',
  );

/** One open trip per truck. */
export const checkOpenTrip = (openTrips: number): FleetCheck =>
  verdict('openTrip', openTrips === 0, 'fleet.open_trip_exists');

/** Delivered vs loaded outside the configured band needs a level-4 approval. */
export const checkVolumeBand = (
  rule: RuleDefinition | null,
  loadedM3: number,
  deliveredM3: number,
): FleetCheck => {
  if (!Number.isFinite(loadedM3) || loadedM3 <= 0) {
    return verdict('volumeBand', false, 'fleet.volume_unmeasured');
  }
  const deviation = (Math.abs(deliveredM3 - loadedM3) / loadedM3) * 100;
  return fromEvaluation(
    'volumeBand',
    evaluateRule(rule ?? missingFleetRule('volumeBand'), { actual: deviation, comparator: 'lte' }),
  );
};

/** Soft load limit: above the configured percentage of capacity it is a recorded warning. */
export const checkSoftLoad = (rule: RuleDefinition | null, capacityM3: number, loadedM3: number): FleetCheck => {
  if (!Number.isFinite(capacityM3) || capacityM3 <= 0) {
    return verdict('softLoad', false, 'fleet.capacity_unknown');
  }
  const used = (loadedM3 / capacityM3) * 100;
  return fromEvaluation(
    'softLoad',
    evaluateRule(rule ?? missingFleetRule('softLoad'), { actual: used, comparator: 'lte' }),
  );
};

/** Drum age and site wait are warnings driven by configured minutes. */
export const checkDrumAge = (rule: RuleDefinition | null, minutes: number): FleetCheck =>
  fromEvaluation(
    'drumAge',
    evaluateRule(rule ?? missingFleetRule('drumAge'), { actual: minutes, comparator: 'lte' }),
  );

export const checkSiteWait = (rule: RuleDefinition | null, minutes: number): FleetCheck =>
  fromEvaluation(
    'siteWait',
    evaluateRule(rule ?? missingFleetRule('siteWait'), { actual: minutes, comparator: 'lte' }),
  );

/** A manual correction is an authorized override: actor and reason are mandatory. */
export const checkGpsCorrection = (source: string, reason: string): FleetCheck =>
  verdict(
    'gpsCorrection',
    source !== 'manual' || reason.trim().length >= 5,
    'fleet.gps_reason_required',
  );

export const TRUCK_TRANSITIONS: Record<TruckStatus, readonly TruckStatus[]> = {
  available: ['assigned', 'loading', 'maintenance', 'retired'],
  assigned: ['loading', 'en_route', 'available', 'maintenance'],
  loading: ['en_route', 'available'],
  en_route: ['at_site', 'returning'],
  at_site: ['returning'],
  returning: ['available'],
  maintenance: ['available', 'retired'],
  retired: [],
};

export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  proposed: ['confirmed', 'cancelled'],
  confirmed: ['dispatched', 'cancelled'],
  dispatched: ['delivered', 'cancelled'],
  delivered: ['closed'],
  closed: [],
  cancelled: [],
};

export const TRIP_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  planned: ['departed', 'aborted'],
  departed: ['arrived', 'aborted'],
  arrived: ['returned', 'aborted'],
  returned: [],
  aborted: [],
};

export const canTruckTransition = (from: TruckStatus, to: TruckStatus): boolean =>
  TRUCK_TRANSITIONS[from].includes(to);

export const canAssignmentTransition = (from: AssignmentStatus, to: AssignmentStatus): boolean =>
  ASSIGNMENT_TRANSITIONS[from].includes(to);

export const canTripTransition = (from: TripStatus, to: TripStatus): boolean =>
  TRIP_TRANSITIONS[from].includes(to);
