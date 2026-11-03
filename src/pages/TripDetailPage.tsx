import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone } from '../components/ui';
import type { Lang } from '../types';

/**
 * M5 — one trip. Timestamps, loaded and delivered volumes, the site wait and the difference
 * reason are read from the trip row. Departure, arrival, delivery, return and abort move the
 * documented lifecycle; a difference outside the configured band stays approval_required until
 * a level-4 override is recorded, and the override is stored with its actor and reason.
 */

interface Trip {
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
  status: string;
  aborted_reason: string | null;
}

const TONE: Record<string, BadgeTone> = {
  planned: 'neutral',
  departed: 'info',
  arrived: 'warning',
  returned: 'success',
  aborted: 'danger',
};

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.code === 'approval_required') return 'trip.err.approvalRequired';
    if (caught.code === 'mandatory_failure') return 'trip.err.mandatoryFailure';
    if (caught.code === 'invalid_transition') return 'trip.err.invalidTransition';
    if (caught.code === 'validation_error') return 'trip.err.validation';
  }
  return 'errors.network';
};

export const TripDetailPage = ({ tripId, onBack }: { tripId: string; onBack: () => void }) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState('');
  const [delivered, setDelivered] = useState('');
  const [reason, setReason] = useState('');
  const [abortReason, setAbortReason] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ trip: Trip }>(`/api/fleet/trips/${encodeURIComponent(tripId)}`);
      setTrip(response.trip);
      setDelivered(response.trip.delivered_volume_m3 === null ? '' : String(response.trip.delivered_volume_m3));
      setReason(response.trip.volume_diff_reason ?? '');
      setWait(response.trip.site_wait_minutes === null ? '' : String(response.trip.site_wait_minutes));
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/fleet/trips/${encodeURIComponent(tripId)}${path}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setNeedsOverride(false);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'approval_required') setNeedsOverride(true);
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const deliver = () => act('/delivery', { deliveredVolumeM3: Number(delivered), reason });

  const approveAndDeliver = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/fleet/trips/${encodeURIComponent(tripId)}/override`, {
        method: 'POST',
        body: JSON.stringify({
          ruleCode: 'fleet.volume_difference_band',
          reason,
          decision: 'approved',
        }),
      });
      await apiFetch(`/api/fleet/trips/${encodeURIComponent(tripId)}/delivery`, {
        method: 'POST',
        body: JSON.stringify({ deliveredVolumeM3: Number(delivered), reason }),
      });
      setNeedsOverride(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (!trip) return <ErrorNote>{t(error ?? 'errors.network')}</ErrorNote>;

  const stamp = (value: string | null) =>
    value === null ? '—' : new Date(value).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB');
  const volume = (value: number | null) => (value === null ? '—' : `${value} m³`);

  const rows: Array<[string, string]> = [
    [t('trip.departedAt'), stamp(trip.departed_at)],
    [t('trip.arrivedAt'), stamp(trip.arrived_at)],
    [t('trip.returnedAt'), stamp(trip.returned_at)],
    [t('trip.loaded'), volume(trip.loaded_volume_m3)],
    [t('trip.delivered'), volume(trip.delivered_volume_m3)],
    [t('trip.wait'), trip.site_wait_minutes === null ? '—' : `${trip.site_wait_minutes} min`],
    [t('trip.diffReason'), trip.volume_diff_reason ?? '—'],
    [t('trip.assignment'), trip.assignment_id],
    [t('trip.batch'), trip.batch_id ?? t('trip.batchNone')],
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={`${t('trip.title')} · ${trip.id}`}
        subtitle={t('trip.subtitle')}
        badge={<Badge tone={TONE[trip.status] ?? 'neutral'}>{t(`trip.status.${trip.status}`)}</Badge>}
      />

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      <Card title={t('trip.timestamps')}>
        <table className="data-table">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th className="align-start">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
            {trip.aborted_reason ? (
              <tr>
                <th className="align-start">{t('trip.abortReason')}</th>
                <td>{trip.aborted_reason}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      {level < 3 ? (
        <Card>
          <p className="muted">{t('trip.readOnly')}</p>
          <div className="filters__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
              {t('common.cancel')}
            </button>
          </div>
        </Card>
      ) : trip.status === 'returned' || trip.status === 'aborted' ? (
        <Card>
          <div className="filters__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
              {t('common.cancel')}
            </button>
          </div>
        </Card>
      ) : (
        <>
          <Card title={t('trip.actions')}>
            <div className="filters">
              {trip.status === 'planned' ? (
                <div className="filters__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={busy}
                    onClick={() => void act('/depart')}
                  >
                    {t('trip.depart')}
                  </button>
                </div>
              ) : null}
              {trip.status === 'departed' ? (
                <>
                  <label className="field">
                    <span>{t('trip.wait')}</span>
                    <input
                      type="number"
                      min="0"
                      value={wait}
                      onChange={(event) => setWait(event.target.value)}
                    />
                  </label>
                  <div className="filters__actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={busy}
                      onClick={() => void act('/arrive', { siteWaitMinutes: wait === '' ? null : Number(wait) })}
                    >
                      {t('trip.arrive')}
                    </button>
                  </div>
                </>
              ) : null}
              {trip.status === 'departed' || trip.status === 'arrived' ? (
                <>
                  <label className="field">
                    <span>{t('trip.deliveredVolume')}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={delivered}
                      onChange={(event) => setDelivered(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t('trip.reason')}</span>
                    <input value={reason} onChange={(event) => setReason(event.target.value)} />
                  </label>
                  <div className="filters__actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={busy || delivered === '' || reason.trim().length < 5}
                      onClick={() => void deliver()}
                    >
                      {t('trip.recordDelivery')}
                    </button>
                  </div>
                </>
              ) : null}
              {trip.status === 'arrived' ? (
                <div className="filters__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={busy}
                    onClick={() => void act('/return')}
                  >
                    {t('trip.return')}
                  </button>
                </div>
              ) : null}
            </div>

            {needsOverride && level >= 4 ? (
              <div className="info-note info-note--warning">
                <p>{t('trip.overrideNote')}</p>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() => void approveAndDeliver()}
                >
                  {t('trip.approveDifference')}
                </button>
              </div>
            ) : null}
          </Card>

          <Card title={t('trip.abort')} subtitle={t('trip.abortNote')}>
            <div className="filters">
              <label className="field">
                <span>{t('trip.abortReason')}</span>
                <input value={abortReason} onChange={(event) => setAbortReason(event.target.value)} />
              </label>
              <div className="filters__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy || abortReason.trim().length < 5}
                  onClick={() => void act('/abort', { reason: abortReason })}
                >
                  {t('trip.abort')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
