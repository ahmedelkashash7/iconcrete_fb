/**
 * ICONCRETE — locked brand identity (Addendum A1).
 * These values are final. Never prompt the user to confirm them.
 */
export const BRAND = {
  internalName: 'IConcrete-fp',
  name: 'ICONCRETE',
  tagline: 'Concrete Management Solutions',
  defaultLang: 'ar',
  supportedLangs: ['ar', 'en'],
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  colors: {
    primary: '#6D28D9',
    primaryDark: '#4C1D95',
    secondary: '#8B5CF6',
    accent: '#2563EB',
    success: '#16A34A',
    danger: '#DC2626',
    warning: '#F59E0B',
    background: '#F8FAFC',
    text: '#0F172A',
  },
  demoCompany: {
    ar: 'شركة آي كونكريت التجريبية',
    en: 'IConcrete Demo Company',
  },
  demoPlant: {
    ar: 'محطة آي كونكريت التجريبية - القاهرة',
    en: 'IConcrete Demo Plant - Cairo',
  },
} as const;

export type Brand = typeof BRAND;
