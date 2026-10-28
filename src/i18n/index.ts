import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { BRAND } from '../brand';
import { ar } from './locales/ar';
import { en } from './locales/en';
import type { Lang } from '../types';

const STORAGE_KEY = 'iconcrete.lang';

export const supportedLanguages: Lang[] = ['ar', 'en'];

export const readStoredLang = (): Lang => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'en' || stored === 'ar' ? stored : BRAND.defaultLang;
  } catch {
    return BRAND.defaultLang;
  }
};

export const applyDocumentDirection = (lang: Lang): void => {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('data-lang', lang);
};

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: readStoredLang(),
  fallbackLng: 'ar',
  supportedLngs: supportedLanguages,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const currentLang = (): Lang => (i18n.language === 'en' ? 'en' : 'ar');

export const changeLanguage = async (lang: Lang): Promise<void> => {
  await i18n.changeLanguage(lang);
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable — language still applies for this session */
  }
  applyDocumentDirection(lang);
};

applyDocumentDirection(currentLang());

export default i18n;
