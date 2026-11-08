import { createDemoDataset } from '../src/seed/demo';
import type { AuditEntry, DemoDataset, SessionRecord, User } from '../src/types';
import type { ValidationResult } from '../src/core/validation';
import {
  assertProductionSecrets,
  ConfigurationError,
  DEMO_ADMIN_PASSWORD,
  parseRuntimeEnvironment,
  type RuntimeEnvironment,
} from './db/mode';

export interface AuthedUser extends User {
  password_hash: string;
}

export interface StagedImport {
  id: string;
  templateId: string;
  templateVersion: string;
  fileName: string;
  checksum: string;
  bytes: number;
  createdAt: string;
  createdBy: string;
  result: ValidationResult;
  committed: boolean;
  importedRows: number;
}

export interface ImportedRecord {
  id: string;
  templateId: string;
  values: Record<string, string>;
  importedBy: string;
  importedAt: string;
}

export interface AppStore {
  dataset: DemoDataset;
  users: AuthedUser[];
  sessions: Map<string, SessionRecord>;
  staged: Map<string, StagedImport>;
  /** Landing buffer for imported rows whose module tables arrive in later phases. */
  imports: ImportedRecord[];
}

export interface AppEnv {
  environment: RuntimeEnvironment;
  adminPassword: string;
  idleMinutes: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
  maxUploadBytes: number;
  /** Opt-in only. Off by default until SMTP/OTP delivery is configured. */
  twoFactorEnabled?: boolean;
  /** Development-only one-time fallback. Must never be enabled in production. */
  magicLogin?: boolean;
}

const boundedInteger = (
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number => {
  const value = raw === undefined || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(
      'invalid_configuration',
      `${name} must be an integer between ${min} and ${max} (received an invalid value).`,
    );
  }
  return value;
};

/**
 * Reads and validates the runtime configuration.
 *
 * In production the demo credential is rejected outright, so a development password
 * can never quietly become a production password. Secrets are never logged here.
 */
export const readEnv = (env: NodeJS.ProcessEnv = process.env): AppEnv => {
  const environment = parseRuntimeEnvironment(env.ICONCRETE_ENV);
  assertProductionSecrets(env, environment);
  const magicLogin = env.ICONCRETE_MAGIC_LOGIN === 'true';
  if (environment === 'production' && magicLogin) {
    throw new ConfigurationError(
      'magic_login_forbidden',
      'ICONCRETE_MAGIC_LOGIN is a development fallback and must be disabled in production.',
    );
  }

  return {
    environment,
    adminPassword: env.ICONCRETE_DEMO_ADMIN_PASSWORD?.trim() || DEMO_ADMIN_PASSWORD,
    idleMinutes: boundedInteger(env.ICONCRETE_SESSION_IDLE_MINUTES, 30, 1, 1440, 'ICONCRETE_SESSION_IDLE_MINUTES'),
    maxFailedLogins: boundedInteger(env.ICONCRETE_MAX_FAILED_LOGINS, 5, 1, 50, 'ICONCRETE_MAX_FAILED_LOGINS'),
    lockoutMinutes: boundedInteger(env.ICONCRETE_LOCKOUT_MINUTES, 15, 1, 1440, 'ICONCRETE_LOCKOUT_MINUTES'),
    twoFactorEnabled: env.ICONCRETE_2FA_ENABLED === 'true',
    magicLogin,
    maxUploadBytes: boundedInteger(
      env.ICONCRETE_MAX_UPLOAD_BYTES,
      2_097_152,
      1_024,
      8 * 1_048_576,
      'ICONCRETE_MAX_UPLOAD_BYTES',
    ),
  };
};

/**
 * Phase 1 store: seeded in-memory demo data + hashed demo credentials.
 * Durable PostgreSQL storage with RLS is Phase 2 work (module M1).
 */
export const createStore = async (env: AppEnv = readEnv()): Promise<AppStore> => {
  const dataset = createDemoDataset();
  const users: AuthedUser[] = await Promise.all(
    dataset.users.map(async (user) => ({
      ...user,
      demo_password: '',
      password_hash: await Bun.password.hash(
        user.username === 'admin' ? env.adminPassword : user.demo_password || 'Demo@2026',
        { algorithm: 'argon2id' },
      ),
    })),
  );
  return { dataset, users, sessions: new Map(), staged: new Map(), imports: [] };
};

export const appendAudit = (
  store: AppStore,
  entry: Omit<AuditEntry, 'id' | 'created_at'>,
): AuditEntry => {
  const record: AuditEntry = {
    id: `AUD-${crypto.randomUUID().slice(0, 12)}`,
    created_at: new Date().toISOString(),
    ...entry,
  };
  store.dataset.auditLog.unshift(record);
  if (store.dataset.auditLog.length > 1000) store.dataset.auditLog.length = 1000;
  return record;
};
