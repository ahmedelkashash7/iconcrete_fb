import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import {
  apiMessage,
  fmtDate,
  fmtMoney,
  fmtQty,
  type GoodsReceipt,
  type PurchaseOrder,
} from './inventoryShared';

/**
 * M6 — goods receipts. Recording is level 3 and does not move stock: the receipt stays a draft
 * until it is confirmed. Confirmation posts the receipt movements and opens FIFO layers; an
 * over-receipt needs a level-4 approval reason. Voiding is level 5 and only allowed while the
 * receipt's stock is untouched.
 */

const TONE: Record<string, BadgeTone> = {
  draft: 'warning',
  confirmed: 'success',
  voided: 'danger',
};

interface LineDraft {
  poItemId: string;
  label: string;
  remaining: number;
  quantity: string;
  unitCost: string;
  lotNo: string;
  expiryDate: string;
  weight: string;
}

export const GoodsReceiptPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [poId, setPoId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [receiptResponse, orderResponse] = await Promise.all([
        apiFetch<{ goodsReceipts: GoodsReceipt[] }>('/api/inventory/goods-receipts'),
        apiFetch<{ purchaseOrders: PurchaseOrder[] }>('/api/inventory/purchase-orders'),
      ]);
      setReceipts(receiptResponse.goodsReceipts);
      setOrders(orderResponse.purchaseOrders);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const receivable = useMemo(
    () => orders.filter((order) => order.status === 'confirmed' || order.status === 'partially_received'),
    [orders],
  );

  const chooseOrder = (id: string) => {
    setPoId(id);
    const order = orders.find((row) => row.id === id);
    setLines(
      (order?.items ?? []).map((item) => ({
        poItemId: item.id,
        label: `${item.material_code} — ${item.material_name}`,
        remaining: Math.max(0, item.quantity_ordered - item.quantity_received),
        quantity: String(Math.max(0, item.quantity_ordered - item.quantity_received)),
        unitCost: String(item.unit_price),
        lotNo: '',
        expiryDate: '',
        weight: '',
      })),
    );
  };

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line, position) => (position === index ? { ...line, ...patch } : line)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/inventory/goods-receipts', {
        method: 'POST',
        body: JSON.stringify({
          poId,
          receivedAt: null,
          items: lines
            .filter((line) => Number(line.quantity) > 0)
            .map((line) => ({
              poItemId: line.poItemId,
              quantityReceived: Number(line.quantity),
              unitCost: Number(line.unitCost),
              lotNo: line.lotNo,
              expiryDate: line.expiryDate || null,
              weightInKg: line.weight === '' ? null : Number(line.weight),
            })),
        }),
      });
      setPoId('');
      setLines([]);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (receipt: GoodsReceipt, action: 'confirm' | 'void') => {
    const answer = window.prompt(t(action === 'confirm' ? 'grn.approvalReason' : 'grn.voidReason'));
    if (answer === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventory/goods-receipts/${encodeURIComponent(receipt.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: answer }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<GoodsReceipt>[] = [
    { key: 'receipt_no', header: t('grn.no') },
    { key: 'po_no', header: t('grn.po') },
    {
      key: 'items',
      header: t('grn.lines'),
      render: (row) =>
        row.items
          .map((item) => `${item.material_code}: ${fmtQty(item.quantity_received, lang)} @ ${fmtMoney(item.unit_cost, lang)}${item.lot_no ? ` · ${item.lot_no}` : ''}`)
          .join(' · ') || '—',
    },
    { key: 'received_at', header: t('grn.receivedAt'), render: (row) => fmtDate(row.received_at, lang) },
    { key: 'received_by', header: t('grn.receivedBy') },
    { key: 'status', header: t('inventory.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`grn.status.${row.status}`)}</Badge> },
    { key: 'void_reason', header: t('inventory.reason'), render: (row) => row.void_reason ?? '—' },
    {
      key: 'id',
      header: '',
      render: (row) => (
        <span className="filters__actions">
          {row.status === 'draft' && level >= 3 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'confirm')}>
              {t('grn.confirm')}
            </button>
          ) : null}
          {row.status === 'confirmed' && level >= 5 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'void')}>
              {t('grn.void')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle title={t('grn.title')} subtitle={t('grn.subtitle')} badge={<Badge tone="purple">{receipts.length}</Badge>} />
      <Card>
        <div className="filters">
          <span className="muted">{t('grn.flow')}</span>
          {level >= 3 ? (
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('grn.create')}
              </button>
            </div>
          ) : null}
        </div>
        {level < 3 ? <p className="muted">{t('grn.readOnly')}</p> : null}
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      {receipts.some((receipt) => receipt.status === 'draft') ? <InfoNote tone="warning">{t('grn.draftNote')}</InfoNote> : null}

      {showForm && level >= 3 ? (
        <Card title={t('grn.create')}>
          <div className="filters">
            <label className="field">
              <span>{t('grn.po')}</span>
              <select value={poId} onChange={(event) => chooseOrder(event.target.value)}>
                <option value="">—</option>
                {receivable.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.po_no} · {order.supplier_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {lines.length === 0 ? (
            <p className="muted">{t('grn.pickOrder')}</p>
          ) : (
            lines.map((line, index) => (
              <div className="filters" key={line.poItemId}>
                <label className="field field--wide">
                  <span>{line.label}</span>
                  <span className="muted">
                    {t('grn.remaining')}: {fmtQty(line.remaining, lang)}
                  </span>
                </label>
                <label className="field">
                  <span>{t('inventory.quantity')}</span>
                  <input type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} />
                </label>
                <label className="field">
                  <span>{t('inventory.unitCost')}</span>
                  <input type="number" min="0" step="0.0001" value={line.unitCost} onChange={(event) => setLine(index, { unitCost: event.target.value })} />
                </label>
                <label className="field">
                  <span>{t('inventory.lot')}</span>
                  <input value={line.lotNo} onChange={(event) => setLine(index, { lotNo: event.target.value })} />
                </label>
                <label className="field">
                  <span>{t('grn.expiry')}</span>
                  <input type="date" value={line.expiryDate} onChange={(event) => setLine(index, { expiryDate: event.target.value })} />
                </label>
                <label className="field">
                  <span>{t('grn.weight')}</span>
                  <input type="number" min="0" step="0.001" value={line.weight} onChange={(event) => setLine(index, { weight: event.target.value })} />
                </label>
              </div>
            ))
          )}
          <div className="filters">
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !poId || lines.every((line) => Number(line.quantity) <= 0)}
                onClick={() => void save()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <DataTable columns={columns} rows={receipts} rowKey={(row) => row.id} empty={t('grn.empty')} />
        )}
      </Card>
    </div>
  );
};
