import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, ErrorNote, LoadingBlock, SectionTitle, StatCard, type BadgeTone } from '../components/ui';
import {
  isTerminalTripStatus,
  nextTripStatus,
  TRIP_GROUPS,
  type DispatchTripStatus,
  type TripGroup,
} from '../core/dispatch';
import { formatMoney } from '../core/money';
import type { Lang } from '../types';

/**
 * M11 — the daily dispatch board. The server owns every timestamp and computes the
 * reproducible KPIs; this screen only groups today's trips into the four operating
 * columns, offers the next legal action, and keeps the trucks panel beside the board.
 */

interface Trip {
  id: string;
  plant_id: string;
  order_id: string | null;
  customer_id: string | null;
  truck_id: string | null;
  driver_name: string;
  mix_design_id: string | null;
  target_m3: number;
  loaded_m3: number | null;
  status: DispatchTripStatus;
  departure_time: string | null;
  arrive_site_time: string | null;
  finish_unload_time: string | null;
  return_time: string | null;
  wait_min_at_site: number | null;
  wait_flagged: boolean;
  cycle_minutes: number | null;
  stage_started_at: string | null;
  stage_elapsed_minutes: number | null;
  cancel_reason: string;
  trip_date: string;
  order_no: string;
  concrete_grade: string;
  customer_name_ar: string;
  customer_name_en: string;
  project_name_ar: string;
  project_name_en: string;
  truck_plate: string;
  truck_capacity_m3: number | null;
  mix_code: string;
  group: TripGroup;
}

interface TripCost {
  trip_id: string;
  total_cost: string;
  cost_per_m3: string | null;
  fuel_cost: string;
  driver_cost: string;
  waiting_cost: string;
  status: 'complete' | 'incomplete';
  missing_fields: string[];
}

interface Truck {
  id: string;
  plant_id: string;
  plate_no: string;
  capacity_m3: number;
  status: string;
  current_odometer: number | null;
  active: boolean;
  trips_today: number;
  m3_today: number;
}

interface Order {
  id: string;
  plant_id: string | null;
  order_no: string;
  customer_name_ar: string;
  customer_name_en: string;
  project_name_ar: string;
  project_name_en: string;
  concrete_grade: string;
  quantity_m3: number;
  remaining_m3: number;
  status: string;
  delivery_date: string;
}

interface Mix {
  id: string;
  plant_id: string;
  code: string;
  name_ar: string;
  name_en: string;
}

interface Board {
  date: string;
  trips: Trip[];
  trucks: Truck[];
  orders: Order[];
  mixDesigns: Mix[];
  plants: Array<{ id: string; name_ar: string; name_en: string }>;
  kpis: {
    tripsCount: number;
    deliveredM3: number;
    inProgress: number;
    trucksAvailable: number;
  };
  serverNow: string;
}

const TONE: Record<string, BadgeTone> = {
  queued: 'neutral',
  loading: 'info',
  loaded: 'purple',
  traveling: 'info',
  unloading: 'warning',
  unloaded: 'warning',
  returned: 'success',
  cancelled: 'danger',
};

const NEXT_KEY: Record<string, string> = {
  queued: 'dispatch.m11.startLoading',
  loading: 'dispatch.m11.markLoaded',
  loaded: 'dispatch.m11.depart',
  traveling: 'dispatch.m11.arriveSite',
  unloading: 'dispatch.m11.finishUnload',
  unloaded: 'dispatch.m11.returnPlant',
};

const GROUP_LABEL: Record<TripGroup, string> = {
  queued: 'dispatch.m11.queued',
  on_road: 'dispatch.m11.onRoad',
  unloading: 'dispatch.m11.unloading',
  done: 'dispatch.m11.done',
};

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return caught.code === 'forbidden_plant' ? 'dispatch.m11.err.forbiddenPlant' : 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    switch (caught.code) {
      case 'truck_busy':
        return 'dispatch.m11.err.truckBusy';
      case 'capacity_exceeded':
        return 'dispatch.m11.err.capacity';
      case 'order_closed':
        return 'dispatch.m11.err.orderClosed';
      case 'order_not_accepted':
        return 'dispatch.m11.err.orderNotAccepted';
      case 'truck_required':
        return 'dispatch.m11.err.truckRequired';
      case 'duplicate_plate':
        return 'dispatch.m11.err.duplicatePlate';
      case 'order_remaining_exceeded':
        return 'dispatch.m11.err.remaining';
      case 'truck_unavailable':
        return 'dispatch.m11.err.truckUnavailable';
      case 'trip_already_assigned':
        return 'dispatch.m11.err.tripAlreadyAssigned';
      case 'trip_not_found':
      case 'truck_not_found':
      case 'order_not_found':
        return 'dispatch.m11.err.notFound';
      case 'validation_error':
        return 'dispatch.m11.err.validation';
      default:
        return 'dispatch.m11.err.network';
    }
  }
  return 'dispatch.m11.err.network';
};

const m3 = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toLocaleString('en-GB', { maximumFractionDigits: 3 })} m³`;

const minutes = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value} min`;

const elapsedSince = (value: string | null, nowMs: number): number | null => {
  if (!value) return null;
  const start = new Date(value).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((nowMs - start) / 60_000));
};

export const DispatchBoardPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [date, setDate] = useState('');
  const [plantId, setPlantId] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const actionInFlight = useRef(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [tripCosts, setTripCosts] = useState<Record<string, TripCost>>({});

  const [orderId, setOrderId] = useState('');
  const [target, setTarget] = useState('');
  const [driver, setDriver] = useState('');
  const [newTruck, setNewTruck] = useState('');
  const [mixId, setMixId] = useState('');

  const [loadedDrafts, setLoadedDrafts] = useState<Record<string, string>>({});
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [assignPick, setAssignPick] = useState<Record<string, string>>({});

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (date) query.set('date', date);
        if (plantId) query.set('plantId', plantId);
        const suffix = query.toString() ? `?${query.toString()}` : '';
        const response = await apiFetch<Board>(`/api/trips${suffix}`);
        setBoard(response);
        setNowMs(Date.now());
        const ids = response.trips.map((trip) => trip.id).join(',');
        if (ids) {
          const costs = await apiFetch<{ trips: TripCost[] }>(`/api/cost/trips?ids=${encodeURIComponent(ids)}`).catch(() => ({ trips: [] }));
          setTripCosts(Object.fromEntries(costs.trips.map((row) => [row.trip_id, row])));
        } else {
          setTripCosts({});
        }
      } catch (caught) {
        setError(apiMessage(caught));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [date, plantId],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedOrder = useMemo(
    () => board?.orders.find((order) => order.id === orderId) ?? null,
    [board, orderId],
  );

  const plants = board?.plants ?? [];
  const customerName = (trip: Trip): string =>
    lang === 'ar' ? trip.customer_name_ar || trip.customer_name_en : trip.customer_name_en || trip.customer_name_ar;
  const projectName = (trip: Trip): string =>
    lang === 'ar' ? trip.project_name_ar || trip.project_name_en : trip.project_name_en || trip.project_name_ar;
  const orderLabel = (order: Order): string =>
    `${order.order_no} · ${lang === 'ar' ? order.customer_name_ar || order.customer_name_en : order.customer_name_en || order.customer_name_ar}`;

  const groups = useMemo(() => {
    const result: Record<TripGroup, Trip[]> = { queued: [], on_road: [], unloading: [], done: [] };
    for (const trip of board?.trips ?? []) result[trip.group].push(trip);
    return result;
  }, [board]);

  const queuedWithoutTruck = (board?.trips ?? []).filter(
    (trip) => trip.status === 'queued' && !trip.truck_id,
  );
  const plantTrucks = (board?.trucks ?? []).filter(
    (truck) => !selectedOrder?.plant_id || truck.plant_id === selectedOrder.plant_id,
  );
  const plantMixes = (board?.mixDesigns ?? []).filter(
    (mix) => !selectedOrder?.plant_id || mix.plant_id === selectedOrder.plant_id,
  );

  const refreshAfter = async (): Promise<void> => {
    setLoadedDrafts({});
    setCancelId(null);
    setCancelReason('');
    await load(true);
  };

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    // React state disables the button on the next render, not in the same tick. Guard the
    // in-flight action so a double click cannot create two trips or advance twice.
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshAfter();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  };

  const createTrip = () => {
    if (!selectedOrder) return;
    void runAction(async () => {
      await apiFetch('/api/trips', {
        method: 'POST',
        body: JSON.stringify({
          orderId: selectedOrder.id,
          truckId: newTruck || undefined,
          driverName: driver,
          mixDesignId: mixId || undefined,
          targetM3: Number(target),
          plantId: selectedOrder.plant_id || plantId || undefined,
        }),
      });
      setOrderId('');
      setTarget('');
      setDriver('');
      setNewTruck('');
      setMixId('');
    });
  };

  const advance = (trip: Trip) => {
    const loadedM3 = loadedDrafts[trip.id] ?? (trip.status === 'loading' ? String(trip.target_m3) : '');
    void runAction(() =>
      apiFetch(`/api/trips/${encodeURIComponent(trip.id)}/advance`, {
        method: 'POST',
        body: JSON.stringify(trip.status === 'loading' ? { loadedM3: Number(loadedM3) } : {}),
      }),
    );
  };

  const assign = (truck: Truck) => {
    const tripId = assignPick[truck.id];
    if (!tripId) return;
    void runAction(async () => {
      await apiFetch(`/api/trips/${encodeURIComponent(tripId)}/assign`, {
        method: 'POST',
        body: JSON.stringify({ truckId: truck.id }),
      });
      setAssignPick((current) => ({ ...current, [truck.id]: '' }));
    });
  };

  const cancel = () => {
    if (!cancelId) return;
    void runAction(() =>
      apiFetch(`/api/trips/${encodeURIComponent(cancelId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason }),
      }),
    );
  };

  if (loading && !board) return <LoadingBlock label={t('common.loading')} />;
  if (!board) return <ErrorNote>{t(error ?? 'dispatch.m11.err.network')}</ErrorNote>;

  return (
    <div className="page-stack dispatch-page">
      <SectionTitle
        title={t('dispatch.m11.title')}
        subtitle={t('dispatch.m11.subtitle')}
        badge={<Badge tone="purple">{board.date}</Badge>}
      />

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('dispatch.m11.date')}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('dispatch.m11.plant')}</span>
            <select value={plantId} onChange={(event) => setPlantId(event.target.value)}>
              <option value="">{t('dispatch.m11.allPlants')}</option>
              {plants.map((plant) => (
                <option key={plant.id} value={plant.id}>
                  {lang === 'ar' ? plant.name_ar : plant.name_en}
                </option>
              ))}
            </select>
          </label>
          <div className="filters__actions">
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void load(true)}>
              {t('dispatch.m11.refresh')}
            </button>
          </div>
        </div>
      </Card>

      <div className="kpi-grid">
        <StatCard
          label={t('dispatch.m11.kpiTrips')}
          value={String(board.kpis.tripsCount)}
          hint={`${t('dispatch.m11.trips')} / ${board.date}`}
          tone="purple"
        />
        <StatCard
          label={t('dispatch.m11.kpiM3')}
          value={m3(board.kpis.deliveredM3)}
          hint={t('dispatch.m11.m3')}
          tone="success"
        />
        <StatCard
          label={t('dispatch.m11.kpiProgress')}
          value={String(board.kpis.inProgress)}
          hint={t('dispatch.m11.trips')}
          tone="warning"
        />
        <StatCard
          label={t('dispatch.m11.kpiTrucks')}
          value={String(board.kpis.trucksAvailable)}
          hint={t('dispatch.m11.trucks')}
          tone="neutral"
        />
      </div>

      {level >= 3 ? (
        <Card title={t('dispatch.m11.newTrip')} subtitle={t('dispatch.m11.newTripNote')}>
          <div className="dispatch-order-queue">
            <div className="dispatch-order-queue__head">
              <strong>{t('dispatch.m11.ordersQueue')}</strong>
              <span className="muted">{t('dispatch.m11.ordersNote')}</span>
            </div>
            {board.orders.length === 0 ? (
              <p className="muted">{t('dispatch.m11.noOrders')}</p>
            ) : (
              <div className="dispatch-order-chips">
                {board.orders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    className={`dispatch-order-chip ${order.id === orderId ? 'is-selected' : ''}`}
                    onClick={() => {
                      setOrderId(order.id);
                      setTarget(String(order.remaining_m3));
                      setNewTruck('');
                    }}
                  >
                    <strong>{order.order_no}</strong>
                    <span>{orderLabel(order).split(' · ')[1] ?? ''}</span>
                    <span>
                      {order.concrete_grade} · {m3(order.remaining_m3)} {t('dispatch.m11.remaining')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedOrder ? (
            <div className="filters dispatch-new-trip">
              <label className="field">
                <span>{t('dispatch.m11.target')}</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </label>
              <label className="field">
                <span>{t('dispatch.m11.driver')}</span>
                <input value={driver} onChange={(event) => setDriver(event.target.value)} />
              </label>
              <label className="field">
                <span>{t('dispatch.m11.truck')}</span>
                <select value={newTruck} onChange={(event) => setNewTruck(event.target.value)}>
                  <option value="">{t('dispatch.m11.noTruck')}</option>
                  {plantTrucks
                    .filter((truck) => truck.status === 'available')
                    .map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        {truck.plate_no} · {truck.capacity_m3} m³
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>{t('dispatch.m11.mix')}</span>
                <select value={mixId} onChange={(event) => setMixId(event.target.value)}>
                  <option value="">{t('dispatch.m11.noMix')}</option>
                  {plantMixes.map((mix) => (
                    <option key={mix.id} value={mix.id}>
                      {mix.code} · {lang === 'ar' ? mix.name_ar : mix.name_en}
                    </option>
                  ))}
                </select>
              </label>
              <div className="filters__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || !target || !driver.trim() || Number(target) <= 0}
                  onClick={createTrip}
                >
                  {t('dispatch.m11.create')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setOrderId('');
                    setTarget('');
                    setDriver('');
                    setNewTruck('');
                    setMixId('');
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <p className="muted">{t('dispatch.m11.selectOrder')}</p>
          )}
        </Card>
      ) : (
        <Card>
          <p className="muted">{t('dispatch.m11.readOnly')}</p>
        </Card>
      )}

      <div className="dispatch-layout">
        <div className="dispatch-board">
          {TRIP_GROUPS.map((group) => (
            <section key={group} className={`dispatch-column dispatch-column--${group}`}>
              <header className="dispatch-column__head">
                <span>{t(GROUP_LABEL[group])}</span>
                <Badge tone={group === 'done' ? 'success' : group === 'unloading' ? 'warning' : 'neutral'}>
                  {groups[group].length}
                </Badge>
              </header>
              <div className="dispatch-column__body">
                {groups[group].length === 0 ? (
                  <p className="dispatch-empty">{t('dispatch.m11.noTrips')}</p>
                ) : (
                  groups[group].map((trip) => {
                    const stageMinutes =
                      trip.stage_elapsed_minutes ?? elapsedSince(trip.stage_started_at, nowMs);
                    const waitNow =
                      trip.finish_unload_time !== null
                        ? trip.wait_min_at_site
                        : elapsedSince(trip.arrive_site_time, nowMs);
                    const waitFlagged = waitNow !== null && waitNow > 30;
                    const tripCost = tripCosts[trip.id];
                    const next = nextTripStatus(trip.status);
                    return (
                      <article key={trip.id} className={`trip-card trip-card--${trip.group}`}>
                        <div className="trip-card__head">
                          <div>
                            <strong>{trip.order_no || trip.id}</strong>
                            <span>{customerName(trip)}</span>
                            <span className="muted">{trip.id}</span>
                          </div>
                          <Badge tone={TONE[trip.status] ?? 'neutral'}>
                            {t(`dispatch.tripStatus.${trip.status}`, { defaultValue: trip.status })}
                          </Badge>
                        </div>
                        <div className="trip-card__meta">
                          <span>
                            {t('dispatch.m11.project')}: {projectName(trip) || '—'}
                          </span>
                          <span>
                            {t('dispatch.m11.truck')}:{' '}
                            {trip.truck_plate || <em>{t('dispatch.m11.unassigned')}</em>}
                          </span>
                          <span>
                            {t('dispatch.m11.driver')}: {trip.driver_name || '—'}
                          </span>
                          <span>
                            {t('dispatch.m11.grade')}: {trip.concrete_grade || '—'} ·{' '}
                            {t('dispatch.m11.target')}: {m3(trip.target_m3)}
                            {trip.loaded_m3 !== null ? ` · ${t('dispatch.m11.loaded')}: ${m3(trip.loaded_m3)}` : ''}
                          </span>
                          <span>
                            {t('dispatch.m11.stage')}: {minutes(stageMinutes)}
                            {trip.cycle_minutes !== null ? ` · ${t('dispatch.m11.cycle')}: ${minutes(trip.cycle_minutes)}` : ''}
                          </span>
                          <span className={waitFlagged ? 'trip-wait trip-wait--danger' : 'trip-wait'}>
                            {t('dispatch.m11.wait')}: {minutes(waitNow)}
                            {waitFlagged ? ` · ${t('dispatch.m11.waitRed')}` : ''}
                          </span>
                          {trip.cancel_reason ? (
                            <span className="trip-cancel-reason">
                              {t('dispatch.m11.cancelReason')}: {trip.cancel_reason}
                            </span>
                          ) : null}
                          {tripCost ? (
                            <span className={tripCost.status === 'incomplete' ? 'trip-wait trip-wait--danger' : ''}>
                              {t('dispatch.m11.tripCost')}: {formatMoney(Number(tripCost.total_cost), lang)}
                              {tripCost.cost_per_m3 ? ` · ${formatMoney(Number(tripCost.cost_per_m3), lang)}/m³` : ''}
                              {tripCost.status === 'incomplete'
                                ? ` · ${t('cost.incompleteFields', { fields: tripCost.missing_fields.join(', ') || '—' })}`
                                : ''}
                            </span>
                          ) : null}
                        </div>
                        {level >= 3 && !isTerminalTripStatus(trip.status) ? (
                          <div className="trip-card__actions">
                            {trip.status === 'loading' ? (
                              <label className="trip-loaded-input">
                                <span>{t('dispatch.m11.loaded')}</span>
                                <input
                                  type="number"
                                  min="0.1"
                                  step="0.1"
                                  max={trip.truck_capacity_m3 ?? undefined}
                                  value={loadedDrafts[trip.id] ?? String(trip.target_m3)}
                                  onChange={(event) =>
                                    setLoadedDrafts((current) => ({ ...current, [trip.id]: event.target.value }))
                                  }
                                />
                              </label>
                            ) : null}
                            {next ? (
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                disabled={
                                  busy ||
                                  !trip.truck_id ||
                                  (trip.status === 'loading' &&
                                    Number(loadedDrafts[trip.id] ?? trip.target_m3) <= 0)
                                }
                                onClick={() => advance(trip)}
                              >
                                {t(NEXT_KEY[trip.status] ?? 'dispatch.m11.advance')}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={busy}
                              onClick={() => {
                                setCancelId(trip.id);
                                setCancelReason('');
                              }}
                            >
                              {t('dispatch.m11.cancelTrip')}
                            </button>
                          </div>
                        ) : null}
                        {!trip.truck_id && trip.status === 'queued' ? (
                          <p className="trip-unassigned-note">{t('dispatch.m11.noTruckAssigned')}</p>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          ))}
        </div>

        <aside className="dispatch-trucks">
          <Card title={t('dispatch.m11.trucks')} subtitle={t('dispatch.m11.truckPanelNote')}>
            {(board.trucks ?? []).length === 0 ? (
              <p className="muted">{t('dispatch.m11.noTrucks')}</p>
            ) : (
              <div className="truck-list">
                {board.trucks.map((truck) => (
                  <div key={truck.id} className="truck-row">
                    <div className="truck-row__head">
                      <strong>{truck.plate_no}</strong>
                      <Badge tone={truck.status === 'available' ? 'success' : truck.status === 'maintenance' ? 'danger' : 'info'}>
                        {t(`fleet.status.${truck.status}`)}
                      </Badge>
                    </div>
                    <div className="truck-row__meta">
                      <span>
                        {t('dispatch.m11.truckCapacity')}: {truck.capacity_m3} m³
                      </span>
                      <span>
                        {truck.trips_today} {t('dispatch.m11.tripsPerDay')}
                      </span>
                      <span>
                        {m3(truck.m3_today)} {t('dispatch.m11.m3PerDay')}
                      </span>
                    </div>
                    {level >= 3 && truck.status === 'available' && queuedWithoutTruck.length > 0 ? (
                      <div className="truck-row__assign">
                        <select
                          value={assignPick[truck.id] ?? ''}
                          onChange={(event) =>
                            setAssignPick((current) => ({ ...current, [truck.id]: event.target.value }))
                          }
                        >
                          <option value="">{t('dispatch.m11.selectQueued')}</option>
                          {queuedWithoutTruck.map((trip) => (
                            <option key={trip.id} value={trip.id}>
                              {trip.order_no} · {m3(trip.target_m3)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy || !assignPick[truck.id]}
                          onClick={() => assign(truck)}
                        >
                          {t('dispatch.m11.assign')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>

      {cancelId ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('dispatch.m11.cancelTrip')}
          className="modal-backdrop"
        >
          <div className="card modal-card">
            <header className="card__header">
              <div>
                <h2 className="card__title">{t('dispatch.m11.cancelTrip')}</h2>
                <p className="card__subtitle">{t('dispatch.m11.cancelNote')}</p>
              </div>
            </header>
            <div className="card__body">
              <label className="field">
                <span>{t('dispatch.m11.cancelReason')}</span>
                <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
              </label>
              <div className="filters__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || cancelReason.trim().length < 5}
                  onClick={cancel}
                >
                  {t('dispatch.m11.cancelTrip')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCancelId(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
