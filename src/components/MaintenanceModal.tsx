import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';

/**
 * M5 — open or close maintenance. Opening moves the truck to `maintenance` (level 4); closing
 * records the cost and odometer and returns it to `available`. The truck cannot be dispatched
 * while the record is open, and the API refuses the dispatch, not only the form.
 */

interface Truck {
  id: string;
  plate_no: string;
  status: string;
  odometer_km: number | null;
}

interface MaintenanceRecord {
  id: string;
  truck_id: string;
  status: string;
  maintenance_type: string;
  opened_at: string;
}

interface Props {
  truck: Truck | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const message = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.code === 'invalid_transition') return 'fleet.err.invalidTransition';
  }
  return 'errors.network';
};

export const MaintenanceModal = ({ truck, open, onClose, onSaved }: Props) => {
  const { t } = useTranslation();
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [type, setType] = useState('service');
  const [odometer, setOdometer] = useState('');
  const [notes, setNotes] = useState('');
  const [cost, setCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !truck) return;
    setType('service');
    setOdometer(truck.odometer_km === null ? '' : String(truck.odometer_km));
    setNotes('');
    setCost('');
    setError(null);
    setSaving(false);
    void apiFetch<{ maintenance: MaintenanceRecord[] }>('/api/fleet/maintenance')
      .then((response) => setRecords(response.maintenance))
      .catch((caught) => setError(message(caught)));
  }, [open, truck]);

  if (!open || !truck) return null;

  const current = records.find((record) => record.truck_id === truck.id && record.status === 'open');
  const closing = truck.status === 'maintenance' && current !== undefined;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (closing && current) {
        await apiFetch(`/api/fleet/maintenance/${encodeURIComponent(current.id)}/close`, {
          method: 'POST',
          body: JSON.stringify({
            costAmount: cost === '' ? null : Number(cost),
            odometerKm: odometer === '' ? null : Number(odometer),
          }),
        });
      } else {
        await apiFetch('/api/fleet/maintenance', {
          method: 'POST',
          body: JSON.stringify({
            truckId: truck.id,
            maintenanceType: type,
            odometerKm: odometer === '' ? null : Number(odometer),
            notes,
          }),
        });
      }
      onSaved();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={closing ? t('fleet.closeMaintenance') : t('fleet.openMaintenance')}
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
      <div className="card" style={{ maxWidth: '32rem', width: '100%' }}>
        <header className="card__header">
          <div>
            <h2 className="card__title">
              {closing ? t('fleet.closeMaintenance') : t('fleet.openMaintenance')} · {truck.plate_no}
            </h2>
            <p className="card__subtitle">{t('fleet.maintenanceNote')}</p>
          </div>
        </header>
        <div className="card__body">
          <div className="filters">
            {closing ? null : (
              <label className="field">
                <span>{t('fleet.maintenanceType')}</span>
                <select value={type} onChange={(event) => setType(event.target.value)}>
                  <option value="service">{t('fleet.maintenanceKind.service')}</option>
                  <option value="repair">{t('fleet.maintenanceKind.repair')}</option>
                  <option value="inspection">{t('fleet.maintenanceKind.inspection')}</option>
                </select>
              </label>
            )}
            <label className="field">
              <span>{t('fleet.odometer')}</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
              />
            </label>
            {closing ? (
              <label className="field">
                <span>{t('fleet.cost')}</span>
                <input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} />
              </label>
            ) : (
              <label className="field">
                <span>{t('fleet.notes')}</span>
                <input value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
            )}
          </div>
          {error ? <p className="error-note">{t(error)}</p> : null}
          <div className="filters__actions">
            <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={() => void submit()}>
              {saving ? t('common.loading') : t('common.save')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
