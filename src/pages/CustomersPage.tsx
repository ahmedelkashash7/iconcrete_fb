import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError, downloadFile } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone } from '../components/ui';
import { formatCellValue } from '../lib/display';
import type { Customer, Lang } from '../types';

interface CustomerRow extends Customer {
  plant_ar: string;
  plant_en: string;
  outstanding_amount: number;
  available_credit: number;
}

const statusTone: Record<string, BadgeTone> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral',
};

export const CustomersPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<{ customers: CustomerRow[] }>('/api/customers')
      .then((response) => {
        if (active) setRows(response.customers);
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
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.id, row.name_ar, row.name_en, row.phone, row.tax_id].some((value) =>
        value.toLowerCase().includes(term),
      ),
    );
  }, [rows, search]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadFile(`/api/export/customers.xlsx?lang=${lang}`, `ICONCRETE_customers_${Date.now()}.xlsx`);
    } catch {
      setError('report.exportError');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('customers.title')}
        subtitle={t('customers.subtitle')}
        badge={<Badge tone="purple">{filtered.length} {t('customers.count')}</Badge>}
      />

      <Card
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void exportExcel()} disabled={exporting}>
            {t('customers.export')}
          </button>
        }
      >
        <div className="filters filters--compact">
          <label className="field field--grow">
            <span>{t('common.search')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('customers.search')}
            />
          </label>
        </div>

        <DataTable
          dense
          rows={filtered}
          rowKey={(row) => row.id}
          empty={t('customers.noResults')}
          columns={[
            { key: 'id', header: t('customers.id'), render: (row) => <span className="mono">{row.id}</span> },
            {
              key: 'name',
              header: t('customers.name'),
              render: (row) => (
                <div className="cell-stack">
                  <strong>{lang === 'ar' ? row.name_ar : row.name_en}</strong>
                  <span className="muted small">{lang === 'ar' ? row.name_en : row.name_ar}</span>
                </div>
              ),
            },
            { key: 'plant', header: t('customers.plant'), render: (row) => (lang === 'ar' ? row.plant_ar : row.plant_en) },
            { key: 'tier', header: t('customers.tier'), align: 'end' },
            { key: 'credit_limit_egp', header: t('customers.creditLimit'), align: 'end', render: (row) => formatCellValue(row.credit_limit_egp, 'money', lang) },
            {
              key: 'outstanding',
              header: t('customers.creditUsed'),
              align: 'end',
              render: (row) => formatCellValue(row.outstanding_amount, 'money', lang),
            },
            {
              key: 'available',
              header: t('customers.available'),
              align: 'end',
              render: (row) => {
                const ratio = row.credit_limit_egp === 0 ? 0 : row.outstanding_amount / row.credit_limit_egp;
                const tone: BadgeTone = ratio > 1 ? 'danger' : ratio > 0.8 ? 'warning' : 'success';
                const label = ratio > 1 ? t('customers.creditExceeded') : ratio > 0.8 ? t('customers.creditWarn') : t('customers.creditOk');
                return (
                  <div className="cell-stack cell-stack--end">
                    <span>{formatCellValue(row.available_credit, 'money', lang)}</span>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                );
              },
            },
            { key: 'credit_days', header: t('customers.creditDays'), align: 'end' },
            {
              key: 'status',
              header: t('customers.status'),
              render: (row) => <Badge tone={statusTone[row.status] ?? 'neutral'}>{t(`customers.status.${row.status}`)}</Badge>,
            },
            { key: 'phone', header: t('common.phone'), render: (row) => <span className="mono">{row.phone || '—'}</span> },
          ]}
        />
        <InfoNote tone="info">{t('customers.note')}</InfoNote>
      </Card>
    </div>
  );
};
