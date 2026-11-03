import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { BATCH_MATERIALS, type MoistureBasis } from '../core/batching';

/**
 * Moisture entry for a plant's aggregate. The reading carries the window it is valid for;
 * when the window closes within the hour the modal warns before saving, and a reading the
 * server considers expired blocks batch completion instead of being used silently.
 */

interface Props {
  batchId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const NEAR_EXPIRY_MINUTES = 60;

const errorKey = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.status === 422) return 'batches.err.validation';
  }
  return 'errors.network';
};

export const MoistureInputModal = ({ batchId, open, onClose, onSaved }: Props) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const [materialId, setMaterialId] = useState<string>(BATCH_MATERIALS[1]!.id);
  const [basis, setBasis] = useState<MoistureBasis>('dry');
  const [moisturePct, setMoisturePct] = useState('');
  const [absorptionPct, setAbsorptionPct] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    const inTwoHours = new Date(Date.now() + 2 * 3600_000);
    setValidUntil(inTwoHours.toISOString().slice(0, 16));
  }, [open]);

  if (!open) return null;

  const expiresAt = validUntil ? new Date(validUntil).getTime() : Number.NaN;
  const minutesLeft = Number.isNaN(expiresAt) ? null : Math.round((expiresAt - Date.now()) / 60_000);
  const nearExpiry = minutesLeft !== null && minutesLeft >= 0 && minutesLeft <= NEAR_EXPIRY_MINUTES;
  const alreadyExpired = minutesLeft !== null && minutesLeft < 0;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/batches/${encodeURIComponent(batchId)}/moisture`, {
        method: 'POST',
        body: JSON.stringify({
          materialId,
          basis,
          moisturePct: moisturePct === '' ? null : Number(moisturePct),
          absorptionPct: absorptionPct === '' ? null : Number(absorptionPct),
          validUntil: validUntil ? new Date(validUntil).toISOString() : null,
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
      aria-label={t('batches.moisture.title')}
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
            <h2 className="card__title">{t('batches.moisture.title')}</h2>
            <p className="card__subtitle">{t('batches.moisture.subtitle')}</p>
          </div>
        </header>
        <div className="card__body">
          <div className="filters">
            <label className="field field--grow">
              <span>{t('batches.material')}</span>
              <select value={materialId} onChange={(event) => setMaterialId(event.target.value)}>
                {BATCH_MATERIALS.map((material) => (
                  <option key={material.id} value={material.id}>
                    {lang === 'ar' ? material.nameAr : material.nameEn} ({material.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('batches.moisture.basis')}</span>
              <select value={basis} onChange={(event) => setBasis(event.target.value as MoistureBasis)}>
                <option value="dry">{t('batches.moisture.dry')}</option>
                <option value="wet">{t('batches.moisture.wet')}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('batches.moisture.percent')}</span>
              <input
                inputMode="decimal"
                value={moisturePct}
                onChange={(event) => setMoisturePct(event.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('batches.moisture.absorption')}</span>
              <input
                inputMode="decimal"
                value={absorptionPct}
                onChange={(event) => setAbsorptionPct(event.target.value)}
              />
            </label>
            <label className="field field--grow">
              <span>{t('batches.moisture.validUntil')}</span>
              <input
                type="datetime-local"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            </label>
          </div>

          {alreadyExpired ? (
            <p className="info-note info-note--danger">{t('batches.moisture.expired')}</p>
          ) : nearExpiry ? (
            <p className="info-note info-note--warning">{t('batches.moisture.nearExpiry')}</p>
          ) : (
            <p className="muted">{t('batches.moisture.windowNote')}</p>
          )}

          {error ? <p className="error-note">{t(error)}</p> : null}

          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void submit()}
              disabled={saving || !validUntil}
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
