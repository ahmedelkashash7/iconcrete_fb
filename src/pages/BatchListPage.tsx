import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
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
import { BatchDetailPage } from './BatchDetailPage';

/**
 * M3 — the dispatch board: every batch for the tenant, filtered by plant, date and status.
 *
 * Planning is level 3, so the form is hidden below that level instead of failing after a
 * submit. A batch opens into the detail/dispatch screen, which owns the lifecycle actions,
 * the moisture entry and the override modal.
 */

interface PlantOption {
  id: string;
  name_ar: string;
  name_en: string;
}

interface VersionOption {
  id: string;
  mix_code: string;
  mix_name_ar: string;
  mix_name_en: string;
  version_no: number;
  strength_class: string;
}

interface BatchRow {
  id: string;
  plant_id: string;
  plant_name_ar: string;
  plant_name_en: string;
  batch_no: string;
  mix_version_no: number;
  mix_strength_class: string;
  planned_volume: number;
  actual_volume: number | null;
  status: string;
  hold_reason: string | null;
  produced_at: string | null;
  created_at: string;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  planned: 'neutral',
  in_progress: 'info',
  completed: 'success',
  held: 'warning',
  cancelled: 'danger',
};

const STATUSES = ['planned', 'in_progress', 'completed', 'held', 'cancelled'] as const;

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.code === 'mandatory_failure') return 'batches.err.mandatoryFailure';
    if (caught.code === 'approval_required') return 'batches.err.approvalRequired';
    if (caught.code === 'engineering_hold') return 'batches.err.engineeringHold';
    if (caught.code === 'invalid_transition') return 'batches.err.invalidTransition';
    if (caught.status === 409) return 'batches.err.conflict';
    if (caught.status === 422) return 'batches.err.validation';
    if (caught.status === 503) return 'common.durableRequired';
  }
  return 'errors.network';
};

export const BatchListPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [rows, setRows] = useState<BatchRow[]>([]);
  const [plants, setPlants] = useState<PlantOption[]>([]);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [plantId, setPlantId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ plantId: '', batchNo: '', mixVersionId: '', plannedVolume: '8', orderId: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (plantId) query.set('plantId', plantId);
      if (status) query.set('status', status);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const response = await apiFetch<{
        batches: BatchRow[];
        plants: PlantOption[];
        versions: VersionOption[];
      }>(`/api/batches${suffix}`);
      setRows(response.batches);
      setPlants(response.plants ?? []);
      setVersions(response.versions ?? []);
      setForm((previous) => ({
        ...previous,
        plantId: previous.plantId || response.plants[0]?.id || '',
        mixVersionId: previous.mixVersionId || response.versions[0]?.id || '',
      }));
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [plantId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        const created = row.created_at.slice(0, 10);
        if (from && created < from) return false;
        if (to && created > to) return false;
        return true;
      }),
    [rows, from, to],
  );

  const submitPlan = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const created = await apiFetch<{ batch: BatchRow }>('/api/batches', {
        method: 'POST',
        body: JSON.stringify({
          plantId: form.plantId,
          batchNo: form.batchNo.trim(),
          orderId: form.orderId.trim() || null,
          mixVersionId: form.mixVersionId,
          plannedVolume: Number(form.plannedVolume),
          operatorId: null,
        }),
      });
      setPlanning(false);
      setForm((previous) => ({ ...previous, batchNo: '', orderId: '' }));
      await load();
      setSelectedId(created.batch.id);
    } catch (caught) {
      setFormError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (selectedId) {
    return (
      <BatchDetailPage
        batchId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void load();
        }}
      />
    );
  }

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  const columns: TableColumn<BatchRow>[] = [
    { key: 'batch_no', header: t('batches.batchNo') },
    {
      key: 'plant_id',
      header: t('batches.plant'),
      render: (row) => (lang === 'ar' ? row.plant_name_ar || row.plant_id : row.plant_name_en || row.plant_id),
    },
    {
      key: 'mix_version_no',
      header: t('batches.mix'),
      render: (row) => `v${row.mix_version_no} — ${row.mix_strength_class}`,
    },
    {
      key: 'planned_volume',
      header: t('batches.plannedVolume'),
      align: 'end',
      render: (row) => row.planned_volume.toFixed(3),
    },
    {
      key: 'actual_volume',
      header: t('batches.actualVolume'),
      align: 'end',
      render: (row) => (row.actual_volume === null ? '—' : row.actual_volume.toFixed(3)),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{t(`batches.status.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'created_at',
      header: t('common.date'),
      render: (row) => row.created_at.slice(0, 10),
    },
    {
      key: 'id',
      header: '',
      render: (row) => (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedId(row.id)}>
          {t('common.open')}
        </button>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('batches.title')}
        subtitle={t('batches.subtitle')}
        badge={<Badge tone="purple">{visible.length}</Badge>}
      />

      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('batches.plant')}</span>
            <select value={plantId} onChange={(event) => setPlantId(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {plants.map((plant) => (
                <option key={plant.id} value={plant.id}>
                  {lang === 'ar' ? plant.name_ar : plant.name_en}
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
                  {t(`batches.status.${value}`)}
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
          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setPlanning((previous) => !previous)}
              disabled={level < 3}
              title={level < 3 ? t('batches.planHint') : undefined}
            >
              {t('batches.plan')}
            </button>
          </div>
        </div>
        {level < 3 ? <InfoNote>{t('batches.readOnly')}</InfoNote> : null}
      </Card>

      {planning && level >= 3 ? (
        <Card title={t('batches.planTitle')} subtitle={t('batches.planSubtitle')}>
          <div className="filters">
            <label className="field">
              <span>{t('batches.plant')}</span>
              <select
                value={form.plantId}
                onChange={(event) => setForm({ ...form, plantId: event.target.value })}
              >
                {plants.map((plant) => (
                  <option key={plant.id} value={plant.id}>
                    {lang === 'ar' ? plant.name_ar : plant.name_en}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('batches.batchNo')}</span>
              <input
                value={form.batchNo}
                onChange={(event) => setForm({ ...form, batchNo: event.target.value })}
              />
            </label>
            <label className="field field--grow">
              <span>{t('batches.mix')}</span>
              <select
                value={form.mixVersionId}
                onChange={(event) => setForm({ ...form, mixVersionId: event.target.value })}
              >
                <option value="">{t('batches.pickMix')}</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.mix_code} v{version.version_no} — {version.strength_class}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('batches.plannedVolume')}</span>
              <input
                inputMode="decimal"
                value={form.plannedVolume}
                onChange={(event) => setForm({ ...form, plannedVolume: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t('batches.order')}</span>
              <input
                value={form.orderId}
                onChange={(event) => setForm({ ...form, orderId: event.target.value })}
              />
            </label>
          </div>
          {versions.length === 0 ? <InfoNote tone="warning">{t('batches.noApprovedMix')}</InfoNote> : null}
          {formError ? <ErrorNote>{t(formError)}</ErrorNote> : null}
          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void submitPlan()}
              disabled={saving || !form.plantId || !form.batchNo.trim() || !form.mixVersionId}
            >
              {saving ? t('common.loading') : t('batches.plan')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPlanning(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Card>
      ) : null}

      <Card>
        <DataTable columns={columns} rows={visible} rowKey={(row) => row.id} empty={t('batches.empty')} />
      </Card>
    </div>
  );
};
