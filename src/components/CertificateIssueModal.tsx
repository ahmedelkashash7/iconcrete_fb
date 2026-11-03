import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../api';

/**
 * Certificate issuance. The confirmation control is disabled whenever the test is not passed and
 * verified, so the mandatory rule is visible rather than discovered after a failed request.
 */

interface Props {
  testId: string;
  status: string;
  verified: boolean;
  open: boolean;
  onClose: () => void;
  onIssued: () => void;
}

export const CertificateIssueModal = ({ testId, status, verified, open, onClose, onIssued }: Props) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  const blocked = status !== 'passed' || !verified;

  const issue = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/quality/tests/${encodeURIComponent(testId)}/certificate`, { method: 'POST' });
      onIssued();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 403) setError('errors.forbidden');
        else if (caught.code === 'mandatory_failure') setError('quality.err.mandatoryFailure');
        else setError('errors.network');
      } else {
        setError('errors.network');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('quality.cert.title')}
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
      <div className="card" style={{ maxWidth: '30rem', width: '100%' }}>
        <header className="card__header">
          <div>
            <h2 className="card__title">{t('quality.cert.title')}</h2>
          </div>
        </header>
        <div className="card__body">
          {blocked ? (
            <p className="info-note info-note--warning">{t('quality.cert.blocked')}</p>
          ) : (
            <p className="muted">{t('quality.cert.confirm')}</p>
          )}
          {error ? <p className="error-note">{t(error)}</p> : null}
          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void issue()}
              disabled={blocked || saving}
            >
              {saving ? t('common.loading') : t('quality.issueCertificate')}
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
