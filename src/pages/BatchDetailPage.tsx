import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { MoistureInputModal } from '../components/MoistureInputModal';
import { OverrideModal, type OverrideRuleOption } from '../components/OverrideModal';
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
import { BATCH_MATERIALS, batchMaterialLabel } from '../core/batching';
import { MIN_OVERRIDE_REASON } from '../core/rules';
import type { Lang } from '../types';

/**
 * M3 — dispatch screen for one batch.
 *
 * Lifecycle actions are shown with the level they need: start/complete at 3, hold/release
 * and cancel at 4, engineering-hold release at 5. A completed batch renders read-only,
 * because the record is terminal and corrections are new adjustment records.
 */

interface ComponentRow {
  id: string;
  material_id: string;
  target_weight: number | null;
  actual_weight: number | null;
  unit: string;
  tolerance_pct: number | null;
  deviation_class: string | null;
}

interface MoistureRow {
  id: string;
  material_id: string;
  basis: string;
  moisture_pct: number | null;
  absorption_pct: number | null;
  sample_at: string;
  valid_until: string | null;
  entered_by: string | null;
}

interface OverrideRow {
  id: string;
  rule_code: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  reason: string;
  decision: string;
  decided_at: string;
}

interface CheckRow {
  key: string;
  classification: string;
  outcome: string;
  reasonKey: string;
}

interface BatchDetail {
  id: string;
  plant_id: string;
  plant_name_ar: string;
  plant_name_en: string;
  batch_no: string;
  order_id: string | null;
  mix_version_id: string;
  mix_version_no: number;
  mix_strength_class: string;
  planned_volume: number;
  actual_volume: number | null;
  status: string;
  operator_id: string | null;
  hold_reason: string | null;
  produced_at: string | null;
  completed_at: string | null;
  created_at: string;
  components: ComponentRow[];
  moisture: MoistureRow[];
  overrides: OverrideRow[];
  checks: CheckRow[];
}

interface ComponentDraft {
  materialId: string;
  unit: string;
  targetWeight: string;
  actualWeight: string;
  tolerancePct: string;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  planned: 'neutral',
  in_progress: 'info',
  completed: 'success',
  held: 'warning',
  cancelled: 'danger',
};

const OUTCOME_TONE: Record<string, BadgeTone> = {
  pass: 'success',
  failure: 'danger',
  approval_required: 'warning',
  warning: 'warning',
  engineering_hold: 'purple',
  override_required: 'purple',
};

const emptyComponent = (): ComponentDraft => ({
  materialId: BATCH_MATERIALS[0]!.id,
  unit: 'kg',
  targetWeight: '',
  actualWeight: '',
  tolerancePct: '',
});

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.code === 'mandatory_failure') return 'batches.err.mandatoryFailure';
    if (caught.code === 'approval_required') return 'batches.err.approvalRequired';
    if (caught.code === 'engineering_hold') return 'batches.err.engineeringHold';
    if (caught.code === 'invalid_transition') return 'batches.err.invalidTransition';
    if (caught.status === 422) return 'batches.err.validation';
    if (caught.status === 503) return 'common.durableRequired';
  }
  return 'errors.network';
};

export const BatchDetailPage = ({ batchId, onBack }: { batchId: string; onBack: () => void }) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [rules, setRules] = useState<OverrideRuleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [moistureOpen, setMoistureOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [actualVolume, setActualVolume] = useState('');
  const [calibratedAt, setCalibratedAt] = useState('');
  const [components, setComponents] = useState<ComponentDraft[]>([emptyComponent()]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ batch: BatchDetail }>(
        `/api/batches/${encodeURIComponent(batchId)}`,
      );
      setDetail(response.batch);
      setActualVolume(
        response.batch.actual_volume === null ? String(response.batch.planned_volume) : String(response.batch.actual_volume),
      );
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // The rule catalogue is a level-2 read; a viewer simply gets no override options.
    if (level < 2) return;
    void (async () => {
      try {
        const response = await apiFetch<{ rules: OverrideRuleOption[] }>('/api/rules?module=batching');
        setRules(response.rules);
      } catch {
        setRules([]);
      }
    })();
  }, [level]);

  const act = async (path: string, payload?: Record<string, unknown>) => {
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/batches/${encodeURIComponent(batchId)}${path}`, {
        method: 'POST',
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      setReason('');
      await load();
    } catch (caught) {
      setActionError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const startBatch = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch('/api/batches', {
        method: 'PATCH',
        body: JSON.stringify({ id: batchId, operatorId: null }),
      });
      await load();
    } catch (caught) {
      setActionError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/batches/${encodeURIComponent(batchId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          actualVolume: Number(actualVolume),
          scaleCalibratedAt: calibratedAt ? new Date(calibratedAt).toISOString() : null,
          components: components
            .filter((component) => component.targetWeight !== '' || component.actualWeight !== '')
            .map((component) => ({
              materialId: component.materialId,
              unit: component.unit.trim() || 'kg',
              targetWeight: component.targetWeight === '' ? null : Number(component.targetWeight),
              actualWeight: component.actualWeight === '' ? null : Number(component.actualWeight),
              tolerancePct: component.tolerancePct === '' ? null : Number(component.tolerancePct),
            })),
        }),
      });
      setCompleting(false);
      await load();
    } catch (caught) {
      setActionError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;
  if (!detail) return <ErrorNote>{t('errors.network')}</ErrorNote>;

  const terminal = detail.status === 'completed' || detail.status === 'cancelled';

  const componentColumns: TableColumn<ComponentRow>[] = [
    {
      key: 'material_id',
      header: t('batches.material'),
      render: (row) => batchMaterialLabel(row.material_id, lang),
    },
    {
      key: 'target_weight',
      header: t('batches.targetWeight'),
      align: 'end',
      render: (row) => (row.target_weight === null ? '—' : row.target_weight.toFixed(3)),
    },
    {
      key: 'actual_weight',
      header: t('batches.actualWeight'),
      align: 'end',
      render: (row) => (row.actual_weight === null ? '—' : row.actual_weight.toFixed(3)),
    },
    { key: 'unit', header: t('batches.unit') },
  ];

  const moistureColumns: TableColumn<MoistureRow>[] = [
    {
      key: 'material_id',
      header: t('batches.material'),
      render: (row) => batchMaterialLabel(row.material_id, lang),
    },
    {
      key: 'basis',
      header: t('batches.moisture.basis'),
      render: (row) => t(`batches.moisture.${row.basis === 'wet' ? 'wet' : 'dry'}`),
    },
    {
      key: 'moisture_pct',
      header: t('batches.moisture.percent'),
      align: 'end',
      render: (row) => (row.moisture_pct === null ? '—' : `${row.moisture_pct}%`),
    },
    {
      key: 'valid_until',
      header: t('batches.moisture.validUntil'),
      render: (row) =>
        row.valid_until === null
          ? t('batches.moisture.noWindow')
          : new Date(row.valid_until).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    },
    {
      key: 'sample_at',
      header: t('batches.sampledAt'),
      render: (row) => new Date(row.sample_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    },
  ];

  const overrideColumns: TableColumn<OverrideRow>[] = [
    { key: 'rule_code', header: t('batches.override.rule') },
    {
      key: 'decision',
      header: t('batches.override.decision'),
      render: (row) => (
        <Badge tone={row.decision === 'approved' ? 'success' : 'danger'}>
          {t(`batches.override.${row.decision === 'approved' ? 'approved' : 'rejected'}`)}
        </Badge>
      ),
    },
    { key: 'actor', header: t('batches.override.actor') },
    { key: 'reason', header: t('batches.override.reason') },
    {
      key: 'decided_at',
      header: t('batches.override.decidedAt'),
      render: (row) => new Date(row.decided_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    },
  ];

  const checkColumns: TableColumn<CheckRow>[] = [
    { key: 'key', header: t('batches.checks.check') },
    {
      key: 'classification',
      header: t('batches.checks.classification'),
      render: (row) => t(`batches.class.${row.classification}`),
    },
    {
      key: 'outcome',
      header: t('batches.checks.outcome'),
      render: (row) => (
        <Badge tone={OUTCOME_TONE[row.outcome] ?? 'neutral'}>{t(`batches.outcome.${row.outcome}`)}</Badge>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={`${detail.batch_no}`}
        subtitle={`${lang === 'ar' ? detail.plant_name_ar : detail.plant_name_en} — v${detail.mix_version_no} ${detail.mix_strength_class}`}
        badge={<Badge tone={STATUS_TONE[detail.status] ?? 'neutral'}>{t(`batches.status.${detail.status}`)}</Badge>}
      />

      <Card
        actions={
          <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
            {t('batches.back')}
          </button>
        }
      >
        <div className="filters">
          <div className="field">
            <span>{t('batches.plannedVolume')}</span>
            <strong>{detail.planned_volume.toFixed(3)} m³</strong>
          </div>
          <div className="field">
            <span>{t('batches.actualVolume')}</span>
            <strong>{detail.actual_volume === null ? '—' : `${detail.actual_volume.toFixed(3)} m³`}</strong>
          </div>
          <div className="field">
            <span>{t('batches.order')}</span>
            <strong>{detail.order_id ?? '—'}</strong>
          </div>
          <div className="field">
            <span>{t('batches.producedAt')}</span>
            <strong>
              {detail.produced_at === null
                ? '—'
                : new Date(detail.produced_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}
            </strong>
          </div>
        </div>
        {detail.hold_reason ? <InfoNote tone="warning">{detail.hold_reason}</InfoNote> : null}
        {detail.status === 'completed' ? <InfoNote>{t('batches.terminal')}</InfoNote> : null}
      </Card>

      <Card title={t('batches.components')} subtitle={t('batches.componentsNote')}>
        <DataTable
          columns={componentColumns}
          rows={detail.components}
          rowKey={(row) => row.id}
          empty={t('batches.noComponents')}
        />
      </Card>

      <Card
        title={t('batches.moisture.title')}
        subtitle={t('batches.moisture.windowNote')}
        actions={
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setMoistureOpen(true)}
            disabled={terminal || level < 3}
          >
            {t('batches.moisture.add')}
          </button>
        }
      >
        <DataTable
          columns={moistureColumns}
          rows={detail.moisture}
          rowKey={(row) => row.id}
          empty={t('batches.moisture.empty')}
        />
      </Card>

      <Card title={t('batches.checks.title')} subtitle={t('batches.checks.note')}>
        <DataTable
          columns={checkColumns}
          rows={detail.checks}
          rowKey={(row) => row.key}
          empty={t('batches.checks.empty')}
        />
      </Card>

      <Card title={t('batches.override.title')} subtitle={t('batches.override.subtitle')}>
        <DataTable
          columns={overrideColumns}
          rows={detail.overrides}
          rowKey={(row) => row.id}
          empty={t('batches.override.empty')}
        />
        <div className="filters__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setOverrideOpen(true)}
            disabled={terminal || level < 4 || rules.length === 0}
          >
            {t('batches.override.add')}
          </button>
        </div>
      </Card>

      <Card title={t('batches.lifecycle')}>
        <div className="filters__actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void startBatch()}
            disabled={saving || level < 3 || detail.status !== 'planned'}
          >
            {t('batches.start')}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => setCompleting((previous) => !previous)}
            disabled={saving || level < 3 || detail.status !== 'in_progress'}
          >
            {t('batches.complete')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void act('/hold', { reason })}
            disabled={saving || level < 4 || terminal || reason.trim().length < MIN_OVERRIDE_REASON}
          >
            {t('batches.hold')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void act('/release')}
            disabled={saving || level < 4 || detail.status !== 'held'}
          >
            {t('batches.release')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void act('/engineering-hold', { reason })}
            disabled={saving || level < 5 || detail.status !== 'held' || reason.trim().length < MIN_OVERRIDE_REASON}
          >
            {t('batches.releaseEngineering')}
          </button>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => void act('/cancel')}
            disabled={saving || level < 4 || terminal}
          >
            {t('batches.cancel')}
          </button>
        </div>

        <label className="field field--grow">
          <span>{t('batches.reason')}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('batches.reasonHint')}
          />
        </label>

        {completing ? (
          <div className="page-stack">
            <div className="filters">
              <label className="field">
                <span>{t('batches.actualVolume')}</span>
                <input
                  inputMode="decimal"
                  value={actualVolume}
                  onChange={(event) => setActualVolume(event.target.value)}
                />
              </label>
              <label className="field field--grow">
                <span>{t('batches.scaleCalibratedAt')}</span>
                <input
                  type="datetime-local"
                  value={calibratedAt}
                  onChange={(event) => setCalibratedAt(event.target.value)}
                />
              </label>
            </div>
            <p className="muted">{t('batches.scaleNote')}</p>

            <DataTable
              columns={[
                {
                  key: 'materialId',
                  header: t('batches.material'),
                  render: (row: ComponentDraft) => (
                    <select
                      value={row.materialId}
                      onChange={(event) =>
                        setComponents((previous) =>
                          previous.map((component) =>
                            component === row ? { ...component, materialId: event.target.value } : component,
                          ),
                        )
                      }
                    >
                      {BATCH_MATERIALS.map((material) => (
                        <option key={material.id} value={material.id}>
                          {lang === 'ar' ? material.nameAr : material.nameEn} ({material.code})
                        </option>
                      ))}
                    </select>
                  ),
                },
                {
                  key: 'targetWeight',
                  header: t('batches.targetWeight'),
                  render: (row: ComponentDraft) => (
                    <input
                      inputMode="decimal"
                      value={row.targetWeight}
                      onChange={(event) =>
                        setComponents((previous) =>
                          previous.map((component) =>
                            component === row ? { ...component, targetWeight: event.target.value } : component,
                          ),
                        )
                      }
                    />
                  ),
                },
                {
                  key: 'actualWeight',
                  header: t('batches.actualWeight'),
                  render: (row: ComponentDraft) => (
                    <input
                      inputMode="decimal"
                      value={row.actualWeight}
                      onChange={(event) =>
                        setComponents((previous) =>
                          previous.map((component) =>
                            component === row ? { ...component, actualWeight: event.target.value } : component,
                          ),
                        )
                      }
                    />
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  render: (row: ComponentDraft) => (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setComponents((previous) => previous.filter((component) => component !== row))}
                    >
                      {t('common.remove')}
                    </button>
                  ),
                },
              ]}
              rows={components}
              rowKey={(_row, index) => `component-${index}`}
              empty={t('batches.noComponents')}
            />
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setComponents((previous) => [...previous, emptyComponent()])}
              >
                {t('batches.addComponent')}
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void complete()}
                disabled={saving}
              >
                {saving ? t('common.loading') : t('batches.confirmComplete')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCompleting(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : null}

        {actionError ? <ErrorNote>{t(actionError)}</ErrorNote> : null}
        {level < 3 ? <InfoNote>{t('batches.readOnly')}</InfoNote> : null}
      </Card>

      <MoistureInputModal
        batchId={batchId}
        open={moistureOpen}
        onClose={() => setMoistureOpen(false)}
        onSaved={() => void load()}
      />
      <OverrideModal
        batchId={batchId}
        open={overrideOpen}
        level={level}
        rules={rules}
        onClose={() => setOverrideOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
};
