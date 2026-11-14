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
const CustomerListPage = lazy(() => import('./pages/CustomerListPage').then((m) => ({ default: m.CustomerListPage })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const SalesOrderPage = lazy(() => import('./pages/SalesOrderPage').then((m) => ({ default: m.SalesOrderPage })));
const QuotationPage = lazy(() => import('./pages/QuotationPage').then((m) => ({ default: m.QuotationPage })));
const ContractPage = lazy(() => import('./pages/ContractPage').then((m) => ({ default: m.ContractPage })));
const DeliveryTicketPage = lazy(() => import('./pages/DeliveryTicketPage').then((m) => ({ default: m.DeliveryTicketPage })));
const PriceListPage = lazy(() => import('./pages/PriceListPage').then((m) => ({ default: m.PriceListPage })));
const VolumeCommitmentPage = lazy(() => import('./pages/VolumeCommitmentPage').then((m) => ({ default: m.VolumeCommitmentPage })));
const CrmActivitiesPage = lazy(() => import('./pages/CrmActivitiesPage').then((m) => ({ default: m.CrmActivitiesPage })));
const ComplaintsPage = lazy(() => import('./pages/ComplaintsPage').then((m) => ({ default: m.ComplaintsPage })));
const MixDesignsPage = lazy(() => import('./pages/MixDesignsPage').then((m) => ({ default: m.MixDesignsPage })));
const BatchListPage = lazy(() => import('./pages/BatchListPage').then((m) => ({ default: m.BatchListPage })));
const CostSettingsPage = lazy(() => import('./pages/CostPages').then((m) => ({ default: m.CostSettingsPage })));
const CostBatchesPage = lazy(() => import('./pages/CostPages').then((m) => ({ default: m.CostBatchesPage })));
const CostReportPage = lazy(() => import('./pages/CostPages').then((m) => ({ default: m.CostReportPage })));
const CostDashboardPage = lazy(() => import('./pages/CostPages').then((m) => ({ default: m.CostDashboardPage })));
const QualityListPage = lazy(() => import('./pages/QualityListPage').then((m) => ({ default: m.QualityListPage })));
const FleetListPage = lazy(() => import('./pages/FleetListPage').then((m) => ({ default: m.FleetListPage })));
const DispatchBoardPage = lazy(() => import('./pages/DispatchBoardPage').then((m) => ({ default: m.DispatchBoardPage })));
const InventoryListPage = lazy(() => import('./pages/InventoryListPage').then((m) => ({ default: m.InventoryListPage })));
const PurchaseRequestPage = lazy(() => import('./pages/PurchaseRequestPage').then((m) => ({ default: m.PurchaseRequestPage })));
const PurchaseOrderPage = lazy(() => import('./pages/PurchaseOrderPage').then((m) => ({ default: m.PurchaseOrderPage })));
const GoodsReceiptPage = lazy(() => import('./pages/GoodsReceiptPage').then((m) => ({ default: m.GoodsReceiptPage })));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })));
const PurchaseInvoicesPage = lazy(() => import('./pages/PurchaseInvoicesPage').then((m) => ({ default: m.PurchaseInvoicesPage })));
const PaymentsVoucherPage = lazy(() => import('./pages/PaymentsVoucherPage').then((m) => ({ default: m.PaymentsVoucherPage })));
const ApAgingReportPage = lazy(() => import('./pages/ApAgingReportPage').then((m) => ({ default: m.ApAgingReportPage })));
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
            <CustomerListPage />
          ) : page === 'projects' ? (
            <ProjectsPage />
          ) : page === 'orders' ? (
            <SalesOrderPage />
          ) : page === 'quotations' ? (
            <QuotationPage />
          ) : page === 'contracts' ? (
            <ContractPage />
          ) : page === 'deliveryTickets' ? (
            <DeliveryTicketPage />
          ) : page === 'priceLists' ? (
            <PriceListPage />
          ) : page === 'commitments' ? (
            <VolumeCommitmentPage />
          ) : page === 'crm' ? (
            <CrmActivitiesPage />
          ) : page === 'complaints' ? (
            <ComplaintsPage />
          ) : page === 'mixDesigns' ? (
            <MixDesignsPage />
          ) : page === 'batches' ? (
            <BatchListPage />
          ) : page === 'costBatches' ? (
            <CostBatchesPage />
          ) : page === 'costReport' ? (
            <CostReportPage />
          ) : page === 'costDashboard' ? (
            <CostDashboardPage />
          ) : page === 'costSettings' ? (
            <CostSettingsPage />
          ) : page === 'quality' ? (
            <QualityListPage />
          ) : page === 'fleet' ? (
            <FleetListPage />
          ) : page === 'dispatch' ? (
            <DispatchBoardPage />
          ) : page === 'inventory' ? (
            <InventoryListPage />
          ) : page === 'purchaseRequests' ? (
            <PurchaseRequestPage />
          ) : page === 'purchaseOrders' ? (
            <PurchaseOrderPage />
          ) : page === 'goodsReceipts' ? (
            <GoodsReceiptPage />
          ) : page === 'suppliers' ? (
            <SuppliersPage />
          ) : page === 'purchaseInvoices' ? (
            <PurchaseInvoicesPage />
          ) : page === 'paymentVouchers' ? (
            <PaymentsVoucherPage />
          ) : page === 'apAging' ? (
            <ApAgingReportPage />
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
