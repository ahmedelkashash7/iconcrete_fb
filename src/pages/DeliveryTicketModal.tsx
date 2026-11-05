import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, ErrorNote } from '../components/ui';
import type { Lang } from '../types';
import {
  apiMessage,
  fmtQty,
  today,
  type Assignment,
  type Batch,
  type DeliveryTicket,
  type Driver,
  type SalesOrder,
  type Truck,
} from './salesShared';

/**
 * M7 — delivery ticket. The ticket must name the trip and the truck; the trip's own truck is
 * enforced by the server. More delivered than loaded needs a level-4 reason. When batch lines are
 * recorded their volumes must cover the loaded volume, and several batches may sit on one ticket.
 */

interface BatchDraft {
  batchId: string;
  volumeM3: string;
  pricePerM3: string;
}

export const DeliveryTicketModal = ({
  order,
  onClose,
  onSaved,
}: {
  order: SalesOrder;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    ticketNo: '',
    tripId: '',
    truckId: '',
    driverId: '',
    ticketDate: today(),
    loadedVol: '',
    deliveredVol: '',
    reason: '',
  });
  const [lines, setLines] = useState<BatchDraft[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [assignmentResponse, truckResponse, driverResponse, batchResponse] = await Promise.all([
        apiFetch<{ assignments: Assignment[] }>('/api/fleet/assignments'),
        apiFetch<{ trucks: Truck[] }>('/api/fleet/trucks'),
        apiFetch<{ drivers: Driver[] }>('/api/fleet/drivers'),
        apiFetch<{ batches: Batch[] }>('/api/batches'),
      ]);
      setAssignments(assignmentResponse.assignments.filter((assignment) => assignment.trip_id));
      setTrucks(truckResponse.trucks);
      setDrivers(driverResponse.drivers);
      setBatches(batchResponse.batches);
    } catch (caught) {
      setError(apiMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remaining = useMemo(
    () => Math.max(0, order.ordered_qty - order.delivered_qty),
    [order.ordered_qty, order.delivered_qty],
  );

  const chooseTrip = (tripId: string) => {
    const assignment = assignments.find((row) => row.trip_id === tripId);
    setForm((current) => ({
      ...current,
      tripId,
      truckId: assignment?.truck_id ?? current.truckId,
      driverId: assignment?.driver_id ?? current.driverId,
    }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ ticket: DeliveryTicket }>('/api/sales/tickets', {
        method: 'POST',
        body: JSON.stringify({
          ticketNo: form.ticketNo || null,
          orderId: order.id,
          tripId: form.tripId,
          truckId: form.truckId,
          driverId: form.driverId || null,
          ticketDate: form.ticketDate,
          loadedVol: Number(form.loadedVol),
          deliveredVol: form.deliveredVol === '' ? undefined : Number(form.deliveredVol),
          reason: form.reason,
          batches: lines
            .filter((line) => line.volumeM3)
            .map((line) => ({
              batchId: line.batchId || null,
              volumeM3: Number(line.volumeM3),
              pricePerM3: Number(line.pricePerM3 || 0),
            })),
        }),
      });
      await apiFetch(`/api/sales/tickets/${encodeURIComponent(created.ticket.id)}/confirm`, {
        method: 'POST',
      });
      onSaved();
      onClose();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal modal--wide">
        <div className="modal__header">
          <div>
            <h2>{t('sales.ticketTitle')}</h2>
            <p className="muted">
              {order.order_no} — {order.customer_name} · {t('sales.remaining')}: {fmtQty(remaining, lang)} m³
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
        <div className="filters">
          <label className="field">
            <span>{t('sales.ticketNo')}</span>
            <input value={form.ticketNo} onChange={(event) => setForm((current) => ({ ...current, ticketNo: event.target.value }))} />
          </label>
          <label className="field">
            <span>{t('sales.trip')}</span>
            <select value={form.tripId} onChange={(event) => chooseTrip(event.target.value)}>
              <option value="">—</option>
              {assignments.map((assignment) => (
                <option key={assignment.trip_id!} value={assignment.trip_id!}>
                  {assignment.trip_id} · {assignment.truck_plate} · {assignment.driver_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('sales.truck')}</span>
            <select value={form.truckId} onChange={(event) => setForm((current) => ({ ...current, truckId: event.target.value }))}>
              <option value="">—</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plate_no}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('sales.driver')}</span>
            <select value={form.driverId} onChange={(event) => setForm((current) => ({ ...current, driverId: event.target.value }))}>
              <option value="">—</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('common.date')}</span>
            <input type="date" value={form.ticketDate} onChange={(event) => setForm((current) => ({ ...current, ticketDate: event.target.value }))} />
          </label>
          <label className="field">
            <span>{t('sales.loadedVol')}</span>
            <input type="number" min="0" step="0.001" value={form.loadedVol} onChange={(event) => setForm((current) => ({ ...current, loadedVol: event.target.value }))} />
          </label>
          <label className="field">
            <span>{t('sales.deliveredVol')}</span>
            <input type="number" min="0" step="0.001" value={form.deliveredVol} onChange={(event) => setForm((current) => ({ ...current, deliveredVol: event.target.value }))} />
          </label>
          {level >= 4 ? (
            <label className="field">
              <span>{t('sales.reasonOptional')}</span>
              <input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
            </label>
          ) : null}
          <div className="filters__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLines((current) => [...current, { batchId: '', volumeM3: '', pricePerM3: '' }])}>
              {t('sales.addBatch')}
            </button>
          </div>
        </div>

        {lines.map((line, index) => (
          <div className="filters" key={`batch-${index}`}>
            <label className="field">
              <span>{t('sales.batch')}</span>
              <select
                value={line.batchId}
                onChange={(event) =>
                  setLines((current) => current.map((row, position) => (position === index ? { ...row, batchId: event.target.value } : row)))
                }
              >
                <option value="">—</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.batch_no} · {batch.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('sales.volume')}</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={line.volumeM3}
                onChange={(event) =>
                  setLines((current) => current.map((row, position) => (position === index ? { ...row, volumeM3: event.target.value } : row)))
                }
              />
            </label>
            <label className="field">
              <span>{t('sales.pricePerM3')}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={line.pricePerM3}
                onChange={(event) =>
                  setLines((current) => current.map((row, position) => (position === index ? { ...row, pricePerM3: event.target.value } : row)))
                }
              />
            </label>
          </div>
        ))}

        <div className="filters">
          <Badge tone="info">{t('sales.ticketConfirmNote')}</Badge>
          <div className="filters__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || !form.tripId || !form.truckId || !form.loadedVol}
              onClick={() => void save()}
            >
              {t('sales.createTicket')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
