import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { MIN_OVERRIDE_REASON } from '../core/rules';

/**
 * Override evidence for a batching rule.
 *
 * The reason is mandatory and cannot be skipped: the submit button stays disabled below the
 * minimum length, so no override row can exist without it. Approving (as opposed to
 * rejecting) is offered only from level 5; the field is disabled rather than failing after
 * a click.
 */

export interface OverrideRuleOption {
  id: string;
  code: string;
  value_display: string;
  configured: boolean;
}

interface Props {
  batchId: string;
  open: boolean;
  level: number;
  rules: OverrideRuleOption[];
  onClose: () => void;
  onSaved: () => void;
}

const errorKey = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 422) return 'batches.err.validation';
    if (caught.status === 503) return 'common.durableRequired';
  }
  return 'errors.network';
};

export const OverrideModal = ({ batchId, open, level, rules, onClose, onSaved }: Props) => {
  const { t } = useTranslation();
  const [ruleCode, setRuleCode] = useState('');
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setReason('');
    setDecision(level >= 5 ? 'approved' : 'rejected');
    setRuleCode(rules[0]?.code ?? '');
  }, [open, rules, level]);

  if (!open) return null;

  const reasonTooShort = reason.trim().length < MIN_OVERRIDE_REASON;
  const canApprove = level >= 5;
  const rule = rules.find((candidate) => candidate.code === ruleCode) ?? null;

  const submit = async () => {
    if (reasonTooShort || !rule) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/batches/${encodeURIComponent(batchId)}/override`, {
        method: 'POST',
        body: JSON.stringify({
          ruleId: rule.id,
          ruleCode: rule.code,
          entityType: 'batch',
          entityId: batchId,
          reason: reason.trim(),
          decision,
        }),
      });
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('batches.override.title')}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        zIndex: 40,
      }}
    >
      <div className="card" style={{ maxWidth: '34rem', width: '100%' }}>
        <header className="card__header">
          <div>
            <h2 className="card__title">{t('batches.override.title')}</h2>
            <p className="card__subtitle">{t('batches.override.subtitle')}</p>
          </div>
        </header>
        <div className="card__body">
          <div className="filters">
            <label className="field field--grow">
              <span>{t('batches.override.rule')}</span>
              <select value={ruleCode} onChange={(event) => setRuleCode(event.target.value)}>
                {rules.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.code} — {option.value_display}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('batches.override.decision')}</span>
              <select
                value={decision}
                onChange={(event) => setDecision(event.target.value as 'approved' | 'rejected')}
              >
                <option value="approved" disabled={!canApprove}>
                  {t('batches.override.approved')}
                </option>
                <option value="rejected">{t('batches.override.rejected')}</option>
              </select>
            </label>
            <label className="field field--grow">
              <span>{t('batches.override.reason')}</span>
              <textarea
                rows={3}
                value={reason}
                placeholder={t('batches.override.reasonHint')}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>

          {!canApprove ? <p className="info-note">{t('batches.override.approveHint')}</p> : null}
          {reasonTooShort ? (
            <p className="muted">{t('batches.override.reasonRequired')}</p>
          ) : null}
          {error ? <p className="error-note">{t(error)}</p> : null}

          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void submit()}
              disabled={saving || reasonTooShort || !rule || (decision === 'approved' && !canApprove)}
            >
              {saving ? t('common.loading') : t('common.save')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
