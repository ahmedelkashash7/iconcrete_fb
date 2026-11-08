import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch, ApiError, getToken, setToken } from '../api';
import type { RoleLevel } from '../types';

export interface SessionUser {
  id: string;
  username: string;
  full_name_ar: string;
  full_name_en: string;
  email: string;
  phone: string;
  role_level: RoleLevel;
  company_id: string;
  assigned_plant_ids: string[];
  is_active: boolean;
  last_login_at: string | null;
}

export interface CompanyInfo {
  name_ar: string;
  name_en: string;
}

export interface LoginInput {
  company: string;
  username: string;
  password: string;
  captcha?: { challengeId: string; answer: string };
}

export interface LoginOutcome {
  ok: boolean;
  code?: string;
  captchaRequired?: boolean;
  lockedUntil?: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  company: CompanyInfo | null;
  loading: boolean;
  sessionMessage: string | null;
  clearSessionMessage: () => void;
  login: (input: LoginInput) => Promise<LoginOutcome>;
  logout: () => Promise<void>;
}

const STORAGE_KEY = 'iconcrete.session';
const AuthContext = createContext<AuthContextValue | null>(null);

interface StoredSession {
  user: SessionUser;
  company: CompanyInfo;
}

const readStoredSession = (): StoredSession | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredSession;
    // Migrate a session written by the previous sessionStorage build.
    const legacy = window.sessionStorage.getItem(STORAGE_KEY);
    if (!legacy) return null;
    window.localStorage.setItem(STORAGE_KEY, legacy);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(legacy) as StoredSession;
  } catch {
    return null;
  }
};

const writeStoredSession = (session: StoredSession | null): void => {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore storage failures */
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  useEffect(() => {
    const restore = async () => {
      // The magic-link path stores only the bearer token; rebuild the session from /me.
      if (!getToken()) {
        setLoading(false);
        return;
      }
      const cached = readStoredSession();
      if (cached) setSession(cached);
      try {
        const fresh = await apiFetch<{ user: SessionUser; company: CompanyInfo }>('/api/auth/me');
        const next = { user: fresh.user, company: fresh.company };
        setSession(next);
        writeStoredSession(next);
      } catch {
        setToken(null);
        writeStoredSession(null);
      } finally {
        setLoading(false);
      }
    };
    void restore();
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setSession(null);
      setToken(null);
      writeStoredSession(null);
      setSessionMessage('login.sessionExpired');
    };
    window.addEventListener('iconcrete:session-expired', onExpired);
    return () => window.removeEventListener('iconcrete:session-expired', onExpired);
  }, []);

  const login = useCallback(async (input: LoginInput): Promise<LoginOutcome> => {
    try {
      const result = await apiFetch<{
        token: string;
        expiresAt: string;
        user: SessionUser;
        company: CompanyInfo;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const next: StoredSession = { user: result.user, company: result.company };
      setToken(result.token);
      writeStoredSession(next);
      setSession(next);

      // Immediate persistence check: the iframe may have dropped the session transport.
      try {
        const verified = await apiFetch<{ user: SessionUser; company: CompanyInfo }>('/api/auth/me');
        const confirmed = { user: verified.user, company: verified.company };
        writeStoredSession(confirmed);
        setSession(confirmed);
      } catch (error) {
        setToken(null);
        writeStoredSession(null);
        setSession(null);
        if (error instanceof ApiError) {
          return {
            ok: false,
            code: error.status === 401 ? 'session_not_persisted' : (error.code || 'server_error'),
          };
        }
        return { ok: false, code: 'network_error' };
      }

      setSessionMessage(null);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError) {
        return {
          ok: false,
          code: error.code,
          captchaRequired: error.details.captchaRequired === true,
          ...(typeof error.details.lockedUntil === 'string' ? { lockedUntil: error.details.lockedUntil } : {}),
        };
      }
      return { ok: false, code: 'network_error' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* revoke best effort */
    }
    setToken(null);
    writeStoredSession(null);
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      company: session?.company ?? null,
      loading,
      sessionMessage,
      clearSessionMessage: () => setSessionMessage(null),
      login,
      logout,
    }),
    [session, loading, sessionMessage, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
