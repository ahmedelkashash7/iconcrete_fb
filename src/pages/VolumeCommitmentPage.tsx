import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import { apiMessage, customerName, fmtDate, fmtMoney, fmtQty, type Customer } from './salesShared';
import type { Material } from './inventoryShared';

interface Commitment {
  id: string;
  plant_id: string;
  commitment_no: string;
  customer_id: string;
  customer_name: string;
  material_id: string;
  material_code: string;
  material_name: string;
  committed_quantity_m3: number;
  fulfilled_quantity_m3: number;
  fulfilment_pct: number;
  period_start: string;
  period_end: string;
  special_price: number;
  status: string;
}

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  active: 'success',
  fulfilled: 'info',
  breached: 'danger',
  expired: 'warning',
  cancelled: 'neutral',
};

const today = () => new Date().toISOString().slice(0, 10);

export const VolumeCommitmentPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ status: '', customerId: '' });
  const [form, setForm] = useState({
    commitmentNo: '',
    customerId: '',
    materialId: '',
    committedQuantityM3: '',
    specialPrice: '',
    periodStart: today(),
    periodEnd: `${new Date().getUTCFullYear()}-12-31`,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [commitmentResponse, customerResponse, materialResponse] = await Promise.all([
        apiFetch<{ commitments: Commitment[] }>('/api/sales/commitments'),
        apiFetch<{ customers: Customer[] }>('/api/sales/customers'),
        apiFetch<{ materials: Material[] }>('/api/inventory/materials'),
      ]);
      setCommitments(commitmentResponse.commitments);
      setCustomers(customerResponse.customers);
      setMaterials(materialResponse.materials);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plantId = materials[0]?.plant_id ?? 'PLT-0001';

  const visible = useMemo(
    () =>
      commitments.filter(
        (row) =>
          (!filters.status || row.status === filters.status) &&
          (!filters.customerId || row.customer_id === filters.customerId),
      ),
    [commitments, filters],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/sales/commitments', {
        method: 'POST',
        body: JSON.stringify({
          plantId,
          commitmentNo: form.commitmentNo,
          customerId: form.customerId,
          materialId: form.materialId,
          committedQuantityM3: Number(form.committedQuantityM3),
          specialPrice: Number(form.specialPrice),
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
        }),
      });
      setForm({
        commitmentNo: '',
        customerId: '',
        materialId: '',
        committedQuantityM3: '',
        specialPrice: '',
        periodStart: today(),
        periodEnd: `${new Date().getUTCFullYear()}-12-31`,
      });
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (commitment: Commitment, action: 'activate' | 'breach' | 'cancel') => {
    let reason = '';
    if (action !== 'activate') {
      const answer = window.prompt(t(action === 'breach' ? 'sales.breachReason' : 'sales.cancelReason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/commitments/${encodeURIComponent(commitment.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<Commitment>[] = [
    { key: 'no', header: t('sales.commitmentNo'), render: (row) => row.commitment_no },
    { key: 'customer', header: t('sales.customer'), render: (row) => row.customer_name },
    { key: 'material', header: t('inventory.material'), render: (row) => `${row.material_code} — ${row.material_name}` },
    {
      key: 'period',
      header: t('sales.period'),
      render: (row) => `${fmtDate(row.period_start, lang)} — ${fmtDate(row.period_end, lang)}`,
    },
    {
      key: 'progress',
      header: t('sales.fulfilment'),
      render: (row) => {
        const pct = row.fulfilment_pct;
        const tone = pct > 100 ? 'danger' : pct > 95 ? 'warning' : 'success';
        return (
          <span className="progress-cell">
            <span className={`progress progress--${tone}`} title={`${pct.toFixed(1)}%`}>
              <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </span>
            <span className="muted">
              {fmtQty(row.fulfilled_quantity_m3, lang)} / {fmtQty(row.committed_quantity_m3, lang)} · {pct.toFixed(0)}%
            </span>
            {pct > 100 ? <Badge tone="danger">{t('sales.breachAlert')}</Badge> : null}
          </span>
        );
      },
    },
    { key: 'price', header: t('sales.specialPrice'), align: 'end', render: (row) => fmtMoney(row.special_price, lang) },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`sales.commitmentStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <span className="row-actions">
          {row.status === 'draft' && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'activate')}>
              {t('sales.activate')}
            </button>
          ) : null}
          {row.status === 'active' && level >= 5 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'breach')}>
              {t('sales.breach')}
            </button>
          ) : null}
          {['draft', 'active'].includes(row.status) && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'cancel')}>
              {t('common.cancel')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('sales.commitmentsTitle')}
        subtitle={t('sales.commitmentsSubtitle')}
        badge={<Badge tone="purple">{commitments.length}</Badge>}
      />
      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('sales.customer')}</span>
            <select value={filters.customerId} onChange={(event) => setFilters((current) => ({ ...current, customerId: event.target.value }))}>
              <option value="">{t('common.all')}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customerName(customer, lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">{t('common.all')}</option>
              {['draft', 'active', 'fulfilled', 'breached', 'expired', 'cancelled'].map((status) => (
                <option key={status} value={status}>
                  {t(`sales.commitmentStatus.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="filters__actions">
            {level >= 3 ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('sales.newCommitment')}
              </button>
            ) : null}
          </div>
        </div>
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {showForm ? (
        <Card>
          <div className="filters">
            <label className="field">
              <span>{t('sales.commitmentNo')}</span>
              <input value={form.commitmentNo} onChange={(event) => setForm((current) => ({ ...current, commitmentNo: event.target.value }))} />
            </label>
            <label className="field field--grow">
              <span>{t('sales.customer')}</span>
              <select value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))}>
                <option value="">—</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customerName(customer, lang)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--grow">
              <span>{t('inventory.material')}</span>
              <select value={form.materialId} onChange={(event) => setForm((current) => ({ ...current, materialId: event.target.value }))}>
                <option value="">—</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.material_code} — {material.name_en || material.name_ar}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="filters">
            <label className="field">
              <span>{t('sales.committedQty')}</span>
              <input type="number" min="0" step="0.001" value={form.committedQuantityM3} onChange={(event) => setForm((current) => ({ ...current, committedQuantityM3: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.specialPrice')}</span>
              <input type="number" min="0" step="0.01" value={form.specialPrice} onChange={(event) => setForm((current) => ({ ...current, specialPrice: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.periodStart')}</span>
              <input type="date" value={form.periodStart} onChange={(event) => setForm((current) => ({ ...current, periodStart: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.periodEnd')}</span>
              <input type="date" value={form.periodEnd} onChange={(event) => setForm((current) => ({ ...current, periodEnd: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !form.customerId || !form.materialId || !form.committedQuantityM3 || !form.specialPrice}
                onClick={() => void save()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
          <p className="muted">{t('sales.commitmentNote')}</p>
        </Card>
      ) : null}

      {!loading ? (
        <Card>
          <DataTable columns={columns} rows={visible} rowKey={(row) => row.id} empty={t('common.noData')} />
        </Card>
      ) : null}
    </div>
  );
};
