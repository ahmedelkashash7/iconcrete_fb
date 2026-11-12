import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError, downloadFile } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, type BadgeTone } from './ui';
import { formatDateTime } from '../lib/display';
import type { Lang } from '../types';

interface CsvIssue {
  row: number;
  column: string;
  code: string;
  message_ar: string;
  message_en: string;
  value: string;
}

interface CsvUpload {
  staging_id: string;
  status: 'pending' | 'rejected' | 'committed';
  target: string;
  plant_id: string;
  file_name: string;
  file_hash: string;
  uploaded_at: string;
  row_count: number;
  error_count: number;
  sample_rows: Array<Record<string, string>>;
  rows: Array<Record<string, string>>;
  errors: CsvIssue[];
}

interface CommitSummary {
  staging_id: string;
  target: string;
  committed_rows: number;
  skipped_rows: number;
  created_customers: string[];
  audit_events: number;
}

interface CsvAuditEntry {
  id: string;
  action: string;
  username: string | null;
  created_at: string;
  details: unknown;
}

const STATUS_TONE: Record<CsvUpload['status'], BadgeTone> = {
  pending: 'warning',
  rejected: 'danger',
  committed: 'success',
};

export const CsvUploadWizard = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';

  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<CsvUpload | null>(null);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [audit, setAudit] = useState<CsvAuditEntry[]>([]);
  const [editText, setEditText] = useState<string | null>(null);
  const [busy, setBusy] = useState<'upload' | 'commit' | 'edit' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setUpload(null);
    setSummary(null);
    setAudit([]);
    setEditText(null);
    setError(null);
    setNotice(null);
  };

  const handleApiError = (caught: unknown): void => {
    if (caught instanceof ApiError && caught.status === 403) setError('errors.forbidden');
    else if (caught instanceof ApiError && caught.status === 503) setError('common.durableRequired');
    else if (caught instanceof ApiError && caught.code === 'duplicate_upload') setError('csv.duplicateUpload');
    else if (caught instanceof ApiError && caught.code === 'validation_failed') setError('csv.stillInvalid');
    else if (caught instanceof ApiError && caught.code === 'invalid_headers') setError('csv.invalidHeaders');
    else if (caught instanceof ApiError && (caught.status === 400 || caught.status === 422)) setError('csv.invalidFile');
    else setError('errors.network');
  };

  const refreshAudit = async (stagingId: string): Promise<void> => {
    try {
      const response = await apiFetch<{ entries: CsvAuditEntry[] }>(`/api/csv/staging/${stagingId}/audit`);
      setAudit(response.entries);
    } catch {
      setAudit([]);
    }
  };

  const uploadFile = async (): Promise<void> => {
    if (!file) {
      setError('csv.fileRequired');
      return;
    }
    setBusy('upload');
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('target', 'customers');
      form.append('file', file);
      const staged = await apiFetch<CsvUpload>('/api/csv/upload', { method: 'POST', body: form });
      setUpload(staged);
      setSummary(null);
      setEditText(null);
      void refreshAudit(staged.staging_id);
    } catch (caught) {
      handleApiError(caught);
    } finally {
      setBusy(null);
    }
  };

  const reject = async (): Promise<void> => {
    if (!upload) return;
    setBusy('reject');
    setError(null);
    try {
      const rejected = await apiFetch<CsvUpload>(`/api/csv/staging/${upload.staging_id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'manual rejection from the wizard' }),
      });
      setUpload(rejected);
      setNotice(t('csv.rejected'));
      void refreshAudit(rejected.staging_id);
    } catch (caught) {
      handleApiError(caught);
    } finally {
      setBusy(null);
    }
  };

  const saveEdits = async (): Promise<void> => {
    if (!upload || editText === null) return;
    setBusy('edit');
    setError(null);
    try {
      const parsed = JSON.parse(editText) as Array<Record<string, unknown>>;
      if (!Array.isArray(parsed)) throw new Error('rows must be an array');
      const edited = await apiFetch<CsvUpload>(`/api/csv/staging/${upload.staging_id}`, {
        method: 'PUT',
        body: JSON.stringify({ rows: parsed }),
      });
      setUpload(edited);
      setEditText(null);
      setNotice(t('csv.edited'));
      void refreshAudit(edited.staging_id);
    } catch (caught) {
      if (caught instanceof SyntaxError) setError('csv.invalidJson');
      else handleApiError(caught);
    } finally {
      setBusy(null);
    }
  };

  const commit = async (): Promise<void> => {
    if (!upload) return;
    setBusy('commit');
    setError(null);
    try {
      const response = await apiFetch<{ commit_summary: CommitSummary }>(
        `/api/csv/commit/${upload.staging_id}`,
        { method: 'POST' },
      );
      setSummary(response.commit_summary);
      setUpload({ ...upload, status: 'committed' });
      setNotice(t('csv.committed'));
      void refreshAudit(upload.staging_id);
    } catch (caught) {
      handleApiError(caught);
      if (upload) void refreshAudit(upload.staging_id);
    } finally {
      setBusy(null);
    }
  };

  const creditTotal = (upload?.rows ?? []).reduce((total, row) => {
    const value = Number(row.credit_limit_egp ?? '0');
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);

  return (
    <Card
      title={t('csv.title')}
      subtitle={t('csv.subtitle')}
      actions={
        upload ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>
            {t('csv.newUpload')}
          </button>
        ) : null
      }
    >
      <div className="steps">
        {[t('csv.step1'), t('csv.step2'), t('csv.step3'), t('csv.step4')].map((label, index) => (
          <div
            className={`step ${upload ? 'is-done' : ''} ${index === 1 && upload && !summary ? 'is-active' : ''}`.trim()}
            key={label}
          >
            <span className="step__index">{index + 1}</span>
            <span>{label.replace(/^\d+\.\s*/, '')}</span>
          </div>
        ))}
      </div>

      {!upload ? (
        <div className="filters">
          <label className="field field--grow">
            <span>{t('csv.chooseFile')}</span>
            <input
              type="file"
              accept=".csv"
              onChange={(event) => {
                setError(null);
                setFile(event.target.files?.[0] ?? null);
              }}
            />
            <small className="field__hint">{t('csv.hint')}</small>
          </label>
          <div className="filters__actions">
            <button type="button" className="btn btn--primary" onClick={() => void uploadFile()} disabled={busy !== null}>
              {busy === 'upload' ? t('csv.uploading') : t('csv.upload')}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      {notice ? <InfoNote tone="purple">{notice}</InfoNote> : null}

      {upload ? (
        <>
          <div className="summary-grid">
            <div className="summary-item">
              <span>{t('csv.statusLabel')}</span>
              <Badge tone={STATUS_TONE[upload.status]}>{t(`csv.status.${upload.status}`)}</Badge>
            </div>
            <div className="summary-item">
              <span>{t('csv.rowCount')}</span>
              <strong>{upload.row_count}</strong>
            </div>
            <div className={`summary-item ${upload.error_count > 0 ? 'summary-item--bad' : 'summary-item--ok'}`.trim()}>
              <span>{t('csv.errorCount')}</span>
              <strong>{upload.error_count}</strong>
            </div>
            <div className="summary-item">
              <span>{t('csv.totalCredit')}</span>
              <strong>{creditTotal.toFixed(2)}</strong>
            </div>
            <div className="summary-item">
              <span>{t('csv.file')}</span>
              <strong className="mono small">{upload.file_name}</strong>
            </div>
            <div className="summary-item">
              <span>{t('csv.fileHash')}</span>
              <strong className="mono small">{upload.file_hash.slice(0, 16)}…</strong>
            </div>
          </div>

          <DataTable
            dense
            rows={upload.sample_rows}
            rowKey={(_row, index) => `${upload.staging_id}-${index}`}
            empty={t('common.noData')}
            columns={[
              { key: 'name_ar', header: t('csv.nameAr') },
              { key: 'name_en', header: t('csv.nameEn') },
              { key: 'credit_limit_egp', header: t('csv.creditLimit') },
              { key: 'credit_days', header: t('csv.creditDays') },
              { key: 'priority_tier', header: t('csv.tier') },
              { key: 'status', header: t('common.status') },
            ]}
          />

          {upload.errors.length > 0 ? (
            <DataTable
              dense
              rows={upload.errors}
              rowKey={(issue) => `${issue.row}-${issue.column}-${issue.code}`}
              empty={t('csv.noErrors')}
              columns={[
                { key: 'row', header: t('common.rowNumber'), render: (issue) => <span className="mono">{issue.row}</span> },
                { key: 'column', header: t('common.column'), render: (issue) => <span className="mono">{issue.column}</span> },
                { key: 'code', header: t('csv.code'), render: (issue) => <span className="mono small">{issue.code}</span> },
                {
                  key: 'message',
                  header: t('common.details'),
                  render: (issue) => (lang === 'ar' ? issue.message_ar : issue.message_en),
                },
                { key: 'value', header: t('common.value'), render: (issue) => <span className="mono">{issue.value || '—'}</span> },
              ]}
            />
          ) : (
            <InfoNote tone="info">{t('csv.noErrors')}</InfoNote>
          )}

          {editText !== null ? (
            <div className="filters">
              <label className="field field--grow">
                <span>{t('csv.editHint')}</span>
                <textarea
                  dir="ltr"
                  rows={10}
                  className="mono"
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                />
              </label>
              <div className="filters__actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={() => void saveEdits()} disabled={busy !== null}>
                  {t('csv.saveEdits')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditText(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : null}

          {upload.status !== 'committed' ? (
            <div className="commit-bar">
              <div className="filters__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => downloadFile(`/api/csv/errors/${upload.staging_id}`, `ICONCRETE_csv_errors_${upload.staging_id}.csv`)}
                >
                  {t('csv.errorReport')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void reject()}
                  disabled={busy !== null || upload.status === 'rejected'}
                >
                  {t('csv.reject')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setEditText(JSON.stringify(upload.rows, null, 2))}
                  disabled={busy !== null}
                >
                  {t('csv.edit')}
                </button>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void commit()}
                disabled={busy !== null || upload.error_count > 0}
                title={upload.error_count > 0 ? t('csv.stillInvalid') : t('csv.confirmNote')}
              >
                {busy === 'commit' ? t('csv.committing') : t('csv.commit')}
              </button>
            </div>
          ) : null}

          {summary ? (
            <div className="summary-grid">
              <div className="summary-item summary-item--ok">
                <span>{t('csv.committedRows')}</span>
                <strong>{summary.committed_rows}</strong>
              </div>
              <div className="summary-item">
                <span>{t('csv.skippedRows')}</span>
                <strong>{summary.skipped_rows}</strong>
              </div>
              <div className="summary-item">
                <span>{t('csv.auditEvents')}</span>
                <strong>{summary.audit_events}</strong>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {upload ? (
        <DataTable
          dense
          rows={audit}
          rowKey={(entry) => String(entry.id)}
          empty={t('csv.auditEmpty')}
          columns={[
            { key: 'action', header: t('excel.audit.action'), render: (entry) => <span className="mono">{entry.action}</span> },
            { key: 'username', header: t('excel.audit.user'), render: (entry) => entry.username ?? '—' },
            { key: 'created_at', header: t('excel.audit.at'), render: (entry) => formatDateTime(entry.created_at, lang) },
            {
              key: 'details',
              header: t('excel.audit.details'),
              render: (entry) => <span className="mono small">{JSON.stringify(entry.details).slice(0, 120)}</span>,
            },
          ]}
        />
      ) : null}
    </Card>
  );
};
