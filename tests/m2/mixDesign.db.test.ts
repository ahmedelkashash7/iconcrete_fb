/**
 * M2 — mix design repository (lifecycle, immutability, RLS, override evidence).
 *
 * Database tests: RLS, the append-only override stream and the immutability trigger are
 * schema behaviour the in-memory adapter cannot prove.
 *
 * Fixtures use a unique code per run. rule_overrides rows are append-only evidence and are
 * intentionally left behind, exactly as in the R1 rule tests.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { MixDesignService } from '../../server/services/mixDesign';
import type { B1Context } from '../../server/services/projects';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run mix design tests.';

if (SKIP_REASON) console.warn(`[M2 mix design tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const ctx = (companyId: string, roleLevel = 5): B1Context => ({
  tenant: { companyId, plantIds: [], userId: 'USR-M2', requestId: 'm2-test' },
  actor: { userId: 'USR-M2', username: 'admin', roleLevel, ip: '127.0.0.1', requestId: 'm2-test' },
});

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fixtureCode = `test.m2.${tag}`;

const basePayload = (code: string, overrides: Record<string, unknown> = {}) => ({
  plantId: '',
  code,
  nameAr: 'خلط تجريبي',
  nameEn: 'Demo mix',
  strengthClass: 'C35/45',
  components: [
    { materialId: 'MAT-001', role: 'cement', qtyPerM3: 350, unit: 'kg', moistureBasis: '' },
  ],
  strengthTests: [{ ageDays: 28, targetMinMpa: 30, sourceNote: 'client specification rev 1' }],
  ...overrides,
});

const expectM1 = async (run: () => Promise<unknown>, code: string, status?: number): Promise<M1Error> => {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(M1Error);
  const m1 = caught as M1Error;
  expect(m1.code).toBe(code);
  if (status !== undefined) expect(m1.status).toBe(status);
  return m1;
};

describeDb('mix design repository', () => {
  let admin: Db;
  let app: Db;
  let designs: MixDesignService;
  let plantId = '';
  let approvedId = '';
  let approvedVersionId = '';
  let draftId = '';

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    designs = new MixDesignService(app);

    const plants = await admin.unsafe<{ id: string }>(
      `select id from plants where company_id = 'CMP-0001' and deleted_at is null order by id`,
    );
    plantId = plants[0]?.id ?? '';
    expect(plantId).not.toBe('');
  });

  afterAll(async () => {
    await app?.close();
    await admin?.close();
  });

  dbTest('creates a draft version and refuses a duplicate code as mandatory_failure', async () => {
    const created = await designs.create(ctx('CMP-0001', 4), basePayload(fixtureCode, { plantId }) as never);
    approvedId = created.id;
    expect(created.code).toBe(fixtureCode);
    expect(created.current_version).toBe(1);
    expect(created.versions).toHaveLength(1);
    expect(created.versions[0]?.status).toBe('draft');
    expect(created.versions[0]?.components).toHaveLength(1);
    expect(created.versions[0]?.strength_tests[0]?.source_note).not.toBe('');

    const error = await expectM1(
      () => designs.create(ctx('CMP-0001', 4), basePayload(fixtureCode, { plantId }) as never),
      'mandatory_failure',
      409,
    );
    expect((error.details as Record<string, unknown>).check).toBe('code_unique');
  });

  dbTest('refuses a non-positive quantity as mandatory_failure and a missing source note as approval_required', async () => {
    await expectM1(
      () =>
        designs.create(
          ctx('CMP-0001', 4),
          basePayload(`test.m2.qty.${tag}`, {
            plantId,
            components: [{ materialId: 'MAT-001', role: 'cement', qtyPerM3: 0, unit: 'kg', moistureBasis: '' }],
          }) as never,
        ),
      'mandatory_failure',
      422,
    );

    await expectM1(
      () =>
        designs.create(
          ctx('CMP-0001', 4),
          basePayload(`test.m2.src.${tag}`, {
            plantId,
            strengthTests: [{ ageDays: 28, targetMinMpa: 30, sourceNote: '  ' }],
          }) as never,
        ),
      'approval_required',
      422,
    );
  });

  dbTest('runs draft → submitted and refuses every other transition', async () => {
    const submitted = await designs.submit(ctx('CMP-0001', 4), approvedId, 1);
    expect(submitted.status).toBe('submitted');

    await expectM1(() => designs.submit(ctx('CMP-0001', 4), approvedId, 1), 'invalid_transition', 409);
    await expectM1(() => designs.approve(ctx('CMP-0001', 5), approvedId, 2), 'mix_version_not_found', 404);

    const draft = await designs.create(
      ctx('CMP-0001', 4),
      basePayload(`test.m2.draft.${tag}`, { plantId }) as never,
    );
    draftId = draft.id;
    await expectM1(() => designs.approve(ctx('CMP-0001', 5), draftId, 1), 'invalid_transition', 409);
  });

  dbTest('refuses approval below level 5', async () => {
    await expectM1(() => designs.approve(ctx('CMP-0001', 4), approvedId, 1), 'forbidden', 403);
  });

  dbTest('an unknown strength class blocks approval as approval_required', async () => {
    const unknown = await designs.create(
      ctx('CMP-0001', 4),
      basePayload(`test.m2.grade.${tag}`, { plantId, strengthClass: 'MIX-99' }) as never,
    );
    await designs.submit(ctx('CMP-0001', 4), unknown.id, 1);

    const error = await expectM1(
      () => designs.approve(ctx('CMP-0001', 5), unknown.id, 1),
      'approval_required',
      422,
    );
    expect((error.details as Record<string, unknown>).check).toBe('strength_class_known');

    const stored = await admin.unsafe<{ status: string }>(
      `select status from mix_design_versions where mix_id = $1 and version_no = 1`,
      [unknown.id],
    );
    expect(stored[0]?.status).toBe('submitted');
  });

  dbTest('approves at level 5 and points the design at the approved version', async () => {
    const approved = await designs.approve(ctx('CMP-0001', 5), approvedId, 1);
    expect(approved.status).toBe('approved');
    expect(approved.immutable).toBe(true);
    expect(approved.approved_by).toBe('admin');
    approvedVersionId = approved.id;

    const design = await designs.get(ctx('CMP-0001', 5), approvedId);
    expect(design.current_version).toBe(1);
    expect(design.approved_version).toBe(1);
    expect(design.current_status).toBe('approved');
  });

  dbTest('an approved version cannot be edited — not by the service and not by direct SQL', async () => {
    const error = await expectM1(
      () =>
        designs.updateDraft(ctx('CMP-0001', 4), approvedId, 1, {
          components: [{ materialId: 'MAT-002', role: 'sand', qtyPerM3: 700, unit: 'kg', moistureBasis: '' }],
        }),
      'mandatory_failure',
      409,
    );
    expect((error.details as Record<string, unknown>).check).toBe('version_editable');

    let triggerFired = false;
    try {
      await admin.unsafe(`update mix_components set qty_per_m3 = 1 where version_id = $1`, [approvedVersionId]);
    } catch (caught) {
      triggerFired = true;
      expect(String(caught)).toContain('immutable');
    }
    expect(triggerFired).toBe(true);

    let versionTriggerFired = false;
    try {
      await admin.unsafe(`update mix_design_versions set strength_class = 'C12/15' where id = $1`, [
        approvedVersionId,
      ]);
    } catch (caught) {
      versionTriggerFired = true;
      expect(String(caught)).toContain('immutable');
    }
    expect(versionTriggerFired).toBe(true);
  });

  dbTest('supersede needs a reason and records the override with all five fields', async () => {
    await expectM1(
      () => designs.supersede(ctx('CMP-0001', 5), approvedId, 1, ' x '),
      'validation_error',
      422,
    );

    const reason = 'client changed the specification in writing';
    const result = await designs.supersede(ctx('CMP-0001', 5), approvedId, 1, reason);
    expect(result.version.version_no).toBe(2);
    expect(result.version.status).toBe('draft');
    expect(result.override.actor).toBe('admin');
    expect(result.override.reason).toBe(reason);
    expect(result.override.decision).toBe('approved');
    expect(result.override.ruleCode).toBe('mix.approved_version_edit');
    expect(Date.parse(result.override.decidedAt)).not.toBeNaN();

    const rows = await admin.unsafe<{
      actor: string;
      reason: string;
      decision: string;
      rule_id: string;
      rule_code: string;
      decided_at: string;
      entity_type: string;
      entity_id: string;
    }>(
      `select actor, reason, decision, rule_id, rule_code, decided_at, entity_type, entity_id
         from rule_overrides where id = $1`,
      [result.override.id],
    );
    const row = rows[0];
    expect(row?.actor).toBe('admin');
    expect(row?.reason).toBe(reason);
    expect(row?.decision).toBe('approved');
    expect(row?.rule_code).toBe('mix.approved_version_edit');
    expect(row?.entity_type).toBe('mix_design_version');
    expect(row?.entity_id).toBe(result.override.entityId);
    expect(row?.rule_id).toBe(`RUL-CMP-0001-mix_approved_version_edit`);
    expect(Date.parse(row?.decided_at ?? '')).not.toBeNaN();

    const audits = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from audit_log where action = 'mix.version_superseded' and record_id = $1`,
      [approvedId],
    );
    expect(audits[0]?.n).toBe(1);

    const old = await admin.unsafe<{ status: string }>(
      `select status from mix_design_versions where id = $1`,
      [approvedVersionId],
    );
    expect(old[0]?.status).toBe('superseded');
  });

  dbTest('keeps tenants apart: another company sees neither the design nor its rows', async () => {
    const list = await designs.list(ctx('CMP-0002'));
    expect(list.some((row) => row.id === approvedId)).toBe(false);

    await expectM1(() => designs.get(ctx('CMP-0002'), approvedId), 'mix_design_not_found', 404);

    // With company B's tenant context the RLS policy hides company A's rows entirely.
    const scoped = await app.withTenant({ companyId: 'CMP-0002', plantIds: [], userId: 'USR-M2' }, (tx) =>
      tx.unsafe<{ n: number }>(`select count(*)::int as n from mix_designs where id = $1`, [approvedId]),
    );
    expect(scoped[0]?.n).toBe(0);
  });

  dbTest('a level-1 reader gets the catalogue and a draft design can be deleted', async () => {
    const readable = await designs.list(ctx('CMP-0001', 1));
    expect(readable.some((row) => row.id === approvedId)).toBe(true);
    const detail = await designs.get(ctx('CMP-0001', 1), approvedId);
    expect(detail.checks.length).toBeGreaterThan(0);

    await expectM1(() => designs.remove(ctx('CMP-0001', 4), approvedId), 'mandatory_failure', 409);

    await designs.remove(ctx('CMP-0001', 4), draftId);
    await expectM1(() => designs.get(ctx('CMP-0001', 4), draftId), 'mix_design_not_found', 404);
  });
});
