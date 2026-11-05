import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { fmtDate } from './salesShared';
import {
  apiMessage,
  docTone,
  statusTone,
  supplierName,
  type SupplierContract,
  type SupplierDetail,
  type SupplierDocument,
  type SupplierEvaluation,
  type SupplierRow,
} from './procurementShared';
import { SupplierEvaluationForm } from './SupplierEvaluationForm';

type Tab = 'profile' | 'documents' | 'evaluations' | 'contracts';

const today = () => new Date().toISOString().slice(0, 10);

export const SuppliersPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [filter, setFilter] = useState({ q: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<'document' | 'evaluation' | 'contract' | null>(null);
  const [threshold, setThreshold] = useState(60);
  const [docForm, setDocForm] = useState({
    docType: 'registration',
    documentRef: '',
    validFrom: today(),
    validUntil: '',
  });
  const [contractForm, setContractForm] = useState({
    contractNo: '',
    startDate: today(),
    endDate: '',
    paymentTerms: '',
    priceAdjustmentClause: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (filter.q) query.set('q', filter.q);
      if (filter.status) query.set('status', filter.status);
      const response = await apiFetch<{ suppliers: SupplierRow[] }>(
        `/api/procurement/suppliers?${query.toString()}`,
      );
      setSuppliers(response.suppliers);
      const rules = await apiFetch<{ rules: Array<{ code: string; value: number | null }> }>(
        '/api/rules?module=procurement',
      ).catch(() => ({ rules: [] }));
      const rule = rules.rules.find((row) => row.code === 'procurement.supplier_grade_d_threshold');
      if (typeof rule?.value === 'number') setThreshold(rule.value);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [filter.q, filter.status]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (row: SupplierRow) => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ supplier: SupplierDetail }>(
        `/api/procurement/suppliers/${encodeURIComponent(row.id)}`,
      );
      setDetail(response.supplier);
      setTab('profile');
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    await load();
    if (detail) {
      const response = await apiFetch<{ supplier: SupplierDetail }>(
        `/api/procurement/suppliers/${encodeURIComponent(detail.id)}`,
      );
      setDetail(response.supplier);
    }
  };

  const act = async (path: string, reason = '') => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/procurement/suppliers/${encodeURIComponent(detail.id)}/${path}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await refresh();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const docAct = async (doc: SupplierDocument, action: 'verify' | 'reject' | 'void') => {
    let reason = '';
    if (action !== 'verify') {
      const answer = window.prompt(t('common.reason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/procurement/documents/${encodeURIComponent(doc.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await refresh();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const evalAct = async (evaluation: SupplierEvaluation, action: 'publish' | 'supersede') => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/procurement/evaluations/${encodeURIComponent(evaluation.id)}/${action}`, {
        method: 'POST',
        body: '{}',
      });
      await refresh();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const contractAct = async (
    contract: SupplierContract,
    action: 'sign' | 'activate' | 'expire' | 'void',
  ) => {
    let reason = '';
    if (action === 'void') {
      const answer = window.prompt(t('common.reason'));
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/procurement/contracts/${encodeURIComponent(contract.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await refresh();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveDocument = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/procurement/documents', {
        method: 'POST',
        body: JSON.stringify({
          plantId: detail.plant_id ?? 'PLT-0001',
          supplierId: detail.id,
          ...docForm,
          validUntil: docForm.validUntil || null,
        }),
      });
      setDocForm({ docType: 'registration', documentRef: '', validFrom: today(), validUntil: '' });
      setForm(null);
      await refresh();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveContract = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/procurement/contracts', {
        method: 'POST',
        body: JSON.stringify({
          plantId: detail.plant_id ?? 'PLT-0001',
          supplierId: detail.id,
          ...contractForm,
          endDate: contractForm.endDate || null,
        }),
      });
      setContractForm({
        contractNo: '',
        startDate: today(),
        endDate: '',
        paymentTerms: '',
        priceAdjustmentClause: '',
      });
      setForm(null);
      await refresh();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => suppliers, [suppliers]);

  const supplierColumns: TableColumn<SupplierRow>[] = [
    { key: 'name', header: t('common.name'), render: (row) => supplierName(row, lang) },
    { key: 'code', header: t('procurement.supplierCode'), render: (row) => row.supplier_code ?? '—' },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <Badge tone={row.status === 'suspended' ? 'danger' : 'success'}>
          {t(`procurement.supplierStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'grade',
      header: t('procurement.grade'),
      render: (row) =>
        row.overall_grade ? (
          <Badge tone={row.overall_grade === 'D' ? 'danger' : 'success'}>{row.overall_grade}</Badge>
        ) : (
          <span className="muted">{t('procurement.noGrade')}</span>
        ),
    },
    {
      key: 'docs',
      header: t('procurement.invalidDocs'),
      align: 'end',
      render: (row) =>
        row.invalid_documents > 0 ? (
          <Badge tone="danger">{row.invalid_documents}</Badge>
        ) : (
          `${row.document_count}`
        ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void open(row)}>
          {t('common.details')}
        </button>
      ),
    },
  ];

  const documentColumns: TableColumn<SupplierDocument>[] = [
    { key: 'type', header: t('procurement.documentType'), render: (row) => t(`procurement.docType.${row.doc_type}`) },
    { key: 'ref', header: t('procurement.documentRef'), render: (row) => row.document_ref },
    { key: 'from', header: t('procurement.validFrom'), render: (row) => fmtDate(row.valid_from, lang) },
    {
      key: 'until',
      header: t('procurement.validUntil'),
      render: (row) => (
        <span>
          {fmtDate(row.valid_until, lang)}{' '}
          {row.valid_until && row.valid_until < today() ? <Badge tone="danger">{t('procurement.expired')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <Badge tone={docTone(row.status, row.valid_until)}>{t(`procurement.docStatus.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <span className="row-actions">
          {row.status === 'pending' && level >= 4 ? (
            <>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void docAct(row, 'verify')}>
                {t('procurement.verify')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void docAct(row, 'reject')}>
                {t('procurement.reject')}
              </button>
            </>
          ) : null}
          {row.status === 'verified' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void docAct(row, 'reject')}>
              {t('procurement.reject')}
            </button>
          ) : null}
          {level >= 5 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void docAct(row, 'void')}>
              {t('procurement.void')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  const evaluationColumns: TableColumn<SupplierEvaluation>[] = [
    { key: 'no', header: t('procurement.evaluationNo'), render: (row) => row.evaluation_no },
    {
      key: 'period',
      header: t('procurement.period'),
      render: (row) => `${fmtDate(row.period_start, lang)} — ${fmtDate(row.period_end, lang)}`,
    },
    {
      key: 'scores',
      header: t('procurement.scores'),
      render: (row) =>
        `${row.quality_score} / ${row.delivery_score} / ${row.price_score} / ${row.responsiveness_score}`,
    },
    {
      key: 'grade',
      header: t('procurement.overallGrade'),
      render: (row) =>
        row.overall_grade ? (
          <Badge tone={row.overall_grade === 'D' ? 'danger' : 'success'}>{row.overall_grade}</Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <Badge tone={statusTone(row.status)}>{t(`procurement.evalStatus.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <span className="row-actions">
          {row.status === 'draft' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void evalAct(row, 'publish')}>
              {t('procurement.publish')}
            </button>
          ) : null}
          {row.status === 'published' && level >= 5 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void evalAct(row, 'supersede')}>
              {t('procurement.supersede')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  const contractColumns: TableColumn<SupplierContract>[] = [
    { key: 'no', header: t('procurement.contractNo'), render: (row) => row.contract_no },
    {
      key: 'period',
      header: t('procurement.period'),
      render: (row) => `${fmtDate(row.start_date, lang)} — ${row.end_date ? fmtDate(row.end_date, lang) : '∞'}`,
    },
    { key: 'terms', header: t('procurement.paymentTerms'), render: (row) => row.payment_terms || '—' },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <Badge tone={statusTone(row.status)}>{t(`procurement.contractStatus.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <span className="row-actions">
          {row.status === 'draft' && level >= 3 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void contractAct(row, 'sign')}>
              {t('procurement.sign')}
            </button>
          ) : null}
          {row.status === 'signed' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void contractAct(row, 'activate')}>
              {t('procurement.activate')}
            </button>
          ) : null}
          {row.status === 'active' && level >= 4 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void contractAct(row, 'expire')}>
              {t('procurement.expire')}
            </button>
          ) : null}
          {['draft', 'signed', 'active'].includes(row.status) && level >= 5 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void contractAct(row, 'void')}>
              {t('procurement.void')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('procurement.suppliersTitle')}
        subtitle={t('procurement.suppliersSubtitle')}
        badge={<Badge tone="purple">{suppliers.length}</Badge>}
      />
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      <Card>
        <div className="filters">
          <label className="field field--grow">
            <span>{t('common.search')}</span>
            <input value={filter.q} onChange={(event) => setFilter({ ...filter, q: event.target.value })} />
          </label>
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value })}>
              <option value="">{t('common.all')}</option>
              <option value="active">{t('procurement.supplierStatus.active')}</option>
              <option value="suspended">{t('procurement.supplierStatus.suspended')}</option>
            </select>
          </label>
        </div>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <DataTable rows={visible} columns={supplierColumns} rowKey={(row) => row.id} empty={t('common.noData')} />
        )}
      </Card>

      {detail ? (
        <Card>
          <div className="section-head">
            <div>
              <h2>{supplierName(detail, lang)}</h2>
              <p className="muted">{detail.supplier_code ?? detail.id}</p>
            </div>
            <Badge tone={detail.status === 'suspended' ? 'danger' : 'success'}>
              {t(`procurement.supplierStatus.${detail.status}`)}
            </Badge>
          </div>
          <div className="tabs-row">
            {(['profile', 'documents', 'evaluations', 'contracts'] as Tab[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`chip ${tab === key ? 'is-active' : ''}`.trim()}
                onClick={() => setTab(key)}
              >
                {t(`procurement.tab.${key}`)}
              </button>
            ))}
          </div>

          {tab === 'profile' ? (
            <div className="two-col">
              <div>
                <p><strong>{t('common.phone')}:</strong> {detail.phone || '—'}</p>
                <p><strong>{t('procurement.contact')}:</strong> {detail.contact || '—'}</p>
                <p><strong>{t('procurement.category')}:</strong> {detail.category}</p>
                <p><strong>{t('procurement.paymentTerms')}:</strong> {detail.payment_terms || '—'}</p>
              </div>
              <div className="row-actions">
                {level >= 5 && detail.status !== 'suspended' ? (
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(t('common.reason'));
                      if (reason !== null) void act('suspend', reason);
                    }}
                  >
                    {t('procurement.suspend')}
                  </button>
                ) : null}
                {level >= 5 && detail.status === 'suspended' ? (
                  <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void act('reactivate')}>
                    {t('procurement.reactivate')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === 'documents' ? (
            <div className="page-stack">
              {level >= 3 ? (
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setForm(form === 'document' ? null : 'document')}>
                  {t('procurement.addDocument')}
                </button>
              ) : null}
              {form === 'document' ? (
                <Card>
                  <div className="filters">
                    <label className="field">
                      <span>{t('procurement.documentType')}</span>
                      <select value={docForm.docType} onChange={(event) => setDocForm({ ...docForm, docType: event.target.value })}>
                        {['registration', 'insurance', 'licence', 'quality_certificate'].map((type) => (
                          <option key={type} value={type}>{t(`procurement.docType.${type}`)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field field--grow">
                      <span>{t('procurement.documentRef')}</span>
                      <input value={docForm.documentRef} onChange={(event) => setDocForm({ ...docForm, documentRef: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>{t('procurement.validFrom')}</span>
                      <input type="date" value={docForm.validFrom} onChange={(event) => setDocForm({ ...docForm, validFrom: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>{t('procurement.validUntil')}</span>
                      <input type="date" value={docForm.validUntil} onChange={(event) => setDocForm({ ...docForm, validUntil: event.target.value })} />
                    </label>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy || !docForm.documentRef} onClick={() => void saveDocument()}>
                      {t('common.save')}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm(null)}>{t('common.cancel')}</button>
                  </div>
                </Card>
              ) : null}
              <DataTable rows={detail.documents} columns={documentColumns} rowKey={(row) => row.id} empty={t('common.noData')} />
            </div>
          ) : null}

          {tab === 'evaluations' ? (
            <div className="page-stack">
              {level >= 3 ? (
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setForm(form === 'evaluation' ? null : 'evaluation')}>
                  {t('procurement.newEvaluation')}
                </button>
              ) : null}
              {form === 'evaluation' ? (
                <SupplierEvaluationForm
                  supplierId={detail.id}
                  plantId={detail.plant_id ?? 'PLT-0001'}
                  threshold={threshold}
                  onSaved={refresh}
                  onCancel={() => setForm(null)}
                />
              ) : null}
              <DataTable rows={detail.evaluations} columns={evaluationColumns} rowKey={(row) => row.id} empty={t('common.noData')} />
            </div>
          ) : null}

          {tab === 'contracts' ? (
            <div className="page-stack">
              {level >= 3 ? (
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setForm(form === 'contract' ? null : 'contract')}>
                  {t('procurement.newContract')}
                </button>
              ) : null}
              {form === 'contract' ? (
                <Card>
                  <div className="filters">
                    <label className="field">
                      <span>{t('procurement.contractNo')}</span>
                      <input value={contractForm.contractNo} onChange={(event) => setContractForm({ ...contractForm, contractNo: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>{t('procurement.startDate')}</span>
                      <input type="date" value={contractForm.startDate} onChange={(event) => setContractForm({ ...contractForm, startDate: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>{t('procurement.endDate')}</span>
                      <input type="date" value={contractForm.endDate} onChange={(event) => setContractForm({ ...contractForm, endDate: event.target.value })} />
                    </label>
                    <label className="field field--grow">
                      <span>{t('procurement.paymentTerms')}</span>
                      <input value={contractForm.paymentTerms} onChange={(event) => setContractForm({ ...contractForm, paymentTerms: event.target.value })} />
                    </label>
                    <label className="field field--grow">
                      <span>{t('procurement.priceClause')}</span>
                      <input value={contractForm.priceAdjustmentClause} onChange={(event) => setContractForm({ ...contractForm, priceAdjustmentClause: event.target.value })} />
                    </label>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy || !contractForm.startDate} onClick={() => void saveContract()}>
                      {t('common.save')}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm(null)}>{t('common.cancel')}</button>
                  </div>
                </Card>
              ) : null}
              <DataTable rows={detail.contracts} columns={contractColumns} rowKey={(row) => row.id} empty={t('common.noData')} />
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
};
