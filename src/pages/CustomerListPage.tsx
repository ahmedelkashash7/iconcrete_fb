import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import {
  apiMessage,
  creditTone,
  customerName,
  fmtDate,
  fmtMoney,
  type Customer,
  type Project,
} from './salesShared';

/**
 * M7 — customer master and projects. Reads are level 1; customer/project writes are level 4/3.
 * A blacklisted customer stays visible with its reason and is blocked on the order screen.
 */

const TONE: Record<string, BadgeTone> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral',
  draft: 'neutral',
  on_hold: 'warning',
  completed: 'success',
  cancelled: 'danger',
};

const emptyCustomer = {
  customerCode: '',
  nameAr: '',
  nameEn: '',
  contactPerson: '',
  phone: '',
  email: '',
  billingAddress: '',
  shippingAddress: '',
  creditLimit: '',
  blacklisted: false,
  blacklistReason: '',
};

const emptyProject = {
  customerId: '',
  code: '',
  nameAr: '',
  nameEn: '',
  siteLocation: '',
  contactPerson: '',
  contactPhone: '',
  startDate: '',
  endDate: '',
};

export const CustomerListPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [tab, setTab] = useState<'customers' | 'projects'>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ q: '', plantId: '', status: '', minLimit: '' });
  const [form, setForm] = useState(emptyCustomer);
  const [projectForm, setProjectForm] = useState(emptyProject);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [customerResponse, projectResponse] = await Promise.all([
        apiFetch<{ customers: Customer[] }>('/api/sales/customers'),
        apiFetch<{ projects: Project[] }>('/api/sales/projects'),
      ]);
      setCustomers(customerResponse.customers);
      setProjects(projectResponse.projects);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plants = useMemo(
    () => [...new Set(customers.map((customer) => customer.plant_id).filter(Boolean) as string[])].sort(),
    [customers],
  );

  const visibleCustomers = useMemo(
    () =>
      customers.filter((customer) => {
        const haystack = `${customer.customer_code ?? ''} ${customer.name_ar} ${customer.name_en}`.toLowerCase();
        return (
          (!filters.q || haystack.includes(filters.q.toLowerCase())) &&
          (!filters.plantId || customer.plant_id === filters.plantId) &&
          (!filters.status || customer.status === filters.status) &&
          (!filters.minLimit || (customer.credit_limit ?? 0) >= Number(filters.minLimit))
        );
      }),
    [customers, filters],
  );

  const visibleProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          (!filters.plantId || project.plant_id === filters.plantId) &&
          (!filters.q || `${project.code} ${project.name_ar} ${project.name_en}`.toLowerCase().includes(filters.q.toLowerCase())),
      ),
    [projects, filters],
  );

  const saveCustomer = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/sales/customers', {
        method: 'POST',
        body: JSON.stringify({
          plantId: filters.plantId || plants[0] || 'PLT-0001',
          customerCode: form.customerCode || null,
          nameAr: form.nameAr,
          nameEn: form.nameEn,
          contactPerson: form.contactPerson,
          phone: form.phone,
          email: form.email,
          billingAddress: form.billingAddress,
          shippingAddress: form.shippingAddress,
          creditLimit: form.creditLimit === '' ? null : Number(form.creditLimit),
          blacklisted: form.blacklisted,
          blacklistReason: form.blacklistReason,
        }),
      });
      setForm(emptyCustomer);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveProject = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/sales/projects', {
        method: 'POST',
        body: JSON.stringify({
          plantId: filters.plantId || plants[0] || 'PLT-0001',
          ...projectForm,
          startDate: projectForm.startDate || null,
          endDate: projectForm.endDate || null,
        }),
      });
      setProjectForm(emptyProject);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const blacklist = async (customer: Customer) => {
    const reason = customer.blacklisted ? '' : window.prompt(t('sales.blacklistReason'));
    if (!customer.blacklisted && reason === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/customers/${encodeURIComponent(customer.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ blacklisted: !customer.blacklisted, blacklistReason: reason ?? '' }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const customerColumns: TableColumn<Customer>[] = [
    { key: 'code', header: t('customers.id'), render: (row) => row.customer_code ?? row.id },
    { key: 'name', header: t('customers.name'), render: (row) => customerName(row, lang) },
    { key: 'contact', header: t('sales.contact'), render: (row) => row.contact_person || row.phone || '—' },
    {
      key: 'credit',
      header: t('customers.creditLimit'),
      align: 'end',
      render: (row) => (
        <span>
          {fmtMoney(row.exposure, lang)} / {row.effective_limit > 0 ? fmtMoney(row.effective_limit, lang) : '—'}
          {row.credit_ratio !== null ? (
            <Badge tone={creditTone(row.credit_ratio)}>{row.credit_ratio.toFixed(0)}%</Badge>
          ) : null}
        </span>
      ),
    },
    { key: 'status', header: t('common.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`customers.status.${row.status}`)}</Badge> },
    {
      key: 'blacklisted',
      header: t('sales.blacklisted'),
      render: (row) =>
        row.blacklisted ? <Badge tone="danger">{row.blacklist_reason || t('sales.blacklisted')}</Badge> : '—',
    },
    {
      key: 'id',
      header: '',
      render: (row) =>
        level >= 4 ? (
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void blacklist(row)}>
            {row.blacklisted ? t('sales.unblacklist') : t('sales.blacklist')}
          </button>
        ) : null,
    },
  ];

  const projectColumns: TableColumn<Project>[] = [
    { key: 'code', header: t('projects.code') },
    { key: 'name', header: t('projects.name'), render: (row) => (lang === 'ar' ? row.name_ar : row.name_en || row.name_ar) },
    { key: 'site', header: t('sales.site'), render: (row) => row.site_location || '—' },
    { key: 'contact', header: t('sales.contact'), render: (row) => row.contact_person || row.contact_phone || '—' },
    { key: 'start', header: t('sales.start'), render: (row) => fmtDate(row.start_date, lang) },
    { key: 'status', header: t('common.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{row.status}</Badge> },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('sales.customersTitle')}
        subtitle={t('sales.customersSubtitle')}
        badge={<Badge tone="purple">{customers.length}</Badge>}
      />
      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('common.search')}</span>
            <input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} />
          </label>
          <label className="field">
            <span>{t('inventory.plant')}</span>
            <select value={filters.plantId} onChange={(event) => setFilters((current) => ({ ...current, plantId: event.target.value }))}>
              <option value="">{t('common.all')}</option>
              {plants.map((plant) => (
                <option key={plant} value={plant}>
                  {plant}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">{t('common.all')}</option>
              <option value="active">{t('customers.status.active')}</option>
              <option value="suspended">{t('customers.status.suspended')}</option>
              <option value="archived">{t('customers.status.archived')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('sales.minCreditLimit')}</span>
            <input type="number" min="0" value={filters.minLimit} onChange={(event) => setFilters((current) => ({ ...current, minLimit: event.target.value }))} />
          </label>
          <div className="filters__actions">
            <button type="button" className={`btn btn--sm ${tab === 'customers' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setTab('customers')}>
              {t('sales.customersTab')}
            </button>
            <button type="button" className={`btn btn--sm ${tab === 'projects' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setTab('projects')}>
              {t('sales.projectsTab')}
            </button>
            {tab === 'customers' && level >= 4 ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('sales.newCustomer')}
              </button>
            ) : null}
            {tab === 'projects' && level >= 3 ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('sales.newProject')}
              </button>
            ) : null}
          </div>
        </div>
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      {showForm && level >= 4 && tab === 'customers' ? (
        <Card title={t('sales.newCustomer')}>
          <div className="filters">
            <label className="field">
              <span>{t('customers.id')}</span>
              <input value={form.customerCode} onChange={(event) => setForm((current) => ({ ...current, customerCode: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.nameAr')}</span>
              <input required value={form.nameAr} onChange={(event) => setForm((current) => ({ ...current, nameAr: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.nameEn')}</span>
              <input value={form.nameEn} onChange={(event) => setForm((current) => ({ ...current, nameEn: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.contact')}</span>
              <input value={form.contactPerson} onChange={(event) => setForm((current) => ({ ...current, contactPerson: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('common.phone')}</span>
              <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('common.email')}</span>
              <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('customers.creditLimit')}</span>
              <input type="number" min="0" value={form.creditLimit} onChange={(event) => setForm((current) => ({ ...current, creditLimit: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.billingAddress')}</span>
              <input value={form.billingAddress} onChange={(event) => setForm((current) => ({ ...current, billingAddress: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.shippingAddress')}</span>
              <input value={form.shippingAddress} onChange={(event) => setForm((current) => ({ ...current, shippingAddress: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.blacklisted')}</span>
              <input type="checkbox" checked={form.blacklisted} onChange={(event) => setForm((current) => ({ ...current, blacklisted: event.target.checked }))} />
            </label>
            {form.blacklisted ? (
              <label className="field">
                <span>{t('sales.blacklistReason')}</span>
                <input value={form.blacklistReason} onChange={(event) => setForm((current) => ({ ...current, blacklistReason: event.target.value }))} />
              </label>
            ) : null}
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || !form.nameAr} onClick={() => void saveCustomer()}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {showForm && level >= 3 && tab === 'projects' ? (
        <Card title={t('sales.newProject')}>
          <div className="filters">
            <label className="field">
              <span>{t('sales.customer')}</span>
              <select value={projectForm.customerId} onChange={(event) => setProjectForm((current) => ({ ...current, customerId: event.target.value }))}>
                <option value="">—</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customerName(customer, lang)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('projects.code')}</span>
              <input value={projectForm.code} onChange={(event) => setProjectForm((current) => ({ ...current, code: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.nameAr')}</span>
              <input value={projectForm.nameAr} onChange={(event) => setProjectForm((current) => ({ ...current, nameAr: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.nameEn')}</span>
              <input value={projectForm.nameEn} onChange={(event) => setProjectForm((current) => ({ ...current, nameEn: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.site')}</span>
              <input value={projectForm.siteLocation} onChange={(event) => setProjectForm((current) => ({ ...current, siteLocation: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.contact')}</span>
              <input value={projectForm.contactPerson} onChange={(event) => setProjectForm((current) => ({ ...current, contactPerson: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('common.phone')}</span>
              <input value={projectForm.contactPhone} onChange={(event) => setProjectForm((current) => ({ ...current, contactPhone: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.start')}</span>
              <input type="date" value={projectForm.startDate} onChange={(event) => setProjectForm((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.end')}</span>
              <input type="date" value={projectForm.endDate} onChange={(event) => setProjectForm((current) => ({ ...current, endDate: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !projectForm.customerId || !projectForm.code || !projectForm.nameAr}
                onClick={() => void saveProject()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {level < 4 ? <p className="muted">{t('sales.readOnly')}</p> : null}
      {loading ? (
        <LoadingBlock label={t('common.loading')} />
      ) : tab === 'customers' ? (
        <DataTable columns={customerColumns} rows={visibleCustomers} rowKey={(row) => row.id} empty={t('customers.noResults')} />
      ) : (
        <DataTable columns={projectColumns} rows={visibleProjects} rowKey={(row) => row.id} empty={t('common.noData')} />
      )}
    </div>
  );
};
