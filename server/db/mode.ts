/**
 * Explicit storage modes.
 *
 * demo     — seeded in-memory adapter (Phase 1 behaviour, no database required)
 * test     — empty in-memory adapter used by unit tests
 * postgres — durable PostgreSQL; NEVER falls back to memory
 */

export type StorageMode = 'demo' | 'test' | 'postgres';

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

export interface StorageSettings {
  mode: StorageMode;
  databaseUrl: string | null;
}

export const readStorageSettings = (env: NodeJS.ProcessEnv = process.env): StorageSettings => {
  const mode = parseStorageMode(env.ICONCRETE_STORAGE_MODE);
  const databaseUrl = env.DATABASE_URL?.trim() || null;

  if (mode === 'postgres' && !databaseUrl) {
    throw new StorageModeError(
      'database_url_missing',
      'ICONCRETE_STORAGE_MODE=postgres requires DATABASE_URL. Refusing to fall back to the in-memory adapter.',
    );
  }

  return { mode, databaseUrl };
};

export const describeMode = (mode: StorageMode): string =>
  mode === 'postgres' ? 'postgres (durable)' : mode === 'test' ? 'in-memory (test)' : 'in-memory (demo)';
