import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import {
  apiMessage,
  fmtDate,
  fmtMoney,
  fmtQty,
  plantsIn,
  type Material,
  type PurchaseOrder,
  type Supplier,
} from './inventoryShared';

/**
 * M6 — purchase orders. Creating and confirming are level 4; cancelling is level 5 with a reason.
 * A line above the material's reorder point is only a warning, recorded when the order is created;
 * receiving more than ordered is handled on the goods-receipt screen.
 */

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  confirmed: 'info',
  partially_received: 'warning',
  fully_received: 'success',
  closed: 'neutral',
  cancelled: 'danger',
};

interface LineDraft {
  materialId: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  discountPct: string;
}

const emptyLine = (): LineDraft => ({ materialId: '', quantity: '', unitPrice: '', taxRate: '0', discountPct: '0' });

export const PurchaseOrderPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ plantId: '', supplierId: '', expectedDeliveryAt: '' });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orderResponse, materialResponse, supplierResponse] = await Promise.all([
        apiFetch<{ purchaseOrders: PurchaseOrder[] }>('/api/inventory/purchase-orders'),
        apiFetch<{ materials: Material[] }>('/api/inventory/materials'),
        level >= 4 ? apiFetch<{ suppliers: Supplier[] }>('/api/inventory/suppliers') : Promise.resolve({ suppliers: [] }),
      ]);
      setOrders(orderResponse.purchaseOrders);
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

  const total = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const gross = Number(line.quantity || 0) * Number(line.unitPrice || 0);
        const net = gross - (gross * Number(line.discountPct || 0)) / 100;
        return sum + net + (net * Number(line.taxRate || 0)) / 100;
      }, 0),
    [lines],
  );

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line, position) => (position === index ? { ...line, ...patch } : line)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/inventory/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          plantId: form.plantId || plants[0] || 'PLT-0001',
          supplierId: form.supplierId,
          expectedDeliveryAt: form.expectedDeliveryAt || null,
          items: lines.map((line) => ({
            materialId: line.materialId,
            quantityOrdered: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            taxRate: Number(line.taxRate || 0),
            discountPct: Number(line.discountPct || 0),
          })),
        }),
      });
      setForm({ plantId: '', supplierId: '', expectedDeliveryAt: '' });
      setLines([emptyLine()]);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (order: PurchaseOrder, action: 'confirm' | 'cancel') => {
    let reason = '';
    if (action === 'cancel') {
      const answer = window.prompt(t('po.cancelReason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventory/purchase-orders/${encodeURIComponent(order.id)}/${action}`, {
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

  const columns: TableColumn<PurchaseOrder>[] = [
    { key: 'po_no', header: t('po.no') },
    { key: 'supplier_name', header: t('po.supplier') },
    {
      key: 'total_amount',
      header: t('po.total'),
      align: 'end',
      render: (row) => fmtMoney(row.total_amount + row.tax_amount, lang),
    },
    {
      key: 'items',
      header: t('po.lines'),
      render: (row) =>
        row.items
          .map((item) => `${item.material_code}: ${fmtQty(item.quantity_received, lang)}/${fmtQty(item.quantity_ordered, lang)} ${item.unit_of_measure}`)
          .join(' · '),
    },
    { key: 'expected_delivery_at', header: t('po.expected'), render: (row) => fmtDate(row.expected_delivery_at, lang) },
    { key: 'status', header: t('inventory.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`po.status.${row.status}`)}</Badge> },
    {
      key: 'id',
      header: '',
      render: (row) => (
        <span className="filters__actions">
          {row.status === 'draft' && level >= 4 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'confirm')}>
              {t('po.confirm')}
            </button>
          ) : null}
          {['draft', 'confirmed', 'partially_received'].includes(row.status) && level >= 5 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'cancel')}>
              {t('po.cancel')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle title={t('po.title')} subtitle={t('po.subtitle')} badge={<Badge tone="purple">{orders.length}</Badge>} />
      <Card>
        <div className="filters">
          <span className="muted">{t('po.flow')}</span>
          {level >= 4 ? (
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('po.create')}
              </button>
            </div>
          ) : null}
        </div>
        {level < 4 ? <p className="muted">{t('po.readOnly')}</p> : null}
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      {showForm && level >= 4 ? (
        <Card title={t('po.create')}>
          <div className="filters">
            <label className="field">
              <span>{t('inventory.plant')}</span>
              <input value={form.plantId} placeholder={plants[0] ?? 'PLT-0001'} onChange={(event) => setForm((current) => ({ ...current, plantId: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('po.supplier')}</span>
              <select value={form.supplierId} onChange={(event) => setForm((current) => ({ ...current, supplierId: event.target.value }))}>
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
              <span>{t('po.expected')}</span>
              <input type="date" value={form.expectedDeliveryAt} onChange={(event) => setForm((current) => ({ ...current, expectedDeliveryAt: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLines((current) => [...current, emptyLine()])}>
                {t('po.addLine')}
              </button>
            </div>
          </div>
          {lines.map((line, index) => (
            <div className="filters" key={`line-${index}`}>
              <label className="field">
                <span>{t('pr.material')}</span>
                <select value={line.materialId} onChange={(event) => setLine(index, { materialId: event.target.value })}>
                  <option value="">—</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.material_code} — {lang === 'ar' ? material.name_ar : material.name_en || material.name_ar}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('po.quantity')}</span>
                <input type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('po.unitPrice')}</span>
                <input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => setLine(index, { unitPrice: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('po.taxRate')} %</span>
                <input type="number" min="0" step="0.01" value={line.taxRate} onChange={(event) => setLine(index, { taxRate: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('po.discount')} %</span>
                <input type="number" min="0" max="100" step="0.01" value={line.discountPct} onChange={(event) => setLine(index, { discountPct: event.target.value })} />
              </label>
              {lines.length > 1 ? (
                <div className="filters__actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>
                    {t('common.remove')}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          <div className="filters">
            <span className="muted">
              {t('po.total')}: {fmtMoney(total, lang)}
            </span>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !form.supplierId || lines.some((line) => !line.materialId || Number(line.quantity) <= 0)}
                onClick={() => void save()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <DataTable columns={columns} rows={orders} rowKey={(row) => row.id} empty={t('po.empty')} />
        )}
      </Card>
    </div>
  );
};
