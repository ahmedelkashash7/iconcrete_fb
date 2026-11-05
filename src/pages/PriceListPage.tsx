import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import { apiMessage, fmtDate, fmtMoney } from './salesShared';
import type { Material } from './inventoryShared';

interface PriceListItem {
  id: string;
  material_id: string;
  material_code: string;
  material_name: string;
  unit_price: number;
  min_quantity: number;
  discount_pct: number;
  valid_from: string | null;
  valid_until: string | null;
}

interface PriceList {
  id: string;
  plant_id: string;
  list_code: string;
  name: string;
  currency: string;
  valid_from: string;
  valid_until: string | null;
  status: string;
  item_count: number;
  items?: PriceListItem[];
}

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  active: 'success',
  expired: 'warning',
  superseded: 'danger',
};

const today = () => new Date().toISOString().slice(0, 10);

export const PriceListPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [lists, setLists] = useState<PriceList[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [detail, setDetail] = useState<PriceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [form, setForm] = useState({
    listCode: '',
    name: '',
    validFrom: today(),
    validUntil: '',
    materialId: '',
    unitPrice: '',
    minQuantity: '0',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listResponse, materialResponse] = await Promise.all([
        apiFetch<{ priceLists: PriceList[] }>('/api/sales/price-lists'),
        apiFetch<{ materials: Material[] }>('/api/inventory/materials'),
      ]);
      setLists(listResponse.priceLists);
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
      lists.filter(
        (row) =>
          (!filters.status || row.status === filters.status) &&
          (!filters.q ||
            `${row.list_code} ${row.name}`.toLowerCase().includes(filters.q.toLowerCase())),
      ),
    [lists, filters],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/sales/price-lists', {
        method: 'POST',
        body: JSON.stringify({
          plantId,
          listCode: form.listCode,
          name: form.name,
          validFrom: form.validFrom,
          validUntil: form.validUntil || null,
          items:
            form.materialId && form.unitPrice
              ? [
                  {
                    materialId: form.materialId,
                    unitPrice: Number(form.unitPrice),
                    minQuantity: Number(form.minQuantity || 0),
                  },
                ]
              : [],
        }),
      });
      setForm({
        listCode: '',
        name: '',
        validFrom: today(),
        validUntil: '',
        materialId: '',
        unitPrice: '',
        minQuantity: '0',
      });
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (list: PriceList, action: 'activate' | 'supersede') => {
    let reason = '';
    if (action === 'supersede') {
      const answer = window.prompt(t('sales.supersedeReason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/price-lists/${encodeURIComponent(list.id)}/${action}`, {
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

  const openDetail = async (list: PriceList) => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ priceList: PriceList }>(
        `/api/sales/price-lists/${encodeURIComponent(list.id)}`,
      );
      setDetail(response.priceList);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<PriceList>[] = [
    { key: 'code', header: t('sales.listCode'), render: (row) => row.list_code },
    { key: 'name', header: t('common.name'), render: (row) => row.name },
    {
      key: 'validity',
      header: t('sales.validity'),
      render: (row) => `${fmtDate(row.valid_from, lang)} — ${row.valid_until ? fmtDate(row.valid_until, lang) : '∞'}`,
    },
    { key: 'items', header: t('sales.itemCount'), align: 'end', render: (row) => row.item_count },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`sales.priceStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <span className="row-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openDetail(row)}>
            {t('common.details')}
          </button>
          {row.status === 'draft' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'activate')}>
              {t('sales.activate')}
            </button>
          ) : null}
          {row.status === 'active' && level >= 5 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'supersede')}>
              {t('sales.supersede')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  const itemColumns: TableColumn<PriceListItem>[] = [
    { key: 'material', header: t('inventory.material'), render: (row) => `${row.material_code} — ${row.material_name}` },
    { key: 'price', header: t('sales.unitPrice'), align: 'end', render: (row) => fmtMoney(row.unit_price, lang) },
    { key: 'min', header: t('sales.minQuantity'), align: 'end', render: (row) => row.min_quantity },
    { key: 'discount', header: t('sales.discountPct'), align: 'end', render: (row) => `${row.discount_pct}%` },
    {
      key: 'validity',
      header: t('sales.validity'),
      render: (row) => `${row.valid_from ? fmtDate(row.valid_from, lang) : '—'} — ${row.valid_until ? fmtDate(row.valid_until, lang) : '∞'}`,
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('sales.priceListsTitle')}
        subtitle={t('sales.priceListsSubtitle')}
        badge={<Badge tone="purple">{lists.length}</Badge>}
      />
      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('common.search')}</span>
            <input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} />
          </label>
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">{t('common.all')}</option>
              {['draft', 'active', 'expired', 'superseded'].map((status) => (
                <option key={status} value={status}>
                  {t(`sales.priceStatus.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="filters__actions">
            {level >= 3 ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('sales.newPriceList')}
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
              <span>{t('sales.listCode')}</span>
              <input value={form.listCode} onChange={(event) => setForm((current) => ({ ...current, listCode: event.target.value }))} />
            </label>
            <label className="field field--grow">
              <span>{t('common.name')}</span>
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.validFrom')}</span>
              <input type="date" value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.validUntil')}</span>
              <input type="date" value={form.validUntil} onChange={(event) => setForm((current) => ({ ...current, validUntil: event.target.value }))} />
            </label>
          </div>
          <div className="filters">
            <label className="field field--grow">
              <span>{t('inventory.material')}</span>
              <select value={form.materialId} onChange={(event) => setForm((current) => ({ ...current, materialId: event.target.value }))}>
                <option value="">{t('common.optional')}</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.material_code} — {material.name_en || material.name_ar}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('sales.unitPrice')}</span>
              <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.minQuantity')}</span>
              <input type="number" min="0" step="0.001" value={form.minQuantity} onChange={(event) => setForm((current) => ({ ...current, minQuantity: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || !form.listCode || !form.name} onClick={() => void save()}>
                {t('common.save')}
              </button>
            </div>
          </div>
          <p className="muted">{t('sales.priceListNote')}</p>
        </Card>
      ) : null}

      {!loading ? (
        <Card>
          <DataTable columns={columns} rows={visible} rowKey={(row) => row.id} empty={t('common.noData')} />
        </Card>
      ) : null}

      {detail ? (
        <Card>
          <SectionTitle
            title={`${detail.list_code} — ${detail.name}`}
            subtitle={`${fmtDate(detail.valid_from, lang)} — ${detail.valid_until ? fmtDate(detail.valid_until, lang) : '∞'}`}
            badge={<Badge tone={TONE[detail.status] ?? 'neutral'}>{t(`sales.priceStatus.${detail.status}`)}</Badge>}
          />
          <DataTable
            columns={itemColumns}
            rows={detail.items ?? []}
            rowKey={(row) => row.id}
            empty={t('sales.noPriceItems')}
          />
        </Card>
      ) : null}
    </div>
  );
};
