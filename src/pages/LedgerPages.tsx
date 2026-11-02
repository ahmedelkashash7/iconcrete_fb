import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone } from '../components/ui';
import { formatCellValue } from '../lib/display';
import type { Lang } from '../types';

/**
 * M1 accounting screens (gap G5): Customers → Draft Invoice → Post Invoice → Payment →
 * FIFO allocation → Customer statement → Journal entry → General ledger.
 *
 * Every action calls the real API; there is no optimistic/fake success. Each screen has
 * explicit loading, empty, error and forbidden states, and labels demo storage instead of
 * pretending it is a database.
 */

type Status = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden';

export interface StateBannerProps {
  status: Status;
  message?: string;
  count?: number;
}

/** Pure, hook-free state banner so the four honest states are testable without a DOM. */
export const StateBanner = ({ status, message, count }: StateBannerProps) => {
  const { t } = useTranslation();
  if (status === 'loading') return <LoadingBlock label={t('common.loading')} />;
  if (status === 'forbidden') return <ErrorNote>{t('errors.forbidden')}</ErrorNote>;
  if (status === 'error') return <ErrorNote>{t(message ?? 'errors.network')}</ErrorNote>;
  if (status === 'empty') {
    return <InfoNote tone="info">{t(message ?? 'common.noData')}</InfoNote>;
  }
  return count === undefined ? null : (
    <InfoNote tone="info">
      {t('common.rows')}: {count}
    </InfoNote>
  );
};

interface AccountRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: string;
  isPostable: boolean;
}

interface CustomerRow {
  id: string;
  nameAr: string;
  nameEn: string;
  status: string;
  creditLimit: number;
  creditDays: number;
}

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  customerId: string;
  customerNameAr: string;
  customerNameEn: string;
  issueDate: string;
  dueDate: string;
  grandTotal: number;
  paidAmount: number;
  outstanding: number;
  status: string;
  itemCount: number;
}

interface PaymentRow {
  id: string;
  paymentNo: string;
  customerId: string;
  customerNameAr: string;
  customerNameEn: string;
  method: string;
  amount: number;
  unappliedAmount: number;
  paymentDate: string;
  allocationCount: number;
}

interface StatementLine {
  id: string;
  kind: 'invoice' | 'payment';
  date: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  status: string;
}

interface StatementResponse {
  customer: { id: string; nameAr: string; nameEn: string; creditLimit: number; creditDays: number; status: string };
  openingBalance: number;
  invoiced: number;
  paid: number;
  closingBalance: number;
  lines: StatementLine[];
  storage: string;
}

interface LedgerLine {
  entryId: number;
  entryNo: string;
  entryDate: string;
  memoAr: string;
  memoEn: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

const useList = <T,>(path: string, key: string) => {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<string>('');

  useEffect(() => {
    let active = true;
    apiFetch<Record<string, unknown>>(path)
      .then((response) => {
        if (!active) return;
        setRows((response[key] as T[]) ?? []);
        setStorage(typeof response.storage === 'string' ? response.storage : '');
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'network');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, key]);

  return { rows, loading, error, storage };
};

const useCustomers = () => useList<CustomerRow>('/api/m1/customers', 'customers');

const statusTone = (value: string): BadgeTone =>
  value === 'paid' || value === 'issued' || value === 'posted' || value === 'active'
    ? 'success'
    : value === 'partially_paid' || value === 'overdue'
      ? 'warning'
      : value === 'void'
        ? 'danger'
        : 'neutral';

const today = (): string => new Date().toISOString().slice(0, 10);
const inDays = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export const InvoicesPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const customers = useCustomers();
  const invoices = useList<InvoiceRow>('/api/m1/invoices', 'invoices');
  const [form, setForm] = useState({
    customerId: '',
    invoiceNo: `INV-${Date.now().toString().slice(-6)}`,
    issueDate: today(),
    dueDate: inDays(30),
    quantity: '10',
    unitPrice: '1750',
    taxPercent: '14',
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch<{ invoiceId: string; status: string }>('/api/m1/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.customerId,
          invoiceNo: form.invoiceNo,
          issueDate: form.issueDate,
          dueDate: form.dueDate,
          taxPercent: Number(form.taxPercent),
          items: [
            {
              quantity: Number(form.quantity),
              unitPrice: Number(form.unitPrice),
              descriptionAr: 'خرسانة جاهزة',
              descriptionEn: 'Ready-mix concrete',
            },
          ],
        }),
      });
      const posted = await apiFetch<{ entry: { entryNo: string } }>(
        `/api/m1/invoices/${encodeURIComponent(created.invoiceId)}/post`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setNotice(t('invoices.posted', { no: form.invoiceNo, entry: posted.entry.entryNo }));
      setForm((current) => ({ ...current, invoiceNo: `INV-${Date.now().toString().slice(-6)}` }));
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'errors.network');
    } finally {
      setBusy(false);
    }
  };

  const post = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const posted = await apiFetch<{ entry: { entryNo: string } }>(
        `/api/m1/invoices/${encodeURIComponent(id)}/post`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setNotice(t('invoices.posted', { no: id, entry: posted.entry.entryNo }));
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'errors.network');
    } finally {
      setBusy(false);
    }
  };

  if (invoices.loading || customers.loading) return <StateBanner status="loading" />;
  if (invoices.error === 'forbidden' || customers.error === 'forbidden') return <StateBanner status="forbidden" />;
  if (invoices.error || customers.error) return <StateBanner status="error" message="errors.network" />;

  return (
    <div className="page-stack" key={refresh}>
      <SectionTitle
        title={t('invoices.title')}
        subtitle={t('invoices.subtitle')}
        badge={<Badge tone="purple">{invoices.rows.length} {t('invoices.title')}</Badge>}
      />
      {invoices.storage === 'memory' ? <InfoNote tone="warning">{t('common.demoMode')}</InfoNote> : null}
      {notice ? <InfoNote tone="info">{notice}</InfoNote> : null}
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      <Card title={t('invoices.new')}>
        <form className="filters" onSubmit={create}>
          <label className="field">
            <span>{t('invoices.customer')}</span>
            <select
              required
              value={form.customerId}
              onChange={(event) => setForm({ ...form, customerId: event.target.value })}
            >
              <option value="">—</option>
              {customers.rows.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {lang === 'ar' ? customer.nameAr : customer.nameEn} ({customer.id})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('invoices.number')}</span>
            <input required value={form.invoiceNo} onChange={(event) => setForm({ ...form, invoiceNo: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('invoices.issueDate')}</span>
            <input type="date" required value={form.issueDate} onChange={(event) => setForm({ ...form, issueDate: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('invoices.dueDate')}</span>
            <input type="date" required value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('invoices.quantity')}</span>
            <input type="number" min="0.001" step="0.001" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('invoices.unitPrice')}</span>
            <input type="number" min="0" step="0.01" required value={form.unitPrice} onChange={(event) => setForm({ ...form, unitPrice: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('invoices.tax')}</span>
            <input type="number" min="0" max="100" step="0.01" value={form.taxPercent} onChange={(event) => setForm({ ...form, taxPercent: event.target.value })} />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy || !form.customerId}>
            {busy ? t('common.loading') : t('invoices.create')}
          </button>
        </form>
      </Card>

      <Card>
        {invoices.rows.length === 0 ? (
          <StateBanner status="empty" message="invoices.empty" />
        ) : (
          <DataTable
            dense
            empty={t('common.noData')}
            rows={invoices.rows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'no', header: t('invoices.number'), render: (row) => <span className="mono">{row.invoiceNo}</span> },
              { key: 'customer', header: t('invoices.customer'), render: (row) => (lang === 'ar' ? row.customerNameAr : row.customerNameEn) },
              { key: 'issue', header: t('invoices.issueDate'), render: (row) => row.issueDate },
              { key: 'grand', header: t('invoices.grandTotal'), align: 'end', render: (row) => formatCellValue(row.grandTotal, 'money', lang) },
              { key: 'paid', header: t('invoices.paid'), align: 'end', render: (row) => formatCellValue(row.paidAmount, 'money', lang) },
              { key: 'outstanding', header: t('invoices.outstanding'), align: 'end', render: (row) => formatCellValue(row.outstanding, 'money', lang) },
              { key: 'status', header: t('common.status'), render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
              {
                key: 'action',
                header: '',
                render: (row) =>
                  row.status === 'draft' ? (
                    <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void post(row.id)}>
                      {t('invoices.post')}
                    </button>
                  ) : (
                    <span className="muted small">{row.itemCount} {t('invoices.items')}</span>
                  ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
};

export const PaymentsPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const customers = useCustomers();
  const payments = useList<PaymentRow>('/api/m1/payments', 'payments');
  const [form, setForm] = useState({ customerId: '', amount: '', method: 'bank', paymentDate: today(), reference: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const receive = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{
        paymentId: string;
        allocations: { invoiceId: string; amount: number }[];
        unapplied: number;
      }>('/api/m1/payments', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.customerId,
          amount: Number(form.amount),
          method: form.method,
          paymentDate: form.paymentDate,
          reference: form.reference,
        }),
      });
      setNotice(
        t('payments.received', {
          id: response.paymentId,
          allocated: response.allocations.length,
          unapplied: response.unapplied.toFixed(2),
        }),
      );
      setForm({ ...form, amount: '', reference: '' });
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'errors.network');
    } finally {
      setBusy(false);
    }
  };

  if (payments.loading || customers.loading) return <StateBanner status="loading" />;
  if (payments.error === 'forbidden' || customers.error === 'forbidden') return <StateBanner status="forbidden" />;
  if (payments.error || customers.error) return <StateBanner status="error" message="errors.network" />;

  return (
    <div className="page-stack" key={refresh}>
      <SectionTitle title={t('payments.title')} subtitle={t('payments.subtitle')} badge={<Badge tone="purple">{payments.rows.length}</Badge>} />
      {payments.storage === 'memory' ? <InfoNote tone="warning">{t('common.demoMode')}</InfoNote> : null}
      {notice ? <InfoNote tone="info">{notice}</InfoNote> : null}
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      <Card title={t('payments.new')}>
        <form className="filters" onSubmit={receive}>
          <label className="field">
            <span>{t('payments.customer')}</span>
            <select required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
              <option value="">—</option>
              {customers.rows.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {lang === 'ar' ? customer.nameAr : customer.nameEn} ({customer.id})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('payments.amount')}</span>
            <input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('payments.method')}</span>
            <select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>
              <option value="bank">{t('payments.method.bank')}</option>
              <option value="cash">{t('payments.method.cash')}</option>
              <option value="cheque">{t('payments.method.cheque')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('payments.date')}</span>
            <input type="date" required value={form.paymentDate} onChange={(event) => setForm({ ...form, paymentDate: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('payments.reference')}</span>
            <input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy || !form.customerId || !form.amount}>
            {busy ? t('common.loading') : t('payments.submit')}
          </button>
        </form>
        <InfoNote tone="info">{t('payments.fifoNote')}</InfoNote>
      </Card>

      <Card>
        {payments.rows.length === 0 ? (
          <StateBanner status="empty" message="payments.empty" />
        ) : (
          <DataTable
            dense
            empty={t('common.noData')}
            rows={payments.rows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'no', header: t('payments.number'), render: (row) => <span className="mono">{row.paymentNo}</span> },
              { key: 'customer', header: t('payments.customer'), render: (row) => (lang === 'ar' ? row.customerNameAr : row.customerNameEn) },
              { key: 'date', header: t('payments.date'), render: (row) => row.paymentDate },
              { key: 'method', header: t('payments.method'), render: (row) => <Badge tone="neutral">{row.method}</Badge> },
              { key: 'amount', header: t('payments.amount'), align: 'end', render: (row) => formatCellValue(row.amount, 'money', lang) },
              { key: 'unapplied', header: t('payments.unapplied'), align: 'end', render: (row) => formatCellValue(row.unappliedAmount, 'money', lang) },
              { key: 'allocations', header: t('payments.allocations'), align: 'end' },
            ]}
          />
        )}
      </Card>
    </div>
  );
};

export const StatementPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const customers = useCustomers();
  const [customerId, setCustomerId] = useState('');
  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) {
      setStatement(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<StatementResponse>(`/api/m1/customers/${encodeURIComponent(customerId)}/statement`)
      .then((response) => {
        if (active) setStatement(response);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'network');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId]);

  if (customers.loading) return <StateBanner status="loading" />;
  if (customers.error === 'forbidden') return <StateBanner status="forbidden" />;

  return (
    <div className="page-stack">
      <SectionTitle title={t('statement.title')} subtitle={t('statement.subtitle')} />
      <Card>
        <div className="filters filters--compact">
          <label className="field field--grow">
            <span>{t('statement.customer')}</span>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">—</option>
              {customers.rows.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {lang === 'ar' ? customer.nameAr : customer.nameEn} ({customer.id})
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <StateBanner status="loading" /> : null}
        {error === 'forbidden' ? <StateBanner status="forbidden" /> : null}
        {error === 'network' ? <StateBanner status="error" message="errors.network" /> : null}
        {!loading && !error && !statement ? <StateBanner status="empty" message="statement.pick" /> : null}
        {statement ? (
          <>
            {statement.storage === 'memory' ? <InfoNote tone="warning">{t('common.demoMode')}</InfoNote> : null}
            <div className="kpi-grid">
              <div className="kpi"><span>{t('statement.opening')}</span><strong>{formatCellValue(statement.openingBalance, 'money', lang)}</strong></div>
              <div className="kpi"><span>{t('statement.invoiced')}</span><strong>{formatCellValue(statement.invoiced, 'money', lang)}</strong></div>
              <div className="kpi"><span>{t('statement.paid')}</span><strong>{formatCellValue(statement.paid, 'money', lang)}</strong></div>
              <div className="kpi"><span>{t('statement.closing')}</span><strong>{formatCellValue(statement.closingBalance, 'money', lang)}</strong></div>
            </div>
            {statement.lines.length === 0 ? (
              <StateBanner status="empty" message="statement.empty" />
            ) : (
              <DataTable
                dense
                empty={t('common.noData')}
                rows={statement.lines}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'date', header: t('common.date'), render: (row) => row.date },
                  { key: 'ref', header: t('statement.reference'), render: (row) => <span className="mono">{row.reference}</span> },
                  { key: 'kind', header: t('common.details'), render: (row) => <Badge tone={row.kind === 'invoice' ? 'info' : 'success'}>{t(`statement.kind.${row.kind}`)}</Badge> },
                  { key: 'debit', header: t('statement.debit'), align: 'end', render: (row) => (row.debit ? formatCellValue(row.debit, 'money', lang) : '—') },
                  { key: 'credit', header: t('statement.credit'), align: 'end', render: (row) => (row.credit ? formatCellValue(row.credit, 'money', lang) : '—') },
                  { key: 'balance', header: t('statement.balance'), align: 'end', render: (row) => formatCellValue(row.balance, 'money', lang) },
                ]}
              />
            )}
          </>
        ) : null}
      </Card>
    </div>
  );
};

export const LedgerPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const accounts = useList<AccountRow>('/api/m1/accounts', 'accounts');
  const [code, setCode] = useState('');
  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => accounts.rows.find((account) => account.code === code), [accounts.rows, code]);

  useEffect(() => {
    if (!code) {
      setLines([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<{ lines: LedgerLine[] }>(`/api/m1/ledger?account=${encodeURIComponent(code)}`)
      .then((response) => {
        if (active) setLines(response.lines);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'network');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [code]);

  if (accounts.loading) return <StateBanner status="loading" />;
  if (accounts.error === 'forbidden') return <StateBanner status="forbidden" />;

  return (
    <div className="page-stack">
      <SectionTitle title={t('ledger.title')} subtitle={t('ledger.subtitle')} />
      <Card>
        <div className="filters filters--compact">
          <label className="field field--grow">
            <span>{t('ledger.account')}</span>
            <select value={code} onChange={(event) => setCode(event.target.value)}>
              <option value="">—</option>
              {accounts.rows.map((account) => (
                <option key={account.id} value={account.code}>
                  {account.code} — {lang === 'ar' ? account.nameAr : account.nameEn}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selected ? (
          <InfoNote tone="info">
            {selected.accountType} · {selected.isPostable ? t('ledger.postable') : t('ledger.summary')}
          </InfoNote>
        ) : null}
        {loading ? <StateBanner status="loading" /> : null}
        {error === 'forbidden' ? <StateBanner status="forbidden" /> : null}
        {error === 'network' ? <StateBanner status="error" message="errors.network" /> : null}
        {!code ? <StateBanner status="empty" message="ledger.pick" /> : null}
        {code && !loading && !error && lines.length === 0 ? <StateBanner status="empty" message="ledger.empty" /> : null}
        {lines.length > 0 ? (
          <DataTable
            dense
            empty={t('common.noData')}
            rows={lines}
            rowKey={(row) => `${row.entryId}-${row.entryNo}-${row.runningBalance}`}
            columns={[
              { key: 'date', header: t('common.date'), render: (row) => row.entryDate },
              { key: 'no', header: t('ledger.entryNo'), render: (row) => <span className="mono">{row.entryNo}</span> },
              { key: 'memo', header: t('common.details'), render: (row) => (lang === 'ar' ? row.memoAr : row.memoEn) },
              { key: 'debit', header: t('ledger.debit'), align: 'end', render: (row) => (row.debit ? formatCellValue(row.debit, 'money', lang) : '—') },
              { key: 'credit', header: t('ledger.credit'), align: 'end', render: (row) => (row.credit ? formatCellValue(row.credit, 'money', lang) : '—') },
              { key: 'balance', header: t('ledger.balance'), align: 'end', render: (row) => formatCellValue(row.runningBalance, 'money', lang) },
            ]}
          />
        ) : null}
      </Card>
    </div>
  );
};
