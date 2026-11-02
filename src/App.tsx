import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from './components/Brand';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ReportsPage } from './pages/ReportsPage';
import { CustomersPage } from './pages/CustomersPage';
import { InvoicesPage, LedgerPage, PaymentsPage, StatementPage } from './pages/LedgerPages';
import { ExcelCenterPage } from './pages/ExcelCenterPage';
import { AuditPage, PlantsPage, SettingsPage, UsersPage } from './pages/StructurePages';
import { useAuth } from './auth/AuthContext';
import { canAccessPage, PAGES, PAGE_MIN_LEVEL, type PageKey } from './core/rbac';

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
      ) : page === 'dashboard' ? (
        <DashboardPage onNavigate={navigate} />
      ) : page === 'reports' ? (
        <ReportsPage />
      ) : page === 'customers' ? (
        <CustomersPage />
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
      ) : (
        <SettingsPage />
      )}
    </AppShell>
  );
};
