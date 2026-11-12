import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone } from '../components/ui';
import type { Customer, Lang, Project } from '../types';

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  active: 'success',
  on_hold: 'warning',
  completed: 'purple',
  cancelled: 'danger',
};

interface CustomerOption {
  id: string;
  name_ar: string;
  name_en: string;
}

const emptyForm = { plantId: 'PLT-0001', customerId: '', code: '', nameAr: '', nameEn: '', siteLocation: '' };

export const ProjectsPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [rows, setRows] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projects, parties] = await Promise.all([
        apiFetch<{ projects: Project[] }>('/api/projects'),
        apiFetch<{ customers: Customer[] }>('/api/customers'),
      ]);
      setRows(projects.projects);
      setCustomers(parties.customers.map((row) => ({ id: row.id, name_ar: row.name_ar, name_en: row.name_en })));
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 403 ? 'errors.forbidden' : 'errors.network');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const detail = useMemo(() => rows.find((row) => row.id === selected) ?? null, [rows, selected]);

  const submit = async () => {
    if (!form.customerId || !form.code.trim() || !form.nameAr.trim() || !form.nameEn.trim()) {
      setFormError('projects.required');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch('/api/sales/projects', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm(emptyForm);
      setFormOpen(false);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 503) setFormError('common.durableRequired');
      else if (caught instanceof ApiError && caught.status === 403) setFormError('errors.forbidden');
      else if (caught instanceof ApiError && (caught.status === 409 || caught.status === 422)) setFormError('projects.duplicateCode');
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
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        badge={<Badge tone="purple">{rows.length}</Badge>}
      />

      <Card
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen((open) => !open)}>
            {t('projects.create')}
          </button>
        }
      >
        {formOpen ? (
          <div className="filters">
            <label className="field">
              <span>{t('common.plant')}</span>
              <select value={form.plantId} onChange={(event) => setForm({ ...form, plantId: event.target.value })}>
                <option value="PLT-0001">PLT-0001</option>
                <option value="PLT-0002">PLT-0002</option>
              </select>
            </label>
            <label className="field field--grow">
              <span>{t('projects.customer')}</span>
              <select value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
                <option value="">{t('projects.selectCustomer')}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {lang === 'ar' ? customer.name_ar : customer.name_en}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('projects.code')}</span>
              <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
            </label>
            <label className="field field--grow">
              <span>{t('projects.name')} (AR)</span>
              <input value={form.nameAr} onChange={(event) => setForm({ ...form, nameAr: event.target.value })} dir="rtl" />
            </label>
            <label className="field field--grow">
              <span>{t('projects.name')} (EN)</span>
              <input value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} dir="ltr" />
            </label>
            <label className="field field--grow">
              <span>{t('projects.site')}</span>
              <input value={form.siteLocation} onChange={(event) => setForm({ ...form, siteLocation: event.target.value })} />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => void submit()} disabled={saving}>
                {saving ? t('common.loading') : t('common.save')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setForm(emptyForm);
                  setFormOpen(false);
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
            {formError ? <ErrorNote>{t(formError)}</ErrorNote> : null}
          </div>
        ) : null}

        <DataTable
          dense
          rows={rows}
          rowKey={(row) => row.id}
          empty={t('projects.empty')}
          columns={[
            {
              key: 'detail',
              header: t('common.details'),
              render: (row) => (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setSelected(row.id === selected ? null : row.id)}
                >
                  {row.code}
                </button>
              ),
            },
            { key: 'code', header: t('projects.code'), render: (row) => <span className="mono">{row.code}</span> },
            {
              key: 'name',
              header: t('projects.name'),
              render: (row) => (
                <div className="cell-stack">
                  <strong>{lang === 'ar' ? row.name_ar : row.name_en}</strong>
                  <span className="muted small">{lang === 'ar' ? row.customer_name_ar : row.customer_name_en}</span>
                </div>
              ),
            },
            { key: 'site', header: t('projects.site'), render: (row) => row.site_location || '—' },
            { key: 'orders', header: t('projects.ordersCount'), align: 'end', render: (row) => row.order_count },
            {
              key: 'status',
              header: t('common.status'),
              render: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{t(`projects.status.${row.status}`)}</Badge>,
            },
          ]}
        />

        {detail ? (
          <InfoNote tone="info">
            <strong>{detail.code}</strong> — {lang === 'ar' ? detail.name_ar : detail.name_en} ·{' '}
            {t('projects.ordersCount')}: {detail.order_count} · {t(`projects.status.${detail.status}`)}
          </InfoNote>
        ) : null}

        <InfoNote tone="warning">{t('projects.note')}</InfoNote>
      </Card>
    </div>
  );
};
