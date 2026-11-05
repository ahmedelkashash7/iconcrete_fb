import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Card,
  DataTable,
  ErrorNote,
  LoadingBlock,
  SectionTitle,
  type TableColumn,
} from '../components/ui';
import type { Lang } from '../types';
import { fmtDate, fmtMoney } from './salesShared';
import { apiMessage, statusTone, type PurchaseInvoice, type SupplierRow } from './procurementShared';
import type { Material, PurchaseOrder } from './inventoryShared';

const today = () => new Date().toISOString().slice(0, 10);

export const PurchaseInvoicesPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [detail, setDetail] = useState<PurchaseInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({
    supplierId: '',
    poId: '',
    invoiceNo: '',
    invoiceDate: today(),
    dueDate: '',
    materialId: '',
    quantity: '1',
    unitPrice: '',
    taxAmount: '0',
    reason: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invoiceResponse, supplierResponse, orderResponse, materialResponse] = await Promise.all([
        apiFetch<{ invoices: PurchaseInvoice[] }>(`/api/procurement/invoices?status=${encodeURIComponent(status)}`),
        apiFetch<{ suppliers: SupplierRow[] }>('/api/procurement/suppliers'),
        apiFetch<{ purchaseOrders: PurchaseOrder[] }>('/api/inventory/purchase-orders'),
        apiFetch<{ materials: Material[] }>('/api/inventory/materials'),
      ]);
      setInvoices(invoiceResponse.invoices);
      setSuppliers(supplierResponse.suppliers);
      setOrders(orderResponse.purchaseOrders);
      setMaterials(materialResponse.materials);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const plantId =
    suppliers.find((supplier) => supplier.id === form.supplierId)?.plant_id ?? 'PLT-0001';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const quantity = Number(form.quantity);
      const unitPrice = Number(form.unitPrice);
      const subtotal = Math.round(quantity * unitPrice * 100) / 100;
      const tax = Number(form.taxAmount || 0);
      await apiFetch('/api/procurement/invoices', {
        method: 'POST',
        body: JSON.stringify({
          plantId,
          supplierId: form.supplierId,
          poId: form.poId || null,
          invoiceNo: form.invoiceNo || undefined,
          invoiceDate: form.invoiceDate,
          dueDate: form.dueDate || null,
          taxAmount: tax,
          subtotal,
          totalAmount: Math.round((subtotal + tax) * 100) / 100,
          reason: form.reason,
          items: [{ materialId: form.materialId, quantity, unitPrice }],
        }),
      });
      setShowForm(false);
      setForm({
        supplierId: '',
        poId: '',
        invoiceNo: '',
        invoiceDate: today(),
        dueDate: '',
        materialId: '',
        quantity: '1',
        unitPrice: '',
        taxAmount: '0',
        reason: '',
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const open = async (invoice: PurchaseInvoice) => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ invoice: PurchaseInvoice }>(
        `/api/procurement/invoices/${encodeURIComponent(invoice.id)}`,
      );
      setDetail(response.invoice);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (invoice: PurchaseInvoice, action: 'verify' | 'approve' | 'dispute' | 'void') => {
    let reason = '';
    if (action === 'dispute' || action === 'void') {
      const answer = window.prompt(t('common.reason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/procurement/invoices/${encodeURIComponent(invoice.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await load();
      setDetail(null);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<PurchaseInvoice>[] = [
    { key: 'no', header: t('procurement.invoiceNo'), render: (row) => row.invoice_no },
    {
      key: 'supplier',
      header: t('procurement.supplier'),
      render: (row) => (lang === 'ar' ? row.supplier_name_ar : row.supplier_name_en || row.supplier_name_ar),
    },
    { key: 'po', header: t('procurement.po'), render: (row) => row.po_no ?? '—' },
    { key: 'date', header: t('common.date'), render: (row) => fmtDate(row.invoice_date, lang) },
    {
      key: 'total',
      header: t('common.total'),
      align: 'end',
      render: (row) => fmtMoney(row.total_amount, lang),
    },
    {
      key: 'match',
      header: t('procurement.match'),
      render: (row) => (
        <Badge tone={row.match_status === 'matched' ? 'success' : 'warning'}>
          {t(`procurement.matchStatus.${row.match_status}`)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={statusTone(row.status)}>{t(`procurement.invoiceStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <span className="row-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void open(row)}>
            {t('common.details')}
          </button>
          {row.status === 'received' && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'verify')}>
              {t('procurement.verify')}
            </button>
          ) : null}
          {row.status === 'verified' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'approve')}>
              {t('procurement.approve')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  const matchLines = useMemo(() => detail?.match_details?.lines ?? [], [detail]);

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('procurement.invoicesTitle')}
        subtitle={t('procurement.invoicesSubtitle')}
        badge={<Badge tone="purple">{invoices.length}</Badge>}
      />
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {['received', 'verified', 'approved', 'paid', 'disputed', 'voided'].map((key) => (
                <option key={key} value={key}>{t(`procurement.invoiceStatus.${key}`)}</option>
              ))}
            </select>
          </label>
          <div className="filters__actions">
            {level >= 3 ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm(!showForm)}>
                {t('procurement.newInvoice')}
              </button>
            ) : null}
          </div>
        </div>

        {showForm ? (
          <div className="page-stack">
            <div className="filters">
              <label className="field">
                <span>{t('procurement.supplier')}</span>
                <select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value, poId: '' })}>
                  <option value="">—</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {lang === 'ar' ? supplier.name_ar : supplier.name_en || supplier.name_ar}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('procurement.po')}</span>
                <select value={form.poId} onChange={(event) => setForm({ ...form, poId: event.target.value })}>
                  <option value="">{t('procurement.noPo')}</option>
                  {orders
                    .filter((order) => !form.supplierId || order.supplier_id === form.supplierId)
                    .map((order) => (
                      <option key={order.id} value={order.id}>{order.po_no}</option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>{t('procurement.invoiceNo')}</span>
                <input value={form.invoiceNo} onChange={(event) => setForm({ ...form, invoiceNo: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('common.date')}</span>
                <input type="date" value={form.invoiceDate} onChange={(event) => setForm({ ...form, invoiceDate: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('procurement.dueDate')}</span>
                <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('inventory.material')}</span>
                <select value={form.materialId} onChange={(event) => setForm({ ...form, materialId: event.target.value })}>
                  <option value="">—</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.material_code} — {lang === 'ar' ? material.name_ar : material.name_en}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('procurement.quantity')}</span>
                <input type="number" min="0" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('procurement.unitPrice')}</span>
                <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(event) => setForm({ ...form, unitPrice: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('procurement.taxAmount')}</span>
                <input type="number" min="0" step="0.01" value={form.taxAmount} onChange={(event) => setForm({ ...form, taxAmount: event.target.value })} />
              </label>
              <label className="field field--grow">
                <span>{t('procurement.overrideReason')}</span>
                <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
              </label>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !form.supplierId || !form.materialId || !form.unitPrice}
                onClick={() => void save()}
              >
                {t('common.save')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <DataTable rows={invoices} columns={columns} rowKey={(row) => row.id} empty={t('common.noData')} />
        )}
      </Card>

      {detail ? (
        <Card>
          <div className="section-head">
            <h2>{detail.invoice_no}</h2>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDetail(null)}>
              {t('common.close')}
            </button>
          </div>
          <div className="two-col">
            <div>
              <p><strong>{t('procurement.supplier')}:</strong> {lang === 'ar' ? detail.supplier_name_ar : detail.supplier_name_en}</p>
              <p><strong>{t('procurement.po')}:</strong> {detail.po_no ?? '—'}</p>
              <p><strong>{t('common.total')}:</strong> {fmtMoney(detail.total_amount, lang)}</p>
              <p><strong>{t('procurement.paid')}:</strong> {fmtMoney(detail.paid_amount, lang)}</p>
              <p><strong>{t('common.status')}:</strong> {t(`procurement.invoiceStatus.${detail.status}`)}</p>
            </div>
            <div>
              <p><strong>{t('procurement.match')}:</strong> {t(`procurement.matchStatus.${detail.match_status}`)}</p>
              <p><strong>{t('procurement.subtotal')}:</strong> {fmtMoney(detail.subtotal, lang)}</p>
              <p><strong>{t('procurement.taxAmount')}:</strong> {fmtMoney(detail.tax_amount, lang)}</p>
              <p><strong>{t('procurement.dueDate')}:</strong> {fmtDate(detail.due_date, lang)}</p>
            </div>
          </div>

          <h3>{t('procurement.threeWayPanel')}</h3>
          {matchLines.length === 0 ? (
            <p className="muted">{t('procurement.noMatchLines')}</p>
          ) : (
            <div className="table-wrap table-wrap--dense">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('inventory.material')}</th>
                    <th className="align-end">{t('procurement.ordered')}</th>
                    <th className="align-end">{t('procurement.received')}</th>
                    <th className="align-end">{t('procurement.invoiced')}</th>
                    <th className="align-end">{t('procurement.poPrice')}</th>
                    <th className="align-end">{t('procurement.invoicePrice')}</th>
                    <th className="align-end">{t('procurement.variance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {matchLines.map((line) => (
                    <tr key={line.materialId}>
                      <td>{line.materialId}</td>
                      <td className="align-end">{line.ordered}</td>
                      <td className="align-end">{line.received}</td>
                      <td className="align-end">{line.invoiced}</td>
                      <td className="align-end">{line.poPrice ?? '—'}</td>
                      <td className="align-end">{line.invoicePrice}</td>
                      <td className="align-end">
                        {line.qtyVariancePct === null ? '—' : `${line.qtyVariancePct.toFixed(2)}%`} /{' '}
                        {line.priceVariancePct === null ? '—' : `${line.priceVariancePct.toFixed(2)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detail.match_details?.reasons?.length ? (
            <ul>
              {detail.match_details.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {detail.match_details?.override ? <Badge tone="warning">{t('procurement.overridden')}</Badge> : null}

          <div className="row-actions">
            {detail.status === 'received' && level >= 3 ? (
              <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(detail, 'verify')}>
                {t('procurement.verify')}
              </button>
            ) : null}
            {detail.status === 'verified' && level >= 4 ? (
              <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(detail, 'approve')}>
                {t('procurement.approve')}
              </button>
            ) : null}
            {['received', 'verified', 'approved'].includes(detail.status) && level >= 4 ? (
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(detail, 'dispute')}>
                {t('procurement.dispute')}
              </button>
            ) : null}
            {!['paid', 'voided'].includes(detail.status) && level >= 5 ? (
              <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void act(detail, 'void')}>
                {t('procurement.void')}
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
};
