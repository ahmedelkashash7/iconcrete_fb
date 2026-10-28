import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '../components/Brand';
import { InfoNote } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api';
import { changeLanguage } from '../i18n';
import { BRAND } from '../brand';
import { DEMO_CREDENTIALS } from '../seed/demo';
import type { Lang } from '../types';

interface CaptchaChallenge {
  challengeId: string;
  questionAr: string;
  questionEn: string;
}

export const LoginPage = ({ onSuccess }: { onSuccess: () => void }) => {
  const { t, i18n } = useTranslation();
  const { login, sessionMessage, clearSessionMessage } = useAuth();
  const lang = (i18n.language as Lang) === 'en' ? 'en' : 'ar';

  const [company, setCompany] = useState<string>(lang === 'ar' ? BRAND.demoCompany.ar : BRAND.demoCompany.en);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState<string>(DEMO_CREDENTIALS.password);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  useEffect(() => {
    if (sessionMessage) {
      setError(t(sessionMessage));
      clearSessionMessage();
    }
  }, [sessionMessage, t, clearSessionMessage]);

  const loadCaptcha = async () => {
    try {
      const challenge = await apiFetch<CaptchaChallenge>('/api/auth/captcha', { method: 'POST' });
      setCaptcha(challenge);
      setCaptchaAnswer('');
    } catch {
      setError(t('login.errorNetwork'));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const outcome = await login({
      company,
      username,
      password,
      ...(captcha ? { captcha: { challengeId: captcha.challengeId, answer: captchaAnswer } } : {}),
    });
    setSubmitting(false);

    if (outcome.ok) {
      onSuccess();
      return;
    }

    switch (outcome.code) {
      case 'invalid_credentials':
        setError(t('login.errorInvalid'));
        break;
      case 'company_not_found':
        setError(t('login.errorCompany'));
        break;
      case 'account_locked':
        setError(t('login.errorLocked'));
        break;
      case 'account_inactive':
        setError(t('login.errorInactive'));
        break;
      case 'captcha_required':
      case 'captcha_invalid':
        setError(t('login.errorCaptcha'));
        await loadCaptcha();
        break;
      case 'network_error':
      case 'http_502':
      case 'http_503':
        setError(t('login.errorNetwork'));
        break;
      default:
        setError(t('errors.generic'));
    }

    if (outcome.captchaRequired && !captcha) {
      await loadCaptcha();
    }
  };

  return (
    <div className="login-shell">
      <div className="login-brand-panel">
        <div className="login-brand-panel__top">
          <BrandLogo variant="light" size="lg" />
        </div>
        <div className="login-brand-panel__body">
          <h2>{lang === 'ar' ? 'إدارة محطة الخرسانة الجاهزة بالكامل' : 'Run your ready-mix plant end to end'}</h2>
          <ul className="login-features">
            <li>{t('login.feature1')}</li>
            <li>{t('login.feature2')}</li>
            <li>{t('login.feature3')}</li>
          </ul>
        </div>
        <div className="login-brand-panel__footer">
          <p>{t('common.phase1')} · {t('common.version')} 0.1.0</p>
          <p>{t('login.rights')}</p>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="login-card">
          <div className="login-card__lang lang-toggle">
            <button type="button" className={lang === 'ar' ? 'is-active' : ''} onClick={() => void changeLanguage('ar')}>
              العربية
            </button>
            <button type="button" className={lang === 'en' ? 'is-active' : ''} onClick={() => void changeLanguage('en')}>
              English
            </button>
          </div>

          <h1>{t('login.title')}</h1>
          <p className="login-card__subtitle">{t('login.subtitle')}</p>

          {error ? <InfoNote tone="danger">{error}</InfoNote> : null}

          <form onSubmit={submit} className="login-form">
            <label className="field">
              <span>{t('login.companyLabel')}</span>
              <input
                type="text"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder={t('login.companyPlaceholder')}
                autoComplete="organization"
                required
              />
            </label>

            <label className="field">
              <span>{t('login.usernameLabel')}</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t('login.usernamePlaceholder')}
                autoComplete="username"
                required
              />
            </label>

            <label className="field">
              <span>{t('login.passwordLabel')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                autoComplete="current-password"
                required
              />
            </label>

            {captcha ? (
              <label className="field">
                <span>
                  {t('login.captchaLabel')} — {lang === 'ar' ? captcha.questionAr : captcha.questionEn}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={captchaAnswer}
                  onChange={(event) => setCaptchaAnswer(event.target.value)}
                  placeholder={t('login.captchaPlaceholder')}
                  required
                />
                <small className="field__hint">{t('login.captchaHint')}</small>
              </label>
            ) : null}

            <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
              {submitting ? t('login.submitting') : t('login.submit')}
            </button>
          </form>

          <div className="demo-box">
            <div className="demo-box__title">
              <strong>{t('login.demoTitle')}</strong>
              <span className="mono">{DEMO_CREDENTIALS.password}</span>
            </div>
            <p className="muted">{t('login.demoHint')}</p>
            <div className="demo-box__users">
              {DEMO_CREDENTIALS.users.map((user) => (
                <button
                  key={user.username}
                  type="button"
                  className={`chip ${username === user.username ? 'is-active' : ''}`.trim()}
                  onClick={() => {
                    setUsername(user.username);
                    setPassword(DEMO_CREDENTIALS.password);
                    setCompany(lang === 'ar' ? BRAND.demoCompany.ar : BRAND.demoCompany.en);
                  }}
                >
                  <span className="mono">{user.username}</span>
                  <span>{t(user.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="login-security">{t('login.securityNote')}</p>
          <p className="login-twofa">{t('login.twoFactorNote')}</p>
        </div>
      </div>
    </div>
  );
};
