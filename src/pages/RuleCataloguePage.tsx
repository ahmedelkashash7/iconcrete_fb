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

/**
 * R1 catalogue — the ECP rule register. Every rule states its own value and source; a rule
 * without both is shown as "not specified in the supplied reference" and is never presented as
 * a pass. Values are editable at level 5 only, and each change is audited by the API.
 */

interface Rule {
  id: string;
  code: string;
  module: string;
  classification: string;
  value: number | null;
  unit: string;
  source_note: string;
  effective_from: string;
  approved_by: string;
  status: string;
  configured: boolean;
  value_display: string;
  version: number;
}

const MODULES = ['mix_design', 'batching', 'quality', 'fleet'];
const TONE: Record<string, BadgeTone> = {
  warning: 'warning',
  mandatory_failure: 'danger',
  approval_required: 'warning',
  engineering_hold: 'danger',
  authorized_override: 'purple',
};

const message = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.code === 'validation_error') return 'rules.err.validation';
  }
  return 'errors.network';
};

export const RuleCataloguePage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [rows, setRows] = useState<Rule[]>([]);
  const [module, setModule] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (module) query.set('module', module);
      if (status) query.set('status', status);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const response = await apiFetch<{ rules: Rule[] }>(`/api/rules${suffix}`);
      setRows(response.rules);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, [module, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const configured = rows.filter((row) => row.configured).length;
    return { configured, missing: rows.length - configured };
  }, [rows]);

  const startEdit = (rule: Rule) => {
    setEditing(rule);
    setValue(rule.value === null ? '' : String(rule.value));
    setUnit(rule.unit);
    setSource(rule.source_note);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/rules/${encodeURIComponent(editing.code)}`, {
        method: 'PUT',
        body: JSON.stringify({
          value: value === '' ? null : Number(value),
          unit,
          sourceNote: source,
        }),
      });
      setEditing(null);
      await load();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error && rows.length === 0) return <ErrorNote>{t(error)}</ErrorNote>;

  const columns: TableColumn<Rule>[] = [
    { key: 'code', header: t('rules.code') },
    { key: 'module', header: t('rules.module'), render: (row) => t(`rules.module.${row.module}`) },
    {
      key: 'classification',
      header: t('rules.classification'),
      render: (row) => (
        <Badge tone={TONE[row.classification] ?? 'neutral'}>{t(`rules.class.${row.classification}`)}</Badge>
      ),
    },
    {
      key: 'value_display',
      header: t('rules.value'),
      render: (row) =>
        row.configured ? <span>{row.value_display}</span> : <span className="muted">{t('rules.missingReference')}</span>,
    },
    {
      key: 'source_note',
      header: t('rules.source'),
      render: (row) => (row.source_note.trim() ? row.source_note : <span className="muted">{t('rules.missingSource')}</span>),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{t(`rules.status.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'id',
      header: '',
      render: (row) =>
        level >= 5 ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEdit(row)}>
            {t('rules.edit')}
          </button>
        ) : null,
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('rules.title')}
        subtitle={t('rules.subtitle')}
        badge={<Badge tone="purple">{counts.configured}/{rows.length}</Badge>}
      />

      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('rules.module')}</span>
            <select value={module} onChange={(event) => setModule(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {MODULES.map((entry) => (
                <option key={entry} value={entry}>
                  {t(`rules.module.${entry}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('common.status')}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="active">{t('rules.status.active')}</option>
              <option value="retired">{t('rules.status.retired')}</option>
            </select>
          </label>
        </div>
        <p className="info-note info-note--warning">{t('rules.note')}</p>
        {level < 5 ? <p className="muted">{t('rules.readOnly')}</p> : null}
        {error ? <p className="error-note">{t(error)}</p> : null}
      </Card>

      {editing ? (
        <Card
          title={`${t('rules.edit')} · ${editing.code}`}
          subtitle={editing.configured ? undefined : t('rules.missingReference')}
        >
          <div className="filters">
            <label className="field">
              <span>{t('rules.value')}</span>
              <input type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} />
            </label>
            <label className="field">
              <span>{t('rules.unit')}</span>
              <input value={unit} onChange={(event) => setUnit(event.target.value)} />
            </label>
            <label className="field">
              <span>{t('rules.source')}</span>
              <input value={source} onChange={(event) => setSource(event.target.value)} />
            </label>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={saving || source.trim().length === 0}
                onClick={() => void save()}
              >
                {saving ? t('common.loading') : t('common.save')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
          <p className="muted">{t('rules.sourceRequired')}</p>
        </Card>
      ) : null}

      <Card>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} empty={t('rules.empty')} />
      </Card>

      <p className="muted">        {lang === 'ar'
          ? `القواعد المكوّنة: ${counts.configured} · بلا قيمة أو مصدر: ${counts.missing}`
          : `Configured: ${counts.configured} · missing value or source: ${counts.missing}`}
      </p>
    </div>
  );
};
