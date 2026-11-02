import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError, downloadFile } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle } from '../components/ui';
import type { TemplateColumn, ValidationResult } from '../core/validation';
import { formatDateTime } from '../lib/display';
import type { AuditEntry, Lang } from '../types';

interface TemplateInfo {
  id: string;
  entity: string;
  version: string;
  sheetName: string;
  descriptionAr: string;
  descriptionEn: string;
  columnCount: number;
}

interface StagedResponse {
  stagedId: string;
  fileName: string;
  checksum: string;
  template: {
    id: string;
    version: string;
    entity: string;
    sheetName: string;
    columns: TemplateColumn[];
  };
  result: ValidationResult;
  missingHeaders: string[];
  checkedAt: string;
}

interface StagedRow {
  id: string;
  templateId: string;
  fileName: string;
  committed: boolean;
  importedRows: number;
  createdAt: string;
  discardedAt?: string | null;
}

const MAX_BYTES = 2 * 1024 * 1024;

export const ExcelCenterPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [staged, setStaged] = useState<StagedResponse | null>(null);
  const [busy, setBusy] = useState<'validate' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [stagedList, setStagedList] = useState<StagedRow[]>([]);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAudit = async () => {
    try {
      const response = await apiFetch<{ entries: AuditEntry[] }>('/api/excel/audit');
      setAudit(response.entries);
    } catch {
      setAudit([]);
    }
  };

  const loadStaged = async () => {
    try {
      const response = await apiFetch<{ staged: StagedRow[] }>('/api/excel/staged');
      setStagedList(response.staged);
    } catch {
      setStagedList([]);
    }
  };

  const discard = async (id: string) => {
    setDiscardingId(id);
    setError(null);
    try {
      await apiFetch('/api/excel/discard', { method: 'POST', body: JSON.stringify({ stagedId: id }) });
      setNotice(t('excel.discarded'));
      if (staged?.stagedId === id) setStaged(null);
      await loadStaged();
      void loadAudit();
    } catch {
      setError('excel.error.network');
    } finally {
      setDiscardingId(null);
    }
  };

  useEffect(() => {
    void loadStaged();
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<{ templates: TemplateInfo[] }>('/api/excel/templates'),
      apiFetch<{ entries: AuditEntry[] }>('/api/excel/audit').catch(() => ({ entries: [] as AuditEntry[] })),
    ])
      .then(([templateResponse, auditResponse]) => {
        if (!active) return;
        setTemplates(templateResponse.templates);
        setSelectedId(templateResponse.templates[0]?.id ?? '');
        setAudit(auditResponse.entries);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError && caught.status === 403 ? 'errors.forbidden' : 'errors.network');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId),
    [templates, selectedId],
  );

  const issues = useMemo(() => {
    if (!staged) return [];
    return staged.result.rows.flatMap((row) => row.issues.map((issue) => ({ ...issue, id: `${row.rowNumber}-${issue.column}-${issue.code}` })));
  }, [staged]);

  const pickFile = (incoming: File | null) => {
    setError(null);
    setNotice(null);
    setStaged(null);
    if (!incoming) {
      setFile(null);
      return;
    }
    const name = incoming.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
      setError('excel.error.fileType');
      setFile(null);
      return;
    }
    if (incoming.size > MAX_BYTES) {
      setError('excel.error.fileSize');
      setFile(null);
      return;
    }
    setFile(incoming);
  };

  const validate = async () => {
    if (!file || !selectedId) {
      setError('excel.error.noFile');
      return;
    }
    setBusy('validate');
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('templateId', selectedId);
      form.append('file', file);
      const response = await apiFetch<StagedResponse>('/api/excel/validate', { method: 'POST', body: form });
      setStaged(response);
      void loadAudit();
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === 'file_too_large') setError('excel.error.fileSize');
        else if (caught.code === 'unsupported_type') setError('excel.error.fileType');
        else if (caught.code === 'no_rows' || caught.code === 'parse_error') setError('excel.error.parse');
        else if (caught.status === 403) setError('errors.forbidden');
        else setError('excel.error.network');
      } else {
        setError('excel.error.network');
      }
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!staged) return;
    setBusy('commit');
    setError(null);
    try {
      const response = await apiFetch<{ importedRows: number; skippedRows: number }>('/api/excel/commit', {
        method: 'POST',
        body: JSON.stringify({ stagedId: staged.stagedId, confirm: true }),
      });
      setConfirmOpen(false);
      setStaged(null);
      setFile(null);
      setNotice(t('excel.committed', { count: response.importedRows }));
      void loadAudit();
    } catch {
      setError('excel.error.network');
      setConfirmOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = async (template: TemplateInfo) => {
    try {
      await downloadFile(
        `/api/excel/templates/${template.id}.xlsx`,
        `ICONCRETE_${template.id}_template_v${template.version}.xlsx`,
      );
      void loadAudit();
    } catch {
      setError('errors.network');
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error === 'errors.forbidden') return <ErrorNote>{t('errors.forbidden')}</ErrorNote>;

  const validCount = staged?.result.summary.validRows ?? 0;
  const errorCount = staged?.result.summary.errorRows ?? 0;

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('excel.title')}
        subtitle={t('excel.subtitle')}
        badge={<Badge tone="purple">{t('excel.step1')} · {t('excel.step2')}</Badge>}
      />

      <div className="steps">
        {[t('excel.step1'), t('excel.step2'), t('excel.step3'), t('excel.step4')].map((label, index) => (
          <div className={`step ${selectedId ? 'is-done' : ''} ${index === 2 && staged ? 'is-active' : ''}`.trim()} key={label}>
            <span className="step__index">{index + 1}</span>
            <span>{label.replace(/^\d+\.\s*/, '')}</span>
          </div>
        ))}
      </div>

      {error && error !== 'errors.forbidden' ? <ErrorNote>{t(error)}</ErrorNote> : null}
      {notice ? <InfoNote tone="purple">{notice}</InfoNote> : null}

      <div className="excel-grid">
        <Card title={t('excel.templatesTitle')} subtitle={t('excel.templatesSubtitle')}>
          <ul className="template-list">
            {templates.map((template) => (
              <li key={template.id} className={`template-item ${template.id === selectedId ? 'is-selected' : ''}`.trim()}>
                <button type="button" className="template-item__select" onClick={() => setSelectedId(template.id)}>
                  <span className="template-item__name">
                    {lang === 'ar' ? template.descriptionAr : template.descriptionEn}
                  </span>
                  <span className="template-item__meta">
                    <span className="mono">{template.sheetName}</span>
                    <span>{t('excel.templateVersion')} {template.version}</span>
                    <span>{template.columnCount} {t('excel.templateColumns')}</span>
                  </span>
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void downloadTemplate(template)}>
                  {t('excel.downloadTemplate')}
                </button>
              </li>
            ))}
          </ul>
          <InfoNote tone="info">{t('excel.generatorLink')}: {t('excel.generatorLinkText')} <span className="mono">excel_generator/</span></InfoNote>
        </Card>

        <Card title={t('excel.uploadTitle')} subtitle={t('excel.uploadSubtitle')}>
          <div className="upload-box">
            <label className="field field--grow">
              <span>{selected ? (lang === 'ar' ? selected.descriptionAr : selected.descriptionEn) : t('excel.chooseFile')}</span>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
              />
              <small className="field__hint">{t('excel.fileHint')} · {t('excel.maxSize')}</small>
            </label>
            <div className="upload-box__meta">
              {file ? (
                <span className="file-row">
                  <strong>{t('excel.selectedFile')}:</strong>
                  <span className="mono">{file.name}</span>
                  <span className="muted">{Math.round(file.size / 1024)} KB</span>
                </span>
              ) : null}
              <button type="button" className="btn btn--primary" onClick={() => void validate()} disabled={!file || busy !== null}>
                {busy === 'validate' ? t('excel.validating') : t('excel.validate')}
              </button>
            </div>
          </div>

          {staged ? (
            <div className="summary-grid">
              <div className="summary-item">
                <span>{t('excel.rowsTotal')}</span>
                <strong>{staged.result.summary.totalRows}</strong>
              </div>
              <div className="summary-item summary-item--ok">
                <span>{t('excel.rowsValid')}</span>
                <strong>{validCount}</strong>
              </div>
              <div className={`summary-item ${errorCount > 0 ? 'summary-item--bad' : ''}`.trim()}>
                <span>{t('excel.rowsInvalid')}</span>
                <strong>{errorCount}</strong>
              </div>
              <div className="summary-item">
                <span>{t('excel.warningCount')}</span>
                <strong>{staged.result.summary.warningCount}</strong>
              </div>
              <div className="summary-item">
                <span>{t('excel.importVersion')}</span>
                <strong className="mono">{staged.template.version}</strong>
              </div>
              <div className="summary-item">
                <span>{t('excel.schemaVersion')}</span>
                <strong className="mono">{staged.result.templateVersion}</strong>
              </div>
            </div>
          ) : null}

          {staged?.missingHeaders.length ? (
            <InfoNote tone="warning">
              {t('excel.errorsTitle')}: <span className="mono">{staged.missingHeaders.join(', ')}</span>
            </InfoNote>
          ) : null}

          <InfoNote tone="info">
            {t('excel.securityNote')} {t('excel.demoNotice')}
          </InfoNote>
        </Card>
      </div>

      {staged ? (
        <>
          <Card title={t('excel.previewTitle')} subtitle={t('excel.previewHint')}>
            <DataTable
              dense
              rows={staged.result.rows.slice(0, 30)}
              rowKey={(row) => String(row.rowNumber)}
              empty={t('common.noData')}
              columns={[
                { key: 'row', header: t('common.rowNumber'), render: (row) => <span className="mono">{row.rowNumber}</span> },
                ...staged.template.columns.slice(0, 5).map((column) => ({
                  key: column.key,
                  header: lang === 'ar' ? column.labelAr : column.labelEn,
                  render: (row: { values: Record<string, string> }) => row.values[column.key] || '—',
                })),
                {
                  key: 'issues',
                  header: t('common.status'),
                  render: (row: { issues: Array<{ severity: string }> }) => {
                    const hasError = row.issues.some((issue) => issue.severity === 'error');
                    const hasWarning = row.issues.some((issue) => issue.severity === 'warning');
                    if (hasError) return <Badge tone="danger">{t('common.errors')}</Badge>;
                    if (hasWarning) return <Badge tone="warning">{t('common.warnings')}</Badge>;
                    return <Badge tone="success">OK</Badge>;
                  },
                },
              ]}
            />
          </Card>

          <Card
            title={t('excel.errorsTitle')}
            subtitle={t('excel.errorWorkbookHint')}
            actions={
              <div className="filters__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    void downloadFile(`/api/excel/errors/${staged.stagedId}.xlsx`, `ICONCRETE_errors_${staged.template.id}.xlsx`)
                  }
                >
                  {t('excel.downloadErrorWorkbook')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    void downloadFile(`/api/excel/errors/${staged.stagedId}.csv`, `ICONCRETE_errors_${staged.template.id}.csv`)
                  }
                >
                  {t('excel.downloadErrorCsv')}
                </button>
              </div>
            }
          >
            {issues.length === 0 ? (
              <div className="empty-state">{t('excel.noErrors')}</div>
            ) : (
              <DataTable
                dense
                rows={issues}
                rowKey={(issue) => issue.id}
                empty={t('excel.noErrors')}
                columns={[
                  { key: 'rowNumber', header: t('common.rowNumber'), render: (issue) => <span className="mono">{issue.rowNumber}</span> },
                  { key: 'column', header: t('common.column'), render: (issue) => <span className="mono">{issue.column}</span> },
                  {
                    key: 'severity',
                    header: t('common.status'),
                    render: (issue) => (
                      <Badge tone={issue.severity === 'error' ? 'danger' : 'warning'}>
                        {issue.severity === 'error' ? t('common.errors') : t('common.warnings')}
                      </Badge>
                    ),
                  },
                  { key: 'message', header: t('common.details'), render: (issue) => (lang === 'ar' ? issue.messageAr : issue.messageEn) },
                  { key: 'value', header: t('common.value'), render: (issue) => <span className="mono">{issue.value || '—'}</span> },
                ]}
              />
            )}

            <div className="commit-bar">
              <div>
                <strong>{t('excel.commitTitle')}</strong>
                <p className="muted small">
                  {validCount} {t('excel.rowsValid')} · {t('excel.validRowsOnly')}
                </p>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setConfirmOpen(true)}
                disabled={validCount === 0 || busy !== null}
                title={validCount === 0 ? t('excel.commitBlocked') : t('excel.commit')}
              >
                {t('excel.commit')}
              </button>
            </div>
          </Card>
        </>
      ) : null}

      <Card title={t('excel.stagedTitle')} subtitle={t('excel.stagedSubtitle')}>
        <DataTable
          dense
          rows={stagedList}
          rowKey={(row) => row.id}
          empty={t('excel.stagedEmpty')}
          columns={[
            { key: 'id', header: t('common.id'), render: (row) => <span className="mono">{row.id}</span> },
            { key: 'templateId', header: t('excel.stagedTemplate'), render: (row) => <span className="mono">{row.templateId}</span> },
            { key: 'fileName', header: t('excel.stagedFile'), render: (row) => <span className="mono small">{row.fileName}</span> },
            { key: 'importedRows', header: t('excel.stagedRows'), align: 'end' },
            {
              key: 'status',
              header: t('excel.stagedStatus'),
              render: (row) => (
                <Badge tone={row.committed ? 'success' : 'warning'}>
                  {row.committed ? t('excel.stagedCommitted') : t('excel.stagedOpen')}
                </Badge>
              ),
            },
            { key: 'createdAt', header: t('common.date'), render: (row) => formatDateTime(row.createdAt, lang) },
            {
              key: 'actions',
              header: t('common.actions'),
              render: (row) =>
                row.committed ? null : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={discardingId === row.id}
                    onClick={() => void discard(row.id)}
                  >
                    {t('excel.discard')}
                  </button>
                ),
            },
          ]}
        />
      </Card>

      <Card title={t('excel.auditTitle')}>
        <DataTable
          dense
          rows={audit}
          rowKey={(entry) => entry.id}
          empty={t('excel.auditEmpty')}
          columns={[
            { key: 'action', header: t('excel.audit.action'), render: (entry) => <span className="mono">{entry.action}</span> },
            { key: 'table_name', header: t('excel.audit.table'), render: (entry) => <span className="mono">{entry.table_name}</span> },
            { key: 'record_id', header: t('excel.audit.record'), render: (entry) => <span className="mono small">{entry.record_id ?? '—'}</span> },
            { key: 'username', header: t('excel.audit.user'), render: (entry) => entry.username ?? '—' },
            { key: 'created_at', header: t('excel.audit.at'), render: (entry) => formatDateTime(entry.created_at, lang) },
            {
              key: 'details',
              header: t('excel.audit.details'),
              render: (entry) => <span className="mono small">{JSON.stringify(entry.details).slice(0, 120)}</span>,
            },
          ]}
        />
      </Card>

      {confirmOpen && staged ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>{t('excel.commitTitle')}</h2>
            <p>{t('excel.commitBody', { count: validCount })}</p>
            <p className="muted small mono">
              {staged.fileName} · {staged.checksum.slice(0, 16)}… · v{staged.template.version}
            </p>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmOpen(false)} disabled={busy === 'commit'}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void commit()} disabled={busy === 'commit'}>
                {busy === 'commit' ? t('excel.committing') : t('excel.commit')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
