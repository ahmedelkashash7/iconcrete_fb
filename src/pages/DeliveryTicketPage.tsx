import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import { DeliveryTicketModal } from './DeliveryTicketModal';
import {
  apiMessage,
  fmtDate,
  fmtQty,
  type DeliveryTicket,
  type SalesOrder,
} from './salesShared';

/** M7 — delivery tickets. Reads are level 1; issuing a ticket is level 3 and opens the modal. */

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  confirmed: 'info',
  delivered: 'success',
  voided: 'danger',
};

export const DeliveryTicketPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [tickets, setTickets] = useState<DeliveryTicket[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [orderId, setOrderId] = useState('');
  const [ticketOrder, setTicketOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ticketResponse, orderResponse] = await Promise.all([
        apiFetch<{ tickets: DeliveryTicket[] }>('/api/sales/tickets'),
        apiFetch<{ orders: SalesOrder[] }>('/api/sales/orders'),
      ]);
      setTickets(ticketResponse.tickets);
      setOrders(orderResponse.orders);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const eligible = orders.filter((order) => ['confirmed', 'scheduled', 'in_production'].includes(order.status));

  const act = async (ticket: DeliveryTicket, action: 'confirm' | 'deliver' | 'void') => {
    let reason = '';
    if (action === 'void') {
      const answer = window.prompt(t('sales.voidReason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/tickets/${encodeURIComponent(ticket.id)}/${action}`, {
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

  const columns: TableColumn<DeliveryTicket>[] = [
    { key: 'no', header: t('sales.ticketNo'), render: (row) => row.ticket_no },
    { key: 'order', header: t('sales.orderNo'), render: (row) => row.order_no },
    { key: 'truck', header: t('sales.truck'), render: (row) => row.truck_plate },
    { key: 'date', header: t('common.date'), render: (row) => fmtDate(row.ticket_date, lang) },
    {
      key: 'volumes',
      header: t('sales.volumes'),
      align: 'end',
      render: (row) => `${fmtQty(row.loaded_vol, lang)} / ${fmtQty(row.delivered_vol, lang)} m³`,
    },
    { key: 'batches', header: t('sales.batches'), align: 'end', render: (row) => row.batches.length },
    { key: 'status', header: t('common.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`sales.ticketStatus.${row.status}`)}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <span className="filters__actions">
          {row.status === 'draft' && level >= 3 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'confirm')}>
              {t('sales.confirm')}
            </button>
          ) : null}
          {row.status === 'confirmed' && level >= 3 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'deliver')}>
              {t('sales.markDelivered')}
            </button>
          ) : null}
          {['draft', 'confirmed'].includes(row.status) && level >= 5 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'void')}>
              {t('sales.void')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('sales.ticketsTitle')}
        subtitle={t('sales.ticketsSubtitle')}
        badge={<Badge tone="purple">{tickets.length}</Badge>}
      />
      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('sales.orderNo')}</span>
            <select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.order_no} · {order.customer_name}
                </option>
              ))}
            </select>
          </label>
          {level >= 3 ? (
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!orderId}
                onClick={() => setTicketOrder(orders.find((order) => order.id === orderId && eligible.includes(order)) ?? null)}
              >
                {t('sales.newTicket')}
              </button>
            </div>
          ) : null}
        </div>
        {level >= 3 && orderId && !eligible.some((order) => order.id === orderId) ? (
          <p className="muted">{t('sales.ticketOrderState')}</p>
        ) : null}
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      {loading ? (
        <LoadingBlock label={t('common.loading')} />
      ) : (
        <DataTable
          columns={columns}
          rows={orderId ? tickets.filter((ticket) => ticket.order_id === orderId) : tickets}
          rowKey={(row) => row.id}
          empty={t('common.noData')}
        />
      )}

      {ticketOrder ? <DeliveryTicketModal order={ticketOrder} onClose={() => setTicketOrder(null)} onSaved={() => void load()} /> : null}
    </div>
  );
};
