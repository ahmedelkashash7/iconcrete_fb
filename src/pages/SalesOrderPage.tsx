import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import { DeliveryTicketModal } from './DeliveryTicketModal';
import {
  apiMessage,
  customerName,
  fmtDate,
  fmtMoney,
  fmtQty,
  today,
  type Contract,
  type Customer,
  type Quotation,
  type SalesOrder,
} from './salesShared';
import type { Material } from './inventoryShared';

/**
 * M7 — sales orders. Level 3 creates a draft and moves production states; level 4 confirms,
 * holds, resumes and cancels. Without a quotation or a signed contract the order needs a level-4
 * reason; a blacklisted customer is refused regardless of level. Partial delivery is derived from
 * confirmed/delivered tickets, never typed into the order.
 */

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  confirmed: 'success',
  scheduled: 'purple',
  in_production: 'warning',
  delivered: 'success',
  invoiced: 'purple',
  closed: 'neutral',
  on_hold: 'warning',
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

export const SalesOrderPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [ticketOrder, setTicketOrder] = useState<SalesOrder | null>(null);
  const [form, setForm] = useState({
    customerId: '',
    sourceType: 'quotation' as 'quotation' | 'contract',
    sourceId: '',
    deliveryDate: '',
    reason: '',
  });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orderResponse, customerResponse, quotationResponse, contractResponse, materialResponse] =
        await Promise.all([
          apiFetch<{ orders: SalesOrder[] }>('/api/sales/orders'),
          apiFetch<{ customers: Customer[] }>('/api/sales/customers'),
          apiFetch<{ quotations: Quotation[] }>('/api/sales/quotations'),
          apiFetch<{ contracts: Contract[] }>('/api/sales/contracts'),
          apiFetch<{ materials: Material[] }>('/api/inventory/materials'),
        ]);
      setOrders(orderResponse.orders);
      setCustomers(customerResponse.customers);
      setQuotations(quotationResponse.quotations);
      setContracts(contractResponse.contracts);
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

  const customerQuotations = useMemo(
    () => quotations.filter((quotation) => !form.customerId || quotation.customer_id === form.customerId),
    [quotations, form.customerId],
  );
  const customerContracts = useMemo(
    () => contracts.filter((contract) => !form.customerId || contract.customer_id === form.customerId),
    [contracts, form.customerId],
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
      await apiFetch('/api/sales/orders', {
        method: 'POST',
        body: JSON.stringify({
          plantId: materials[0]?.plant_id ?? 'PLT-0001',
          customerId: form.customerId,
          quotationId: form.sourceType === 'quotation' ? form.sourceId || null : null,
          contractId: form.sourceType === 'contract' ? form.sourceId || null : null,
          deliveryDate: form.deliveryDate || null,
          orderDate: today(),
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
      setForm({ customerId: '', sourceType: 'quotation', sourceId: '', deliveryDate: '', reason: '' });
      setLines([emptyLine()]);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (order: SalesOrder, action: string) => {
    let reason = '';
    if (['cancel', 'hold', 'deliver'].includes(action) && level >= 4) {
      if (action === 'cancel' || action === 'hold') {
        const answer = window.prompt(t(action === 'cancel' ? 'sales.cancelReason' : 'sales.holdReason'));
        if (answer === null) return;
        reason = answer;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/orders/${encodeURIComponent(order.id)}/${action}`, {
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

  const columns: TableColumn<SalesOrder>[] = [
    { key: 'no', header: t('sales.orderNo'), render: (row) => row.order_no },
    { key: 'customer', header: t('sales.customer'), render: (row) => row.customer_name },
    { key: 'project', header: t('sales.project'), render: (row) => row.project_code ?? '—' },
    {
      key: 'total',
      header: t('common.total'),
      align: 'end',
      render: (row) => (
        <span>
          {fmtMoney(row.total_amount, lang)}
          {row.credit_status ? <Badge tone={row.credit_status === 'pass' ? 'success' : row.credit_status === 'warn' ? 'warning' : 'danger'}>{row.credit_status}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'delivery',
      header: t('sales.delivery'),
      render: (row) => (
        <span>
          {fmtQty(row.delivered_qty, lang)} / {fmtQty(row.ordered_qty, lang)} m³ ·{' '}
          <Badge tone={row.delivery_state === 'full' ? 'success' : row.delivery_state === 'partial' ? 'warning' : 'neutral'}>
            {t(`sales.deliveryState.${row.delivery_state}`)}
          </Badge>
        </span>
      ),
    },
    { key: 'date', header: t('sales.deliveryDate'), render: (row) => fmtDate(row.delivery_date, lang) },
    { key: 'status', header: t('common.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`orders.status.${row.status}`)}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <span className="filters__actions">
          {row.status === 'draft' && level >= 4 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'confirm')}>
              {t('sales.confirm')}
            </button>
          ) : null}
          {row.status === 'confirmed' && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'schedule')}>
              {t('sales.schedule')}
            </button>
          ) : null}
          {row.status === 'scheduled' && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'start')}>
              {t('sales.startProduction')}
            </button>
          ) : null}
          {row.status === 'in_production' && level >= 3 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'deliver')}>
              {t('sales.markDelivered')}
            </button>
          ) : null}
          {['confirmed', 'scheduled', 'in_production'].includes(row.status) && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setTicketOrder(row)}>
              {t('sales.newTicket')}
            </button>
          ) : null}
          {['confirmed', 'scheduled', 'in_production'].includes(row.status) && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'hold')}>
              {t('sales.hold')}
            </button>
          ) : null}
          {row.status === 'on_hold' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'resume')}>
              {t('sales.resume')}
            </button>
          ) : null}
          {['draft', 'confirmed', 'scheduled'].includes(row.status) && level >= 4 ? (
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
        title={t('sales.ordersTitle')}
        subtitle={t('sales.ordersSubtitle')}
        badge={<Badge tone="purple">{orders.length}</Badge>}
      />
      <Card>
        <div className="filters">
          <span className="muted">{t('sales.orderFlow')}</span>
          {level >= 3 ? (
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('sales.newOrder')}
              </button>
            </div>
          ) : null}
        </div>
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      {showForm && level >= 3 ? (
        <Card title={t('sales.newOrder')}>
          <div className="filters">
            <label className="field">
              <span>{t('sales.customer')}</span>
              <select value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value, sourceId: '' }))}>
                <option value="">—</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customerName(customer, lang)}
                    {customer.blacklisted ? ' ⛔' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('sales.priceSource')}</span>
              <select
                value={form.sourceType}
                onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value as 'quotation' | 'contract', sourceId: '' }))}
              >
                <option value="quotation">{t('sales.quotation')}</option>
                <option value="contract">{t('sales.contract')}</option>
              </select>
            </label>
            <label className="field">
              <span>{form.sourceType === 'quotation' ? t('sales.quotationNo') : t('sales.contractNo')}</span>
              <select value={form.sourceId} onChange={(event) => setForm((current) => ({ ...current, sourceId: event.target.value }))}>
                <option value="">—</option>
                {(form.sourceType === 'quotation' ? customerQuotations : customerContracts).map((source) => (
                  <option key={source.id} value={source.id}>
                    {'quotation_no' in source ? source.quotation_no : source.contract_no} · {source.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('sales.deliveryDate')}</span>
              <input type="date" value={form.deliveryDate} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value }))} />
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
            <div className="filters" key={`order-line-${index}`}>
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

      {loading ? <LoadingBlock label={t('common.loading')} /> : <DataTable columns={columns} rows={orders} rowKey={(row) => row.id} empty={t('common.noData')} />}

      {orders
        .filter((order) => order.tickets.length > 0)
        .map((order) => (
          <Card key={order.id} title={`${order.order_no} — ${t('sales.tickets')}`}>
            <ul className="stack-list">
              {order.tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Badge tone={ticket.status === 'delivered' ? 'success' : ticket.status === 'voided' ? 'danger' : 'info'}>{ticket.status}</Badge>{' '}
                  {ticket.ticket_no} · {ticket.truck_plate} · {fmtQty(ticket.loaded_vol, lang)}/{fmtQty(ticket.delivered_vol, lang)} m³ ·{' '}
                  {ticket.batches.length} {t('sales.batches')}
                </li>
              ))}
            </ul>
          </Card>
        ))}

      {ticketOrder ? <DeliveryTicketModal order={ticketOrder} onClose={() => setTicketOrder(null)} onSaved={() => void load()} /> : null}
    </div>
  );
};
