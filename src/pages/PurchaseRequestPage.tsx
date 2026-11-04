import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import {
  apiMessage,
  fmtDate,
  fmtQty,
  plantsIn,
  type Material,
  type PurchaseRequest,
  type Supplier,
} from './inventoryShared';

/**
 * M6 — purchase requests. Raising is level 3, approving and converting are level 4, and a
 * request only converts once it is approved. The conversion creates a draft PO with one line.
 */

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  converted_to_po: 'purple',
  rejected: 'danger',
};

export const PurchaseRequestPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [converting, setConverting] = useState<PurchaseRequest | null>(null);
  const [form, setForm] = useState({ plantId: '', materialId: '', quantity: '', reason: '' });
  const [conversion, setConversion] = useState({ supplierId: '', unitPrice: '', taxRate: '0', expectedDeliveryAt: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requestResponse, materialResponse, supplierResponse] = await Promise.all([
        apiFetch<{ purchaseRequests: PurchaseRequest[] }>('/api/inventory/purchase-requests'),
        apiFetch<{ materials: Material[] }>('/api/inventory/materials'),
        level >= 4 ? apiFetch<{ suppliers: Supplier[] }>('/api/inventory/suppliers') : Promise.resolve({ suppliers: [] }),
      ]);
      setRequests(requestResponse.purchaseRequests);
      setMaterials(materialResponse.materials);
      setSuppliers(supplierResponse.suppliers);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [level]);

  useEffect(() => {
    void load();
  }, [load]);

  const plants = useMemo(() => plantsIn(materials), [materials]);

  const act = async (request: PurchaseRequest, action: 'submit' | 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventory/purchase-requests/${encodeURIComponent(request.id)}/${action}`, {
        method: 'POST',
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/inventory/purchase-requests', {
        method: 'POST',
        body: JSON.stringify({
          plantId: form.plantId || plants[0] || 'PLT-0001',
          materialId: form.materialId,
          quantityRequested: Number(form.quantity),
          reason: form.reason,
        }),
      });
      setForm({ plantId: '', materialId: '', quantity: '', reason: '' });
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!converting) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventory/purchase-requests/${encodeURIComponent(converting.id)}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          supplierId: conversion.supplierId,
          unitPrice: Number(conversion.unitPrice),
          taxRate: Number(conversion.taxRate),
          expectedDeliveryAt: conversion.expectedDeliveryAt || null,
        }),
      });
      setConverting(null);
      setConversion({ supplierId: '', unitPrice: '', taxRate: '0', expectedDeliveryAt: '' });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<PurchaseRequest>[] = [
    { key: 'pr_no', header: t('pr.no') },
    {
      key: 'material_code',
      header: t('pr.material'),
      render: (row) => `${row.material_code} — ${row.material_name}`,
    },
    {
      key: 'quantity_requested',
      header: t('pr.quantity'),
      align: 'end',
      render: (row) => `${fmtQty(row.quantity_requested, lang)} ${row.unit_of_measure}`,
    },
    { key: 'reason', header: t('inventory.reason') },
    { key: 'requested_by', header: t('pr.requestedBy') },
    { key: 'requested_at', header: t('pr.requestedAt'), render: (row) => fmtDate(row.requested_at, lang) },
    { key: 'status', header: t('inventory.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`pr.status.${row.status}`)}</Badge> },
    {
      key: 'id',
      header: '',
      render: (row) => (
        <span className="filters__actions">
          {row.status === 'draft' && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'submit')}>
              {t('pr.submit')}
            </button>
          ) : null}
          {row.status === 'submitted' && level >= 4 ? (
            <>
              <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'approve')}>
                {t('pr.approve')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'reject')}>
                {t('pr.reject')}
              </button>
            </>
          ) : null}
          {row.status === 'approved' && level >= 4 ? (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setConverting(row)}>
              {t('pr.convert')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('pr.title')}
        subtitle={t('pr.subtitle')}
        badge={<Badge tone="purple">{requests.length}</Badge>}
      />
      <Card>
        <div className="filters">
          <span className="muted">{t('pr.flow')}</span>
          {level >= 3 ? (
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('pr.create')}
              </button>
            </div>
          ) : null}
        </div>
        {level < 3 ? <p className="muted">{t('pr.readOnly')}</p> : null}
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      {showForm && level >= 3 ? (
        <Card title={t('pr.create')}>
          <div className="filters">
            <label className="field">
              <span>{t('inventory.plant')}</span>
              <input value={form.plantId} placeholder={plants[0] ?? 'PLT-0001'} onChange={(event) => setForm((current) => ({ ...current, plantId: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('pr.material')}</span>
              <select value={form.materialId} onChange={(event) => setForm((current) => ({ ...current, materialId: event.target.value }))}>
                <option value="">—</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.material_code} — {lang === 'ar' ? material.name_ar : material.name_en || material.name_ar}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('pr.quantity')}</span>
              <input type="number" min="0" step="0.001" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} />
            </label>
            <label className="field field--wide">
              <span>{t('inventory.reason')}</span>
              <input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || !form.materialId || Number(form.quantity) <= 0} onClick={() => void save()}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {converting ? (
        <Card title={`${t('pr.convert')} · ${converting.pr_no}`}>
          <div className="filters">
            <label className="field">
              <span>{t('po.supplier')}</span>
              <select value={conversion.supplierId} onChange={(event) => setConversion((current) => ({ ...current, supplierId: event.target.value }))}>
                <option value="">—</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.supplier_code ? `${supplier.supplier_code} · ` : ''}
                    {lang === 'ar' ? supplier.name_ar : supplier.name_en || supplier.name_ar}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('po.unitPrice')}</span>
              <input type="number" min="0" step="0.01" value={conversion.unitPrice} onChange={(event) => setConversion((current) => ({ ...current, unitPrice: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('po.taxRate')} %</span>
              <input type="number" min="0" step="0.01" value={conversion.taxRate} onChange={(event) => setConversion((current) => ({ ...current, taxRate: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('po.expected')}</span>
              <input type="date" value={conversion.expectedDeliveryAt} onChange={(event) => setConversion((current) => ({ ...current, expectedDeliveryAt: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || !conversion.supplierId || conversion.unitPrice === ''} onClick={() => void convert()}>
                {t('pr.convert')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConverting(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <DataTable columns={columns} rows={requests} rowKey={(row) => row.id} empty={t('pr.empty')} />
        )}
      </Card>
    </div>
  );
};
