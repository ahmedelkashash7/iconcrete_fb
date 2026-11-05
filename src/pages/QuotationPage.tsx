import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import {
  apiMessage,
  customerName,
  fmtDate,
  fmtMoney,
  fmtQty,
  today,
  type Customer,
  type Quotation,
} from './salesShared';
import type { Material } from './inventoryShared';

/**
 * M7 — quotations. Level 3 creates/submits/revises; level 4 approves; level 5 cancels. Approval
 * appends an immutable version; a revision starts a new draft and approval appends the next
 * version, so the previous evidence is never edited.
 */

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  superseded: 'warning',
  expired: 'danger',
  cancelled: 'danger',
};

interface LineDraft {
  materialId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxRate: string;
}

const emptyLine = (): LineDraft => ({
  materialId: '',
  description: '',
  quantity: '',
  unitPrice: '',
  discountPct: '0',
  taxRate: '0',
});

export const QuotationPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ customerId: '', projectId: '', validUntil: today(), reason: '' });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [quotationResponse, customerResponse, materialResponse] = await Promise.all([
        apiFetch<{ quotations: Quotation[] }>('/api/sales/quotations'),
        apiFetch<{ customers: Customer[] }>('/api/sales/customers'),
        apiFetch<{ materials: Material[] }>('/api/inventory/materials'),
      ]);
      setQuotations(quotationResponse.quotations);
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

  const detail = useMemo(
    () => quotations.find((quotation) => quotation.id === selected) ?? null,
    [quotations, selected],
  );

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
      await apiFetch('/api/sales/quotations', {
        method: 'POST',
        body: JSON.stringify({
          plantId: materials[0]?.plant_id ?? 'PLT-0001',
          customerId: form.customerId,
          projectId: form.projectId || null,
          validUntil: form.validUntil,
          reason: form.reason,
          items: lines.map((line) => ({
            materialId: line.materialId || null,
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            discountPct: Number(line.discountPct || 0),
            taxRate: Number(line.taxRate || 0),
          })),
        }),
      });
      setForm({ customerId: '', projectId: '', validUntil: today(), reason: '' });
      setLines([emptyLine()]);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (quotation: Quotation, action: 'submit' | 'approve' | 'revise' | 'cancel') => {
    let reason = '';
    if (action === 'cancel' || action === 'revise') {
      const answer = window.prompt(t(action === 'cancel' ? 'sales.cancelReason' : 'sales.revisionReason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/quotations/${encodeURIComponent(quotation.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await load();
      setSelected(quotation.id);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<Quotation>[] = [
    { key: 'no', header: t('sales.quotationNo'), render: (row) => row.quotation_no },
    { key: 'customer', header: t('sales.customer'), render: (row) => row.customer_name },
    { key: 'total', header: t('common.total'), align: 'end', render: (row) => fmtMoney(row.total_amount, lang) },
    { key: 'valid', header: t('sales.validUntil'), render: (row) => fmtDate(row.valid_until, lang) },
    { key: 'versions', header: t('sales.versions'), align: 'end', render: (row) => row.versions.length },
    { key: 'status', header: t('common.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`sales.status.${row.status}`)}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <span className="filters__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(row.id)}>
            {t('common.details')}
          </button>
          {row.status === 'draft' && level >= 3 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'submit')}>
              {t('sales.submit')}
            </button>
          ) : null}
          {row.status === 'submitted' && level >= 4 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'approve')}>
              {t('sales.approve')}
            </button>
          ) : null}
          {['approved', 'superseded'].includes(row.status) && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'revise')}>
              {t('sales.revise')}
            </button>
          ) : null}
          {['draft', 'submitted', 'approved'].includes(row.status) && level >= 5 ? (
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
        title={t('sales.quotationsTitle')}
        subtitle={t('sales.quotationsSubtitle')}
        badge={<Badge tone="purple">{quotations.length}</Badge>}
      />
      <Card>
        <div className="filters">
          <span className="muted">{t('sales.versionNote')}</span>
          {level >= 3 ? (
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('sales.newQuotation')}
              </button>
            </div>
          ) : null}
        </div>
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      {showForm && level >= 3 ? (
        <Card title={t('sales.newQuotation')}>
          <div className="filters">
            <label className="field">
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
            <label className="field">
              <span>{t('sales.validUntil')}</span>
              <input type="date" value={form.validUntil} onChange={(event) => setForm((current) => ({ ...current, validUntil: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.reasonOptional')}</span>
              <input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLines((current) => [...current, emptyLine()])}>
                {t('po.addLine')}
              </button>
            </div>
          </div>
          {lines.map((line, index) => (
            <div className="filters" key={`quote-line-${index}`}>
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
                <span>{t('sales.description')}</span>
                <input value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} />
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
                <span>{t('sales.discountPct')} %</span>
                <input type="number" min="0" max="100" step="0.01" value={line.discountPct} onChange={(event) => setLine(index, { discountPct: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('po.taxRate')} %</span>
                <input type="number" min="0" step="0.01" value={line.taxRate} onChange={(event) => setLine(index, { taxRate: event.target.value })} />
              </label>
            </div>
          ))}
          <div className="filters">
            <span className="muted">
              {t('common.total')}: <strong>{fmtMoney(total, lang)}</strong>
            </span>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !form.customerId || lines.some((line) => !line.quantity || !line.unitPrice)}
                onClick={() => void save()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {loading ? <LoadingBlock label={t('common.loading')} /> : <DataTable columns={columns} rows={quotations} rowKey={(row) => row.id} empty={t('common.noData')} />}

      {detail ? (
        <Card title={`${t('sales.versionHistory')} — ${detail.quotation_no}`}>
          <div className="filters">
            <span className="muted">{detail.customer_name}</span>
            <span className="muted">
              {t('common.total')}: {fmtMoney(detail.total_amount, lang)}
            </span>
            <span className="muted">
              {detail.items.map((item) => `${item.description || item.material_code}: ${fmtQty(item.quantity, lang)} × ${fmtMoney(item.unit_price, lang)}`).join(' · ')}
            </span>
          </div>
          {detail.versions.length === 0 ? (
            <p className="muted">{t('sales.noVersions')}</p>
          ) : (
            <ul className="stack-list">
              {detail.versions.map((version) => (
                <li key={version.id}>
                  <Badge tone="info">v{version.version_no}</Badge> {fmtDate(version.created_at, lang)} — {version.created_by || '—'}
                  {version.reason ? <span className="muted"> · {version.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
};
