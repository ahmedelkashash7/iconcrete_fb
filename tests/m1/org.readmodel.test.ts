import { TEST_ADMIN_PASSWORD } from '../helpers/credentials';
/**
 * Tenant-scoped users and plants (gap G1) against a real PostgreSQL server.
 *
 * Every read goes through the restricted application role, so RLS is genuinely exercised.
 * The owner connection is used only for fixtures and cleanup.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { loadCompanyForTenant, loadPlantsForTenant, loadUsersForTenant } from '../../server/db/orgRepo';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? '';
const SKIP_REASON =
  ADMIN_URL && RLS_URL
    ? null
    : 'PostgreSQL not configured: set DATABASE_URL and ICONCRETE_RLS_URL to run organisation read-model tests.';

if (SKIP_REASON) console.warn(`[organisation read-model tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

let admin: Db;
let app: Db;

const PLANT_A = 'PLT-G1-A';
const PLANT_B = 'PLT-G1-B';
const USER_A = 'USR-G1-A';
const USER_B = 'USR-G1-B';
const USER_X = 'USR-G1-X';

const ctx = (companyId: string, plantIds: string[] = []) => ({
  companyId,
  plantIds,
  userId: USER_A,
});

const insertFixture = async (id: string, companyId: string, plants: string[], username: string) => {
  await admin.unsafe(
    `insert into users (id, company_id, username, password_hash, full_name_ar, full_name_en, role_level, assigned_plant_ids)
     values ($1,$2,$3,'x',$3,$3,5,$4::text[])
     on conflict (id) do update set assigned_plant_ids = excluded.assigned_plant_ids`,
    [id, companyId, username, `{${plants.join(',')}}`],
  );
};

describeDb('tenant-scoped users and plants', () => {
  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);

    await admin.unsafe(
      `insert into plants (id, company_id, name_ar, name_en, city)
       values ($1,'CMP-0001','محطة أ','Plant A','Cairo'), ($2,'CMP-0001','محطة ب','Plant B','Giza')
       on conflict (id) do nothing`,
      [PLANT_A, PLANT_B],
    );
    await insertFixture(USER_A, 'CMP-0001', [PLANT_A], 'g1.a');
    await insertFixture(USER_B, 'CMP-0001', [PLANT_B], 'g1.b');
    await insertFixture(USER_X, 'CMP-0002', [], 'g1.x');
  });

  afterAll(async () => {
    await admin?.unsafe(`delete from users where id in ($1,$2,$3)`, [USER_A, USER_B, USER_X]);
    await admin?.unsafe(`delete from plants where id in ($1,$2)`, [PLANT_A, PLANT_B]);
    await app?.close();
    await admin?.close();
  });

  dbTest('company A reads its own users and never company B rows', async () => {
    const one = await loadUsersForTenant(app, ctx('CMP-0001'));
    const two = await loadUsersForTenant(app, ctx('CMP-0002'));

    expect(one.some((user) => user.id === USER_A)).toBe(true);
    expect(one.some((user) => user.id === USER_B)).toBe(true);
    expect(one.some((user) => user.id === USER_X)).toBe(false);
    expect(two.some((user) => user.id === USER_X)).toBe(true);
    expect(two.some((user) => user.id === USER_A)).toBe(false);
    expect(one.every((user) => user.company_id === 'CMP-0001')).toBe(true);

    // No password hashes or demo rows can leak through the read model.
    const serialized = JSON.stringify(one);
    expect(serialized.includes('password_hash')).toBe(false);
    expect(serialized.includes(TEST_ADMIN_PASSWORD)).toBe(false);
  });

  dbTest('company A reads only its own plants', async () => {
    const one = await loadPlantsForTenant(app, ctx('CMP-0001'));
    const two = await loadPlantsForTenant(app, ctx('CMP-0002'));

    expect(one.some((plant) => plant.id === PLANT_A)).toBe(true);
    expect(two.some((plant) => plant.id === PLANT_A)).toBe(false);
    expect(one.every((plant) => plant.company_id === 'CMP-0001')).toBe(true);
    expect(two.every((plant) => plant.company_id === 'CMP-0002')).toBe(true);
  });

  dbTest('a plant-scoped caller cannot read another plant or its users', async () => {
    const users = await loadUsersForTenant(app, ctx('CMP-0001', [PLANT_A]));
    const plants = await loadPlantsForTenant(app, ctx('CMP-0001', [PLANT_A]));

    expect(users.map((user) => user.id)).toContain(USER_A);
    expect(users.map((user) => user.id)).not.toContain(USER_B);
    expect(plants.map((plant) => plant.id)).toEqual([PLANT_A]);
  });

  dbTest('demo rows never appear in postgres mode', async () => {
    const adminCount = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from users where company_id = 'CMP-0001' and deleted_at is null`,
    );
    const users = await loadUsersForTenant(app, ctx('CMP-0001'));
    expect(users.length).toBe(adminCount[0]?.n ?? -1);
  });

  dbTest('a restart returns the same rows', async () => {
    const before = await loadUsersForTenant(app, ctx('CMP-0001'));
    const fresh = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    const after = await loadUsersForTenant(fresh, ctx('CMP-0001'));
    await fresh.close();

    expect(after.map((user) => user.id)).toEqual(before.map((user) => user.id));
    expect(after.length).toBeGreaterThan(0);
  });

  dbTest('returns the real company name for the tenant', async () => {
    const company = await loadCompanyForTenant(app, ctx('CMP-0002'));
    expect(company?.id).toBe('CMP-0002');
    expect(company?.name_ar.length).toBeGreaterThan(0);
    expect(await loadCompanyForTenant(app, ctx('CMP-9999'))).toBeNull();
  });
});
