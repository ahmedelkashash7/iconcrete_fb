import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from './Brand';
import { Badge } from './ui';
import { useAuth } from '../auth/AuthContext';
import { canAccessPage, visiblePages, type PageKey, ROLE_KEYS } from '../core/rbac';
import { changeLanguage, currentLang } from '../i18n';
import { initials } from '../lib/display';
import type { Lang } from '../types';

const NAV_GROUPS: Array<{ key: string; pages: PageKey[] }> = [
  { key: 'nav.overview', pages: ['dashboard', 'reports'] },
  { key: 'nav.data', pages: ['customers', 'projects', 'orders', 'mixDesigns', 'batches', 'quality', 'fleet', 'dispatch', 'excelCenter'] },
  { key: 'nav.inventory', pages: ['inventory', 'purchaseRequests', 'purchaseOrders', 'goodsReceipts'] },
  { key: 'nav.accounting', pages: ['invoices', 'payments', 'statement', 'ledger'] },
  { key: 'nav.admin', pages: ['plants', 'users', 'rules', 'audit', 'settings', 'designSystem'] },
];

const PageIcon = ({ page }: { page: PageKey }) => {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (page) {
    case 'dashboard':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );
    case 'customers':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-2-4.3" />
        </svg>
      );
    case 'projects':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 20V6a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <path d="M9 12h6M9 16h4" />
        </svg>
      );
    case 'orders':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M9 8h5M9 12h6M9 16h6" />
        </svg>
      );
    case 'excelCenter':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M4 9h16M4 15h16M10 3v18" />
        </svg>
      );
    case 'plants':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 21V9l6 4V9l6 4V5h6v16z" />
          <path d="M7 21v-3M13 21v-3M18 21v-3" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="8" r="3.2" />
          <path d="M6 20a6 6 0 0 1 12 0" />
        </svg>
      );
    case 'audit':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'invoices':
    case 'payments':
    case 'statement':
    case 'ledger':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 3h14v18H5z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    default:
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
  }
};

export const AppShell = ({
  page,
  onNavigate,
  children,
}: {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  children: ReactNode;
}) => {
  const { t, i18n } = useTranslation();
  const { user, company, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const lang = (i18n.language as Lang) === 'en' ? 'en' : 'ar';
  const roleLevel = user?.role_level ?? 1;

  const pages = new Set(visiblePages(roleLevel));
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    pages: group.pages.filter((candidate) => pages.has(candidate)),
  })).filter((group) => group.pages.length > 0);

  const handleLanguage = (next: Lang) => {
    void changeLanguage(next);
  };

  const displayName = lang === 'ar' ? user?.full_name_ar : user?.full_name_en;

  return (
    <div className={`app-shell ${menuOpen ? 'app-shell--menu-open' : ''}`.trim()}>
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <BrandLogo variant="light" size="sm" />
        </div>
        <nav className="app-nav" aria-label={t('shell.menu')}>
          {groups.map((group) => (
            <div className="app-nav__group" key={group.key}>
              <span className="app-nav__group-label">{t(group.key)}</span>
              {group.pages.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={`app-nav__item ${candidate === page ? 'is-active' : ''}`.trim()}
                  onClick={() => {
                    onNavigate(candidate);
                    setMenuOpen(false);
                  }}
                  aria-current={candidate === page ? 'page' : undefined}
                >
                  <span className="app-nav__icon">
                    <PageIcon page={candidate} />
                  </span>
                  <span>{t(`nav.${candidate}`)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="app-sidebar__footer">
          <p>{company ? (lang === 'ar' ? company.name_ar : company.name_en) : t('common.demo')}</p>
          <p className="muted">{t('shell.demoStore')}</p>
          <p className="muted">{t('common.version')} 0.1.0 · {t('common.phase1')}</p>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="icon-button app-topbar__menu"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={t('shell.menu')}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="app-topbar__title">
            <span className="app-topbar__eyebrow">{t('common.appName')}</span>
            <strong>{t(`nav.${page}`)}</strong>
          </div>
          <div className="app-topbar__spacer" />
          <span className="plant-chip no-print">
            <span className="plant-chip__dot" />
            {lang === 'ar' ? company?.name_ar ?? t('shell.demoStore') : company?.name_en ?? t('shell.demoStore')}
          </span>
          <div className="lang-toggle no-print" role="group" aria-label={t('common.language')}>
            <button type="button" className={lang === 'ar' ? 'is-active' : ''} onClick={() => handleLanguage('ar')}>
              العربية
            </button>
            <button type="button" className={lang === 'en' ? 'is-active' : ''} onClick={() => handleLanguage('en')}>
              English
            </button>
          </div>
          <div className="user-chip no-print">
            <span className="user-chip__avatar">{initials(displayName ?? user?.username ?? 'IC')}</span>
            <span className="user-chip__text">
              <strong>{displayName ?? user?.username}</strong>
              <span>{t(ROLE_KEYS[roleLevel])}</span>
            </span>
          </div>
          <button type="button" className="btn btn--ghost btn--sm no-print" onClick={() => void logout()}>
            {t('common.logout')}
          </button>
        </header>

        <div className="phase-banner no-print">
          <Badge tone="purple">{t('shell.phase1Banner')}</Badge>
          <span>{t('shell.demoStore')}</span>
          <span className="phase-banner__lang">{currentLang() === 'ar' ? 'RTL' : 'LTR'} · {t('common.currency')}: EGP</span>
        </div>

        <main className="app-content">{children}</main>
      </div>
    </div>
  );
};

export const canSee = (level: number, page: PageKey): boolean =>
  canAccessPage(level as 1 | 2 | 3 | 4 | 5, page);
