import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Card,
  DataTable,
  ErrorNote,
  LoadingBlock,
  SectionTitle,
  type TableColumn,
} from '../components/ui';
import type { Lang } from '../types';
import { fmtMoney } from './salesShared';
import { apiMessage, type AgingRow } from './procurementShared';

const today = () => new Date().toISOString().slice(0, 10);

export const ApAgingReportPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;
  const plantId = user?.assigned_plant_ids?.[0] ?? 'PLT-0001';

  const [rows, setRows] = useState<AgingRow[]>([]);
  const [asOf, setAsOf] = useState(today());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ rows: AgingRow[] }>(
        `/api/procurement/ap-aging?asOf=${encodeURIComponent(asOf)}`,
      );
      setRows(response.rows);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          bucket0To30: sum.bucket0To30 + row.bucket0To30,
          bucket31To60: sum.bucket31To60 + row.bucket31To60,
          bucket61To90: sum.bucket61To90 + row.bucket61To90,
          bucket90Plus: sum.bucket90Plus + row.bucket90Plus,
          totalDue: sum.totalDue + row.totalDue,
        }),
        { bucket0To30: 0, bucket31To60: 0, bucket61To90: 0, bucket90Plus: 0, totalDue: 0 },
      ),
    [rows],
  );

  const snapshot = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/procurement/ap-aging/snapshot', {
        method: 'POST',
        body: JSON.stringify({ plantId, asOf }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumn<AgingRow>[] = [
    {
      key: 'supplier',
      header: t('procurement.supplier'),
      render: (row) => (lang === 'ar' ? row.supplier_name_ar : row.supplier_name_en || row.supplier_name_ar),
    },
    { key: 'code', header: t('procurement.supplierCode'), render: (row) => row.supplier_code || '—' },
    { key: 'b0', header: t('procurement.bucket0To30'), align: 'end', render: (row) => fmtMoney(row.bucket0To30, lang) },
    { key: 'b31', header: t('procurement.bucket31To60'), align: 'end', render: (row) => fmtMoney(row.bucket31To60, lang) },
    { key: 'b61', header: t('procurement.bucket61To90'), align: 'end', render: (row) => fmtMoney(row.bucket61To90, lang) },
    { key: 'b90', header: t('procurement.bucket90Plus'), align: 'end', render: (row) => fmtMoney(row.bucket90Plus, lang) },
    {
      key: 'total',
      header: t('common.total'),
      align: 'end',
      render: (row) => <strong>{fmtMoney(row.totalDue, lang)}</strong>,
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('procurement.agingTitle')}
        subtitle={t('procurement.agingSubtitle')}
        badge={<Badge tone="purple">{rows.length}</Badge>}
      />
      {error ? <ErrorNote>{t(error)}</ErrorNote> : null}
      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('procurement.asOf')}</span>
            <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
          <div className="filters__actions">
            {level >= 3 ? (
              <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void snapshot()}>
                {t('procurement.snapshot')}
              </button>
            ) : null}
          </div>
        </div>
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.supplierId}
            empty={t('common.noData')}
            footer={
              <tr>
                <td colSpan={2}>{t('common.total')}</td>
                <td className="align-end">{fmtMoney(totals.bucket0To30, lang)}</td>
                <td className="align-end">{fmtMoney(totals.bucket31To60, lang)}</td>
                <td className="align-end">{fmtMoney(totals.bucket61To90, lang)}</td>
                <td className="align-end">{fmtMoney(totals.bucket90Plus, lang)}</td>
                <td className="align-end">{fmtMoney(totals.totalDue, lang)}</td>
              </tr>
            }
          />
        )}
      </Card>
    </div>
  );
};
