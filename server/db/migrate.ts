/** Minimal, checksum-verified migration runner. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './client';

export interface AppliedMigration {
  version: string;
  checksum: string;
  appliedAt: string;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  migrations: AppliedMigration[];
}

export const MIGRATIONS_DIR = join(import.meta.dir, '..', '..', 'db', 'migrations');

const checksum = (text: string): string => new Bun.CryptoHasher('sha256').update(text).digest('hex');

export const listMigrationFiles = (dir = MIGRATIONS_DIR): { version: string; path: string }[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ version: name, path: join(dir, name) }));

export const migrate = async (db: Db, dir = MIGRATIONS_DIR): Promise<MigrateResult> => {
  await db.unsafe(`
    create table if not exists schema_migrations (
      version      text primary key,
      checksum     text not null,
      applied_at   timestamptz not null default now(),
      duration_ms  integer not null default 0
    )
  `);

  const existing = await db.unsafe<{ version: string; checksum: string; applied_at: Date }>(
    `select version, checksum, applied_at from schema_migrations`,
  );
  const byVersion = new Map(existing.map((row) => [row.version, row]));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of listMigrationFiles(dir)) {
    const text = readFileSync(file.path, 'utf8');
    const digest = checksum(text);
    const already = byVersion.get(file.version);

    if (already) {
      if (already.checksum !== digest) {
        throw new Error(
          `migration ${file.version} changed after it was applied (checksum drift). Create a new migration instead of editing history.`,
        );
      }
      skipped.push(file.version);
      continue;
    }

    const startedAt = Date.now();
    await db.transaction(async (tx) => {
      await tx.unsafe(text);
      await tx.unsafe(`insert into schema_migrations (version, checksum, duration_ms) values ($1, $2, $3)`, [
        file.version,
        digest,
        Date.now() - startedAt,
      ]);
    });
    applied.push(file.version);
  }

  const rows = await db.unsafe<{ version: string; checksum: string; applied_at: Date }>(
    `select version, checksum, applied_at from schema_migrations order by version`,
  );

  return {
    applied,
    skipped,
    migrations: rows.map((row) => ({
      version: row.version,
      checksum: row.checksum,
      appliedAt: new Date(row.applied_at).toISOString(),
    })),
  };
};

export interface DbStatus {
  connected: boolean;
  version?: string;
  error?: string;
  migrations: AppliedMigration[];
  tables: number;
  rlsTables: number;
  journalTrigger: boolean;
  appRole: boolean;
}

export const databaseStatus = async (db: Db): Promise<DbStatus> => {
  const ping = await db.ping();
  if (!ping.ok) return { connected: false, error: ping.error, migrations: [], tables: 0, rlsTables: 0, journalTrigger: false, appRole: false };

  const migrations = await db.unsafe<{ version: string; checksum: string; applied_at: Date }>(
    `select version, checksum, applied_at from schema_migrations order by version`,
  ).catch(() => []);

  const counts = await db.unsafe<{ tables: number; rls: number }>(
    `select count(*)::int as tables,
            count(*) filter (where rowsecurity)::int as rls
       from pg_tables where schemaname = 'public'`,
  );
  const trigger = await db.unsafe<{ present: boolean }>(
    `select exists(select 1 from pg_trigger where tgname = 'trg_journal_balanced') as present`,
  );
  const role = await db.unsafe<{ present: boolean }>(
    `select exists(select 1 from pg_roles where rolname = 'iconcrete_app') as present`,
  );

  return {
    connected: true,
    version: ping.version,
    migrations: migrations.map((row) => ({
      version: row.version,
      checksum: row.checksum,
      appliedAt: new Date(row.applied_at).toISOString(),
    })),
    tables: counts[0]?.tables ?? 0,
    rlsTables: counts[0]?.rls ?? 0,
    journalTrigger: trigger[0]?.present ?? false,
    appRole: role[0]?.present ?? false,
  };
};
