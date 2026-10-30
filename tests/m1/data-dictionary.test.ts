/**
 * The committed data dictionary must match the live schema exactly.
 *
 * Fails when a table, column, type, default, FK, unique or CHECK constraint is added or
 * changed without regenerating docs/DATA_DICTIONARY.md (`bun run schema:docs`).
 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { renderDictionary } from '../../scripts/schema-docs';

const DATABASE_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? '';
const SKIP_REASON = DATABASE_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL to verify the generated data dictionary.';

if (SKIP_REASON) console.warn(`[data dictionary test skipped] ${SKIP_REASON}`);

const dbTest = SKIP_REASON ? test.skip : test;

dbTest('docs/DATA_DICTIONARY.md equals the live schema rendering', async () => {
  const db = (await createDb({ mode: 'postgres', databaseUrl: DATABASE_URL })) as Db;
  try {
    const rendered = await renderDictionary(db);
    const committed = readFileSync('docs/DATA_DICTIONARY.md', 'utf8');
    expect(committed.trimEnd()).toBe(rendered.trimEnd());

    const tableCount = (rendered.match(/^## `/gm) ?? []).length;
    expect(tableCount).toBeGreaterThanOrEqual(45);
    expect(rendered).toContain('| `company_id` | text | no |');
    expect(rendered).toContain('foreign key');
    expect(rendered).toContain('check');
  } finally {
    await db.close();
  }
});
