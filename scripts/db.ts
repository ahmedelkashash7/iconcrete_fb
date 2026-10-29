#!/usr/bin/env bun
/**
 * Database CLI — migration, seed, reset, status.
 *
 *   bun run db:migrate    apply pending migrations
 *   bun run db:seed       (re)seed the two demo companies
 *   bun run db:reset      drop every table in the public schema, then migrate + seed
 *   bun run db:status     print connectivity, RLS and migration state
 *
 * Migrations and seeding use DATABASE_ADMIN_URL when set (the owner role);
 * the application itself connects with DATABASE_URL as the restricted role.
 */
import { createDb } from '../server/db/client';
import { databaseStatus, migrate } from '../server/db/migrate';
import { seedDemo } from '../server/db/seed';
import { StorageModeError } from '../server/db/mode';

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;

const open = async () => {
  if (!adminUrl) {
    console.error('DATABASE_URL is not set. Example: postgres://postgres@127.0.0.1:5432/iconcrete');
    process.exit(2);
  }
  process.env.ICONCRETE_STORAGE_MODE = 'postgres';
  const db = await createDb({ mode: 'postgres', databaseUrl: adminUrl });
  if (!db) throw new Error('unreachable: postgres mode returned no adapter');
  return db;
};

const command = process.argv[2] ?? 'status';

try {
  const db = await open();

  if (command === 'migrate') {
    const result = await migrate(db);
    console.log(`applied: ${result.applied.length === 0 ? 'none' : result.applied.join(', ')}`);
    console.log(`skipped: ${result.skipped.length === 0 ? 'none' : result.skipped.join(', ')}`);
  } else if (command === 'seed') {
    const result = await seedDemo(db);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'reset') {
    if (process.env.ICONCRETE_ALLOW_DESTRUCTIVE !== '1') {
      console.error('Refusing to reset without ICONCRETE_ALLOW_DESTRUCTIVE=1 (development only).');
      process.exit(3);
    }
    await db.unsafe(`drop schema public cascade; create schema public;`);
    console.log('schema dropped');
    const result = await migrate(db);
    console.log(`migrated: ${result.applied.join(', ')}`);
    console.log(JSON.stringify(await seedDemo(db), null, 2));
  } else if (command === 'role') {
    // Credentials come from the environment only; nothing is written into SQL files.
    const password = process.env.ICONCRETE_APP_PASSWORD;
    if (!password || password.trim().length < 8) {
      console.error(
        'ICONCRETE_APP_PASSWORD must be set to a value of at least 8 characters.\n' +
          'Example: ICONCRETE_APP_PASSWORD="$(openssl rand -base64 24)" bun run db:role',
      );
      process.exit(5);
    }
    // ALTER ROLE cannot take bind parameters; quote the value first so nothing is interpolated raw.
    const quoted = await db.unsafe<{ q: string }>(`select quote_literal($1) as q`, [password]);
    const literal = quoted[0]?.q;
    if (!literal) throw new Error('could not quote the role password');
    await db.unsafe(`alter role iconcrete_app with password ${literal}`);
    console.log('role iconcrete_app password updated from ICONCRETE_APP_PASSWORD (value not printed)');
  } else if (command === 'status') {
    console.log(JSON.stringify(await databaseStatus(db), null, 2));
  } else {
    console.error(`unknown command "${command}" — use migrate, seed, reset, role or status`);
    process.exit(2);
  }

  await db.close();
} catch (error) {
  if (error instanceof StorageModeError) {
    console.error(`[${error.code}] ${error.message}`);
    process.exit(4);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
