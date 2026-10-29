import { appendAudit, type AppEnv, type AppStore, type AuthedUser } from './store';
import { safeUserFromRow, type PgAuthRepository, type PgUserRow } from './db/authRepo';
import type { RoleLevel, SessionRecord } from '../src/types';

export type AuthFailureCode =
  | 'invalid_credentials'
  | 'company_not_found'
  | 'account_locked'
  | 'account_inactive'
  | 'captcha_required';

export interface SafeUser {
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

export type AuthResult =
  | { ok: true; token: string; expiresAt: string; user: SafeUser; companyNameAr: string; companyNameEn: string }
  | { ok: false; code: AuthFailureCode; failedAttempts: number; lockedUntil?: string };

export type SessionLookup =
  | { ok: true; user: AuthedUser; session: SessionRecord }
  | { ok: false; code: 'unauthorized' | 'forbidden' };

export const toSafeUser = (user: AuthedUser): SafeUser => ({
  id: user.id,
  username: user.username,
  full_name_ar: user.full_name_ar,
  full_name_en: user.full_name_en,
  email: user.email,
  phone: user.phone,
  role_level: user.role_level,
  company_id: user.company_id,
  assigned_plant_ids: user.assigned_plant_ids,
  is_active: user.is_active,
  last_login_at: user.last_login_at,
});

export const hashToken = (token: string): string =>
  new Bun.CryptoHasher('sha256').update(token).digest('hex');

const findCompany = (store: AppStore, name: string) => {
  const wanted = name.trim().toLowerCase();
  const company = store.dataset.company;
  const candidates = [company.name_ar, company.name_en, company.tax_id, company.id].map((value) =>
    value.trim().toLowerCase(),
  );
  return candidates.includes(wanted) ? company : undefined;
};

export interface LoginInput {
  company: string;
  username: string;
  password: string;
  ip: string;
  device: string;
}

export const authenticate = async (
  store: AppStore,
  input: LoginInput,
  env: AppEnv,
): Promise<AuthResult> => {
  const company = findCompany(store, input.company);
  if (!company) {
    appendAudit(store, {
      user_id: null,
      username: input.username,
      company_id: null,
      action: 'auth.company_not_found',
      table_name: 'companies',
      record_id: null,
      ip_address: input.ip,
      details: { company: input.company },
    });
    return { ok: false, code: 'company_not_found', failedAttempts: 0 };
  }

  const user = store.users.find(
    (candidate) =>
      candidate.company_id === company.id &&
      candidate.username.toLowerCase() === input.username.trim().toLowerCase(),
  );

  if (!user) {
    return { ok: false, code: 'invalid_credentials', failedAttempts: 0 };
  }

  const now = Date.now();
  if (user.locked_until && new Date(user.locked_until).getTime() > now) {
    return { ok: false, code: 'account_locked', failedAttempts: user.failed_login_attempts, lockedUntil: user.locked_until };
  }

  if (!user.is_active) {
    return { ok: false, code: 'account_inactive', failedAttempts: user.failed_login_attempts };
  }

  const passwordOk = await Bun.password.verify(input.password, user.password_hash);
  if (!passwordOk) {
    user.failed_login_attempts += 1;
    let lockedUntil: string | undefined;
    if (user.failed_login_attempts >= env.maxFailedLogins) {
      lockedUntil = new Date(now + env.lockoutMinutes * 60_000).toISOString();
      user.locked_until = lockedUntil;
      user.failed_login_attempts = 0;
    }
    appendAudit(store, {
      user_id: user.id,
      username: user.username,
      company_id: user.company_id,
      action: lockedUntil ? 'auth.locked' : 'auth.failed',
      table_name: 'users',
      record_id: user.id,
      ip_address: input.ip,
      details: { attempts: user.failed_login_attempts, locked_until: lockedUntil ?? null },
    });
    return {
      ok: false,
      code: lockedUntil ? 'account_locked' : 'invalid_credentials',
      failedAttempts: user.failed_login_attempts,
      ...(lockedUntil ? { lockedUntil } : {}),
    };
  }

  user.failed_login_attempts = 0;
  user.locked_until = null;
  user.last_login_at = new Date().toISOString();

  const token = `ic_${crypto.randomUUID()}${crypto.randomUUID()}`;
  const expiresAt = new Date(now + env.idleMinutes * 60_000).toISOString();
  const session: SessionRecord = {
    id: `SES-${crypto.randomUUID().slice(0, 12)}`,
    user_id: user.id,
    token_hash: hashToken(token),
    ip_address: input.ip,
    device_info: input.device,
    created_at: new Date(now).toISOString(),
    expires_at: expiresAt,
    revoked_at: null,
  };
  store.sessions.set(session.token_hash, session);

  appendAudit(store, {
    user_id: user.id,
    username: user.username,
    company_id: user.company_id,
    action: 'auth.login',
    table_name: 'sessions',
    record_id: session.id,
    ip_address: input.ip,
    details: { role_level: user.role_level, expires_at: expiresAt },
  });

  return {
    ok: true,
    token,
    expiresAt,
    user: toSafeUser(user),
    companyNameAr: company.name_ar,
    companyNameEn: company.name_en,
  };
};

export const resolveSession = (
  store: AppStore,
  token: string | null,
  opts: { idleMinutes: number; minLevel?: RoleLevel },
): SessionLookup => {
  if (!token) return { ok: false, code: 'unauthorized' };
  const session = store.sessions.get(hashToken(token));
  if (!session || session.revoked_at) return { ok: false, code: 'unauthorized' };

  const now = Date.now();
  if (new Date(session.expires_at).getTime() <= now) {
    store.sessions.delete(session.token_hash);
    return { ok: false, code: 'unauthorized' };
  }

  const user = store.users.find((candidate) => candidate.id === session.user_id);
  if (!user || !user.is_active) return { ok: false, code: 'unauthorized' };

  if (opts.minLevel !== undefined && user.role_level < opts.minLevel) {
    return { ok: false, code: 'forbidden' };
  }

  // Sliding idle expiry: 30 minutes by default.
  session.expires_at = new Date(now + opts.idleMinutes * 60_000).toISOString();
  return { ok: true, user, session };
};

export const revokeSession = (store: AppStore, token: string): void => {
  const session = store.sessions.get(hashToken(token));
  if (session) {
    session.revoked_at = new Date().toISOString();
    store.sessions.delete(session.token_hash);
  }
};

export const extractBearer = (request: Request): string | null => {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
};

// ---------------------------------------------------------------------------
// Durable (PostgreSQL) authentication.
//
// Same contract as the in-memory adapter, but every session, failure counter and
// audit event is persisted. The in-memory path above stays the demo/test adapter.
// ---------------------------------------------------------------------------

export interface AuthRequestMeta {
  ip: string;
  device: string;
  requestId?: string | null;
}

export type PgSessionLookup =
  | { ok: true; user: SafeUser; sessionId: string; expiresAt: string }
  | { ok: false; code: 'unauthorized' | 'forbidden' };

const auditEvent = (
  repo: PgAuthRepository,
  meta: AuthRequestMeta,
  event: {
    action: string;
    result: 'success' | 'failure';
    companyId: string | null;
    userId?: string | null;
    username?: string;
    recordId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> =>
  repo.audit({
    company_id: event.companyId,
    user_id: event.userId ?? null,
    username: event.username ?? '',
    action: event.action,
    table_name: 'sessions',
    record_id: event.recordId ?? null,
    ip_address: meta.ip,
    user_agent: meta.device,
    request_id: meta.requestId ?? null,
    result: event.result,
    details: event.details ?? {},
  });

const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    // A malformed hash must fail closed, never throw a 500 that leaks internals.
    return false;
  }
};

export const authenticatePg = async (
  repo: PgAuthRepository,
  input: LoginInput,
  env: AppEnv,
  meta: AuthRequestMeta,
): Promise<AuthResult> => {
  const company = await repo.findCompany(input.company);
  if (!company) {
    await auditEvent(repo, meta, {
      action: 'auth.login.failure',
      result: 'failure',
      companyId: null,
      username: input.username,
      details: { reason: 'company_not_found', company: input.company },
    });
    return { ok: false, code: 'company_not_found', failedAttempts: 0 };
  }

  const user: PgUserRow | null = await repo.findUser(company.id, input.username);
  if (!user) {
    await auditEvent(repo, meta, {
      action: 'auth.login.failure',
      result: 'failure',
      companyId: company.id,
      username: input.username,
      details: { reason: 'unknown_user' },
    });
    return { ok: false, code: 'invalid_credentials', failedAttempts: 0 };
  }

  const lockedUntil = user.locked_until ? new Date(user.locked_until).toISOString() : null;
  if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
    await auditEvent(repo, meta, {
      action: 'auth.login.failure',
      result: 'failure',
      companyId: company.id,
      userId: user.id,
      username: user.username,
      recordId: user.id,
      details: { reason: 'account_locked', locked_until: lockedUntil },
    });
    return {
      ok: false,
      code: 'account_locked',
      failedAttempts: Number(user.failed_login_attempts ?? 0),
      lockedUntil,
    };
  }

  if (!user.is_active) {
    await auditEvent(repo, meta, {
      action: 'auth.login.failure',
      result: 'failure',
      companyId: company.id,
      userId: user.id,
      username: user.username,
      recordId: user.id,
      details: { reason: 'account_inactive' },
    });
    return { ok: false, code: 'account_inactive', failedAttempts: 0 };
  }

  if (!input.password || !(await verifyPassword(input.password, user.password_hash))) {
    const state = await repo.recordFailure(user.id, env.maxFailedLogins, env.lockoutMinutes);
    await auditEvent(repo, meta, {
      action: 'auth.login.failure',
      result: 'failure',
      companyId: company.id,
      userId: user.id,
      username: user.username,
      recordId: user.id,
      details: {
        reason: 'invalid_credentials',
        attempts: state.failedAttempts,
        locked_until: state.lockedUntil,
      },
    });
    if (state.lockedUntil) {
      await auditEvent(repo, meta, {
        action: 'auth.lockout',
        result: 'failure',
        companyId: company.id,
        userId: user.id,
        username: user.username,
        recordId: user.id,
        details: { locked_until: state.lockedUntil, max_attempts: env.maxFailedLogins },
      });
      return {
        ok: false,
        code: 'account_locked',
        failedAttempts: state.failedAttempts,
        lockedUntil: state.lockedUntil,
      };
    }
    return { ok: false, code: 'invalid_credentials', failedAttempts: state.failedAttempts };
  }

  await repo.recordSuccess(user.id);

  // A brand new opaque token per login: no fixation and nothing guessable.
  const token = `ic_${crypto.randomUUID()}${crypto.randomUUID()}`;
  const sessionId = `SES-${crypto.randomUUID().slice(0, 12)}`;
  const expiresAt = await repo.createSession({
    sessionId,
    companyId: company.id,
    userId: user.id,
    tokenHash: hashToken(token),
    ip: meta.ip,
    device: meta.device,
    idleMinutes: env.idleMinutes,
  });

  await auditEvent(repo, meta, {
    action: 'auth.login.success',
    result: 'success',
    companyId: company.id,
    userId: user.id,
    username: user.username,
    recordId: sessionId,
    details: { role_level: user.role_level, expires_at: expiresAt },
  });

  return {
    ok: true,
    token,
    expiresAt,
    user: safeUserFromRow(user) as SafeUser,
    companyNameAr: company.name_ar,
    companyNameEn: company.name_en,
  };
};

export const resolveSessionPg = async (
  repo: PgAuthRepository,
  token: string | null,
  opts: { idleMinutes: number; minLevel?: RoleLevel },
  meta: AuthRequestMeta,
): Promise<PgSessionLookup> => {
  if (!token) return { ok: false, code: 'unauthorized' };
  const tokenHash = hashToken(token);
  const row = await repo.resolveSession(tokenHash, opts.idleMinutes);
  if (!row) {
    // Distinguish an expired session (audited) from an unknown/revoked token.
    const expired = await repo.expireSession(tokenHash);
    if (expired) {
      await auditEvent(repo, meta, {
        action: 'auth.session.expired',
        result: 'failure',
        companyId: expired.company_id,
        userId: expired.user_id,
        username: expired.username,
        recordId: expired.session_id,
      });
    }
    return { ok: false, code: 'unauthorized' };
  }

  const user = safeUserFromRow(row.user_data) as SafeUser;
  if (opts.minLevel !== undefined && user.role_level < opts.minLevel) {
    return { ok: false, code: 'forbidden' };
  }

  return {
    ok: true,
    user,
    sessionId: row.session_id,
    expiresAt:
      row.expires_at instanceof Date ? row.expires_at.toISOString() : new Date(row.expires_at).toISOString(),
  };
};

/** Revokes the durable session, writing both required audit events. */
export const revokeSessionPg = async (
  repo: PgAuthRepository,
  token: string | null,
  meta: AuthRequestMeta,
): Promise<boolean> => {
  if (!token) return false;
  const revoked = await repo.revokeSession(hashToken(token));
  if (!revoked) return false;

  await auditEvent(repo, meta, {
    action: 'auth.logout',
    result: 'success',
    companyId: revoked.company_id,
    userId: revoked.user_id,
    username: revoked.username,
    recordId: revoked.session_id,
  });
  await auditEvent(repo, meta, {
    action: 'auth.session.revoked',
    result: 'success',
    companyId: revoked.company_id,
    userId: revoked.user_id,
    username: revoked.username,
    recordId: revoked.session_id,
  });
  return true;
};
