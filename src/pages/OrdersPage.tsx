import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone } from '../components/ui';
import { nextOrderStatus, type OrderStatus } from '../core/orders';
import type { Customer, Lang, Order, Project } from '../types';

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  confirmed: 'success',
  scheduled: 'purple',
  in_production: 'warning',
  delivered: 'success',
  invoiced: 'purple',
  closed: 'neutral',
};

const emptyForm = {
  customerId: '',
  projectId: '',
  orderNo: '',
  concreteGrade: '',
  quantityM3: '',
  unitPrice: '',
  deliveryDate: '',
  pourWindowStart: '',
  pourWindowEnd: '',
};

export const OrdersPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [rows, setRows] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name_ar: string; name_en: string }>>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orders, parties, projectList] = await Promise.all([
        apiFetch<{ orders: Order[] }>('/api/orders'),
        apiFetch<{ customers: Customer[] }>('/api/customers'),
        apiFetch<{ projects: Project[] }>('/api/projects'),
      ]);
      setRows(orders.orders);
      setCustomers(parties.customers.map((row) => ({ id: row.id, name_ar: row.name_ar, name_en: row.name_en })));
      setProjects(projectList.projects);
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
  const projectOptions = useMemo(
    () => projects.filter((project) => !form.customerId || project.customer_id === form.customerId),
    [projects, form.customerId],
  );

  const submit = async () => {
    if (!form.customerId || !form.orderNo.trim() || !form.concreteGrade.trim() || !form.quantityM3 || !form.unitPrice) {
      setFormError('orders.required');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ ...form, projectId: form.projectId || null }),
      });
      setForm(emptyForm);
      setFormOpen(false);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 503) setFormError('common.durableRequired');
      else if (caught instanceof ApiError && caught.status === 422) setFormError('orders.invalidInput');
      else if (caught instanceof ApiError && caught.status === 409) setFormError('orders.duplicateNo');
      else setFormError('errors.network');
    } finally {
      setSaving(false);
    }
  };

  const advance = async (order: Order) => {
    const next = nextOrderStatus(order.status as OrderStatus);
    if (!next) return;
    setBusy(order.id);
    setFormError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ to: next }),
      });
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) setFormError('orders.invalidTransition');
      else if (caught instanceof ApiError && caught.status === 503) setFormError('common.durableRequired');
      else setFormError('errors.network');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('orders.title')}
        subtitle={t('orders.subtitle')}
        badge={<Badge tone="purple">{rows.length}</Badge>}
      />

      <Card
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen((open) => !open)}>
            {t('orders.create')}
          </button>
        }
      >
        {formOpen ? (
          <div className="filters">
            <label className="field field--grow">
              <span>{t('orders.customer')}</span>
              <select
                value={form.customerId}
                onChange={(event) => setForm({ ...form, customerId: event.target.value, projectId: '' })}
              >
                <option value="">{t('orders.pick')}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {lang === 'ar' ? customer.name_ar : customer.name_en}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--grow">
              <span>{t('orders.project')}</span>
              <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
                <option value="">{t('orders.none')}</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} — {lang === 'ar' ? project.name_ar : project.name_en}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('orders.number')}</span>
              <input value={form.orderNo} onChange={(event) => setForm({ ...form, orderNo: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('orders.grade')}</span>
              <input value={form.concreteGrade} onChange={(event) => setForm({ ...form, concreteGrade: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('orders.quantity')}</span>
              <input
                inputMode="decimal"
                value={form.quantityM3}
                onChange={(event) => setForm({ ...form, quantityM3: event.target.value })}
                dir="ltr"
              />
            </label>
            <label className="field">
              <span>{t('orders.unitPrice')}</span>
              <input
                inputMode="decimal"
                value={form.unitPrice}
                onChange={(event) => setForm({ ...form, unitPrice: event.target.value })}
                dir="ltr"
              />
            </label>
            <label className="field">
              <span>{t('orders.deliveryDate')}</span>
              <input
                type="date"
                value={form.deliveryDate}
                onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })}
                dir="ltr"
              />
            </label>
            <label className="field">
              <span>{t('orders.window')}</span>
              <input
                type="time"
                value={form.pourWindowStart}
                onChange={(event) => setForm({ ...form, pourWindowStart: event.target.value })}
                dir="ltr"
              />
            </label>
            <label className="field">
              <span>{t('orders.windowEnd')}</span>
              <input
                type="time"
                value={form.pourWindowEnd}
                onChange={(event) => setForm({ ...form, pourWindowEnd: event.target.value })}
                dir="ltr"
              />
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
          </div>
        ) : null}

        {formError ? <ErrorNote>{t(formError)}</ErrorNote> : null}

        <DataTable
          dense
          rows={rows}
          rowKey={(row) => row.id}
          empty={t('orders.empty')}
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
                  {t('common.open')}
                </button>
              ),
            },
            { key: 'order_no', header: t('orders.number'), render: (row) => <span className="mono">{row.order_no}</span> },
            {
              key: 'customer',
              header: t('orders.customer'),
              render: (row) => (
                <div className="cell-stack">
                  <strong>{lang === 'ar' ? row.customer_name_ar : row.customer_name_en}</strong>
                  <span className="muted small">{row.project_code || t('orders.none')}</span>
                </div>
              ),
            },
            { key: 'grade', header: t('orders.grade') },
            { key: 'quantity', header: t('orders.quantity'), align: 'end', render: (row) => <span className="mono">{row.quantity_m3}</span> },
            { key: 'unit_price', header: t('orders.unitPrice'), align: 'end', render: (row) => <span className="mono">{row.unit_price}</span> },
            { key: 'total', header: t('orders.value'), align: 'end', render: (row) => <span className="mono">{row.total_value}</span> },
            { key: 'delivery', header: t('orders.deliveryDate'), render: (row) => row.delivery_date || '—' },
            {
              key: 'status',
              header: t('common.status'),
              render: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{t(`orders.status.${row.status}`)}</Badge>,
            },
            {
              key: 'advance',
              header: t('orders.next'),
              render: (row) => {
                const next = nextOrderStatus(row.status as OrderStatus);
                return next ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy === row.id}
                    onClick={() => void advance(row)}
                  >
                    {t(`orders.status.${next}`)}
                  </button>
                ) : (
                  <span className="muted small">—</span>
                );
              },
            },
          ]}
        />

        {detail ? (
          <InfoNote tone="info">
            <strong>{detail.order_no}</strong> · {t('orders.grade')}: {detail.concrete_grade} · {t('orders.quantity')}:{' '}
            {detail.quantity_m3} m³ · {t('orders.unitPrice')}: {detail.unit_price} · {t('orders.value')}:{' '}
            {detail.total_value} · {t(`orders.status.${detail.status}`)}
            {detail.pour_window_start ? ` · ${detail.pour_window_start}–${detail.pour_window_end}` : ''}
          </InfoNote>
        ) : null}

        <InfoNote tone="warning">{t('orders.note')}</InfoNote>
      </Card>
    </div>
  );
};
