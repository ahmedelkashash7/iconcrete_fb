import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from './components/Brand';
import { AppShell } from './components/AppShell';
import { LoadingBlock } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { useAuth } from './auth/AuthContext';
import { canAccessPage, PAGES, PAGE_MIN_LEVEL, type PageKey } from './core/rbac';

/**
 * Pages are loaded on demand so the first paint does not ship the chart library or the
 * Excel Center. Vite emits one chunk per page; the entry chunk stays small (see
 * docs/BUILD_AND_DEPLOY.md for the measured sizes).
 */
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const MixDesignsPage = lazy(() => import('./pages/MixDesignsPage').then((m) => ({ default: m.MixDesignsPage })));
const BatchListPage = lazy(() => import('./pages/BatchListPage').then((m) => ({ default: m.BatchListPage })));
const QualityListPage = lazy(() => import('./pages/QualityListPage').then((m) => ({ default: m.QualityListPage })));
const FleetListPage = lazy(() => import('./pages/FleetListPage').then((m) => ({ default: m.FleetListPage })));
const DispatchBoardPage = lazy(() => import('./pages/DispatchBoardPage').then((m) => ({ default: m.DispatchBoardPage })));
const RuleCataloguePage = lazy(() => import('./pages/RuleCataloguePage').then((m) => ({ default: m.RuleCataloguePage })));
const ExcelCenterPage = lazy(() => import('./pages/ExcelCenterPage').then((m) => ({ default: m.ExcelCenterPage })));
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage').then((m) => ({ default: m.DesignSystemPage })));
const InvoicesPage = lazy(() => import('./pages/LedgerPages').then((m) => ({ default: m.InvoicesPage })));
const PaymentsPage = lazy(() => import('./pages/LedgerPages').then((m) => ({ default: m.PaymentsPage })));
const StatementPage = lazy(() => import('./pages/LedgerPages').then((m) => ({ default: m.StatementPage })));
const LedgerPage = lazy(() => import('./pages/LedgerPages').then((m) => ({ default: m.LedgerPage })));
const PlantsPage = lazy(() => import('./pages/StructurePages').then((m) => ({ default: m.PlantsPage })));
const UsersPage = lazy(() => import('./pages/StructurePages').then((m) => ({ default: m.UsersPage })));
const AuditPage = lazy(() => import('./pages/StructurePages').then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import('./pages/StructurePages').then((m) => ({ default: m.SettingsPage })));

const readHash = (): PageKey => {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (PAGES as readonly string[]).includes(raw) ? (raw as PageKey) : 'dashboard';
};

export const App = () => {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [page, setPage] = useState<PageKey>(readHash);

  useEffect(() => {
    const onHashChange = () => setPage(readHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: PageKey) => {
    window.location.hash = `#/${next}`;
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  if (loading) {
    return (
      <div className="splash">
        <BrandLogo size="lg" />
        <span className="spinner" aria-hidden="true" />
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onSuccess={() => navigate('dashboard')} />;
  }

  const allowed = canAccessPage(user.role_level, page);

  return (
    <AppShell page={page} onNavigate={navigate}>
      {!allowed ? (
        <div className="forbidden">
          <h1>403</h1>
          <p>{t('errors.forbidden')}</p>
          <p className="muted">
            {t(`nav.${page}`)} — {t('common.role')}: {user.role_level} / {PAGE_MIN_LEVEL[page]}
          </p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('dashboard')}>
            {t('common.backToDashboard')}
          </button>
        </div>
      ) : (
        <Suspense fallback={<LoadingBlock label={t('common.loading')} />}>
          {page === 'dashboard' ? (
            <DashboardPage onNavigate={navigate} />
          ) : page === 'reports' ? (
            <ReportsPage />
          ) : page === 'customers' ? (
            <CustomersPage />
          ) : page === 'projects' ? (
            <ProjectsPage />
          ) : page === 'orders' ? (
            <OrdersPage />
          ) : page === 'mixDesigns' ? (
            <MixDesignsPage />
          ) : page === 'batches' ? (
            <BatchListPage />
          ) : page === 'quality' ? (
            <QualityListPage />
          ) : page === 'fleet' ? (
            <FleetListPage />
          ) : page === 'dispatch' ? (
            <DispatchBoardPage />
          ) : page === 'rules' ? (
            <RuleCataloguePage />
          ) : page === 'invoices' ? (
            <InvoicesPage />
          ) : page === 'payments' ? (
            <PaymentsPage />
          ) : page === 'statement' ? (
            <StatementPage />
          ) : page === 'ledger' ? (
            <LedgerPage />
          ) : page === 'excelCenter' ? (
            <ExcelCenterPage />
          ) : page === 'plants' ? (
            <PlantsPage />
          ) : page === 'users' ? (
            <UsersPage />
          ) : page === 'audit' ? (
            <AuditPage />
          ) : page === 'designSystem' ? (
            <DesignSystemPage />
          ) : (
            <SettingsPage />
          )}
        </Suspense>
      )}
    </AppShell>
  );
};
