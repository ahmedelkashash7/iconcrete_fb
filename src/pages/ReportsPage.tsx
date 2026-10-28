import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError, downloadFile } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle } from '../components/ui';
import { defaultReportRange, REPORT_TYPES, type ReportResult, type ReportType } from '../core/reports';
import { formatCellValue } from '../lib/display';
import { useAuth } from '../auth/AuthContext';
import type { Lang } from '../types';

interface CustomerOption {
  id: string;
  name_ar: string;
  name_en: string;
}

interface ReportResponse {
  report: ReportResult;
  canExport: boolean;
}

export const ReportsPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const range = useMemo(defaultReportRange, []);

  const [type, setType] = useState<ReportType>('general_balance');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if ((user?.role_level ?? 1) < 4) return;
    apiFetch<{ customers: CustomerOption[] }>('/api/customers')
      .then((response) => setCustomers(response.customers))
      .catch(() => setCustomers([]));
  }, [user?.role_level]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    if (type === 'customer_statement' && customerId) params.set('customerId', customerId);
    return params.toString();
  }, [from, to, type, customerId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<ReportResponse>(`/api/reports/${type}?${query}`)
      .then((response) => {
        if (!active) return;
        setReport(response.report);
        setCanExport(response.canExport);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError && caught.status === 403 ? 'errors.forbidden' : 'errors.network');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [type, query]);

  const exportExcel = async () => {
    setExportError(null);
    try {
      await downloadFile(
        `/api/export/reports/${type}?${query}&lang=${lang}`,
        `ICONCRETE_${type}_${Date.now()}.xlsx`,
      );
    } catch {
      setExportError('report.exportError');
    }
  };

  const displayValue = (key: string, raw: string | number | undefined, format: string): string => {
    if (typeof raw === 'string' && (key === 'item' || key === 'sideLabelKey')) {
      return t(raw);
    }
    return formatCellValue(raw, format as 'text' | 'money' | 'number' | 'date' | 'percent', lang);
  };

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('report.title')}
        subtitle={t('report.subtitle')}
        badge={<Badge tone="purple">{t('report.filters')}</Badge>}
      />

      <Card className="no-print">
        <div className="filters">
          <label className="field">
            <span>{t('report.type')}</span>
            <select value={type} onChange={(event) => setType(event.target.value as ReportType)}>
              {REPORT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {t(`report.type.${option === 'general_balance' ? 'generalBalance' : option === 'customer_statement' ? 'customerStatement' : option === 'supplier_statement' ? 'supplierStatement' : option === 'sales_period' ? 'salesPeriod' : option === 'cash_movement' ? 'cashMovement' : option === 'production_period' ? 'productionPeriod' : 'inventory'}`)}
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

          {type === 'customer_statement' ? (
            <label className="field">
              <span>{t('report.customer')}</span>
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={customers.length === 0}>
                <option value="">{t('report.allCustomers')}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {lang === 'ar' ? customer.name_ar : customer.name_en}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="filters__actions">
            <button type="button" className="btn btn--ghost" onClick={() => window.print()}>
              {t('report.print')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => window.print()} title={t('report.printHint')}>
              {t('report.exportPdf')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void exportExcel()}
              disabled={!canExport}
              title={canExport ? t('report.exportExcel') : t('report.exportBlocked')}
            >
              {t('report.exportExcel')}
            </button>
          </div>
        </div>
        {!canExport ? <InfoNote tone="warning">{t('report.exportBlocked')}</InfoNote> : null}
        {exportError ? <InfoNote tone="danger">{t(exportError)}</InfoNote> : null}
        <p className="muted small">{t('report.printHint')}</p>
      </Card>

      <Card
        title={report ? t(report.titleKey) : t('report.title')}
        subtitle={report ? `${t('report.rows')}: ${report.meta.rowCount} · ${t('report.generatedAt')} ${report.meta.generatedAt.slice(0, 19).replace('T', ' ')}` : undefined}
      >
        {loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : error ? (
          <ErrorNote>{t(error)}</ErrorNote>
        ) : report && report.columns.length > 0 ? (
          <>
            <DataTable
              dense
              rows={report.rows}
              rowKey={(row, index) => `${index}-${String(row.document ?? row.item ?? index)}`}
              empty={t('report.empty')}
              columns={report.columns.map((column) => ({
                key: column.key,
                header: t(column.labelKey),
                align: column.align,
                render: (row: Record<string, string | number>) => displayValue(column.key, row[column.key], column.format),
              }))}
              footer={
                Object.keys(report.totals).length > 0 ? (
                  <tr>
                    {report.columns.map((column, index) => {
                      const total = report.totals[column.key];
                      return (
                        <td key={column.key} className={`align-${column.align}`}>
                          {index === 0 ? (
                            <strong>{t('report.totals')}</strong>
                          ) : total !== undefined ? (
                            <strong>{formatCellValue(total, column.format, lang)}</strong>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ) : undefined
              }
            />
            <p className="muted small">
              {t('common.from')} {report.meta.from} — {t('common.to')} {report.meta.to}
            </p>
          </>
        ) : (
          <div className="empty-state">{t('report.empty')}</div>
        )}
      </Card>
    </div>
  );
};
