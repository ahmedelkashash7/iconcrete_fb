import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError, downloadFile } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone } from '../components/ui';
import { formatCellValue } from '../lib/display';
import type { Customer, Lang } from '../types';

interface CustomerRow extends Customer {
  plant_ar: string;
  plant_en: string;
  outstanding_amount: number;
  available_credit: number;
}

const statusTone: Record<string, BadgeTone> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral',
};

interface CustomerForm {
  nameAr: string;
  nameEn: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  priorityTier: 'A' | 'B' | 'C';
  creditDays: string;
  creditLimitEgp: string;
  status: 'active' | 'suspended' | 'archived';
}

const emptyForm: CustomerForm = {
  nameAr: '',
  nameEn: '',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  priorityTier: 'A',
  creditDays: '30',
  creditLimitEgp: '0',
  status: 'active',
};

export const CustomersPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ customers: CustomerRow[] }>('/api/customers');
      setRows(response.customers);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 403 ? 'errors.forbidden' : 'errors.network');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.id, row.name_ar, row.name_en, row.phone, row.tax_id].some((value) =>
        value.toLowerCase().includes(term),
      ),
    );
  }, [rows, search]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadFile(`/api/export/customers.xlsx?lang=${lang}`, `ICONCRETE_customers_${Date.now()}.xlsx`);
    } catch {
      setError('report.exportError');
    } finally {
      setExporting(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (row: CustomerRow) => {
    setEditingId(row.id);
    setForm({
      nameAr: row.name_ar,
      nameEn: row.name_en,
      taxId: row.tax_id,
      phone: row.phone,
      email: row.email,
      address: row.address,
      priorityTier: row.priority_tier,
      creditDays: String(row.credit_days),
      creditLimitEgp: String(row.credit_limit_egp),
      status: row.status,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.nameAr.trim() || !form.nameEn.trim()) {
      setFormError('customers.requiredFields');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        nameAr: form.nameAr,
        nameEn: form.nameEn,
        taxId: form.taxId,
        phone: form.phone,
        email: form.email,
        address: form.address,
        priorityTier: form.priorityTier,
        creditDays: Number(form.creditDays || 0),
        creditLimitEgp: form.creditLimitEgp || '0',
        ...(editingId ? { status: form.status } : {}),
      };
      if (editingId) {
        await apiFetch(`/api/m1/customers/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/m1/customers', { method: 'POST', body: JSON.stringify(payload) });
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 503) setFormError('common.durableRequired');
      else if (caught instanceof ApiError && caught.status === 403) setFormError('errors.forbidden');
      else if (caught instanceof ApiError && caught.status === 422) setFormError('customers.requiredFields');
      else setFormError('errors.network');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('customers.title')}
        subtitle={t('customers.subtitle')}
        badge={<Badge tone="purple">{filtered.length} {t('customers.count')}</Badge>}
      />

      <Card
        actions={
          <div className="filters__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}>
              {t('customers.create')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void exportExcel()} disabled={exporting}>
              {t('customers.export')}
            </button>
          </div>
        }
      >
        {formOpen ? (
          <div className="filters">
            <p className="field field--grow">
              <strong>{editingId ? t('customers.editTitle') : t('customers.newTitle')}</strong>
            </p>
            <label className="field field--grow">
              <span>{t('common.name')} (AR)</span>
              <input dir="rtl" value={form.nameAr} onChange={(event) => setForm({ ...form, nameAr: event.target.value })} />
            </label>
            <label className="field field--grow">
              <span>{t('common.name')} (EN)</span>
              <input dir="ltr" value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('customers.taxId')}</span>
              <input value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('common.phone')}</span>
              <input dir="ltr" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </label>
            <label className="field field--grow">
              <span>{t('common.email')}</span>
              <input dir="ltr" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
            <label className="field field--grow">
              <span>{t('customers.address')}</span>
              <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('customers.tier')}</span>
              <select
                value={form.priorityTier}
                onChange={(event) => setForm({ ...form, priorityTier: event.target.value as 'A' | 'B' | 'C' })}
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </label>
            <label className="field">
              <span>{t('customers.creditLimit')}</span>
              <input
                dir="ltr"
                inputMode="decimal"
                value={form.creditLimitEgp}
                onChange={(event) => setForm({ ...form, creditLimitEgp: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t('customers.creditDays')}</span>
              <input
                dir="ltr"
                inputMode="numeric"
                value={form.creditDays}
                onChange={(event) => setForm({ ...form, creditDays: event.target.value })}
              />
            </label>
            {editingId ? (
              <label className="field">
                <span>{t('common.status')}</span>
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value as CustomerForm['status'] })}
                >
                  <option value="active">{t('customers.status.active')}</option>
                  <option value="suspended">{t('customers.status.suspended')}</option>
                  <option value="archived">{t('customers.status.archived')}</option>
                </select>
              </label>
            ) : null}
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => void save()} disabled={saving}>
                {saving ? t('common.loading') : t('customers.save')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setFormOpen(false);
                  setEditingId(null);
                  setForm(emptyForm);
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : null}

        {formError ? <ErrorNote>{t(formError)}</ErrorNote> : null}

        <div className="filters filters--compact">
          <label className="field field--grow">
            <span>{t('common.search')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('customers.search')}
            />
          </label>
        </div>

        <DataTable
          dense
          rows={filtered}
          rowKey={(row) => row.id}
          empty={t('customers.noResults')}
          columns={[
            { key: 'id', header: t('customers.id'), render: (row) => <span className="mono">{row.id}</span> },
            {
              key: 'name',
              header: t('customers.name'),
              render: (row) => (
                <div className="cell-stack">
                  <strong>{lang === 'ar' ? row.name_ar : row.name_en}</strong>
                  <span className="muted small">{lang === 'ar' ? row.name_en : row.name_ar}</span>
                </div>
              ),
            },
            { key: 'plant', header: t('customers.plant'), render: (row) => (lang === 'ar' ? row.plant_ar : row.plant_en) },
            { key: 'tier', header: t('customers.tier'), align: 'end' },
            { key: 'credit_limit_egp', header: t('customers.creditLimit'), align: 'end', render: (row) => formatCellValue(row.credit_limit_egp, 'money', lang) },
            {
              key: 'outstanding',
              header: t('customers.creditUsed'),
              align: 'end',
              render: (row) => formatCellValue(row.outstanding_amount, 'money', lang),
            },
            {
              key: 'available',
              header: t('customers.available'),
              align: 'end',
              render: (row) => {
                const ratio = row.credit_limit_egp === 0 ? 0 : row.outstanding_amount / row.credit_limit_egp;
                const tone: BadgeTone = ratio > 1 ? 'danger' : ratio > 0.8 ? 'warning' : 'success';
                const label = ratio > 1 ? t('customers.creditExceeded') : ratio > 0.8 ? t('customers.creditWarn') : t('customers.creditOk');
                return (
                  <div className="cell-stack cell-stack--end">
                    <span>{formatCellValue(row.available_credit, 'money', lang)}</span>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                );
              },
            },
            { key: 'credit_days', header: t('customers.creditDays'), align: 'end' },
            {
              key: 'status',
              header: t('customers.status'),
              render: (row) => <Badge tone={statusTone[row.status] ?? 'neutral'}>{t(`customers.status.${row.status}`)}</Badge>,
            },
            { key: 'phone', header: t('common.phone'), render: (row) => <span className="mono">{row.phone || '—'}</span> },
            {
              key: 'edit',
              header: t('customers.edit'),
              render: (row) => (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(row)}>
                  {t('customers.edit')}
                </button>
              ),
            },
          ]}
        />
        <InfoNote tone="info">{t('customers.note')}</InfoNote>
      </Card>
    </div>
  );
};
