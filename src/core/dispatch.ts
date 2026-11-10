/**
 * M11 — dispatch and trips. Pure functions only: no database, no IO, no clock.
 *
 * A trip is one truck and one load. The server owns every timestamp; this module only
 * defines the legal order of the operating statuses and the reproducible KPI arithmetic.
 */

export const DISPATCH_TRIP_STATUSES = [
  'queued',
  'loading',
  'loaded',
  'traveling',
  'unloading',
  'unloaded',
  'returned',
  'cancelled',
] as const;

export type DispatchTripStatus = (typeof DISPATCH_TRIP_STATUSES)[number];

/** A truck with a trip in one of these states is not available for another trip. */
export const OPEN_TRIP_STATUSES = [
  'queued',
  'loading',
  'loaded',
  'traveling',
  'unloading',
  'unloaded',
] as const;

/** Statuses that count as work in progress on the board. */
export const IN_PROGRESS_STATUSES = ['loading', 'loaded', 'traveling', 'unloading'] as const;

/** The four operating columns on the board, in dispatcher reading order. */
export const TRIP_GROUPS = ['queued', 'on_road', 'unloading', 'done'] as const;
export type TripGroup = (typeof TRIP_GROUPS)[number];

export const TRIP_TRANSITIONS: Record<DispatchTripStatus, readonly DispatchTripStatus[]> = {
  queued: ['loading', 'cancelled'],
  loading: ['loaded', 'cancelled'],
  loaded: ['traveling', 'cancelled'],
  traveling: ['unloading', 'cancelled'],
  unloading: ['unloaded', 'cancelled'],
  unloaded: ['returned', 'cancelled'],
  returned: [],
  cancelled: [],
};

export const nextTripStatus = (status: DispatchTripStatus): DispatchTripStatus | null => {
  const transitions = TRIP_TRANSITIONS[status];
  return transitions?.[0] ?? null;
};

export const canAdvanceTrip = (status: DispatchTripStatus): boolean =>
  nextTripStatus(status) !== null;

export const isOpenTripStatus = (status: string): status is (typeof OPEN_TRIP_STATUSES)[number] =>
  (OPEN_TRIP_STATUSES as readonly string[]).includes(status);

export const isTerminalTripStatus = (status: string): boolean =>
  status === 'returned' || status === 'cancelled';

/** The board has four columns; statuses with the same operating meaning share one. */
export const tripGroup = (status: string): TripGroup => {
  switch (status) {
    case 'queued':
    case 'loading':
    case 'loaded':
      return 'queued';
    case 'traveling':
      return 'on_road';
    case 'unloading':
    case 'unloaded':
      return 'unloading';
    case 'returned':
    case 'cancelled':
      return 'done';
    default:
      return 'queued';
  }
};

export const groupTrips = <T extends { status: string }>(trips: T[]): Record<TripGroup, T[]> => {
  const groups: Record<TripGroup, T[]> = {
    queued: [],
    on_road: [],
    unloading: [],
    done: [],
  };
  for (const trip of trips) groups[tripGroup(trip.status)].push(trip);
  return groups;
};

const parseTime = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

/** Whole minutes between two server timestamps, or null while the interval is incomplete. */
export const minutesBetween = (
  from: string | null | undefined,
  to: string | null | undefined,
): number | null => {
  const start = parseTime(from);
  const end = parseTime(to);
  if (start === null || end === null) return null;
  return Math.max(0, Math.floor((end - start) / 60_000));
};

/** Cycle time per trip = return − departure, in whole minutes. */
export const cycleMinutes = (
  departureTime: string | null | undefined,
  returnTime: string | null | undefined,
): number | null => minutesBetween(departureTime, returnTime);

/** Site waiting = finish unload − arrive site, in whole minutes. */
export const siteWaitMinutes = (
  arriveSiteTime: string | null | undefined,
  finishUnloadTime: string | null | undefined,
): number | null => minutesBetween(arriveSiteTime, finishUnloadTime);

export const WAIT_FLAG_MINUTES = 30;

/** Red flag threshold is deliberately fixed at 30 minutes by the M11 acceptance rule. */
export const isWaitFlagged = (minutes: number | null): boolean =>
  minutes !== null && minutes > WAIT_FLAG_MINUTES;

/** Reproducible top-strip numbers for one board day. */
export interface DispatchKpis {
  tripsCount: number;
  deliveredM3: number;
  inProgress: number;
  trucksAvailable: number;
}

export const dispatchKpis = (
  trips: Array<{ status: string; loaded_m3: number | null }>,
  trucksAvailable: number,
): DispatchKpis => {
  const live = trips.filter((trip) => trip.status !== 'cancelled');
  return {
    tripsCount: live.length,
    deliveredM3: live
      .filter((trip) => trip.status === 'unloaded' || trip.status === 'returned')
      .reduce((sum, trip) => sum + (trip.loaded_m3 ?? 0), 0),
    inProgress: live.filter((trip) =>
      (IN_PROGRESS_STATUSES as readonly string[]).includes(trip.status),
    ).length,
    trucksAvailable,
  };
};

/** Trips per truck and m³ per truck for the same day, both reproducible from TRIPS. */
export const truckDayKpis = (
  trips: Array<{ truck_id: string | null; status: string; loaded_m3: number | null }>,
): Map<string, { trips: number; m3: number }> => {
  const result = new Map<string, { trips: number; m3: number }>();
  for (const trip of trips) {
    if (!trip.truck_id || trip.status === 'cancelled') continue;
    const row = result.get(trip.truck_id) ?? { trips: 0, m3: 0 };
    row.trips += 1;
    if (trip.status === 'unloaded' || trip.status === 'returned') row.m3 += trip.loaded_m3 ?? 0;
    result.set(trip.truck_id, row);
  }
  return result;
};

export const formatMinutes = (value: number | null): string =>
  value === null ? '—' : `${value} min`;
