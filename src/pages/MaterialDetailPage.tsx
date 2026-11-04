import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, StatCard, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import {
  apiMessage,
  fmtDate,
  fmtMoney,
  fmtQty,
  today,
  type Material,
  type Movement,
} from './inventoryShared';

/**
 * M6 — one material: derived balance, moving-average cost, reorder alert, movement history and
 * the posting form. Posting is level 3; an adjustment is level 4. Stock is never edited: a
 * correction is a new movement.
 */
export const MaterialDetailPage = ({
  material,
  onClose,
  onChanged,
}: {
  material: Material;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    movementType: 'issue',
    quantity: '',
    unitCost: '',
    reason: '',
    lotNo: '',
    snapshotDate: today(),
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ movements: Movement[] }>(
        `/api/inventory/movements?materialId=${encodeURIComponent(material.id)}&limit=100`,
      );
      setMovements(response.movements);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [material.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/api/inventory/movements', {
        method: 'POST',
        body: JSON.stringify({
          plantId: material.plant_id,
          materialId: material.id,
          quantity: Number(form.quantity),
          unit: material.unit_of_measure,
          movementType: form.movementType,
          unitCost: form.unitCost === '' ? null : Number(form.unitCost),
          reason: form.reason,
          lotNo: form.lotNo,
        }),
      });
      setForm((current) => ({ ...current, quantity: '', reason: '' }));
      setNotice(t('inventory.movementPosted'));
      await load();
      onChanged();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const snapshot = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{ snapshot: { closingQty: number; closingValue: number; agrees: boolean } }>(
        '/api/inventory/snapshots',
        {
          method: 'POST',
          body: JSON.stringify({
            plantId: material.plant_id,
            materialId: material.id,
            date: form.snapshotDate,
          }),
        },
      );
      setNotice(
        response.snapshot.agrees
          ? t('inventory.snapshotAgrees')
          : t('inventory.snapshotDisagrees'),
      );
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const low = material.reorder_point !== null && material.balance <= material.reorder_point;
  const adjustment = form.movementType === 'adjustment';

  const columns: TableColumn<Movement>[] = [
    { key: 'occurred_at', header: t('inventory.date'), render: (row) => fmtDate(row.occurred_at, lang) },
    {
      key: 'movement_type',
      header: t('inventory.movementType'),
      render: (row) => <Badge tone={row.movement_type === 'receipt' ? 'success' : 'info'}>{t(`inventory.movement.${row.movement_type}`)}</Badge>,
    },
    { key: 'quantity', header: t('inventory.quantity'), align: 'end', render: (row) => `${fmtQty(row.quantity, lang)} ${row.unit}` },
    { key: 'unit_cost', header: t('inventory.unitCost'), align: 'end', render: (row) => (row.unit_cost === null ? '—' : fmtMoney(row.unit_cost, lang)) },
    { key: 'total_cost', header: t('inventory.value'), align: 'end', render: (row) => (row.total_cost === null ? '—' : fmtMoney(row.total_cost, lang)) },
    { key: 'lot_no', header: t('inventory.lot'), render: (row) => row.lot_no || '—' },
    { key: 'reference_type', header: t('inventory.reference'), render: (row) => (row.reference_id ? `${row.reference_type} · ${row.reference_id}` : row.reference_type) },
    { key: 'reason', header: t('inventory.reason'), render: (row) => row.reason || '—' },
    { key: 'created_by', header: t('inventory.by'), render: (row) => row.created_by },
  ];

  return (
    <div className="page-stack">
      <Card
        title={`${material.material_code} — ${lang === 'ar' ? material.name_ar : material.name_en || material.name_ar}`}
        subtitle={t('inventory.materialDetail')}
        actions={
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            {t('common.close')}
          </button>
        }
      >
        <div className="kpi-grid">
          <StatCard label={t('inventory.balance')} value={`${fmtQty(material.balance, lang)} ${material.unit_of_measure}`} tone={low ? 'danger' : 'success'} />
          <StatCard label={t('inventory.avgCost')} value={fmtMoney(material.average_cost, lang)} />
          <StatCard label={t('inventory.reorderPoint')} value={material.reorder_point === null ? t('inventory.notConfigured') : fmtQty(material.reorder_point, lang)} />
          <StatCard
            label={t('inventory.method')}
            value={material.valuation_method === null ? t('inventory.notConfigured') : t(`inventory.method.${material.valuation_method}`)}
            hint={material.is_bulk ? t('inventory.bulk') : t('inventory.nonBulk')}
          />
        </div>
        {low ? <InfoNote tone="danger">{t('inventory.lowStockAlert')}</InfoNote> : null}
        {material.valuation_method === null ? <InfoNote tone="warning">{t('inventory.methodMissing')}</InfoNote> : null}
      </Card>

      {notice ? <InfoNote tone="info">{notice}</InfoNote> : null}
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      <Card title={t('inventory.postMovement')}>
        {level < 3 ? (
          <p className="muted">{t('inventory.readOnly')}</p>
        ) : (
          <div className="filters">
            <label className="field">
              <span>{t('inventory.movementType')}</span>
              <select
                value={form.movementType}
                onChange={(event) => setForm((current) => ({ ...current, movementType: event.target.value }))}
              >
                <option value="issue">{t('inventory.movement.issue')}</option>
                <option value="consumption">{t('inventory.movement.consumption')}</option>
                <option value="return">{t('inventory.movement.return')}</option>
                {level >= 4 ? <option value="adjustment">{t('inventory.movement.adjustment')}</option> : null}
              </select>
            </label>
            <label className="field">
              <span>{t('inventory.quantity')} ({material.unit_of_measure})</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={form.quantity}
                onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
              />
            </label>
            {form.movementType !== 'issue' && form.movementType !== 'consumption' ? (
              <label className="field">
                <span>{t('inventory.unitCost')}</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.unitCost}
                  onChange={(event) => setForm((current) => ({ ...current, unitCost: event.target.value }))}
                />
              </label>
            ) : null}
            <label className="field">
              <span>{t('inventory.lot')}</span>
              <input value={form.lotNo} onChange={(event) => setForm((current) => ({ ...current, lotNo: event.target.value }))} />
            </label>
            <label className="field field--wide">
              <span>{t('inventory.reason')}</span>
              <input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !form.quantity || Number(form.quantity) <= 0}
                onClick={() => void post()}
              >
                {t('inventory.post')}
              </button>
            </div>
          </div>
        )}
        {adjustment && level < 4 ? <p className="muted">{t('inventory.adjustmentNeedsLevel4')}</p> : null}
      </Card>

      <Card
        title={t('inventory.snapshot')}
        actions={
          level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void snapshot()}>
              {t('inventory.generateSnapshot')}
            </button>
          ) : null
        }
      >
        <div className="filters">
          <label className="field">
            <span>{t('inventory.date')}</span>
            <input
              type="date"
              value={form.snapshotDate}
              onChange={(event) => setForm((current) => ({ ...current, snapshotDate: event.target.value }))}
            />
          </label>
        </div>
        <p className="muted">{t('inventory.snapshotHint')}</p>
      </Card>

      <Card title={t('inventory.movementHistory')}>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <DataTable columns={columns} rows={movements} rowKey={(row) => row.movement_id} empty={t('inventory.noMovements')} dense />
        )}
      </Card>
    </div>
  );
};
