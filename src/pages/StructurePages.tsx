import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError } from '../api';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle } from '../components/ui';
import { BRAND } from '../brand';
import { ROLE_KEYS } from '../core/rbac';
import { formatDateTime, initials } from '../lib/display';
import type { AuditEntry, Lang, Plant } from '../types';

const useApiList = <T,>(path: string, key: string) => {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch<Record<string, T[]>>(path)
      .then((response) => {
        if (active) setRows(response[key] ?? []);
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
  }, [path, key]);

  return { rows, error, loading };
};

export const PlantsPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const { rows, error, loading } = useApiList<Plant>('/api/plants', 'plants');

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  return (
    <div className="page-stack">
      <SectionTitle title={t('plants.title')} subtitle={t('plants.subtitle')} badge={<Badge tone="purple">{rows.length} {t('plants.count')}</Badge>} />
      <Card>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty={t('common.noData')}
          columns={[
            { key: 'id', header: t('plants.id'), render: (row) => <span className="mono">{row.id}</span> },
            { key: 'name', header: t('plants.name'), render: (row) => (lang === 'ar' ? row.name_ar : row.name_en) },
            { key: 'city', header: t('plants.city') },
            { key: 'capacity', header: t('plants.capacity'), align: 'end' },
            {
              key: 'status',
              header: t('common.status'),
              render: (row) => (
                <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? t('plants.active') : t('plants.inactive')}</Badge>
              ),
            },
          ]}
        />
        <InfoNote tone="info">{t('plants.placeholderNote')}</InfoNote>
      </Card>
    </div>
  );
};

interface SafeUserRow {
  id: string;
  username: string;
  full_name_ar: string;
  full_name_en: string;
  email: string;
  role_level: 1 | 2 | 3 | 4 | 5;
  assigned_plant_ids: string[];
  is_active: boolean;
  last_login_at: string | null;
}

export const UsersPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const { rows, error, loading } = useApiList<SafeUserRow>('/api/users', 'users');

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  return (
    <div className="page-stack">
      <SectionTitle title={t('users.title')} subtitle={t('users.subtitle')} badge={<Badge tone="purple">{rows.length} {t('common.user')}</Badge>} />
      <Card>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty={t('common.noData')}
          columns={[
            {
              key: 'avatar',
              header: '',
              render: (row) => <span className="user-chip__avatar user-chip__avatar--sm">{initials(lang === 'ar' ? row.full_name_ar : row.full_name_en)}</span>,
            },
            { key: 'username', header: t('users.username'), render: (row) => <span className="mono">{row.username}</span> },
            { key: 'full_name', header: t('users.fullName'), render: (row) => (lang === 'ar' ? row.full_name_ar : row.full_name_en) },
            {
              key: 'role',
              header: t('users.role'),
              render: (row) => (
                <Badge tone={row.role_level === 5 ? 'purple' : 'info'}>
                  {t(ROLE_KEYS[row.role_level])} · {t('users.level', { level: row.role_level })}
                </Badge>
              ),
            },
            {
              key: 'plants',
              header: t('users.plants'),
              render: (row) => <span className="mono small">{row.assigned_plant_ids.join(', ') || '—'}</span>,
            },
            {
              key: 'is_active',
              header: t('users.status'),
              render: (row) => <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? t('users.activeYes') : t('users.activeNo')}</Badge>,
            },
            { key: 'last_login', header: t('users.lastLogin'), render: (row) => formatDateTime(row.last_login_at, lang) },
          ]}
        />
        <InfoNote tone="warning">{t('users.placeholderNote')}</InfoNote>
      </Card>
    </div>
  );
};

export const AuditPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const { rows, error, loading } = useApiList<AuditEntry>('/api/audit', 'entries');

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  return (
    <div className="page-stack">
      <SectionTitle title={t('audit.title')} subtitle={t('audit.subtitle')} badge={<Badge tone="purple">{rows.length}</Badge>} />
      <Card>
        <DataTable
          dense
          rows={rows}
          rowKey={(row) => row.id}
          empty={t('audit.empty')}
          columns={[
            { key: 'created_at', header: t('audit.at'), render: (row) => formatDateTime(row.created_at, lang) },
            { key: 'action', header: t('audit.action'), render: (row) => <Badge tone={row.action.includes('fail') || row.action.includes('locked') ? 'danger' : 'info'}>{row.action}</Badge> },
            { key: 'username', header: t('audit.user'), render: (row) => row.username ?? '—' },
            { key: 'table_name', header: t('audit.table'), render: (row) => <span className="mono">{row.table_name}</span> },
            { key: 'record_id', header: t('audit.record'), render: (row) => <span className="mono small">{row.record_id ?? '—'}</span> },
            { key: 'ip_address', header: t('audit.ip'), render: (row) => <span className="mono small">{row.ip_address ?? '—'}</span> },
            { key: 'details', header: t('audit.details'), render: (row) => <span className="mono small">{JSON.stringify(row.details).slice(0, 110)}</span> },
          ]}
        />
        <InfoNote tone="warning">{t('audit.note')}</InfoNote>
      </Card>
    </div>
  );
};

export const SettingsPage = () => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const palette = [
    { key: 'primary', value: BRAND.colors.primary },
    { key: 'primaryDark', value: BRAND.colors.primaryDark },
    { key: 'secondary', value: BRAND.colors.secondary },
    { key: 'accent', value: BRAND.colors.accent },
    { key: 'success', value: BRAND.colors.success },
    { key: 'danger', value: BRAND.colors.danger },
    { key: 'warning', value: BRAND.colors.warning },
    { key: 'background', value: BRAND.colors.background },
  ] as const;

  return (
    <div className="page-stack">
      <SectionTitle title={t('settings.title')} subtitle={t('settings.subtitle')} badge={<Badge tone="purple">v0.1.0</Badge>} />

      <div className="two-col">
        <Card title={t('settings.brandTitle')} subtitle={t('settings.brandBody')}>
          <div className="identity-block">
            <div>
              <span className="identity-block__name">{BRAND.name}</span>
              <span className="identity-block__tagline">{BRAND.tagline}</span>
            </div>
            <div className="identity-rows">
              <div><span>{t('settings.internalName')}</span><strong className="mono">{BRAND.internalName}</strong></div>
              <div><span>{t('settings.languageDefault')}</span><strong>{BRAND.defaultLang === 'ar' ? 'العربية (RTL)' : 'English (LTR)'}</strong></div>
              <div><span>{t('settings.currency')}</span><strong className="mono">{BRAND.currency}</strong></div>
              <div><span>{t('settings.timezone')}</span><strong className="mono">{BRAND.timezone}</strong></div>
              <div><span>{t('settings.demoCompany')}</span><strong>{lang === 'ar' ? BRAND.demoCompany.ar : BRAND.demoCompany.en}</strong></div>
              <div><span>{t('settings.demoPlant')}</span><strong>{lang === 'ar' ? BRAND.demoPlant.ar : BRAND.demoPlant.en}</strong></div>
            </div>
          </div>
          <h3 className="subhead">{t('settings.palette')}</h3>
          <div className="palette">
            {palette.map((color) => (
              <div className="palette__item" key={color.key}>
                <span className="palette__swatch" style={{ background: color.value }} />
                <span className="mono small">{color.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('settings.futureTitle')} subtitle={t('settings.futureBody')}>
          <ul className="feature-list">
            <li><Badge tone="neutral">Phase 2</Badge> PostgreSQL + Row-Level Security</li>
            <li><Badge tone="neutral">Phase 2</Badge> Offline sync (SQLite queue)</li>
            <li><Badge tone="neutral">Later</Badge> WhatsApp / SMS notifications</li>
            <li><Badge tone="neutral">Later</Badge> GPS, weighbridge and PLC adapters</li>
            <li><Badge tone="neutral">Later</Badge> Subscription billing and entitlements</li>
          </ul>
          <InfoNote tone="warning">{t('settings.placeholderNote')}</InfoNote>
          <InfoNote tone="info">{t('login.twoFactorNote')}</InfoNote>
        </Card>
      </div>

      <Card title={t('settings.excelTitle')} subtitle={t('settings.excelBody')}>
        <div className="excel-doc-grid">
          <div>
            <h3 className="subhead">excel_generator/</h3>
            <ul className="feature-list mono small">
              <li>generate_workbook.py</li>
              <li>config.py</li>
              <li>calc.py</li>
              <li>requirements.txt</li>
              <li>IConcrete_Generator.ipynb</li>
              <li>tests/test_workbook.py</li>
              <li>sample_input/</li>
              <li>output/</li>
            </ul>
          </div>
          <div>
            <p>{t('excel.generatorLinkText')}</p>
            <p className="muted small">{t('common.secureNote')}</p>
          </div>
        </div>
      </Card>
    </div>
  );
};
