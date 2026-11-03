import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Card,
  DataTable,
  ErrorNote,
  LoadingBlock,
  SectionTitle,
  type BadgeTone,
  type TableColumn,
} from '../components/ui';
import type { Lang } from '../types';
import { NcrDetailPage } from './NcrDetailPage';
import { QualityTestDetailPage } from './QualityTestDetailPage';

/**
 * M4 — the laboratory board. Filters are plant, date range, test type and status; the plant list
 * is derived from the rows the reader is allowed to see, so no extra privileged call is made.
 */

interface QualityTest {
  id: string;
  plant_id: string;
  plant_name_ar: string;
  plant_name_en: string;
  batch_no: string | null;
  test_type: string;
  sampled_at: string;
  result_value: number | null;
  result_unit: string | null;
  status: string;
  specimen_count: number;
  ncr_id: string | null;
  certificate_id: string | null;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  sampled: 'neutral',
  testing: 'info',
  passed: 'success',
  failed: 'danger',
  inconclusive: 'warning',
};

const TEST_TYPES = ['slump', 'cube_strength', 'temperature', 'density', 'other'] as const;
const STATUSES = ['sampled', 'testing', 'passed', 'failed', 'inconclusive'] as const;

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
  }
  return 'errors.network';
};

export const QualityListPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [rows, setRows] = useState<QualityTest[]>([]);
  const [testType, setTestType] = useState('');
  const [status, setStatus] = useState('');
  const [plantId, setPlantId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [selectedNcrId, setSelectedNcrId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (testType) query.set('testType', testType);
      if (status) query.set('status', status);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const response = await apiFetch<{ tests: QualityTest[] }>(`/api/quality/tests${suffix}`);
      setRows(response.tests);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [testType, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const plants = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      if (!seen.has(row.plant_id)) {
        seen.set(row.plant_id, lang === 'ar' ? row.plant_name_ar || row.plant_id : row.plant_name_en || row.plant_id);
      }
    }
    return [...seen.entries()];
  }, [rows, lang]);

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (plantId && row.plant_id !== plantId) return false;
        const day = row.sampled_at.slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      }),
    [rows, plantId, from, to],
  );

  if (selectedNcrId) {
    return <NcrDetailPage ncrId={selectedNcrId} onBack={() => setSelectedNcrId(null)} />;
  }

  if (selectedTestId) {
    return (
      <QualityTestDetailPage
        testId={selectedTestId}
        onBack={() => {
          setSelectedTestId(null);
          void load();
        }}
        onOpenNcr={setSelectedNcrId}
      />
    );
  }

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  const columns: TableColumn<QualityTest>[] = [
    {
      key: 'test_type',
      header: t('quality.testType'),
      render: (row) => t(`quality.type.${row.test_type}`),
    },
    {
      key: 'plant_id',
      header: t('quality.plant'),
      render: (row) => (lang === 'ar' ? row.plant_name_ar || row.plant_id : row.plant_name_en || row.plant_id),
    },
    {
      key: 'batch_no',
      header: t('quality.batch'),
      render: (row) => row.batch_no ?? t('quality.batchNone'),
    },
    {
      key: 'sampled_at',
      header: t('quality.sampledAt'),
      render: (row) => new Date(row.sampled_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    },
    {
      key: 'result_value',
      header: t('quality.result'),
      align: 'end',
      render: (row) =>
        row.result_value === null ? '—' : `${row.result_value} ${row.result_unit ?? ''}`.trim(),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{t(`quality.status.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'specimen_count',
      header: t('quality.specimens'),
      align: 'end',
    },
    {
      key: 'ncr_id',
      header: t('quality.ncr'),
      render: (row) =>
        row.ncr_id ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setSelectedNcrId(row.ncr_id)}
          >
            {t('quality.openNcr')}
          </button>
        ) : (
          <span className="muted">{t('quality.noNcr')}</span>
        ),
    },
    {
      key: 'id',
      header: '',
      render: (row) => (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedTestId(row.id)}>
          {t('common.open')}
        </button>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('quality.title')}
        subtitle={t('quality.subtitle')}
        badge={<Badge tone="purple">{visible.length}</Badge>}
      />

      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('quality.plant')}</span>
            <select value={plantId} onChange={(event) => setPlantId(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {plants.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('quality.testType')}</span>
            <select value={testType} onChange={(event) => setTestType(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {TEST_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`quality.type.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`quality.status.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('common.from')}</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('common.to')}</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
        {level < 3 ? <p className="muted">{t('quality.readOnly')}</p> : null}
      </Card>

      <Card>
        <DataTable columns={columns} rows={visible} rowKey={(row) => row.id} empty={t('quality.empty')} />
      </Card>
    </div>
  );
};
