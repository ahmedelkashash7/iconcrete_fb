/**
 * PostgreSQL access for M1.
 *
 * The adapter never hides a failure: if the mode is `postgres` and the server is
 * unreachable, connection creation throws instead of degrading to memory.
 */
import { SQL } from 'bun';
import { StorageModeError, type StorageMode } from './mode';

export interface TenantContext {
  companyId: string;
  /** Empty array = company-wide role, no plant restriction. */
  plantIds: string[];
  userId?: string | null;
  requestId?: string | null;
}

export interface Executor {
  unsafe<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
}

export interface Tx extends Executor {
  /** Runs a statement and returns rows; convenience for tagged SQL. */
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
}

export interface DbPing {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface Db extends Executor {
  readonly mode: StorageMode;
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  withTenant<T>(context: TenantContext, fn: (tx: Executor) => Promise<T>): Promise<T>;
  ping(): Promise<DbPing>;
  close(): Promise<void>;
}

class PostgresDb implements Db {
  readonly mode: StorageMode = 'postgres';
  readonly #sql: SQL;

  constructor(databaseUrl: string) {
    this.#sql = new SQL(databaseUrl, { max: 10, idleTimeout: 30 });
  }

  async unsafe<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.#sql.unsafe(text, values)) as T[];
  }

  async transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return this.#sql.begin(async (tx) => {
      const executor: Executor = {
        unsafe: async <R = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<R[]> =>
          (await tx.unsafe(text, values)) as R[],
      };
      return fn(executor);
    }) as Promise<T>;
  }

  async withTenant<T>(context: TenantContext, fn: (tx: Executor) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      await tx.unsafe(`select set_config('app.company_id', $1, true)`, [context.companyId]);
      await tx.unsafe(`select set_config('app.plant_ids', $1, true)`, [context.plantIds.join(',')]);
      await tx.unsafe(`select set_config('app.user_id', $1, true)`, [context.userId ?? '']);
      await tx.unsafe(`select set_config('app.request_id', $1, true)`, [context.requestId ?? '']);
      return fn(tx);
    });
  }

  async ping(): Promise<DbPing> {
    try {
      const rows = await this.unsafe<{ version: string; rls: boolean }>(
        `select version() as version,
                (select count(*) from pg_tables where schemaname = 'public' and rowsecurity = true) > 0 as rls`,
      );
      return { ok: true, version: rows[0]?.version ?? 'unknown' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(): Promise<void> {
    await this.#sql.close();
  }
}

export interface DbFactoryOptions {
  mode: StorageMode;
  databaseUrl: string | null;
}

/**
 * Creates the durable adapter. In demo/test mode there is no database at all;
 * in postgres mode a failed connection is a hard error.
 */
export const createDb = async (options: DbFactoryOptions): Promise<Db | null> => {
  if (options.mode !== 'postgres') return null;

  if (!options.databaseUrl) {
    throw new StorageModeError(
      'database_url_missing',
      'ICONCRETE_STORAGE_MODE=postgres requires DATABASE_URL; refusing to fall back to memory.',
    );
  }

  const db = new PostgresDb(options.databaseUrl);
  const ping = await db.ping();
  if (!ping.ok) {
    await db.close().catch(() => undefined);
    throw new StorageModeError(
      'database_unreachable',
      `PostgreSQL is unreachable (${ping.error ?? 'unknown error'}). Refusing to fall back to the in-memory adapter.`,
    );
  }
  return db;
};
