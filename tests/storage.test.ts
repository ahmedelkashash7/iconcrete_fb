import { describe, expect, test } from 'bun:test';
import {
  assertProductionSecrets,
  ConfigurationError,
  DEMO_ADMIN_PASSWORD,
  describeMode,
  looksLikePlaceholderSecret,
  parseRuntimeEnvironment,
  parseStorageMode,
  readStorageSettings,
  StorageModeError,
} from '../server/db/mode';
import { readEnv } from '../server/store';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof StorageModeError || error instanceof ConfigurationError) return error.code;
    return 'unexpected_error';
  }
  return 'no_error';
};

describe('storage mode resolution', () => {
  test('accepts the three supported modes and defaults to demo', () => {
    expect(parseStorageMode(undefined)).toBe('demo');
    expect(parseStorageMode('DEMO')).toBe('demo');
    expect(parseStorageMode('test')).toBe('test');
    expect(parseStorageMode('postgres')).toBe('postgres');
    expect(codeOf(() => parseStorageMode('mysql'))).toBe('invalid_storage_mode');
  });

  test('postgres mode without DATABASE_URL fails instead of falling back', () => {
    expect(codeOf(() => readStorageSettings({ ICONCRETE_STORAGE_MODE: 'postgres' }))).toBe(
      'database_url_missing',
    );
    const settings = readStorageSettings({
      ICONCRETE_STORAGE_MODE: 'postgres',
      DATABASE_URL: 'postgres://iconcrete_app@127.0.0.1:5432/iconcrete',
    });
    expect(settings.mode).toBe('postgres');
    expect(settings.databaseUrl).not.toBeNull();
  });

  test('demo and test need no database at all', () => {
    expect(readStorageSettings({}).mode).toBe('demo');
    expect(readStorageSettings({ ICONCRETE_STORAGE_MODE: 'test' }).mode).toBe('test');
  });

  test('production refuses demo storage', () => {
    expect(codeOf(() => readStorageSettings({ ICONCRETE_ENV: 'production' }))).toBe(
      'production_requires_postgres',
    );
    expect(
      codeOf(() => readStorageSettings({ ICONCRETE_ENV: 'production', ICONCRETE_STORAGE_MODE: 'demo' })),
    ).toBe('production_requires_postgres');
  });

  test('production requires a real database secret and rejects placeholders', () => {
    expect(
      codeOf(() => readStorageSettings({ ICONCRETE_ENV: 'production', ICONCRETE_STORAGE_MODE: 'postgres' })),
    ).toBe('database_secret_missing');

    expect(
      codeOf(() =>
        readStorageSettings({
          ICONCRETE_ENV: 'production',
          ICONCRETE_STORAGE_MODE: 'postgres',
          DATABASE_URL: 'postgres://app:change-me@db/iconcrete',
        }),
      ),
    ).toBe('database_secret_placeholder');

    expect(
      codeOf(() =>
        readStorageSettings({
          ICONCRETE_ENV: 'production',
          ICONCRETE_STORAGE_MODE: 'postgres',
          DATABASE_URL: 'postgres://app@db/iconcrete',
        }),
      ),
    ).toBe('no_error');
  });

  test('rejects an unknown runtime environment', () => {
    expect(codeOf(() => parseRuntimeEnvironment('staging'))).toBe('invalid_environment');
    expect(parseRuntimeEnvironment(undefined)).toBe('development');
    expect(parseRuntimeEnvironment('prod')).toBe('production');
  });

  test('placeholder detection and mode labels', () => {
    expect(looksLikePlaceholderSecret('postgres://u:change-me@host/db')).toBe(true);
    expect(looksLikePlaceholderSecret('postgres://u:realSecretValue@host/db')).toBe(false);
    expect(describeMode('postgres')).toContain('durable');
    expect(describeMode('demo')).toContain('memory');
  });
});

describe('production credential enforcement', () => {
  const productionDb = {
    ICONCRETE_ENV: 'production',
    ICONCRETE_STORAGE_MODE: 'postgres',
    DATABASE_URL: 'postgres://iconcrete_app@db.internal/iconcrete',
  };

  test('a missing admin secret blocks production', () => {
    expect(
      codeOf(() =>
        readStorageSettings({
          ...productionDb,
        }),
      ),
    ).toBe('no_error'); // storage resolution alone does not own the admin secret
    expect(codeOf(() => assertProductionSecrets({ ...productionDb }, 'production'))).toBe(
      'production_admin_secret_missing',
    );
  });

  test('the published demo password can never become a production password', () => {
    expect(DEMO_ADMIN_PASSWORD).toBe('Demo@2026');
    expect(
      codeOf(() =>
        assertProductionSecrets(
          { ...productionDb, ICONCRETE_DEMO_ADMIN_PASSWORD: DEMO_ADMIN_PASSWORD },
          'production',
        ),
      ),
    ).toBe('production_demo_credential_rejected');
    expect(
      codeOf(() =>
        readEnv({
          ...productionDb,
          ICONCRETE_DEMO_ADMIN_PASSWORD: 'Demo@2026',
        }),
      ),
    ).toBe('production_demo_credential_rejected');
    expect(
      codeOf(() =>
        assertProductionSecrets(
          { ...productionDb, ICONCRETE_DEMO_ADMIN_PASSWORD: 'changeme-please' },
          'production',
        ),
      ),
    ).toBe('production_demo_credential_rejected');
  });

  test('a short admin secret blocks production', () => {
    expect(
      codeOf(() =>
        assertProductionSecrets({ ...productionDb, ICONCRETE_DEMO_ADMIN_PASSWORD: 'Str0ng!' }, 'production'),
      ),
    ).toBe('production_admin_secret_weak');
  });

  test('a valid production configuration resolves', () => {
    const env = readEnv({
      ...productionDb,
      ICONCRETE_DEMO_ADMIN_PASSWORD: 'pr0duction-Secret-Value',
    });
    expect(env.environment).toBe('production');
    expect(env.adminPassword).toBe('pr0duction-Secret-Value');
    expect(env.idleMinutes).toBe(30);
  });

  test('malformed numeric configuration is rejected, never clamped silently', () => {
    expect(codeOf(() => readEnv({ ICONCRETE_SESSION_IDLE_MINUTES: 'soon' }))).toBe('invalid_configuration');
    expect(codeOf(() => readEnv({ ICONCRETE_SESSION_IDLE_MINUTES: '0' }))).toBe('invalid_configuration');
    expect(codeOf(() => readEnv({ ICONCRETE_MAX_FAILED_LOGINS: '-2' }))).toBe('invalid_configuration');
    expect(codeOf(() => readEnv({ ICONCRETE_LOCKOUT_MINUTES: '1.5' }))).toBe('invalid_configuration');
    expect(codeOf(() => readEnv({ ICONCRETE_MAX_UPLOAD_BYTES: '99' }))).toBe('invalid_configuration');
  });

  test('development keeps the demo credential local to development', () => {
    const env = readEnv({});
    expect(env.environment).toBe('development');
    expect(env.adminPassword).toBe(DEMO_ADMIN_PASSWORD);
  });
});
