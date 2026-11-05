import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { Badge, ErrorNote } from '../components/ui';
import { apiMessage } from './procurementShared';

interface Props {
  supplierId: string;
  plantId: string;
  threshold: number;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Four scores, a deterministic grade preview and the required 0–100 bounds. */
export const SupplierEvaluationForm = ({ supplierId, plantId, threshold, onSaved, onCancel }: Props) => {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    periodStart: `${new Date().getFullYear()}-01-01`,
    periodEnd: today(),
    quality: '80',
    delivery: '80',
    price: '80',
    responsiveness: '80',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scores = {
    quality: Number(form.quality),
    delivery: Number(form.delivery),
    price: Number(form.price),
    responsiveness: Number(form.responsiveness),
  };
  const preview = useMemo(() => {
    const values = Object.values(scores);
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
      return null;
    }
    const average = Math.round((values.reduce((sum, value) => sum + value, 0) / 4) * 100) / 100;
    if (values.some((value) => value < threshold)) return { average, grade: 'D' };
    return {
      average,
      grade: average >= 90 ? 'A' : average >= 80 ? 'B' : average >= 70 ? 'C' : 'D',
    };
  }, [scores, threshold]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!preview) throw new Error('score');
      await apiFetch('/api/procurement/evaluations', {
        method: 'POST',
        body: JSON.stringify({
          plantId,
          supplierId,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          ...scores,
          notes: form.notes,
        }),
      });
      await onSaved();
      onCancel();
    } catch (caught) {
      setError(caught instanceof Error && caught.message === 'score'
        ? 'procurement.err.scoreRange'
        : apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card--pad">
      <h3>{t('procurement.newEvaluation')}</h3>
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      <div className="form-grid">
        <label className="field">
          <span>{t('procurement.periodStart')}</span>
          <input type="date" value={form.periodStart} onChange={(event) => setForm({ ...form, periodStart: event.target.value })} />
        </label>
        <label className="field">
          <span>{t('procurement.periodEnd')}</span>
          <input type="date" value={form.periodEnd} onChange={(event) => setForm({ ...form, periodEnd: event.target.value })} />
        </label>
        {(['quality', 'delivery', 'price', 'responsiveness'] as const).map((key) => (
          <label className="field" key={key}>
            <span>{t(`procurement.${key}`)}</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
          </label>
        ))}
        <label className="field">
          <span>{t('procurement.threshold')}</span>
          <input type="text" value={threshold} readOnly />
        </label>
      </div>
      <label className="field">
        <span>{t('common.notes')}</span>
        <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
      </label>
      <div className="inline-actions">
        <Badge tone={preview?.grade === 'D' ? 'danger' : preview ? 'success' : 'warning'}>
          {t('procurement.gradePreview')}: {preview ? `${preview.grade} · ${preview.average}` : '—'}
        </Badge>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy || !preview} onClick={() => void save()}>
          {t('common.save')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
};
