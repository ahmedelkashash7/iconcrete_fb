import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import type { Lang } from '../types';
import { apiMessage, fmtDate, type Contract, type Quotation } from './salesShared';

/**
 * M7 — contracts. Creating a draft is level 4; signing, activating and voiding are level 5. The
 * contract stores the approved quotation version id, and a later quotation version never moves
 * that pin; every signature or void appends an immutable version.
 */

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  signed: 'info',
  active: 'success',
  expired: 'warning',
  void: 'danger',
};

export const ContractPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    quotationVersionId: '',
    contractNo: '',
    startDate: '',
    endDate: '',
    terms: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [contractResponse, quotationResponse] = await Promise.all([
        apiFetch<{ contracts: Contract[] }>('/api/sales/contracts'),
        apiFetch<{ quotations: Quotation[] }>('/api/sales/quotations'),
      ]);
      setContracts(contractResponse.contracts);
      setQuotations(quotationResponse.quotations);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approvedVersions = quotations.flatMap((quotation) =>
    quotation.versions
      .filter((version) => version.status === 'approved')
      .map((version) => ({
        id: version.id,
        label: `${quotation.quotation_no} — v${version.version_no} · ${quotation.customer_name} · ${quotation.total_amount.toFixed(2)}`,
      })),
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/sales/contracts', {
        method: 'POST',
        body: JSON.stringify({
          plantId: contracts[0]?.plant_id ?? 'PLT-0001',
          contractNo: form.contractNo || null,
          quotationVersionId: form.quotationVersionId,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          terms: form.terms,
        }),
      });
      setForm({ quotationVersionId: '', contractNo: '', startDate: '', endDate: '', terms: '' });
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (contract: Contract, action: 'sign' | 'activate' | 'void') => {
    let reason = '';
    if (action === 'void') {
      const answer = window.prompt(t('sales.voidReason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sales/contracts/${encodeURIComponent(contract.id)}/${action}`, {
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

  const columns: TableColumn<Contract>[] = [
    { key: 'no', header: t('sales.contractNo'), render: (row) => row.contract_no },
    { key: 'customer', header: t('sales.customer'), render: (row) => row.customer_name },
    { key: 'version', header: t('sales.pinnedVersion'), render: (row) => row.quotation_version_id },
    { key: 'start', header: t('sales.start'), render: (row) => fmtDate(row.start_date, lang) },
    { key: 'end', header: t('sales.end'), render: (row) => fmtDate(row.end_date, lang) },
    { key: 'signed', header: t('sales.signedAt'), render: (row) => fmtDate(row.signed_at, lang) },
    { key: 'versions', header: t('sales.versions'), align: 'end', render: (row) => row.versions.length },
    { key: 'status', header: t('common.status'), render: (row) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`sales.contractStatus.${row.status}`)}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <span className="filters__actions">
          {row.status === 'draft' && level >= 5 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'sign')}>
              {t('sales.sign')}
            </button>
          ) : null}
          {row.status === 'signed' && level >= 5 ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act(row, 'activate')}>
              {t('sales.activate')}
            </button>
          ) : null}
          {['draft', 'signed', 'active'].includes(row.status) && level >= 5 ? (
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
        title={t('sales.contractsTitle')}
        subtitle={t('sales.contractsSubtitle')}
        badge={<Badge tone="purple">{contracts.length}</Badge>}
      />
      <Card>
        <div className="filters">
          <span className="muted">{t('sales.contractPinNote')}</span>
          {level >= 4 ? (
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowForm((current) => !current)}>
                {showForm ? t('common.cancel') : t('sales.newContract')}
              </button>
            </div>
          ) : null}
        </div>
      </Card>

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}

      {showForm && level >= 4 ? (
        <Card title={t('sales.newContract')}>
          <div className="filters">
            <label className="field">
              <span>{t('sales.approvedQuotationVersion')}</span>
              <select value={form.quotationVersionId} onChange={(event) => setForm((current) => ({ ...current, quotationVersionId: event.target.value }))}>
                <option value="">—</option>
                {approvedVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('sales.contractNo')}</span>
              <input value={form.contractNo} onChange={(event) => setForm((current) => ({ ...current, contractNo: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.start')}</span>
              <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.end')}</span>
              <input type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('sales.terms')}</span>
              <input value={form.terms} onChange={(event) => setForm((current) => ({ ...current, terms: event.target.value }))} />
            </label>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !form.quotationVersionId}
                onClick={() => void save()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {loading ? <LoadingBlock label={t('common.loading')} /> : <DataTable columns={columns} rows={contracts} rowKey={(row) => row.id} empty={t('common.noData')} />}

      {contracts.map((contract) => (
        <Card key={contract.id} title={`${contract.contract_no} — ${t('sales.versionHistory')}`}>
          <div className="filters">
            <span className="muted">{contract.customer_name}</span>
            <span className="muted">{contract.terms}</span>
            {contract.void_reason ? <Badge tone="danger">{contract.void_reason}</Badge> : null}
          </div>
          {contract.versions.length === 0 ? (
            <p className="muted">{t('sales.noVersions')}</p>
          ) : (
            <ul className="stack-list">
              {contract.versions.map((version) => (
                <li key={version.id}>
                  <Badge tone="info">v{version.version_no}</Badge> {version.status} · {fmtDate(version.created_at, lang)} — {version.created_by || '—'}
                  {version.reason ? <span className="muted"> · {version.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
};
