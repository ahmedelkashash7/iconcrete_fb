import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, StatCard, type BadgeTone } from '../components/ui';
import { DonutChart, TrendLine } from '../components/charts';
import { formatMoney, formatNumber, formatPercent } from '../core/money';
import type { GeneralBalance } from '../core/balance';
import type { DashboardAlert, DashboardKpis } from '../core/metrics';
import type { PageKey } from '../core/rbac';
import { formatCellValue, formatIsoDate } from '../lib/display';
import type { Lang, QualityTest } from '../types';

interface DashboardResponse {
  kpis: DashboardKpis;
  balance: GeneralBalance | null;
  balanceRestricted: boolean;
  alerts: DashboardAlert[];
  qualityTests: QualityTest[];
  series: Array<{ month: string; revenue: number; volume: number }>;
  company: { name_ar: string; name_en: string };
  plants: Array<{ id: string; name_ar: string; name_en: string; capacity_m3_per_hour: number }>;
  generatedAt: string;
}

const severityTone: Record<DashboardAlert['severity'], BadgeTone> = {
  danger: 'danger',
  warning: 'warning',
  info: 'info',
};

export const DashboardPage = ({ onNavigate }: { onNavigate: (page: PageKey) => void }) => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<DashboardResponse>('/api/dashboard')
      .then((response) => {
        if (active) setData(response);
      })
      .catch(() => {
        if (active) setError('errors.network');
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <ErrorNote>{t(error)}</ErrorNote>;
  if (!data) return <LoadingBlock label={t('common.loading')} />;

  const { kpis, balance, balanceRestricted } = data;

  const debitPoints = (balance?.debit ?? []).map((line) => ({ label: t(line.labelKey), value: line.amount }));
  const creditPoints = (balance?.credit ?? []).map((line) => ({ label: t(line.labelKey), value: line.amount }));
  const revenuePoints = data.series.map((point) => ({ label: point.month, value: point.revenue }));
  const qualityPoints = data.qualityTests
    .slice()
    .reverse()
    .map((test) => ({ label: test.batch_no.slice(-5), value: test.strength_7d_mpa }));

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        badge={<Badge tone="purple">{lang === 'ar' ? data.company.name_ar : data.company.name_en}</Badge>}
      />

      <div className="kpi-grid">
        <StatCard label={t('dashboard.kpi.producedToday')} value={`${formatNumber(kpis.producedTodayM3, lang, 1)} ${t('dashboard.unitM3')}`} tone="purple" hint={`${kpis.pendingBatches} ${t('dashboard.kpi.pendingBatches')}`} />
        <StatCard label={t('dashboard.kpi.rejectedToday')} value={`${formatNumber(kpis.rejectedTodayM3, lang, 2)} ${t('dashboard.unitM3')}`} tone={kpis.rejectedTodayM3 > 0 ? 'danger' : 'success'} />
        <StatCard label={t('dashboard.kpi.activeTrucks')} value={`${kpis.activeTrucks} / ${kpis.totalTrucks}`} tone="neutral" />
        <StatCard label={t('dashboard.kpi.onTime')} value={formatPercent(kpis.onTimeDeliveryPct, lang)} tone={kpis.onTimeDeliveryPct >= 90 ? 'success' : 'warning'} />
        <StatCard label={t('dashboard.kpi.avgStrength')} value={`${formatNumber(kpis.avg7dStrengthMpa, lang, 1)} ${t('dashboard.unitMpa')}`} tone="neutral" hint={t('dashboard.last7days')} />
        <StatCard label={t('dashboard.kpi.overdue')} value={formatMoney(kpis.overdueReceivables, lang)} tone={kpis.overdueReceivables > 0 ? 'danger' : 'success'} />
        <StatCard label={t('dashboard.kpi.lowStock')} value={formatNumber(kpis.lowStockCount, lang, 0)} tone={kpis.lowStockCount > 0 ? 'warning' : 'success'} />
        <StatCard label={t('dashboard.kpi.creditUtilization')} value={formatPercent(kpis.creditUtilizationPct, lang)} tone="neutral" />
      </div>

      <Card
        title={t('dashboard.balanceTitle')}
        subtitle={t('dashboard.balanceSubtitle')}
        actions={<span className="muted mono">{t('dashboard.asOf')}: {formatIsoDate(data.generatedAt, lang)}</span>}
      >
        {balanceRestricted || !balance ? (
          <InfoNote tone="warning">{t('dashboard.balanceRestricted')}</InfoNote>
        ) : (
          <>
            <div className="balance-grid">
              <div className="balance-col">
                <div className="balance-col__head balance-col__head--debit">
                  <span>{t('dashboard.debitSide')}</span>
                  <strong>{formatMoney(balance.debitTotal, lang)}</strong>
                </div>
                <ul className="balance-list">
                  {balance.debit.map((line) => (
                    <li key={line.key}>
                      <button type="button" className="balance-line" onClick={() => onNavigate('reports')} title={t('dashboard.drillHint')}>
                        <span className="balance-line__label">{t(line.labelKey)}</span>
                        <span className="balance-line__meta">{line.count} · {line.source}</span>
                        <span className="balance-line__value">{formatMoney(line.amount, lang)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="net-card">
                <span className="net-card__label">{t('dashboard.net')}</span>
                <strong className={`net-card__value ${balance.isProfit ? 'is-profit' : 'is-loss'}`}>
                  {formatMoney(balance.net, lang)}
                </strong>
                <Badge tone={balance.isProfit ? 'success' : 'danger'}>
                  {balance.isProfit ? t('dashboard.netProfit') : t('dashboard.netLoss')}
                </Badge>
                <div className="net-card__mini">
                  <span>{t('dashboard.debitSide')}: {formatMoney(balance.debitTotal, lang)}</span>
                  <span>{t('dashboard.creditSide')}: {formatMoney(balance.creditTotal, lang)}</span>
                </div>
              </div>

              <div className="balance-col">
                <div className="balance-col__head balance-col__head--credit">
                  <span>{t('dashboard.creditSide')}</span>
                  <strong>{formatMoney(balance.creditTotal, lang)}</strong>
                </div>
                <ul className="balance-list">
                  {balance.credit.map((line) => (
                    <li key={line.key}>
                      <button type="button" className="balance-line" onClick={() => onNavigate('reports')} title={t('dashboard.drillHint')}>
                        <span className="balance-line__label">{t(line.labelKey)}</span>
                        <span className="balance-line__meta">{line.count} · {line.source}</span>
                        <span className="balance-line__value">{formatMoney(line.amount, lang)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="muted small">{t('dashboard.drillHint')} · {t('common.secureNote')}</p>
          </>
        )}
      </Card>

      <div className="charts-grid">
        <Card title={t('dashboard.debitMix')} subtitle={t('dashboard.chartsSubtitle')}>
          {balance ? <DonutChart points={debitPoints} lang={lang} /> : <div className="empty-state">{t('dashboard.balanceRestricted')}</div>}
        </Card>
        <Card title={t('dashboard.revenueTrend')} subtitle={t('dashboard.chartsSubtitle')}>
          <TrendLine points={revenuePoints} lang={lang} currency color="#6D28D9" />
        </Card>
        <Card title={t('dashboard.qualityTrend')} subtitle={t('dashboard.qualitySubtitle')}>
          <TrendLine points={qualityPoints} lang={lang} color="#16A34A" unit={t('dashboard.unitMpa')} />
        </Card>
        <Card title={t('dashboard.creditMix')} subtitle={t('dashboard.chartsSubtitle')}>
          {balance ? <DonutChart points={creditPoints} lang={lang} /> : <div className="empty-state">{t('dashboard.balanceRestricted')}</div>}
        </Card>
      </div>

      <div className="two-col">
        <Card title={t('dashboard.alertTitle')}>
          {data.alerts.length === 0 ? (
            <div className="empty-state">{t('dashboard.alertEmpty')}</div>
          ) : (
            <ul className="alert-list">
              {data.alerts.map((alert) => (
                <li key={alert.id} className={`alert-item alert-item--${alert.severity}`}>
                  <Badge tone={severityTone[alert.severity]}>{alert.severity}</Badge>
                  <span>{t(alert.labelKey, alert.values)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('dashboard.qualityTitle')} subtitle={t('dashboard.qualitySubtitle')}>
          <DataTable
            dense
            rows={data.qualityTests}
            rowKey={(row) => row.id}
            empty={t('common.noData')}
            columns={[
              { key: 'batch_no', header: t('dashboard.table.batch'), render: (row) => <span className="mono">{row.batch_no}</span> },
              { key: 'mix_code', header: t('dashboard.table.mix') },
              { key: 'tested_at', header: t('dashboard.table.testedAt'), render: (row) => formatIsoDate(row.tested_at, lang) },
              { key: 'slump_mm', header: t('dashboard.table.slump'), align: 'end', render: (row) => formatCellValue(row.slump_mm, 'number', lang) },
              {
                key: 'strength_7d_mpa',
                header: t('dashboard.table.strength'),
                align: 'end',
                render: (row) => `${formatCellValue(row.strength_7d_mpa, 'number', lang)} / ${row.fck_mpa}`,
              },
              { key: 'temperature_c', header: t('dashboard.table.temp'), align: 'end', render: (row) => formatCellValue(row.temperature_c, 'number', lang) },
              {
                key: 'result',
                header: t('dashboard.table.result'),
                render: (row) => (
                  <Badge tone={row.result === 'pass' ? 'success' : 'danger'}>
                    {row.result === 'pass' ? t('dashboard.result.pass') : t('dashboard.result.fail')}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
};
