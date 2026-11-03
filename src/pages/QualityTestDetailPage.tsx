import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CertificateIssueModal } from '../components/CertificateIssueModal';
import {
  Badge,
  Card,
  DataTable,
  ErrorNote,
  InfoNote,
  LoadingBlock,
  SectionTitle,
  type BadgeTone,
  type TableColumn,
} from '../components/ui';
import type { Lang } from '../types';

/**
 * M4 — one quality test: specimens, result entry, verification, the certificate and the rule
 * checks. Results are entered at level 3 and verified at level 4; a certificate control is shown
 * only for a passed, verified test and is disabled otherwise.
 */

interface Specimen {
  id: string;
  specimen_no: number;
  cast_at: string | null;
  cured_until: string | null;
  result_value: number | null;
  disposition: string;
}

interface NcrSummary {
  id: string;
  severity: string;
  status: string;
  description: string;
}

interface CertificateSummary {
  id: string;
  certificate_no: string;
  status: string;
  issued_at: string;
  revoked_reason: string | null;
}

interface CheckRow {
  key: string;
  classification: string;
  outcome: string;
  reasonKey: string;
}

interface TestDetail {
  id: string;
  plant_id: string;
  plant_name_ar: string;
  plant_name_en: string;
  batch_id: string | null;
  batch_no: string | null;
  test_type: string;
  sampled_at: string;
  tested_at: string | null;
  age_days: number | null;
  result_value: number | null;
  result_unit: string | null;
  spec_min: number | null;
  spec_max: number | null;
  spec_source_note: string;
  required_specimen_count: number | null;
  verified_by: string | null;
  verified_at: string | null;
  status: string;
  specimens: Specimen[];
  ncr: NcrSummary | null;
  certificate: CertificateSummary | null;
  checks: CheckRow[];
}

const STATUS_TONE: Record<string, BadgeTone> = {
  sampled: 'neutral',
  testing: 'info',
  passed: 'success',
  failed: 'danger',
  inconclusive: 'warning',
};

const OUTCOME_TONE: Record<string, BadgeTone> = {
  pass: 'success',
  failure: 'danger',
  approval_required: 'warning',
  warning: 'warning',
  engineering_hold: 'purple',
  override_required: 'purple',
};

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.code === 'mandatory_failure') return 'quality.err.mandatoryFailure';
    if (caught.code === 'approval_required') return 'quality.err.approvalRequired';
    if (caught.code === 'engineering_hold') return 'quality.err.engineeringHold';
    if (caught.code === 'invalid_transition') return 'quality.err.invalidTransition';
    if (caught.status === 422) return 'quality.err.validation';
    if (caught.status === 503) return 'common.durableRequired';
  }
  return 'errors.network';
};

export const QualityTestDetailPage = ({
  testId,
  onBack,
  onOpenNcr,
}: {
  testId: string;
  onBack: () => void;
  onOpenNcr: (ncrId: string) => void;
}) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [test, setTest] = useState<TestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const [resultValue, setResultValue] = useState('');
  const [resultUnit, setResultUnit] = useState('MPa');
  const [testedAt, setTestedAt] = useState('');
  const [ageDays, setAgeDays] = useState('');
  const [specimenNo, setSpecimenNo] = useState('1');
  const [castAt, setCastAt] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ test: TestDetail }>(`/api/quality/tests/${encodeURIComponent(testId)}`);
      setTest(response.test);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [testId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (path: string, payload?: Record<string, unknown>) => {
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/quality/tests/${encodeURIComponent(testId)}${path}`, {
        method: 'POST',
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      await load();
    } catch (caught) {
      setActionError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;
  if (!test) return <ErrorNote>{t('errors.network')}</ErrorNote>;

  const open = test.status === 'sampled' || test.status === 'testing';
  const certifiable = test.status === 'passed' && test.verified_at !== null;

  const specimenColumns: TableColumn<Specimen>[] = [
    { key: 'specimen_no', header: t('quality.specimen'), align: 'end' },
    {
      key: 'cast_at',
      header: t('quality.castAt'),
      render: (row) => (row.cast_at ? new Date(row.cast_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    },
    { key: 'disposition', header: t('quality.disposition') },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={`${t(`quality.type.${test.test_type}`)} — ${test.batch_no ?? t('quality.batchNone')}`}
        subtitle={`${lang === 'ar' ? test.plant_name_ar : test.plant_name_en} — ${new Date(test.sampled_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}`}
        badge={<Badge tone={STATUS_TONE[test.status] ?? 'neutral'}>{t(`quality.status.${test.status}`)}</Badge>}
      />

      <Card actions={<button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>{t('common.close')}</button>}>
        <div className="filters">
          <div className="field">
            <span>{t('quality.result')}</span>
            <strong>{test.result_value === null ? '—' : `${test.result_value} ${test.result_unit ?? ''}`}</strong>
          </div>
          <div className="field">
            <span>{t('quality.limits')}</span>
            <strong>
              {test.spec_min === null || test.spec_max === null
                ? t('quality.limitsMissing')
                : `${test.spec_min} … ${test.spec_max}`}
            </strong>
          </div>
          <div className="field field--grow">
            <span>{t('quality.specSource')}</span>
            <strong>{test.spec_source_note || t('quality.specSourceMissing')}</strong>
          </div>
          <div className="field">
            <span>{t('quality.verify')}</span>
            <strong>{test.verified_by ?? '—'}</strong>
          </div>
        </div>
        {test.certificate ? (
          <InfoNote>
            {t('quality.certificate')}: {test.certificate.certificate_no} —{' '}
            {t(`quality.certStatus.${test.certificate.status}`)}
            {test.certificate.revoked_reason ? ` (${test.certificate.revoked_reason})` : ''}
          </InfoNote>
        ) : null}
      </Card>

      <Card title={t('quality.specimens')}>
        <DataTable columns={specimenColumns} rows={test.specimens} rowKey={(row) => row.id} empty={t('quality.noSpecimens')} />
        <div className="filters">
          <label className="field">
            <span>{t('quality.specimen')}</span>
            <input inputMode="numeric" value={specimenNo} onChange={(event) => setSpecimenNo(event.target.value)} />
          </label>
          <label className="field field--grow">
            <span>{t('quality.castAt')}</span>
            <input type="datetime-local" value={castAt} onChange={(event) => setCastAt(event.target.value)} />
          </label>
          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={saving || level < 3 || !open}
              onClick={() =>
                void post('/specimens', {
                  specimenNo: Number(specimenNo),
                  castAt: castAt ? new Date(castAt).toISOString() : null,
                  curedUntil: null,
                })
              }
            >
              {t('quality.addSpecimen')}
            </button>
          </div>
        </div>
      </Card>

      <Card title={t('quality.enterResult')} subtitle={t('quality.resultNote')}>
        <div className="filters">
          <label className="field">
            <span>{t('quality.resultValue')}</span>
            <input inputMode="decimal" value={resultValue} onChange={(event) => setResultValue(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('quality.unit')}</span>
            <input value={resultUnit} onChange={(event) => setResultUnit(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('quality.testedAt')}</span>
            <input type="datetime-local" value={testedAt} onChange={(event) => setTestedAt(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('quality.ageDays')}</span>
            <input inputMode="numeric" value={ageDays} onChange={(event) => setAgeDays(event.target.value)} />
          </label>
        </div>
        <div className="filters__actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={saving || level < 3 || !open || resultValue === ''}
            onClick={() =>
              void post('/result', {
                resultValue: Number(resultValue),
                resultUnit,
                testedAt: testedAt ? new Date(testedAt).toISOString() : new Date().toISOString(),
                ageDays: ageDays === '' ? null : Number(ageDays),
              })
            }
          >
            {t('quality.saveResult')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={saving || level < 4 || open || test.verified_at !== null}
            onClick={() => void post('/verify')}
          >
            {t('quality.verify')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={saving || level < 4 || !certifiable || Boolean(test.certificate)}
            title={!certifiable ? t('quality.certBlocked') : undefined}
            onClick={() => setCertOpen(true)}
          >
            {t('quality.issueCertificate')}
          </button>
          {test.ncr ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onOpenNcr(test.ncr!.id)}>
              {t('quality.openNcr')}
            </button>
          ) : null}
        </div>
        {actionError ? <ErrorNote>{t(actionError)}</ErrorNote> : null}
        {level < 3 ? <InfoNote>{t('quality.readOnly')}</InfoNote> : null}
      </Card>

      <Card title={t('quality.checks')} subtitle={t('quality.checksNote')}>
        {test.checks.length === 0 ? (
          <p className="muted">{t('quality.checksEmpty')}</p>
        ) : (
          <ul className="check-list">
            {test.checks.map((check) => (
              <li key={check.key}>
                <Badge tone={OUTCOME_TONE[check.outcome] ?? 'neutral'}>
                  {t(`quality.outcome.${check.outcome}`)}
                </Badge>{' '}
                <strong>{t(`quality.check.${check.key}`)}</strong>{' '}
                <span className="muted">{t(`quality.class.${check.classification}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CertificateIssueModal
        testId={testId}
        status={test.status}
        verified={test.verified_at !== null}
        open={certOpen}
        onClose={() => setCertOpen(false)}
        onIssued={() => void load()}
      />
    </div>
  );
};
