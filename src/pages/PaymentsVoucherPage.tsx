import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Card,
  DataTable,
  ErrorNote,
  LoadingBlock,
  SectionTitle,
  type TableColumn,
} from '../components/ui';
import type { Lang } from '../types';
import { fmtMoney, type Customer } from './salesShared';
import { apiMessage, statusTone, type PaymentVoucher, type PurchaseInvoice, type SupplierRow } from './procurementShared';

const today = () => new Date().toISOString().slice(0, 10);

export const PaymentsVoucherPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [payments, setPayments] = useState<PaymentVoucher[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState({ status: '', paymentType: '' });
  const [form, setForm] = useState({
    paymentType: 'supplier_payment',
    supplierId: '',
    customerId: '',
    purchaseInvoiceId: '',
    amount: '',
    method: 'bank_transfer',
    chequeNo: '',
    chequeDueDate: '',
    paidAt: today(),
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (filter.status) query.set('status', filter.status);
      if (filter.paymentType) query.set('paymentType', filter.paymentType);
      const [paymentResponse, supplierResponse, customerResponse, invoiceResponse] = await Promise.all([
        apiFetch<{ payments: PaymentVoucher[] }>(`/api/procurement/payments?${query.toString()}`),
        apiFetch<{ suppliers: SupplierRow[] }>('/api/procurement/suppliers'),
        apiFetch<{ customers: Customer[] }>('/api/sales/customers'),
        apiFetch<{ invoices: PurchaseInvoice[] }>('/api/procurement/invoices?status=approved'),
      ]);
      setPayments(paymentResponse.payments);
      setSuppliers(supplierResponse.suppliers);
      setCustomers(customerResponse.customers);
      setInvoices(invoiceResponse.invoices);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [filter.status, filter.paymentType]);

  useEffect(() => {
    void load();
  }, [load]);

  const plantId =
    suppliers.find((supplier) => supplier.id === form.supplierId)?.plant_id ?? 'PLT-0001';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/procurement/payments', {
        method: 'POST',
        body: JSON.stringify({
          plantId,
          paymentType: form.paymentType,
          supplierId: form.supplierId || null,
          customerId: form.customerId || null,
          purchaseInvoiceId: form.purchaseInvoiceId || null,
          amount: Number(form.amount),
          method: form.method,
          chequeNo: form.method === 'cheque' ? form.chequeNo : null,
          chequeDueDate: form.method === 'cheque' ? form.chequeDueDate || null : null,
          paidAt: form.paidAt || null,
          notes: form.notes,
        }),
      });
      setShowForm(false);
      setForm({
        paymentType: 'supplier_payment',
        supplierId: '',
        customerId: '',
        purchaseInvoiceId: '',
        amount: '',
        method: 'bank_transfer',
        chequeNo: '',
        chequeDueDate: '',
        paidAt: today(),
        notes: '',
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (payment: PaymentVoucher, action: 'approve' | 'pay' | 'cancel' | 'bounce') => {
    let reason = '';
    if (action === 'cancel' || action === 'bounce') {
      const answer = window.prompt(t('common.reason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/procurement/payments/${encodeURIComponent(payment.id)}/${action}`, {
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

  const columns: TableColumn<PaymentVoucher>[] = [
    { key: 'no', header: t('procurement.voucherNo'), render: (row) => row.voucher_no },
    {
      key: 'party',
      header: t('procurement.party'),
      render: (row) =>
        row.payment_type === 'customer_receipt'
          ? lang === 'ar'
            ? row.customer_name_ar ?? '—'
            : row.customer_name_en ?? row.customer_name_ar ?? '—'
          : lang === 'ar'
            ? row.supplier_name_ar ?? '—'
            : row.supplier_name_en ?? row.supplier_name_ar ?? '—',
    },
    { key: 'type', header: t('procurement.paymentType'), render: (row) => t(`procurement.paymentTypes.${row.payment_type}`) },
    { key: 'amount', header: t('procurement.amount'), align: 'end', render: (row) => fmtMoney(row.amount, lang) },
    { key: 'method', header: t('procurement.method'), render: (row) => t(`procurement.methods.${row.method}`) },
    { key: 'cheque', header: t('procurement.chequeNo'), render: (row) => row.cheque_no ?? '—' },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <span className="row-actions">
          <Badge tone={statusTone(row.status)}>{t(`procurement.voucherStatus.${row.status}`)}</Badge>
          {row.exception_status === 'open' ? <Badge tone="danger">{t('procurement.exceptionOpen')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <span className="row-actions">
          {row.status === 'draft' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'approve')}>
              {t('procurement.approve')}
            </button>
          ) : null}
          {row.status === 'approved' && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'pay')}>
              {t('procurement.pay')}
            </button>
          ) : null}
          {row.method === 'cheque' && row.status === 'paid' && row.exception_status !== 'open' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(row, 'bounce')}>
              {t('procurement.bounce')}
            </button>
          ) : null}
          {['draft', 'approved'].includes(row.status) && level >= 5 ? (
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
        title={t('procurement.paymentsTitle')}
        subtitle={t('procurement.paymentsSubtitle')}
        badge={<Badge tone="purple">{payments.length}</Badge>}
      />
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value })}>
              <option value="">{t('common.all')}</option>
              {['draft', 'approved', 'paid', 'cancelled'].map((key) => (
                <option key={key} value={key}>{t(`procurement.voucherStatus.${key}`)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('procurement.paymentType')}</span>
            <select value={filter.paymentType} onChange={(event) => setFilter({ ...filter, paymentType: event.target.value })}>
              <option value="">{t('common.all')}</option>
              {['supplier_payment', 'customer_receipt', 'expense'].map((key) => (
                <option key={key} value={key}>{t(`procurement.paymentTypes.${key}`)}</option>
              ))}
            </select>
          </label>
          <div className="filters__actions">
            {level >= 3 ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm(!showForm)}>
                {t('procurement.newVoucher')}
              </button>
            ) : null}
          </div>
        </div>

        {showForm ? (
          <div className="page-stack">
            <div className="filters">
              <label className="field">
                <span>{t('procurement.paymentType')}</span>
                <select
                  value={form.paymentType}
                  onChange={(event) =>
                    setForm({ ...form, paymentType: event.target.value, supplierId: '', customerId: '', purchaseInvoiceId: '' })
                  }
                >
                  {['supplier_payment', 'customer_receipt', 'expense'].map((key) => (
                    <option key={key} value={key}>{t(`procurement.paymentTypes.${key}`)}</option>
                  ))}
                </select>
              </label>
              {form.paymentType === 'supplier_payment' ? (
                <>
                  <label className="field">
                    <span>{t('procurement.invoiceNo')}</span>
                    <select
                      value={form.purchaseInvoiceId}
                      onChange={(event) => {
                        const invoice = invoices.find((row) => row.id === event.target.value);
                        setForm({
                          ...form,
                          purchaseInvoiceId: event.target.value,
                          supplierId: invoice?.supplier_id ?? '',
                          amount: invoice
                            ? String(Math.round((invoice.total_amount - invoice.paid_amount) * 100) / 100)
                            : form.amount,
                        });
                      }}
                    >
                      <option value="">—</option>
                      {invoices.map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>
                          {invoice.invoice_no} — {invoice.po_no ?? '—'} — {fmtMoney(invoice.total_amount - invoice.paid_amount, lang)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{t('procurement.supplier')}</span>
                    <select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}>
                      <option value="">—</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {lang === 'ar' ? supplier.name_ar : supplier.name_en || supplier.name_ar}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {form.paymentType === 'customer_receipt' ? (
                <label className="field">
                  <span>{t('procurement.customer')}</span>
                  <select value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
                    <option value="">—</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {lang === 'ar' ? customer.name_ar : customer.name_en || customer.name_ar}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field">
                <span>{t('procurement.amount')}</span>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('procurement.method')}</span>
                <select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>
                  {['cash', 'bank_transfer', 'cheque'].map((key) => (
                    <option key={key} value={key}>{t(`procurement.methods.${key}`)}</option>
                  ))}
                </select>
              </label>
              {form.method === 'cheque' ? (
                <>
                  <label className="field">
                    <span>{t('procurement.chequeNo')}</span>
                    <input value={form.chequeNo} onChange={(event) => setForm({ ...form, chequeNo: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>{t('procurement.chequeDueDate')}</span>
                    <input type="date" value={form.chequeDueDate} onChange={(event) => setForm({ ...form, chequeDueDate: event.target.value })} />
                  </label>
                </>
              ) : null}
              <label className="field">
                <span>{t('procurement.paidAt')}</span>
                <input type="date" value={form.paidAt} onChange={(event) => setForm({ ...form, paidAt: event.target.value })} />
              </label>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={
                  busy ||
                  !form.amount ||
                  (form.paymentType === 'supplier_payment' && !form.purchaseInvoiceId) ||
                  (form.paymentType === 'customer_receipt' && !form.customerId) ||
                  (form.method === 'cheque' && !form.chequeNo)
                }
                onClick={() => void save()}
              >
                {t('common.save')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <DataTable rows={payments} columns={columns} rowKey={(row) => row.id} empty={t('common.noData')} />
        )}
      </Card>
    </div>
  );
};
