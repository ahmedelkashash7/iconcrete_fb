import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import { apiMessage, customerName, fmtDate, type Customer } from './salesShared';

interface Activity {
  id: string;
  activity_no: string;
  customer_id: string;
  customer_name: string;
  activity_type: string;
  subject: string;
  occurred_at: string;
  due_at: string | null;
  assigned_to: string;
  status: string;
  outcome: string;
}

interface Feedback {
  id: string;
  customer_id: string;
  customer_name: string;
  source: string;
  rating_1_to_5: number;
  category: string;
  comment: string;
  submitted_at: string;
  handled_by: string;
  resolution: string;
  status: string;
}

const ACTIVITY_TONE: Record<string, BadgeTone> = {
  open: 'warning',
  done: 'success',
  cancelled: 'neutral',
};

const FEEDBACK_TONE: Record<string, BadgeTone> = {
  open: 'warning',
  handled: 'info',
  closed: 'success',
};

const nowLocal = () => new Date().toISOString().slice(0, 16);

export const CrmActivitiesPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [tab, setTab] = useState<'activities' | 'feedback'>('activities');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ customerId: '', type: '', status: '' });
  const [activityForm, setActivityForm] = useState({
    activityNo: '',
    customerId: '',
    activityType: 'visit',
    subject: '',
    description: '',
    occurredAt: nowLocal(),
    dueAt: '',
    assignedTo: '',
  });
  const [feedbackForm, setFeedbackForm] = useState({
    customerId: '',
    source: 'phone',
    rating: '5',
    category: '',
    comment: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [activityResponse, feedbackResponse, customerResponse] = await Promise.all([
        apiFetch<{ activities: Activity[] }>('/api/sales/activities'),
        apiFetch<{ feedback: Feedback[] }>('/api/sales/feedback'),
        apiFetch<{ customers: Customer[] }>('/api/sales/customers'),
      ]);
      setActivities(activityResponse.activities);
      setFeedback(feedbackResponse.feedback);
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

  const visibleActivities = useMemo(
    () =>
      activities.filter(
        (row) =>
          (!filters.customerId || row.customer_id === filters.customerId) &&
          (!filters.type || row.activity_type === filters.type) &&
          (!filters.status || row.status === filters.status),
      ),
    [activities, filters],
  );

  const visibleFeedback = useMemo(
    () =>
      feedback.filter(
        (row) =>
          (!filters.customerId || row.customer_id === filters.customerId) &&
          (!filters.status || row.status === filters.status),
      ),
    [feedback, filters],
  );

  const saveActivity = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/sales/activities', {
        method: 'POST',
        body: JSON.stringify({
          plantId,
          activityNo: activityForm.activityNo,
          customerId: activityForm.customerId,
          activityType: activityForm.activityType,
          subject: activityForm.subject,
          description: activityForm.description,
          occurredAt: activityForm.occurredAt ? new Date(activityForm.occurredAt).toISOString() : null,
          dueAt: activityForm.dueAt ? new Date(activityForm.dueAt).toISOString() : null,
          assignedTo: activityForm.assignedTo,
        }),
      });
      setActivityForm({
        activityNo: '',
        customerId: '',
        activityType: 'visit',
        subject: '',
        description: '',
        occurredAt: nowLocal(),
        dueAt: '',
        assignedTo: '',
      });
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveFeedback = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/sales/feedback', {
        method: 'POST',
        body: JSON.stringify({
          plantId,
          customerId: feedbackForm.customerId,
          source: feedbackForm.source,
          rating: Number(feedbackForm.rating),
          category: feedbackForm.category,
          comment: feedbackForm.comment,
        }),
      });
      setFeedbackForm({ customerId: '', source: 'phone', rating: '5', category: '', comment: '' });
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const closeActivity = async (activity: Activity, action: 'done' | 'cancel') => {
    let outcome = '';
    if (action === 'done') {
      const answer = window.prompt(t('sales.activityOutcome'));
      if (answer === null) return;
      outcome = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/activities/${encodeURIComponent(activity.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ outcome }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleFeedback = async (row: Feedback) => {
    const resolution = window.prompt(t('sales.resolutionText'));
    if (resolution === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/feedback/${encodeURIComponent(row.id)}/handle`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const activityColumns: TableColumn<Activity>[] = [
    { key: 'no', header: t('sales.activityNo'), render: (row) => row.activity_no },
    { key: 'customer', header: t('sales.customer'), render: (row) => row.customer_name },
    { key: 'type', header: t('sales.activityType'), render: (row) => t(`sales.activity.${row.activity_type}`) },
    { key: 'subject', header: t('sales.subject'), render: (row) => row.subject },
    { key: 'occurred', header: t('sales.occurredAt'), render: (row) => fmtDate(row.occurred_at, lang) },
    { key: 'due', header: t('sales.dueAt'), render: (row) => fmtDate(row.due_at, lang) },
    { key: 'assigned', header: t('sales.assignedTo'), render: (row) => row.assigned_to || '—' },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={ACTIVITY_TONE[row.status] ?? 'neutral'}>{t(`sales.activityStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) =>
        row.status === 'open' && level >= 2 ? (
          <span className="row-actions">
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void closeActivity(row, 'done')}>
              {t('sales.closeDone')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void closeActivity(row, 'cancel')}>
              {t('common.cancel')}
            </button>
          </span>
        ) : null,
    },
  ];

  const feedbackColumns: TableColumn<Feedback>[] = [
    { key: 'customer', header: t('sales.customer'), render: (row) => row.customer_name },
    { key: 'source', header: t('sales.feedbackSource'), render: (row) => row.source },
    { key: 'rating', header: t('sales.rating'), align: 'end', render: (row) => `${row.rating_1_to_5} / 5` },
    { key: 'category', header: t('sales.category'), render: (row) => row.category || '—' },
    { key: 'comment', header: t('sales.comment'), render: (row) => row.comment || '—' },
    { key: 'submitted', header: t('sales.submittedAt'), render: (row) => fmtDate(row.submitted_at, lang) },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={FEEDBACK_TONE[row.status] ?? 'neutral'}>{t(`sales.feedbackStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) =>
        row.status === 'open' && level >= 2 ? (
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void handleFeedback(row)}>
            {t('sales.handle')}
          </button>
        ) : null,
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('sales.crmTitle')}
        subtitle={t('sales.crmSubtitle')}
        badge={<Badge tone="purple">{tab === 'activities' ? activities.length : feedback.length}</Badge>}
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
          {tab === 'activities' ? (
            <label className="field">
              <span>{t('sales.activityType')}</span>
              <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
                <option value="">{t('common.all')}</option>
                {['call', 'visit', 'complaint', 'inquiry', 'follow_up'].map((type) => (
                  <option key={type} value={type}>
                    {t(`sales.activity.${type}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">{t('common.all')}</option>
              {(tab === 'activities' ? ['open', 'done', 'cancelled'] : ['open', 'handled', 'closed']).map((status) => (
                <option key={status} value={status}>
                  {t(`sales.${tab === 'activities' ? 'activityStatus' : 'feedbackStatus'}.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="filters__actions">
            <button type="button" className={`btn btn--sm ${tab === 'activities' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setTab('activities')}>
              {t('sales.activitiesTab')}
            </button>
            <button type="button" className={`btn btn--sm ${tab === 'feedback' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setTab('feedback')}>
              {t('sales.feedbackTab')}
            </button>
            {level >= 2 ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t(tab === 'activities' ? 'sales.newActivity' : 'sales.newFeedback')}
              </button>
            ) : null}
          </div>
        </div>
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {showForm && level >= 2 ? (
        <Card>
          {tab === 'activities' ? (
            <>
              <div className="filters">
                <label className="field">
                  <span>{t('sales.activityNo')}</span>
                  <input value={activityForm.activityNo} onChange={(event) => setActivityForm((current) => ({ ...current, activityNo: event.target.value }))} />
                </label>
                <label className="field field--grow">
                  <span>{t('sales.customer')}</span>
                  <select value={activityForm.customerId} onChange={(event) => setActivityForm((current) => ({ ...current, customerId: event.target.value }))}>
                    <option value="">—</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customerName(customer, lang)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('sales.activityType')}</span>
                  <select value={activityForm.activityType} onChange={(event) => setActivityForm((current) => ({ ...current, activityType: event.target.value }))}>
                    {['call', 'visit', 'complaint', 'inquiry', 'follow_up'].map((type) => (
                      <option key={type} value={type}>
                        {t(`sales.activity.${type}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="filters">
                <label className="field field--grow">
                  <span>{t('sales.subject')}</span>
                  <input value={activityForm.subject} onChange={(event) => setActivityForm((current) => ({ ...current, subject: event.target.value }))} />
                </label>
                <label className="field">
                  <span>{t('sales.occurredAt')}</span>
                  <input type="datetime-local" value={activityForm.occurredAt} onChange={(event) => setActivityForm((current) => ({ ...current, occurredAt: event.target.value }))} />
                </label>
                <label className="field">
                  <span>{t('sales.dueAt')}</span>
                  <input type="datetime-local" value={activityForm.dueAt} onChange={(event) => setActivityForm((current) => ({ ...current, dueAt: event.target.value }))} />
                </label>
                <label className="field">
                  <span>{t('sales.assignedTo')}</span>
                  <input value={activityForm.assignedTo} onChange={(event) => setActivityForm((current) => ({ ...current, assignedTo: event.target.value }))} />
                </label>
                <div className="filters__actions">
                  <button type="button" className="btn btn--primary btn--sm" disabled={busy || !activityForm.customerId || !activityForm.subject} onClick={() => void saveActivity()}>
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="filters">
              <label className="field field--grow">
                <span>{t('sales.customer')}</span>
                <select value={feedbackForm.customerId} onChange={(event) => setFeedbackForm((current) => ({ ...current, customerId: event.target.value }))}>
                  <option value="">—</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customerName(customer, lang)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('sales.feedbackSource')}</span>
                <input value={feedbackForm.source} onChange={(event) => setFeedbackForm((current) => ({ ...current, source: event.target.value }))} />
              </label>
              <label className="field">
                <span>{t('sales.rating')}</span>
                <input type="number" min="1" max="5" value={feedbackForm.rating} onChange={(event) => setFeedbackForm((current) => ({ ...current, rating: event.target.value }))} />
              </label>
              <label className="field">
                <span>{t('sales.category')}</span>
                <input value={feedbackForm.category} onChange={(event) => setFeedbackForm((current) => ({ ...current, category: event.target.value }))} />
              </label>
              <label className="field field--grow">
                <span>{t('sales.comment')}</span>
                <input value={feedbackForm.comment} onChange={(event) => setFeedbackForm((current) => ({ ...current, comment: event.target.value }))} />
              </label>
              <div className="filters__actions">
                <button type="button" className="btn btn--primary btn--sm" disabled={busy || !feedbackForm.customerId} onClick={() => void saveFeedback()}>
                  {t('common.save')}
                </button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {!loading ? (
        <Card>
          {tab === 'activities' ? (
            <DataTable columns={activityColumns} rows={visibleActivities} rowKey={(row) => row.id} empty={t('common.noData')} />
          ) : (
            <DataTable columns={feedbackColumns} rows={visibleFeedback} rowKey={(row) => row.id} empty={t('common.noData')} />
          )}
        </Card>
      ) : null}
    </div>
  );
};
