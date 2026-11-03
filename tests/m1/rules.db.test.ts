/**
 * R1 — rule repository (spec §26 rule classes, §68.A, §68.H).
 *
 * Database tests: RLS, audit rows and append-only enforcement are schema behaviour, so the
 * in-memory adapter cannot prove them.
 *
 * Fixtures use a unique code per run and are intentionally left behind: rule_evaluations and
 * rule_overrides are append-only even for the owner (verification evidence is not deleted).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { RuleService } from '../../server/services/rules';
import type { B1Context } from '../../server/services/projects';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run rule repository tests.';

if (SKIP_REASON) console.warn(`[R1 rule tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const ctx = (companyId: string, roleLevel = 5): B1Context => ({
  tenant: { companyId, plantIds: [], userId: 'USR-R1', requestId: 'r1-test' },
  actor: { userId: 'USR-R1', username: 'admin', roleLevel, ip: '127.0.0.1', requestId: 'r1-test' },
});

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fixtureCode = `test.r1.${tag}`;
const otherTenantCode = `test.r1_other.${tag}`;
const entityId = `BAT-R1-${tag.toUpperCase()}`;

/** Bun returns jsonb either decoded or as text, depending on the driver path. */
const parseJson = <T>(value: unknown): T =>
  (typeof value === 'string' ? JSON.parse(value) : value) as T;

describeDb('rule repository', () => {
  let admin: Db;
  let app: Db;
  let rules: RuleService;
  let fixtureId = '';
  let otherTenantId = '';

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    rules = new RuleService(app);

    fixtureId = `RUL-TEST-${tag.toUpperCase()}`;
    otherTenantId = `RUL-TEST-OTHER-${tag.toUpperCase()}`;
    await admin.withTenant({ companyId: 'CMP-0001', plantIds: [] }, async (tx) => {
      await tx.unsafe(
        `insert into rule_definitions (id, company_id, code, module, classification, unit)
         values ($1, 'CMP-0001', $2, 'batching', 'mandatory_failure', 'ratio')`,
        [fixtureId, fixtureCode],
      );
    });
    await admin.withTenant({ companyId: 'CMP-0002', plantIds: [] }, async (tx) => {
      await tx.unsafe(
        `insert into rule_definitions (id, company_id, code, module, classification, unit)
         values ($1, 'CMP-0002', $2, 'batching', 'warning', '%')`,
        [otherTenantId, otherTenantCode],
      );
    });
  });

  afterAll(async () => {
    await app?.close();
    await admin?.close();
  });

  dbTest('seeds the catalogue per company and keeps tenants apart', async () => {
    const one = await rules.list(ctx('CMP-0001'));
    const two = await rules.list(ctx('CMP-0002'));

    expect(one.length).toBeGreaterThanOrEqual(10);
    expect(two.length).toBeGreaterThanOrEqual(10);

    const seeded = one.find((rule) => rule.code === 'batch.water_ratio_max');
    expect(seeded).toBeDefined();
    expect(seeded?.classification).toBe('approval_required');
    expect(seeded?.value).toBeNull();
    expect(seeded?.configured).toBe(false);
    expect(seeded?.value_display).toBe('not specified in the supplied reference');

    const seededTwo = two.find((rule) => rule.code === 'batch.water_ratio_max');
    expect(seededTwo?.id).not.toBe(seeded?.id);

    expect(one.some((rule) => rule.code === otherTenantCode)).toBe(false);
    expect(two.some((rule) => rule.code === otherTenantCode)).toBe(true);
    expect(two.some((rule) => rule.code === fixtureCode)).toBe(false);
  });

  dbTest('a rule with no value evaluates to approval_required and is recorded', async () => {
    const evaluation = await rules.evaluate(ctx('CMP-0001'), fixtureCode, {
      entityType: 'batch',
      entityId,
      actual: 0.6,
      comparator: 'lte',
    });

    expect(evaluation.outcome).toBe('approval_required');
    expect(evaluation.unconfigured).toBe(true);
    expect(evaluation.actual).toBe(0.6);
    expect(evaluation.value).toBeNull();

    const rows = await admin.unsafe<{ outcome: string; input_snapshot: unknown }>(
      `select outcome, input_snapshot from rule_evaluations
        where rule_code = $1 and entity_id = $2 order by id desc limit 1`,
      [fixtureCode, entityId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.outcome).toBe('approval_required');
    const snapshot = parseJson<Record<string, unknown>>(rows[0]?.input_snapshot);
    expect(snapshot.value).toBeNull();
    expect(Number(snapshot.actual)).toBe(0.6);
  });

  dbTest("another tenant cannot evaluate this tenant's rule", async () => {
    let caught: unknown = null;
    try {
      await rules.evaluate(ctx('CMP-0002'), fixtureCode, {
        entityType: 'batch',
        entityId,
        actual: 1,
        comparator: 'lte',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof M1Error).toBe(true);
    expect((caught as M1Error).status).toBe(404);
  });

  dbTest('only level 5 may set a value, and the change is audited', async () => {
    let caught: unknown = null;
    try {
      await rules.updateValue(ctx('CMP-0001', 4), fixtureCode, {
        value: 0.5,
        unit: 'ratio',
        sourceNote: 'project specification rev 3',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof M1Error).toBe(true);
    expect((caught as M1Error).code).toBe('forbidden');

    const unchanged = await rules.get(ctx('CMP-0001'), fixtureCode);
    expect(unchanged.value).toBeNull();
    expect(unchanged.configured).toBe(false);

    const updated = await rules.updateValue(ctx('CMP-0001'), fixtureCode, {
      value: 0.5,
      unit: 'ratio',
      sourceNote: 'project specification rev 3',
    });
    expect(updated.value).toBe(0.5);
    expect(updated.source_note).toBe('project specification rev 3');
    expect(updated.configured).toBe(true);
    expect(updated.approved_by).toBe('admin');
    expect(updated.version).toBe(2);

    const audits = await admin.unsafe<{ details: unknown }>(
      `select details from audit_log
        where action = 'rule.value_changed' and record_id = $1 order by id desc limit 1`,
      [fixtureId],
    );
    expect(audits.length).toBe(1);
    const details = parseJson<{
      before?: { value?: number | null };
      after?: { value?: number | null; sourceNote?: string };
    }>(audits[0]?.details);
    expect(details.before?.value).toBeNull();
    expect(Number(details.after?.value)).toBe(0.5);
    expect(details.after?.sourceNote).toBe('project specification rev 3');
  });

  dbTest('a configured rule applies its classification', async () => {
    const pass = await rules.evaluate(ctx('CMP-0001'), fixtureCode, {
      entityType: 'batch',
      entityId,
      actual: 0.4,
      comparator: 'lte',
    });
    expect(pass.outcome).toBe('pass');
    expect(pass.unconfigured).toBe(false);

    const failure = await rules.evaluate(ctx('CMP-0001'), fixtureCode, {
      entityType: 'batch',
      entityId,
      actual: 0.51,
      comparator: 'lte',
    });
    expect(failure.outcome).toBe('failure');
    expect(failure.requiresOverride).toBe(false);
  });

  dbTest('an override stores rule, entity, actor, reason, time and decision', async () => {
    const override = await rules.override(ctx('CMP-0001'), fixtureCode, {
      entityType: 'batch',
      entityId,
      reason: 'client engineer approved the delay in writing',
      decision: 'approved',
    });

    const rows = await admin.unsafe<{
      rule_id: string;
      actor: string;
      reason: string;
      decided_at: string;
      decision: string;
    }>(
      `select rule_id, actor, reason, decided_at, decision from rule_overrides where id = $1`,
      [override.id],
    );
    const row = rows[0];
    expect(row?.rule_id).toBe(fixtureId);
    expect(row?.actor).toBe('admin');
    expect(row?.reason).toBe('client engineer approved the delay in writing');
    expect(row?.decided_at).toBeTruthy();
    expect(row?.decision).toBe('approved');

    const audits = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from audit_log
        where action = 'rule.overridden' and record_id = $1`,
      [fixtureId],
    );
    expect(audits[0]?.n).toBe(1);
  });

  dbTest('an override without a reason is refused and writes nothing', async () => {
    const before = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from rule_overrides where rule_code = $1`,
      [fixtureCode],
    );

    let caught: unknown = null;
    try {
      await rules.override(ctx('CMP-0001'), fixtureCode, {
        entityType: 'batch',
        entityId,
        reason: '   ',
        decision: 'approved',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof M1Error).toBe(true);
    expect((caught as M1Error).code).toBe('validation_error');
    expect((caught as M1Error).details?.field).toBe('reason');

    const after = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from rule_overrides where rule_code = $1`,
      [fixtureCode],
    );
    expect(after[0]?.n).toBe(before[0]?.n ?? 0);
  });

  dbTest('evaluations and overrides reject updates and deletes', async () => {
    const evaluation = await admin.unsafe<{ id: string }>(
      `select id::text as id from rule_evaluations where rule_code = $1 order by id desc limit 1`,
      [fixtureCode],
    );
    const evaluationId = evaluation[0]?.id ?? '';
    expect(evaluationId).not.toBe('');

    await expect(
      admin.unsafe(`update rule_evaluations set outcome = 'pass' where id = $1`, [evaluationId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.unsafe(`delete from rule_overrides where rule_code = $1`, [fixtureCode]),
    ).rejects.toThrow(/append-only/);
  });
});
