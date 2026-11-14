import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, StatCard, type BadgeTone } from '../components/ui';
import { DonutChart } from '../components/charts';
import { formatMoney, formatNumber, formatPercent } from '../core/money';
import { useAuth } from '../auth/AuthContext';
import type { Lang } from '../types';

/**
 * M12 — actual cost per m³. Settings are effective-dated master data; batch and report
 * screens are read-only derivations; every screen exposes the incomplete state instead of
 * hiding a missing input behind a zero.
 */

const TONE: Record<string, BadgeTone> = { complete: 'success', incomplete: 'warning' };
const BREAKDOWN_COLORS: Record<string, string> = {
  material: '#6D28D9',
  production: '#0EA5E9',
  transport: '#F59E0B',
  overhead: '#64748B',
};

const message = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 401) return 'errors.unauthorized';
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 404) return 'errors.notFound';
    if (caught.status === 422) return 'cost.err.validation';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.code === 'postgres_required') return 'common.durableRequired';
  }
  return 'errors.network';
};

const money = (value: unknown, lang: Lang): string => formatMoney(Number(value) || 0, lang);
const qty = (value: unknown, lang: Lang): string => formatNumber(Number(value) || 0, lang, 2);
const pct = (value: unknown, lang: Lang): string =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : formatPercent(Number(value), lang);
const iso = (value: unknown): string => String(value ?? '').slice(0, 10);

const DemoBanner = ({ mode }: { mode?: string }) => {
  const { t } = useTranslation();
  if (mode !== 'demo') return null;
  return <InfoNote tone="warning">{t('cost.demoBanner')}</InfoNote>;
};

interface CostSettingRow {
  key: string;
  value: number;
  unit: string;
  effectiveFrom: string;
  isDemo: boolean;
  noteAr: string;
  noteEn: string;
}

interface MaterialPriceRow {
  materialId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  pricePerUnit: number | null;
  baseUnit: string;
  sourceUnit: string | null;
  effectiveFrom: string | null;
  isDemo: boolean;
}

interface SettingsPayload {
  mode: 'demo' | 'real';
  plantId: string;
  asOf: string;
  rows: CostSettingRow[];
  prices: MaterialPriceRow[];
  missingKeys: string[];
}

export const CostSettingsPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await apiFetch<SettingsPayload>('/api/cost/settings');
      setData(response);
      setDraft(Object.fromEntries(response.rows.map((row) => [row.key, String(row.value)])));
      setPriceDraft(
        Object.fromEntries(
          response.prices.map((row) => [row.materialId, row.pricePerUnit === null ? '' : String(row.pricePerUnit)]),
        ),
      );
    } catch (caught) {
      setError(message(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (row: CostSettingRow) => {
    if (!data) return;
    setBusy(row.key);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/api/cost/settings', {
        method: 'POST',
        body: JSON.stringify({
          plantId: data.plantId,
          key: row.key,
          value: Number(draft[row.key]),
          unit: row.unit,
          effectiveFrom,
        }),
      });
      setNotice(t('cost.saved', { key: t(`cost.setting.${row.key}`) }));
      await load();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy('');
    }
  };

  const savePrice = async (row: MaterialPriceRow) => {
    if (!data) return;
    setBusy(`price:${row.materialId}`);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/api/cost/material-prices', {
        method: 'POST',
        body: JSON.stringify({
          plantId: data.plantId,
          materialId: row.materialId,
          pricePerUnit: Number(priceDraft[row.materialId]),
          baseUnit: row.baseUnit,
          effectiveFrom,
        }),
      });
      setNotice(t('cost.priceSaved', { code: row.code }));
      await load();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy('');
    }
  };

  const recompute = async () => {
    setBusy('recompute');
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{ recomputed: { batches: number; trips: number; snapshots: number } }>(
        '/api/cost/recompute',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setNotice(t('cost.recomputed', response.recomputed));
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy('');
    }
  };

  const seed = async () => {
    setBusy('seed');
    setError(null);
    try {
      const response = await apiFetch<{ seeded: { settings: number; prices: number } }>('/api/cost/seed-demo', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice(t('cost.seeded', response.seeded));
      await load();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy('');
    }
  };

  if (error && !data) return <ErrorNote>{t(error)}</ErrorNote>;
  if (!data) return <LoadingBlock label={t('common.loading')} />;

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('cost.settingsTitle')}
        subtitle={t('cost.settingsSubtitle')}
        badge={<Badge tone={data.mode === 'demo' ? 'warning' : 'success'}>{t(`cost.mode.${data.mode}`)}</Badge>}
      />
      <DemoBanner mode={data.mode} />
      {notice ? <InfoNote tone="info">{notice}</InfoNote> : null}
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      {data.missingKeys.length > 0 ? (
        <InfoNote tone="warning">{t('cost.missingSettings', { count: data.missingKeys.length })}</InfoNote>
      ) : null}

      <Card
        title={t('cost.effectiveFrom')}
        actions={
          <div className="filters__actions">
            <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            {level >= 4 ? (
              <button type="button" className="btn btn--primary btn--sm" disabled={busy === 'recompute'} onClick={() => void recompute()}>
                {t('cost.recompute')}
              </button>
            ) : null}
            {level >= 5 ? (
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy === 'seed'} onClick={() => void seed()}>
                {t('cost.seedDemo')}
              </button>
            ) : null}
          </div>
        }
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('cost.settingName')}</th>
              <th className="align-end">{t('cost.value')}</th>
              <th>{t('cost.unit')}</th>
              <th>{t('cost.effectiveFrom')}</th>
              <th>{t('cost.source')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.key}>
                <td>{t(`cost.setting.${row.key}`)}</td>
                <td className="align-end">
                  <input
                    className="input input--compact"
                    type="number"
                    min="0"
                    step="0.0001"
                    value={draft[row.key] ?? ''}
                    disabled={level < 4}
                    onChange={(event) => setDraft({ ...draft, [row.key]: event.target.value })}
                  />
                </td>
                <td>{row.unit}</td>
                <td>{iso(row.effectiveFrom)}</td>
                <td>
                  {row.isDemo ? <Badge tone="warning">{t('cost.demo')}</Badge> : <Badge tone="success">{t('cost.real')}</Badge>}
                  <div className="muted small">{lang === 'ar' ? row.noteAr : row.noteEn}</div>
                </td>
                <td className="align-end">
                  {level >= 4 ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy === row.key}
                      onClick={() => void save(row)}
                    >
                      {t('common.save')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={t('cost.materialPrices')} subtitle={t('cost.materialPricesNote')}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('cost.materialCode')}</th>
              <th>{t('cost.material')}</th>
              <th className="align-end">{t('cost.price')}</th>
              <th>{t('cost.baseUnit')}</th>
              <th>{t('cost.source')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.prices.map((row) => (
              <tr key={row.materialId}>
                <td>{row.code}</td>
                <td>{lang === 'ar' ? row.nameAr : row.nameEn}</td>
                <td className="align-end">
                  <input
                    className="input input--compact"
                    type="number"
                    min="0"
                    step="0.0001"
                    placeholder={t('cost.noPrice')}
                    value={priceDraft[row.materialId] ?? ''}
                    disabled={level < 4}
                    onChange={(event) => setPriceDraft({ ...priceDraft, [row.materialId]: event.target.value })}
                  />
                </td>
                <td>{row.baseUnit}</td>
                <td>
                  {row.pricePerUnit === null ? (
                    <Badge tone="danger">{t('cost.missingPrice')}</Badge>
                  ) : row.isDemo ? (
                    <Badge tone="warning">{t('cost.demo')}</Badge>
                  ) : (
                    <Badge tone="success">{t('cost.real')}</Badge>
                  )}
                  {row.effectiveFrom ? <div className="muted small">{row.effectiveFrom}{row.sourceUnit ? ` · ${row.sourceUnit}` : ''}</div> : null}
                </td>
                <td className="align-end">
                  {level >= 4 ? (
                    <button type="button" className="btn btn--ghost btn--sm" disabled={busy === `price:${row.materialId}`} onClick={() => void savePrice(row)}>
                      {t('common.save')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

interface BatchRow {
  batch_id: string;
  batch_no: string;
  plant_id: string;
  billed_m3: string;
  total_weight_kg: string;
  yield_m3: string;
  yield_variance_pct: string | null;
  yield_flagged: boolean;
  material_cost: string;
  moisture_adjustment: string;
  production_cost: string;
  overhead_cost: string;
  total_cost: string;
  cost_per_m3: string | null;
  revenue: string;
  revenue_per_m3: string | null;
  margin_per_m3: string | null;
  status: 'complete' | 'incomplete';
  missing_fields: string[];
  batch_status: string;
  order_no: string | null;
  mix_code: string | null;
  mix_name_ar: string | null;
  mix_name_en: string | null;
  produced_at: string | null;
  lines?: BatchLine[];
}

interface BatchLine {
  id: string;
  line_type: string;
  material_code: string | null;
  material_name_ar: string | null;
  material_name_en: string | null;
  measured_qty: string | null;
  theoretical_qty: string | null;
  actual_qty: string | null;
  unit: string;
  unit_price: string | null;
  cost_egp: string;
  moisture_pct: string;
  variance_pct: string | null;
  is_incomplete: boolean;
  missing_reason: string;
}

export const CostBatchesPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [selected, setSelected] = useState<BatchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const response = await apiFetch<{ batches: BatchRow[] }>(`/api/cost/batches?${params.toString()}`);
      setRows(response.batches);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (row: BatchRow) => {
    setError(null);
    try {
      const response = await apiFetch<{ batch: BatchRow }>(`/api/cost/batches/${encodeURIComponent(row.batch_id)}`);
      setSelected(response.batch);
    } catch (caught) {
      setError(message(caught));
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error && rows.length === 0) return <ErrorNote>{t(error)}</ErrorNote>;

  const columns = [
    { key: 'batch_no', header: t('cost.batchNo'), render: (row: BatchRow) => row.batch_no },
    { key: 'mix', header: t('cost.mix'), render: (row: BatchRow) => row.mix_code ?? '—' },
    { key: 'm3', header: t('cost.m3'), align: 'end' as const, render: (row: BatchRow) => qty(row.billed_m3, lang) },
    { key: 'cost', header: t('cost.costPerM3'), align: 'end' as const, render: (row: BatchRow) => money(row.cost_per_m3, lang) },
    { key: 'revenue', header: t('cost.revenuePerM3'), align: 'end' as const, render: (row: BatchRow) => money(row.revenue_per_m3, lang) },
    {
      key: 'margin',
      header: t('cost.marginPerM3'),
      align: 'end' as const,
      render: (row: BatchRow) => (
        <strong className={Number(row.margin_per_m3) < 0 ? 'text-danger' : ''}>{money(row.margin_per_m3, lang)}</strong>
      ),
    },
    { key: 'yield', header: t('cost.yieldVariance'), align: 'end' as const, render: (row: BatchRow) => pct(row.yield_variance_pct, lang) },
    {
      key: 'status',
      header: t('cost.status'),
      render: (row: BatchRow) => (
        <>
          <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`cost.state.${row.status}`)}</Badge>
          {row.yield_flagged ? <Badge tone="warning">{t('cost.yieldFlag')}</Badge> : null}
        </>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle title={t('cost.batchesTitle')} subtitle={t('cost.batchesSubtitle')} badge={<Badge tone="purple">{rows.length}</Badge>} />
      <Card>
        <div className="filters">
          <label className="field"><span>{t('cost.from')}</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field"><span>{t('cost.to')}</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.batch_id} empty={t('cost.noBatches')} />
        <div className="filters__actions">
          {rows.slice(0, 8).map((row) => (
            <button key={row.batch_id} type="button" className="btn btn--ghost btn--sm" onClick={() => void open(row)}>
              {row.batch_no}
            </button>
          ))}
        </div>
      </Card>

      {selected ? <BatchDetail batch={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
};

const BatchDetail = ({ batch, onClose }: { batch: BatchRow; onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const lines = batch.lines ?? [];
  return (
    <Card
      title={`${t('cost.batchDetail')} · ${batch.batch_no}`}
      actions={<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>{t('common.close')}</button>}
    >
      <div className="stats-grid">
        <StatCard label={t('cost.totalCost')} value={money(batch.total_cost, lang)} tone="danger" />
        <StatCard label={t('cost.costPerM3')} value={money(batch.cost_per_m3, lang)} />
        <StatCard label={t('cost.revenuePerM3')} value={money(batch.revenue_per_m3, lang)} tone="success" />
        <StatCard label={t('cost.marginPerM3')} value={money(batch.margin_per_m3, lang)} tone={Number(batch.margin_per_m3) < 0 ? 'danger' : 'success'} />
      </div>
      {batch.status === 'incomplete' ? (
        <InfoNote tone="warning">{t('cost.incompleteFields', { fields: batch.missing_fields.join(', ') || '—' })}</InfoNote>
      ) : null}
      {batch.yield_flagged ? <InfoNote tone="warning">{t('cost.yieldFlagNote')}</InfoNote> : null}
      <p className="muted">
        {t('cost.yieldLine', { yield: qty(batch.yield_m3, lang), weight: qty(batch.total_weight_kg, lang), variance: pct(batch.yield_variance_pct, lang) })}
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('cost.line')}</th>
            <th>{t('cost.material')}</th>
            <th className="align-end">{t('cost.measured')}</th>
            <th className="align-end">{t('cost.theoretical')}</th>
            <th className="align-end">{t('cost.variance')}</th>
            <th className="align-end">{t('cost.unitPrice')}</th>
            <th className="align-end">{t('cost.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{t(`cost.lineType.${line.line_type}`)}</td>
              <td>
                {line.material_code ?? '—'}
                <div className="muted small">
                  {line.is_incomplete ? t('cost.incompleteLine', { reason: line.missing_reason }) : ''}
                </div>
              </td>
              <td className="align-end">{line.measured_qty === null ? '—' : `${qty(line.measured_qty, lang)} ${line.unit}`}</td>
              <td className="align-end">{line.theoretical_qty === null ? '—' : `${qty(line.theoretical_qty, lang)} ${line.unit}`}</td>
              <td className="align-end">{pct(line.variance_pct, lang)}</td>
              <td className="align-end">{line.unit_price === null ? '—' : money(line.unit_price, lang)}</td>
              <td className="align-end">{money(line.cost_egp, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t('cost.waterUnitNote')}</p>
    </Card>
  );
};

interface ReportRow {
  dimension_id: string;
  customer_name_ar: string | null;
  customer_name_en: string | null;
  mix_code: string | null;
  mix_name_ar: string | null;
  mix_name_en: string | null;
  revenue: string;
  cost: string;
  m3: string;
  margin: string;
  margin_pct: string | null;
  status: string;
  period_start: string;
}

const DIMENSIONS = ['order', 'customer', 'mix', 'plant', 'month'] as const;

export const CostReportPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [dimension, setDimension] = useState<(typeof DIMENSIONS)[number]>('order');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dimension });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const response = await apiFetch<{ rows: ReportRow[] }>(`/api/cost/report?${params.toString()}`);
      setRows(response.rows);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, [dimension, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (row: ReportRow): string => {
    if (dimension === 'customer') return (lang === 'ar' ? row.customer_name_ar : row.customer_name_en) || row.dimension_id;
    if (dimension === 'mix') return row.mix_code || row.dimension_id;
    return row.dimension_id;
  };

  const exportCsv = () => {
    const header = ['dimension', 'id', 'period', 'revenue_egp', 'cost_egp', 'm3', 'margin_egp', 'margin_pct', 'status'];
    const body = rows.map((row) => [
      dimension,
      label(row),
      iso(row.period_start),
      row.revenue,
      row.cost,
      row.m3,
      row.margin,
      row.margin_pct ?? '',
      row.status,
    ]);
    const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cost-${dimension}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  const columns = [
    { key: 'name', header: t(`cost.dimension.${dimension}`), render: (row: ReportRow) => label(row) },
    { key: 'period', header: t('cost.period'), render: (row: ReportRow) => iso(row.period_start) },
    { key: 'revenue', header: t('cost.revenue'), align: 'end' as const, render: (row: ReportRow) => money(row.revenue, lang) },
    { key: 'cost', header: t('cost.totalCost'), align: 'end' as const, render: (row: ReportRow) => money(row.cost, lang) },
    { key: 'm3', header: t('cost.m3'), align: 'end' as const, render: (row: ReportRow) => qty(row.m3, lang) },
    { key: 'perM3', header: t('cost.costPerM3'), align: 'end' as const, render: (row: ReportRow) => money(Number(row.cost) / Math.max(Number(row.m3), 1), lang) },
    {
      key: 'margin',
      header: t('cost.marginPerM3'),
      align: 'end' as const,
      render: (row: ReportRow) => (
        <strong className={Number(row.margin) < 0 ? 'text-danger' : ''}>
          {money(Number(row.margin) / Math.max(Number(row.m3), 1), lang)}
        </strong>
      ),
    },
    { key: 'marginPct', header: t('cost.marginPct'), align: 'end' as const, render: (row: ReportRow) => pct(row.margin_pct, lang) },
    { key: 'status', header: t('cost.status'), render: (row: ReportRow) => <Badge tone={TONE[row.status] ?? 'neutral'}>{t(`cost.state.${row.status}`)}</Badge> },
  ];

  return (
    <div className="page-stack">
      <SectionTitle title={t('cost.reportTitle')} subtitle={t('cost.reportSubtitle')} badge={<Badge tone="purple">{rows.length}</Badge>} />
      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('cost.dimensionLabel')}</span>
            <select value={dimension} onChange={(event) => setDimension(event.target.value as (typeof DIMENSIONS)[number])}>
              {DIMENSIONS.map((value) => <option key={value} value={value}>{t(`cost.dimension.${value}`)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('cost.from')}</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field"><span>{t('cost.to')}</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <div className="filters__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv}>{t('cost.export')}</button>
          </div>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(row) => `${row.dimension_id}-${row.period_start}`} empty={t('cost.noRows')} />
      </Card>
    </div>
  );
};

interface DashboardPayload {
  period: string;
  mode: string;
  kpis: {
    revenue: number;
    cost: number;
    margin: number;
    marginPct: number | null;
    m3: number;
    costPerM3: number | null;
    revenuePerM3: number | null;
    marginPerM3: number | null;
  };
  breakdown: Array<{ key: string; value: number; perM3: number }>;
  topLoss: Array<{ dimension_id: string; order_no: string | null; customer_name_ar: string | null; customer_name_en: string | null; margin: string; margin_pct: string | null; revenue: string; cost: string; m3: string }>;
  variances: Array<{ material_id: string; material_code: string; name_ar: string; name_en: string; avg_abs_variance_pct: string; lines: string }>;
}

export const CostDashboardPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<DashboardPayload>(`/api/cost/dashboard?month=${encodeURIComponent(month)}`));
    } catch (caught) {
      setError(message(caught));
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartPoints = useMemo(
    () => (data?.breakdown ?? []).map((item) => ({
      label: t(`cost.breakdown.${item.key}`),
      value: item.value,
      color: BREAKDOWN_COLORS[item.key],
    })),
    [data, t],
  );

  if (error) return <ErrorNote>{t(error)}</ErrorNote>;
  if (!data) return <LoadingBlock label={t('common.loading')} />;

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('cost.dashboardTitle')}
        subtitle={t('cost.dashboardSubtitle')}
        badge={<Badge tone="purple">{iso(data.period)}</Badge>}
      />
      <DemoBanner mode={data.mode} />
      <Card>
        <label className="field">
          <span>{t('cost.month')}</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </Card>

      <div className="stats-grid">
        <StatCard label={t('cost.revenue')} value={money(data.kpis.revenue, lang)} tone="success" />
        <StatCard label={t('cost.totalCost')} value={money(data.kpis.cost, lang)} tone="danger" />
        <StatCard label={t('cost.margin')} value={money(data.kpis.margin, lang)} tone={data.kpis.margin < 0 ? 'danger' : 'success'} hint={pct(data.kpis.marginPct, lang)} />
        <StatCard label={t('cost.costPerM3')} value={money(data.kpis.costPerM3, lang)} hint={`${qty(data.kpis.m3, lang)} m³`} />
        <StatCard label={t('cost.marginPerM3')} value={money(data.kpis.marginPerM3, lang)} tone={Number(data.kpis.marginPerM3) < 0 ? 'danger' : 'success'} />
      </div>

      <div className="grid grid--2">
        <Card title={t('cost.breakdownTitle')}>
          {chartPoints.length > 0 ? <DonutChart points={chartPoints} lang={lang} /> : <p className="muted">{t('cost.noRows')}</p>}
          <table className="data-table">
            <tbody>
              {data.breakdown.map((item) => (
                <tr key={item.key}>
                  <th className="align-start">{t(`cost.breakdown.${item.key}`)}</th>
                  <td className="align-end">{money(item.value, lang)}</td>
                  <td className="align-end">{money(item.perM3, lang)} /m³</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={t('cost.topLossTitle')}>
          <table className="data-table">
            <thead>
              <tr><th>{t('cost.order')}</th><th className="align-end">{t('cost.margin')}</th><th className="align-end">{t('cost.marginPct')}</th></tr>
            </thead>
            <tbody>
              {data.topLoss.map((row) => (
                <tr key={row.dimension_id}>
                  <td>
                    {row.order_no ?? row.dimension_id}
                    <div className="muted small">{(lang === 'ar' ? row.customer_name_ar : row.customer_name_en) ?? ''}</div>
                  </td>
                  <td className={`align-end ${Number(row.margin) < 0 ? 'text-danger' : ''}`}>{money(row.margin, lang)}</td>
                  <td className="align-end">{pct(row.margin_pct, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={t('cost.variancesTitle')}>
        <table className="data-table">
          <thead>
            <tr><th>{t('cost.material')}</th><th className="align-end">{t('cost.avgVariance')}</th><th className="align-end">{t('cost.lines')}</th></tr>
          </thead>
          <tbody>
            {data.variances.map((row) => (
              <tr key={row.material_id}>
                <td>{row.material_code}<div className="muted small">{lang === 'ar' ? row.name_ar : row.name_en}</div></td>
                <td className="align-end">{formatPercent(Number(row.avg_abs_variance_pct), lang)}</td>
                <td className="align-end">{row.lines}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t('cost.varianceNote')}</p>
      </Card>
    </div>
  );
};
