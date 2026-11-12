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
import { TEST_TYPES, type TestType } from '../core/quality';
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

const STATUSES = ['sampled', 'testing', 'passed', 'failed', 'inconclusive'] as const;

const localDateTime = (date = new Date()): string => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const emptyCreate = () => ({
  plantId: '',
  testType: 'cube_strength' as TestType,
  sampledAt: localDateTime(),
  ageDays: '28',
  requiredSpecimenCount: '3',
  specMin: '',
  specMax: '',
  specSourceNote: '',
});

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
  const [showCreate, setShowCreate] = useState(false);
  const [create, setCreate] = useState(emptyCreate);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const openCreate = () => {
    const next = emptyCreate();
    next.plantId = plants[0]?.[0] ?? '';
    setCreate(next);
    setCreateError(null);
    setShowCreate(true);
  };

  const createTest = async () => {
    const sampledAt = create.sampledAt ? new Date(create.sampledAt) : null;
    const ageDays = create.ageDays === '' ? null : Number(create.ageDays);
    const required = create.requiredSpecimenCount === '' ? null : Number(create.requiredSpecimenCount);
    const specMin = create.specMin === '' ? null : Number(create.specMin);
    const specMax = create.specMax === '' ? null : Number(create.specMax);
    if (!create.plantId || !sampledAt || Number.isNaN(sampledAt.getTime())) {
      setCreateError('quality.new.dateRequired');
      return;
    }
    if (sampledAt.getTime() > Date.now() + 5 * 60_000) {
      setCreateError('quality.new.futureDate');
      return;
    }
    if (create.testType === 'cube_strength' && (!ageDays || !Number.isInteger(ageDays) || ageDays < 1 || ageDays > 365)) {
      setCreateError('quality.new.ageRequired');
      return;
    }
    if (!required || !Number.isInteger(required) || required < 1 || required > 20) {
      setCreateError('quality.new.specimenRequired');
      return;
    }
    if ((specMin === null) !== (specMax === null) || (specMin !== null && specMax !== null && (specMin < 0 || specMax < 0 || specMin > specMax))) {
      setCreateError('quality.new.limitsInvalid');
      return;
    }
    if (create.testType === 'cube_strength' && specMax !== null && specMax > 200) {
      setCreateError('quality.new.strengthInvalid');
      return;
    }
    if (!create.specSourceNote.trim()) {
      setCreateError('quality.new.sourceRequired');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const response = await apiFetch<{ test: QualityTest }>('/api/quality/tests', {
        method: 'POST',
        body: JSON.stringify({
          plantId: create.plantId,
          testType: create.testType,
          sampledAt: sampledAt.toISOString(),
          ageDays,
          requiredSpecimenCount: required,
          specMin,
          specMax,
          specSourceNote: create.specSourceNote.trim(),
        }),
      });
      setShowCreate(false);
      setSelectedTestId(response.test.id);
    } catch (caught) {
      setCreateError(apiMessage(caught));
    } finally {
      setCreating(false);
    }
  };

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

      <Card
        actions={
          level >= 3 ? (
            <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}>
              {t('quality.new')}
            </button>
          ) : null
        }
      >
        {showCreate ? (
          <div className="filters">
            <label className="field">
              <span>{t('quality.plant')}</span>
              <select value={create.plantId} onChange={(event) => setCreate({ ...create, plantId: event.target.value })}>
                <option value="">{t('quality.new.pickPlant')}</option>
                {plants.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('quality.testType')}</span>
              <select
                value={create.testType}
                onChange={(event) => {
                  const testType = event.target.value as TestType;
                  setCreate({
                    ...create,
                    testType,
                    ageDays: testType === 'cube_strength' ? create.ageDays || '28' : '',
                    requiredSpecimenCount: testType === 'cube_strength' ? create.requiredSpecimenCount || '3' : '1',
                  });
                }}
              >
                {TEST_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`quality.type.${type}`)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('quality.sampledAt')}</span>
              <input type="datetime-local" value={create.sampledAt} onChange={(event) => setCreate({ ...create, sampledAt: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('quality.ageDays')}</span>
              <input inputMode="numeric" value={create.ageDays} onChange={(event) => setCreate({ ...create, ageDays: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('quality.specimens')}</span>
              <input inputMode="numeric" value={create.requiredSpecimenCount} onChange={(event) => setCreate({ ...create, requiredSpecimenCount: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('quality.limits')} — {t('common.from')}</span>
              <input inputMode="decimal" value={create.specMin} onChange={(event) => setCreate({ ...create, specMin: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('quality.limits')} — {t('common.to')}</span>
              <input inputMode="decimal" value={create.specMax} onChange={(event) => setCreate({ ...create, specMax: event.target.value })} />
            </label>
            <label className="field field--grow">
              <span>{t('quality.specSource')}</span>
              <input value={create.specSourceNote} onChange={(event) => setCreate({ ...create, specSourceNote: event.target.value })} placeholder={t('quality.new.sourceHint')} />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--primary btn--sm" disabled={creating} onClick={() => void createTest()}>
                {creating ? t('common.loading') : t('quality.new.submit')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowCreate(false)}>
                {t('common.cancel')}
              </button>
            </div>
            {createError ? <ErrorNote>{t(createError)}</ErrorNote> : null}
          </div>
        ) : null}

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
