import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import { apiMessage, customerName, fmtDate, type Customer } from './salesShared';

interface Complaint {
  id: string;
  complaint_no: string;
  feedback_id: string | null;
  customer_id: string;
  customer_name: string;
  order_id: string | null;
  order_no: string | null;
  quality_related: boolean;
  ncr_id: string | null;
  severity: string;
  description: string;
  opened_at: string;
  opened_by: string;
  investigation_notes: string;
  root_cause: string;
  status: string;
  rejection_reason: string | null;
  closed_at: string | null;
}

const TONE: Record<string, BadgeTone> = {
  open: 'warning',
  investigating: 'info',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'danger',
};

const SEVERITY_TONE: Record<string, BadgeTone> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

export const ComplaintsPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ customerId: '', status: '' });
  const [form, setForm] = useState({
    complaintNo: '',
    customerId: '',
    severity: 'medium',
    qualityRelated: false,
    ncrId: '',
    description: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [complaintResponse, customerResponse] = await Promise.all([
        apiFetch<{ complaints: Complaint[] }>('/api/sales/complaints'),
        apiFetch<{ customers: Customer[] }>('/api/sales/customers'),
      ]);
      setComplaints(complaintResponse.complaints);
      setCustomers(customerResponse.customers);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plantId = customers[0]?.plant_id ?? 'PLT-0001';

  const visible = useMemo(
    () =>
      complaints.filter(
        (row) =>
          (!filters.customerId || row.customer_id === filters.customerId) &&
          (!filters.status || row.status === filters.status),
      ),
    [complaints, filters],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/sales/complaints', {
        method: 'POST',
        body: JSON.stringify({
          plantId,
          complaintNo: form.complaintNo,
          customerId: form.customerId,
          severity: form.severity,
          qualityRelated: form.qualityRelated,
          ncrId: form.qualityRelated ? form.ncrId : null,
          description: form.description,
        }),
      });
      setForm({
        complaintNo: '',
        customerId: '',
        severity: 'medium',
        qualityRelated: false,
        ncrId: '',
        description: '',
      });
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (complaint: Complaint, action: 'investigate' | 'resolve' | 'close' | 'reject') => {
    let reason = '';
    let investigationNotes = '';
    let rootCause = '';
    if (action === 'investigate') {
      const answer = window.prompt(t('sales.investigationNotes'));
      if (answer === null) return;
      investigationNotes = answer;
    }
    if (action === 'resolve') {
      const notes = window.prompt(t('sales.investigationNotes'));
      if (notes === null) return;
      investigationNotes = notes;
      const cause = window.prompt(t('sales.rootCause'));
      if (cause === null) return;
      rootCause = cause;
    }
    if (action === 'reject') {
      const answer = window.prompt(t('sales.rejectionReason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/complaints/${encodeURIComponent(complaint.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason, investigationNotes, rootCause }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<Complaint>[] = [
    { key: 'no', header: t('sales.complaintNo'), render: (row) => row.complaint_no },
    { key: 'customer', header: t('sales.customer'), render: (row) => row.customer_name },
    {
      key: 'severity',
      header: t('sales.severity'),
      render: (row) => <Badge tone={SEVERITY_TONE[row.severity] ?? 'neutral'}>{t(`sales.severityLevel.${row.severity}`)}</Badge>,
    },
    {
      key: 'quality',
      header: t('sales.qualityRelated'),
      render: (row) => (row.quality_related ? <Badge tone="info">{row.ncr_id}</Badge> : '—'),
    },
    { key: 'description', header: t('sales.description'), render: (row) => row.description },
    { key: 'opened', header: t('sales.openedAt'), render: (row) => fmtDate(row.opened_at, lang) },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`sales.complaintStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <span className="row-actions">
          {row.status === 'open' && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'investigate')}>
              {t('sales.investigate')}
            </button>
          ) : null}
          {row.status === 'investigating' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'resolve')}>
              {t('sales.resolve')}
            </button>
          ) : null}
          {row.status === 'resolved' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'close')}>
              {t('sales.closeComplaint')}
            </button>
          ) : null}
          {['open', 'investigating'].includes(row.status) && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'reject')}>
              {t('sales.reject')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('sales.complaintsTitle')}
        subtitle={t('sales.complaintsSubtitle')}
        badge={<Badge tone="purple">{complaints.length}</Badge>}
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
              {['open', 'investigating', 'resolved', 'closed', 'rejected'].map((status) => (
                <option key={status} value={status}>
                  {t(`sales.complaintStatus.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="filters__actions">
            {level >= 2 ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('sales.newComplaint')}
              </button>
            ) : null}
          </div>
        </div>
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {showForm && level >= 2 ? (
        <Card>
          <div className="filters">
            <label className="field">
              <span>{t('sales.complaintNo')}</span>
              <input value={form.complaintNo} onChange={(event) => setForm((current) => ({ ...current, complaintNo: event.target.value }))} />
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
            <label className="field">
              <span>{t('sales.severity')}</span>
              <select value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value }))}>
                {['low', 'medium', 'high', 'critical'].map((severity) => (
                  <option key={severity} value={severity}>
                    {t(`sales.severityLevel.${severity}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('sales.qualityRelated')}</span>
              <span className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.qualityRelated}
                  onChange={(event) => setForm((current) => ({ ...current, qualityRelated: event.target.checked }))}
                />
                <span>{t('common.required')}</span>
              </span>
            </label>
            {form.qualityRelated ? (
              <label className="field">
                <span>{t('sales.ncrId')}</span>
                <input value={form.ncrId} onChange={(event) => setForm((current) => ({ ...current, ncrId: event.target.value }))} />
              </label>
            ) : null}
          </div>
          <div className="filters">
            <label className="field field--grow">
              <span>{t('sales.description')}</span>
              <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !form.customerId || !form.description || (form.qualityRelated && !form.ncrId)}
                onClick={() => void save()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
          <p className="muted">{t('sales.complaintNote')}</p>
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
