/**
 * Explicit storage modes.
 *
 * demo     — seeded in-memory adapter (Phase 1 behaviour, no database required)
 * test     — empty in-memory adapter used by unit tests
 * postgres — durable PostgreSQL; NEVER falls back to memory
 *
 * ICONCRETE_ENV=production additionally requires a real database secret: demo storage is
 * rejected and placeholder connection strings are rejected with a clear error.
 */

export type StorageMode = 'demo' | 'test' | 'postgres';
export type RuntimeEnvironment = 'development' | 'production';

export class StorageModeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageModeError';
    this.code = code;
  }
}

export const parseStorageMode = (raw: string | undefined): StorageMode => {
  const value = (raw ?? 'demo').trim().toLowerCase();
  if (value === 'demo' || value === 'test' || value === 'postgres') return value;
  throw new StorageModeError(
    'invalid_storage_mode',
    `ICONCRETE_STORAGE_MODE must be demo, test or postgres (received "${raw}").`,
  );
};

export const parseRuntimeEnvironment = (raw: string | undefined): RuntimeEnvironment => {
  const value = (raw ?? 'development').trim().toLowerCase();
  if (value === 'production' || value === 'prod') return 'production';
  if (value === 'development' || value === 'dev' || value === '') return 'development';
  throw new StorageModeError(
    'invalid_environment',
    `ICONCRETE_ENV must be development or production (received "${raw}").`,
  );
};

/** Connection strings that still carry an example/placeholder credential are not secrets. */
const PLACEHOLDER_SECRET = /(change-?me|changeme|your-?password|example-?password|:password@|:postgres@|:admin@)/i;

export const looksLikePlaceholderSecret = (url: string): boolean => PLACEHOLDER_SECRET.test(url);

export interface StorageSettings {
  mode: StorageMode;
  environment: RuntimeEnvironment;
  databaseUrl: string | null;
}

export const readStorageSettings = (env: NodeJS.ProcessEnv = process.env): StorageSettings => {
  const mode = parseStorageMode(env.ICONCRETE_STORAGE_MODE);
  const environment = parseRuntimeEnvironment(env.ICONCRETE_ENV);
  const databaseUrl = env.DATABASE_URL?.trim() || null;

  // Production rules run first so their error codes are specific and actionable.
  if (environment === 'production') {
    if (mode !== 'postgres') {
      throw new StorageModeError(
        'production_requires_postgres',
        'ICONCRETE_ENV=production forbids demo/test storage; set ICONCRETE_STORAGE_MODE=postgres and provide DATABASE_URL.',
      );
    }
    if (!databaseUrl) {
      throw new StorageModeError(
        'database_secret_missing',
        'ICONCRETE_ENV=production requires a database secret in DATABASE_URL. Refusing to start.',
      );
    }
    if (looksLikePlaceholderSecret(databaseUrl)) {
      throw new StorageModeError(
        'database_secret_placeholder',
        'DATABASE_URL still contains a placeholder credential. Provide the real secret from your deployment secret store.',
      );
    }
    return { mode, environment, databaseUrl };
  }

  if (mode === 'postgres' && !databaseUrl) {
    throw new StorageModeError(
      'database_url_missing',
      'ICONCRETE_STORAGE_MODE=postgres requires DATABASE_URL. Refusing to fall back to the in-memory adapter.',
    );
  }

  return { mode, environment, databaseUrl };
};

export class ConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
  }
}

/**
 * Production refuses to boot with demo/questionable credentials. Nothing here logs or
 * echoes a secret: the messages name the variable, never its value.
 */
export const assertProductionSecrets = (
  env: NodeJS.ProcessEnv,
  environment: RuntimeEnvironment,
): void => {
  if (environment !== 'production') return;

  const adminPassword = env.ICONCRETE_DEMO_ADMIN_PASSWORD?.trim() ?? '';
  if (!adminPassword) {
    throw new ConfigurationError(
      'production_admin_secret_missing',
      'ICONCRETE_ENV=production requires ICONCRETE_DEMO_ADMIN_PASSWORD from the secret store. Refusing to start without an admin credential.',
    );
  }
  if (/^(demo|password|changeme|change-me)/i.test(adminPassword)) {
    throw new ConfigurationError(
      'production_demo_credential_rejected',
      'ICONCRETE_DEMO_ADMIN_PASSWORD still matches a demo/placeholder value. Provide a real secret; demo credentials are development-only.',
    );
  }
  if (adminPassword.length < 12) {
    throw new ConfigurationError(
      'production_admin_secret_weak',
      'ICONCRETE_DEMO_ADMIN_PASSWORD must be at least 12 characters in production.',
    );
  }

  const sessionSecret = env.ICONCRETE_SESSION_IDLE_MINUTES;
  if (sessionSecret !== undefined && !Number.isFinite(Number(sessionSecret))) {
    throw new ConfigurationError(
      'invalid_session_configuration',
      'ICONCRETE_SESSION_IDLE_MINUTES must be a number.',
    );
  }
};

export const describeMode = (mode: StorageMode): string =>
  mode === 'postgres' ? 'postgres (durable)' : mode === 'test' ? 'in-memory (test)' : 'in-memory (demo)';
