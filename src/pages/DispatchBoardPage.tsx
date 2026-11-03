import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Card,
  DataTable,
  ErrorNote,
  LoadingBlock,
  SectionTitle,
  type BadgeTone,
  type TableColumn,
} from '../components/ui';
import type { Lang } from '../types';
import { TripDetailPage } from './TripDetailPage';

/**
 * M5 — the dispatch board. The queue is the assignment lifecycle: propose (3), confirm (3),
 * dispatch (3, with the loaded volume), cancel (4, with a reason). A truck in maintenance or
 * retired is refused by the API even if the row is stale here, and the trip opens the detail
 * view where departure, arrival, delivery and return are recorded.
 */

interface Assignment {
  id: string;
  plant_id: string;
  order_id: string | null;
  truck_id: string;
  truck_plate: string;
  driver_id: string;
  driver_name: string;
  sequence_no: number;
  status: string;
  proposed_at: string;
  confirmed_at: string | null;
  dispatched_at: string | null;
  trip_id: string | null;
}

interface Truck {
  id: string;
  plant_id: string;
  plate_no: string;
  status: string;
}

interface Driver {
  id: string;
  plant_id: string;
  full_name: string;
}

const TONE: Record<string, BadgeTone> = {
  proposed: 'neutral',
  confirmed: 'info',
  dispatched: 'purple',
  delivered: 'success',
  closed: 'success',
  cancelled: 'danger',
};

const STATUSES = ['proposed', 'confirmed', 'dispatched', 'delivered', 'closed', 'cancelled'];

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.code === 'mandatory_failure') return 'dispatch.err.mandatoryFailure';
    if (caught.code === 'invalid_transition') return 'dispatch.err.invalidTransition';
    if (caught.code === 'validation_error') return 'dispatch.err.validation';
  }
  return 'errors.network';
};

export const DispatchBoardPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [plantId, setPlantId] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);

  const [proposePlant, setProposePlant] = useState('');
  const [proposeTruck, setProposeTruck] = useState('');
  const [proposeDriver, setProposeDriver] = useState('');
  const [proposeSequence, setProposeSequence] = useState('1');

  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [loadedVolume, setLoadedVolume] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (plantId) query.set('plantId', plantId);
      if (status) query.set('status', status);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const response = await apiFetch<{ assignments: Assignment[] }>(`/api/fleet/assignments${suffix}`);
      setAssignments(response.assignments);

      if (level >= 3) {
        const [truckResponse, driverResponse] = await Promise.all([
          apiFetch<{ trucks: Truck[] }>('/api/fleet/trucks'),
          apiFetch<{ drivers: Driver[] }>('/api/fleet/drivers'),
        ]);
        setTrucks(truckResponse.trucks);
        setDrivers(driverResponse.drivers);
        if (!proposePlant) {
          const first = truckResponse.trucks.find((truck) => truck.status === 'available')?.plant_id ?? '';
          if (first) setProposePlant(first);
        }
      }
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [plantId, status, level, proposePlant]);

  useEffect(() => {
    void load();
  }, [load]);

  const plants = useMemo(() => {
    const seen = new Set<string>();
    for (const row of assignments) seen.add(row.plant_id);
    for (const truck of trucks) seen.add(truck.plant_id);
    return [...seen];
  }, [assignments, trucks]);

  const plantTrucks = trucks.filter((truck) => truck.plant_id === proposePlant);
  const plantDrivers = drivers.filter((driver) => driver.plant_id === proposePlant);

  const act = async (id: string, path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/fleet/assignments/${encodeURIComponent(id)}${path}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setDispatchId(null);
      setCancelId(null);
      setCancelReason('');
      setLoadedVolume('');
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/fleet/assignments', {
        method: 'POST',
        body: JSON.stringify({
          plantId: proposePlant,
          orderId: null,
          truckId: proposeTruck,
          driverId: proposeDriver,
          sequenceNo: Number(proposeSequence) || 1,
        }),
      });
      setProposeTruck('');
      setProposeDriver('');
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (tripId) {
    return (
      <TripDetailPage
        tripId={tripId}
        onBack={() => {
          setTripId(null);
          void load();
        }}
      />
    );
  }

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error && assignments.length === 0) return <ErrorNote>{t(error)}</ErrorNote>;

  const columns: TableColumn<Assignment>[] = [
    { key: 'truck_plate', header: t('dispatch.truck') },
    { key: 'driver_name', header: t('dispatch.driver') },
    { key: 'sequence_no', header: t('dispatch.sequence'), align: 'end' },
    { key: 'plant_id', header: t('fleet.plant') },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`dispatch.status.${row.status}`)}</Badge>,
    },
    {
      key: 'proposed_at',
      header: t('dispatch.proposedAt'),
      render: (row) => new Date(row.proposed_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    },
    {
      key: 'id',
      header: '',
      render: (row) => (
        <div className="filters__actions">
          {level >= 3 && row.status === 'proposed' ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => void act(row.id, '/confirm')}
            >
              {t('dispatch.confirm')}
            </button>
          ) : null}
          {level >= 3 && (row.status === 'proposed' || row.status === 'confirmed') ? (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={() => setDispatchId(row.id)}
            >
              {t('dispatch.dispatch')}
            </button>
          ) : null}
          {row.trip_id ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTripId(row.trip_id)}>
              {t('dispatch.openTrip')}
            </button>
          ) : null}
          {level >= 4 && row.status !== 'cancelled' && row.status !== 'closed' ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => {
                setCancelId(row.id);
                setCancelReason('');
              }}
            >
              {t('dispatch.cancel')}
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('dispatch.title')}
        subtitle={t('dispatch.subtitle')}
        badge={<Badge tone="purple">{assignments.length}</Badge>}
      />

      {level >= 3 ? (
        <Card title={t('dispatch.newAssignment')} subtitle={t('dispatch.newAssignmentNote')}>
          <div className="filters">
            <label className="field">
              <span>{t('fleet.plant')}</span>
              <select
                value={proposePlant}
                onChange={(event) => {
                  setProposePlant(event.target.value);
                  setProposeTruck('');
                  setProposeDriver('');
                }}
              >
                <option value="">{t('common.all')}</option>
                {plants.map((plant) => (
                  <option key={plant} value={plant}>
                    {plant}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('dispatch.truck')}</span>
              <select value={proposeTruck} onChange={(event) => setProposeTruck(event.target.value)}>
                <option value="">{t('dispatch.selectTruck')}</option>
                {plantTrucks.map((truck) => (
                  <option key={truck.id} value={truck.id}>
                    {truck.plate_no} · {t(`fleet.status.${truck.status}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('dispatch.driver')}</span>
              <select value={proposeDriver} onChange={(event) => setProposeDriver(event.target.value)}>
                <option value="">{t('dispatch.selectDriver')}</option>
                {plantDrivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('dispatch.sequence')}</span>
              <input
                type="number"
                min="1"
                value={proposeSequence}
                onChange={(event) => setProposeSequence(event.target.value)}
              />
            </label>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !proposeTruck || !proposeDriver || !proposePlant}
                onClick={() => void propose()}
              >
                {t('dispatch.propose')}
              </button>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="muted">{t('dispatch.readOnly')}</p>
        </Card>
      )}

      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('fleet.plant')}</span>
            <select value={plantId} onChange={(event) => setPlantId(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {plants.map((plant) => (
                <option key={plant} value={plant}>
                  {plant}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`dispatch.status.${value}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="error-note">{t(error)}</p> : null}
        <DataTable columns={columns} rows={assignments} rowKey={(row) => row.id} empty={t('dispatch.empty')} />
      </Card>

      {dispatchId ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('dispatch.dispatch')}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 40,
          }}
        >
          <div className="card" style={{ maxWidth: '28rem', width: '100%' }}>
            <header className="card__header">
              <div>
                <h2 className="card__title">{t('dispatch.dispatch')}</h2>
                <p className="card__subtitle">{t('dispatch.dispatchNote')}</p>
              </div>
            </header>
            <div className="card__body">
              <label className="field">
                <span>{t('dispatch.loadedVolume')}</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={loadedVolume}
                  onChange={(event) => setLoadedVolume(event.target.value)}
                />
              </label>
              <div className="filters__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || loadedVolume === ''}
                  onClick={() =>
                    void act(dispatchId, '/dispatch', {
                      loadedVolumeM3: Number(loadedVolume),
                      batchId: null,
                    })
                  }
                >
                  {t('dispatch.dispatch')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDispatchId(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {cancelId ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('dispatch.cancel')}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 40,
          }}
        >
          <div className="card" style={{ maxWidth: '28rem', width: '100%' }}>
            <header className="card__header">
              <div>
                <h2 className="card__title">{t('dispatch.cancel')}</h2>
                <p className="card__subtitle">{t('dispatch.cancelNote')}</p>
              </div>
            </header>
            <div className="card__body">
              <label className="field">
                <span>{t('dispatch.cancelReason')}</span>
                <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
              </label>
              <div className="filters__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || cancelReason.trim().length < 5}
                  onClick={() => void act(cancelId, '/cancel', { reason: cancelReason })}
                >
                  {t('dispatch.cancel')}
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
