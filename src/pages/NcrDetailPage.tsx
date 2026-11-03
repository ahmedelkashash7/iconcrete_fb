import { useCallback, useEffect, useState } from 'react';
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

/**
 * M4 — one non-conformance: investigation, corrective actions and closure.
 *
 * Closing needs every corrective action verified and at least one recorded effectiveness
 * check; the server refuses it otherwise and the button says so through the API message.
 */

interface Capa {
  id: string;
  action_type: string;
  description: string;
  owner_id: string | null;
  due_date: string | null;
  effectiveness_check: string;
  verified_by: string | null;
  status: string;
}

interface Ncr {
  id: string;
  plant_id: string;
  test_id: string | null;
  batch_id: string | null;
  severity: string;
  description: string;
  containment: string;
  root_cause: string;
  status: string;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  void_reason: string | null;
  capa: Capa[];
}

const SEVERITY_TONE: Record<string, BadgeTone> = {
  minor: 'neutral',
  major: 'warning',
  critical: 'danger',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  open: 'danger',
  investigation: 'warning',
  capa_open: 'info',
  verification: 'info',
  closed: 'success',
  void: 'neutral',
};

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.code === 'approval_required') return 'quality.err.approvalRequired';
    if (caught.code === 'invalid_transition') return 'quality.err.invalidTransition';
    if (caught.status === 422) return 'quality.err.validation';
    if (caught.status === 503) return 'common.durableRequired';
  }
  return 'errors.network';
};

export const NcrDetailPage = ({ ncrId, onBack }: { ncrId: string; onBack: () => void }) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [ncr, setNcr] = useState<Ncr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState('');
  const [actionType, setActionType] = useState<'corrective' | 'preventive'>('corrective');
  const [owner, setOwner] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [effectiveness, setEffectiveness] = useState('');
  const [capaId, setCapaId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ ncr: Ncr }>(`/api/quality/ncr/${encodeURIComponent(ncrId)}`);
      setNcr(response.ncr);
      setCapaId((previous) => previous || response.ncr.capa[0]?.id || '');
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [ncrId]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (path: string, payload?: Record<string, unknown>) => {
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/quality/${path}`, {
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
  if (!ncr) return <ErrorNote>{t('errors.network')}</ErrorNote>;

  const terminal = ncr.status === 'closed' || ncr.status === 'void';

  const capaColumns: TableColumn<Capa>[] = [
    {
      key: 'action_type',
      header: t('quality.ncr.actionType'),
      render: (row) => t(`quality.ncr.${row.action_type === 'preventive' ? 'preventive' : 'corrective'}`),
    },
    { key: 'description', header: t('quality.ncr.description') },
    {
      key: 'owner_id',
      header: t('quality.ncr.owner'),
      render: (row) => row.owner_id ?? '—',
    },
    {
      key: 'due_date',
      header: t('quality.ncr.dueDate'),
      render: (row) => row.due_date ?? '—',
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={row.status === 'verified' ? 'success' : 'warning'}>{t(`quality.capaStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'effectiveness_check',
      header: t('quality.ncr.effectiveness'),
      render: (row) => row.effectiveness_check || '—',
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={`${t('quality.ncr.title')} ${ncr.id}`}
        subtitle={new Date(ncr.opened_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}
        badge={<Badge tone={STATUS_TONE[ncr.status] ?? 'neutral'}>{t(`quality.ncrStatus.${ncr.status}`)}</Badge>}
      />

      <Card actions={<button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>{t('common.close')}</button>}>
        <div className="filters">
          <div className="field">
            <span>{t('quality.ncr.severity')}</span>
            <Badge tone={SEVERITY_TONE[ncr.severity] ?? 'neutral'}>{t(`quality.severity.${ncr.severity}`)}</Badge>
          </div>
          <div className="field">
            <span>{t('quality.ncr.openedBy')}</span>
            <strong>{ncr.opened_by}</strong>
          </div>
          <div className="field">
            <span>{t('quality.ncr.status')}</span>
            <strong>{t(`quality.ncrStatus.${ncr.status}`)}</strong>
          </div>
        </div>
        <p>{ncr.description}</p>
        {ncr.root_cause ? <InfoNote>{ncr.root_cause}</InfoNote> : null}
        {ncr.void_reason ? <InfoNote tone="warning">{ncr.void_reason}</InfoNote> : null}
      </Card>

      <Card title={t('quality.ncr.capa')}>
        <DataTable columns={capaColumns} rows={ncr.capa} rowKey={(row) => row.id} empty={t('quality.ncr.emptyCapa')} />

        <div className="filters">
          <label className="field field--grow">
            <span>{t('quality.ncr.description')}</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('quality.ncr.actionType')}</span>
            <select value={actionType} onChange={(event) => setActionType(event.target.value as 'corrective' | 'preventive')}>
              <option value="corrective">{t('quality.ncr.corrective')}</option>
              <option value="preventive">{t('quality.ncr.preventive')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('quality.ncr.owner')}</span>
            <input value={owner} onChange={(event) => setOwner(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('quality.ncr.dueDate')}</span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={saving || level < 4 || terminal || description.trim().length < 5}
              onClick={() =>
                void call(`ncr/${encodeURIComponent(ncr.id)}/capa`, {
                  actionType,
                  description,
                  ownerId: owner,
                  dueDate: dueDate || null,
                })
              }
            >
              {t('quality.ncr.addCapa')}
            </button>
          </div>
        </div>

        <div className="filters">
          <label className="field field--grow">
            <span>{t('quality.ncr.effectiveness')}</span>
            <input
              value={effectiveness}
              placeholder={t('quality.ncr.effectivenessHint')}
              onChange={(event) => setEffectiveness(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('quality.ncr.capa')}</span>
            <select value={capaId} onChange={(event) => setCapaId(event.target.value)}>
              {ncr.capa.map((action) => (
                <option key={action.id} value={action.id}>
                  {action.description.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={saving || level < 5 || !capaId || effectiveness.trim().length < 5}
              onClick={() => void call(`capa/${encodeURIComponent(capaId)}/verify`, { effectivenessCheck: effectiveness })}
            >
              {t('quality.ncr.verifyCapa')}
            </button>
          </div>
        </div>
      </Card>

      <Card title={t('quality.ncr.advance')}>
        <div className="filters__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={saving || level < 4 || ncr.status !== 'open'}
            onClick={() => void call(`ncr/${encodeURIComponent(ncr.id)}/status`, { status: 'investigation' })}
          >
            {t('quality.ncrStatus.investigation')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={saving || level < 4 || ncr.status === 'closed' || ncr.status === 'void'}
            onClick={() => void call(`ncr/${encodeURIComponent(ncr.id)}/status`, { status: 'verification' })}
          >
            {t('quality.ncrStatus.verification')}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={saving || level < 4 || ncr.status !== 'verification'}
            onClick={() => void call(`ncr/${encodeURIComponent(ncr.id)}/status`, { status: 'closed' })}
          >
            {t('quality.ncr.close')}
          </button>
        </div>
        {actionError ? <ErrorNote>{t(actionError)}</ErrorNote> : null}
        {ncr.status === 'closed' ? <InfoNote>{t('quality.ncr.closedNote')}</InfoNote> : null}
      </Card>
    </div>
  );
};
