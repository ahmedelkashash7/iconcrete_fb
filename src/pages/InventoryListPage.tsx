import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import { MaterialDetailPage } from './MaterialDetailPage';
import {
  apiMessage,
  fmtMoney,
  fmtQty,
  plantsIn,
  type InventoryException,
  type Material,
} from './inventoryShared';

/**
 * M6 — material master and stock. Read is level 1. Creating a material is level 5; low stock is
 * a comparison against the material's reorder point, never a code default. Selecting a row opens
 * the material detail with its derived balance and movement history.
 */

const CATEGORIES = ['cement', 'scm', 'aggregate', 'water', 'admixture', 'fuel', 'spare_part', 'other'];

const emptyForm = {
  plantId: '',
  materialCode: '',
  nameAr: '',
  nameEn: '',
  category: 'aggregate',
  unitOfMeasure: 'kg',
  isBulk: true,
  valuationMethod: '',
  minStockLevel: '',
  maxStockLevel: '',
  reorderPoint: '',
};

export const InventoryListPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [tab, setTab] = useState<'materials' | 'exceptions'>('materials');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [exceptions, setExceptions] = useState<InventoryException[]>([]);
  const [plantId, setPlantId] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Material | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (plantId) params.set('plantId', plantId);
      if (category) params.set('category', category);
      if (query) params.set('q', query);
      if (lowOnly) params.set('lowStock', 'true');
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const [materialResponse, exceptionResponse] = await Promise.all([
        apiFetch<{ materials: Material[] }>(`/api/inventory/materials${suffix}`),
        level >= 4 ? apiFetch<{ exceptions: InventoryException[] }>('/api/inventory/exceptions') : Promise.resolve({ exceptions: [] }),
      ]);
      setMaterials(materialResponse.materials);
      setExceptions(exceptionResponse.exceptions);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [plantId, category, query, lowOnly, level]);

  useEffect(() => {
    void load();
  }, [load]);

  const plants = useMemo(() => plantsIn(materials), [materials]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/inventory/materials', {
        method: 'POST',
        body: JSON.stringify({
          plantId: form.plantId || plants[0] || 'PLT-0001',
          materialCode: form.materialCode,
          nameAr: form.nameAr,
          nameEn: form.nameEn,
          category: form.category,
          unitOfMeasure: form.unitOfMeasure,
          isBulk: form.isBulk,
          valuationMethod: form.valuationMethod || null,
          minStockLevel: form.minStockLevel === '' ? null : Number(form.minStockLevel),
          maxStockLevel: form.maxStockLevel === '' ? null : Number(form.maxStockLevel),
          reorderPoint: form.reorderPoint === '' ? null : Number(form.reorderPoint),
        }),
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const closeException = async (exception: InventoryException, decision: 'approved' | 'rejected') => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventory/exceptions/${encodeURIComponent(exception.exception_id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, status: 'resolved' }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <MaterialDetailPage
        material={selected}
        onClose={() => setSelected(null)}
        onChanged={() => void load()}
      />
    );
  }

  const tone = (row: Material): BadgeTone =>
    row.status !== 'active'
      ? 'neutral'
      : row.reorder_point !== null && row.balance <= row.reorder_point
        ? 'danger'
        : 'success';

  const columns: TableColumn<Material>[] = [
    { key: 'material_code', header: t('inventory.code') },
    {
      key: 'name_ar',
      header: t('inventory.name'),
      render: (row) => (lang === 'ar' ? row.name_ar : row.name_en || row.name_ar),
    },
    { key: 'category', header: t('inventory.category'), render: (row) => t(`inventory.category.${row.category}`) },
    {
      key: 'balance',
      header: t('inventory.balance'),
      align: 'end',
      render: (row) => (
        <span>
          {fmtQty(row.balance, lang)} {row.unit_of_measure}
        </span>
      ),
    },
    {
      key: 'reorder_point',
      header: t('inventory.reorderPoint'),
      align: 'end',
      render: (row) => (row.reorder_point === null ? '—' : fmtQty(row.reorder_point, lang)),
    },
    { key: 'average_cost', header: t('inventory.avgCost'), align: 'end', render: (row) => fmtMoney(row.average_cost, lang) },
    {
      key: 'valuation_method',
      header: t('inventory.method'),
      render: (row) =>
        row.valuation_method === null ? (
          <Badge tone="warning">{t('inventory.notConfigured')}</Badge>
        ) : (
          t(`inventory.method.${row.valuation_method}`)
        ),
    },
    { key: 'plant_id', header: t('inventory.plant') },
    {
      key: 'status',
      header: t('inventory.status'),
      render: (row) => <Badge tone={tone(row)}>{t(`inventory.materialStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'id',
      header: '',
      render: (row) => (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(row)}>
          {t('inventory.open')}
        </button>
      ),
    },
  ];

  const exceptionColumns: TableColumn<InventoryException>[] = [
    { key: 'material_code', header: t('inventory.code') },
    { key: 'quantity', header: t('inventory.requested'), align: 'end', render: (row) => fmtQty(row.quantity, lang) },
    { key: 'available_quantity', header: t('inventory.available'), align: 'end', render: (row) => fmtQty(row.available_quantity, lang) },
    { key: 'reason', header: t('inventory.reason') },
    {
      key: 'suggested_source_type',
      header: t('inventory.suggestion'),
      render: (row) =>
        row.suggested_source_id ? `${t(`inventory.source.${row.suggested_source_type}`)} · ${row.suggested_source_id}` : t('inventory.source.none'),
    },
    { key: 'status', header: t('inventory.status'), render: (row) => <Badge tone={row.status === 'open' ? 'danger' : 'neutral'}>{row.status}</Badge> },
    {
      key: 'exception_id',
      header: '',
      render: (row) =>
        row.status === 'open' || row.status === 'investigation' ? (
          <span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => void closeException(row, 'approved')}
            >
              {t('inventory.resolve')}
            </button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('inventory.title')}
        subtitle={t('inventory.subtitle')}
        badge={<Badge tone="purple">{materials.length}</Badge>}
      />

      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('inventory.view')}</span>
            <select value={tab} onChange={(event) => setTab(event.target.value as 'materials' | 'exceptions')}>
              <option value="materials">{t('inventory.materials')}</option>
              {level >= 4 ? <option value="exceptions">{t('inventory.exceptions')}</option> : null}
            </select>
          </label>
          <label className="field">
            <span>{t('inventory.plant')}</span>
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
            <span>{t('inventory.category')}</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {t(`inventory.category.${entry}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('common.search')}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('inventory.codeOrName')} />
          </label>
          <label className="field field--check">
            <span>{t('inventory.lowStock')}</span>
            <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
          </label>
          {level >= 5 && tab === 'materials' ? (
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('inventory.createMaterial')}
              </button>
            </div>
          ) : null}
        </div>
        {level < 5 ? <p className="muted">{t('inventory.masterRestricted')}</p> : null}
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      {showForm && level >= 5 ? (
        <Card title={t('inventory.createMaterial')}>
          <div className="filters">
            <label className="field">
              <span>{t('inventory.plant')}</span>
              <input value={form.plantId} placeholder={plants[0] ?? 'PLT-0001'} onChange={(event) => setForm((current) => ({ ...current, plantId: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('inventory.code')}</span>
              <input value={form.materialCode} onChange={(event) => setForm((current) => ({ ...current, materialCode: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('inventory.nameAr')}</span>
              <input value={form.nameAr} onChange={(event) => setForm((current) => ({ ...current, nameAr: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('inventory.nameEn')}</span>
              <input value={form.nameEn} onChange={(event) => setForm((current) => ({ ...current, nameEn: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('inventory.category')}</span>
              <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
                {CATEGORIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {t(`inventory.category.${entry}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('inventory.unit')}</span>
              <input value={form.unitOfMeasure} onChange={(event) => setForm((current) => ({ ...current, unitOfMeasure: event.target.value }))} />
            </label>
            <label className="field field--check">
              <span>{t('inventory.bulk')}</span>
              <input type="checkbox" checked={form.isBulk} onChange={(event) => setForm((current) => ({ ...current, isBulk: event.target.checked }))} />
            </label>
            <label className="field">
              <span>{t('inventory.method')}</span>
              <select value={form.valuationMethod} onChange={(event) => setForm((current) => ({ ...current, valuationMethod: event.target.value }))}>
                <option value="">{t('inventory.notConfigured')}</option>
                <option value="weighted_average">{t('inventory.method.weighted_average')}</option>
                {form.isBulk ? null : <option value="fifo">{t('inventory.method.fifo')}</option>}
              </select>
            </label>
            <label className="field">
              <span>{t('inventory.reorderPoint')}</span>
              <input type="number" min="0" value={form.reorderPoint} onChange={(event) => setForm((current) => ({ ...current, reorderPoint: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || !form.materialCode || !form.nameAr} onClick={() => void save()}>
                {t('common.save')}
              </button>
            </div>
          </div>
          <p className="muted">{t('inventory.methodHint')}</p>
        </Card>
      ) : null}

      <Card>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : tab === 'materials' ? (
          <DataTable columns={columns} rows={materials} rowKey={(row) => row.id} empty={t('inventory.emptyMaterials')} />
        ) : (
          <DataTable columns={exceptionColumns} rows={exceptions} rowKey={(row) => row.exception_id} empty={t('inventory.emptyExceptions')} />
        )}
      </Card>

      {tab === 'materials' && materials.some((row) => row.reorder_point !== null && row.balance <= row.reorder_point) ? (
        <InfoNote tone="warning">{t('inventory.reorderNotice')}</InfoNote>
      ) : null}
    </div>
  );
};
