/**
 * M3 — batching.
 *
 * The first block is pure: lifecycle transitions, the configurable moisture window, and the
 * four measured rules going through the R1 engine (a configured band decides, an
 * unconfigured one never passes, a warning never blocks).
 *
 * The database block proves what only PostgreSQL can: the completed row is immutable, the
 * unique batch_no index holds, an override carries all five evidence fields, two concurrent
 * completions produce exactly one winner, and another tenant sees nothing.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { BatchingService } from '../../server/services/batching';
import { MixDesignService } from '../../server/services/mixDesign';
import type { B1Context } from '../../server/services/projects';
import {
  BATCH_RULES,
  canTransition,
  checkAggregateDeviation,
  checkCementWaterDeviation,
  checkMoistureReadingValid,
  deviationPercent,
  roleDeviationPercent,
} from '../../src/core/batching';
import { evaluateRule, validateOverride, type RuleDefinition } from '../../src/core/rules';

const rule = (
  key: 'cementWaterDeviation' | 'aggregateDeviation' | 'yieldOutsideBand',
  value: number,
): RuleDefinition => ({
  code: `batch.${key}`,
  module: 'batching',
  classification: BATCH_RULES[key],
  value,
  unit: '%',
  sourceNote: 'internal test reference',
  status: 'active',
});

describe('batching core', () => {
  test('lifecycle allows only the documented transitions and keeps completed terminal', () => {
    expect(canTransition('planned', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('planned', 'completed')).toBe(false);
    expect(canTransition('held', 'in_progress')).toBe(true);
    expect(canTransition('planned', 'cancelled')).toBe(true);

    for (const to of ['planned', 'in_progress', 'completed', 'held', 'cancelled'] as const) {
      expect(canTransition('completed', to)).toBe(false);
    }
  });

  test('a moisture reading cannot pass without a configured window', () => {
    const sampleAt = new Date('2026-11-03T08:00:00.000Z');
    const validUntil = new Date('2026-11-03T12:00:00.000Z');

    const unconfigured = checkMoistureReadingValid(validUntil, sampleAt, null);
    expect(unconfigured.outcome).toBe('failure');
    expect(unconfigured.reasonKey).toBe('batch.moisture_window_unconfigured');

    const configured = checkMoistureReadingValid(validUntil, sampleAt, 2);
    expect(configured.outcome).toBe('pass');

    const expired = checkMoistureReadingValid(new Date('2026-11-03T09:00:00.000Z'), sampleAt, 2);
    expect(expired.outcome).toBe('failure');
  });

  test('deviation helpers measure the worst component per role', () => {
    expect(deviationPercent(100, 105)).toBeCloseTo(5, 6);
    expect(deviationPercent(100, 100)).toBe(0);
    expect(deviationPercent(0, 5)).toBeNull();
    expect(deviationPercent(null, 5)).toBeNull();

    const components = [
      { materialId: 'MAT-001', targetWeight: 350, actualWeight: 350 },
      { materialId: 'MAT-006', targetWeight: 180, actualWeight: 189 },
      { materialId: 'MAT-002', targetWeight: 1800, actualWeight: 1800 },
    ];
    expect(roleDeviationPercent(components, ['cement', 'water']) as number).toBeCloseTo(5, 6);
    expect(roleDeviationPercent(components, ['aggregate'])).toBe(0);
  });

  test('a configured band classifies at its boundary: inside passes, outside is approval_required', () => {
    const band = rule('cementWaterDeviation', 5);
    expect(checkCementWaterDeviation(band, 5).outcome).toBe('pass');
    expect(checkCementWaterDeviation(band, 4.99).outcome).toBe('pass');
    expect(checkCementWaterDeviation(band, 5.01).outcome).toBe('approval_required');
    expect(checkCementWaterDeviation(band, 5.01).classification).toBe('approval_required');
  });

  test('an unconfigured rule is never a pass and a warning never blocks', () => {
    const unconfigured = checkCementWaterDeviation(null, 1);
    expect(unconfigured.outcome).toBe('approval_required');
    expect(unconfigured.reasonKey).toBe('rule.value_missing');

    const aggregate = rule('aggregateDeviation', 3);
    expect(checkAggregateDeviation(aggregate, 3.5).outcome).toBe('warning');

    const noSource = evaluateRule(
      { ...rule('aggregateDeviation', 3), sourceNote: '   ' },
      { actual: 1, comparator: 'lte' },
    );
    expect(noSource.outcome).toBe('approval_required');
    expect(noSource.unconfigured).toBe(true);
  });

  test('an override needs rule, entity, actor, reason and decision', () => {
    const base = {
      ruleCode: 'batch.water_ratio_max',
      entityType: 'batch',
      entityId: 'BCH-1',
      actor: 'manager',
      reason: 'client approved in writing',
      decision: 'approved',
    };
    expect(validateOverride(base)).toBeNull();
    expect(validateOverride({ ...base, reason: ' x ' })?.field).toBe('reason');
    expect(validateOverride({ ...base, actor: ' ' })?.field).toBe('actor');
    expect(validateOverride({ ...base, decision: 'maybe' })?.field).toBe('decision');
  });
});

// ------------------------------------------------------------------ database tests
const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run batching tests.';

if (SKIP_REASON) console.warn(`[M3 batching tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const ctx = (companyId: string, roleLevel = 5): B1Context => ({
  tenant: { companyId, plantIds: [], userId: 'USR-M3', requestId: 'm3-test' },
  actor: { userId: 'USR-M3', username: 'admin', roleLevel, ip: '127.0.0.1', requestId: 'm3-test' },
});

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

describeDb('batching repository', () => {
  let admin: Db;
  let app: Db;
  let batches: BatchingService;
  let designs: MixDesignService;
  let plantId = '';
  let approvedVersionId = '';
  let batchId = '';
  let overriddenBatchId = '';
  let warningBatchId = '';
  let raceBatchId = '';

  const configure = async (code: string, value: number) => {
    await admin.unsafe(
      `update rule_definitions set value = $3, unit = '%', source_note = 'internal test reference'
        where company_id = $1 and code = $2`,
      ['CMP-0001', code, value],
    );
  };

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    batches = new BatchingService(app);
    designs = new MixDesignService(app);

    const plants = await admin.unsafe<{ id: string }>(
      `select id from plants where company_id = 'CMP-0001' and deleted_at is null order by id limit 1`,
    );
    plantId = plants[0]?.id ?? '';
    expect(plantId).not.toBe('');

    // Values are configuration, never defaults: the seeded rules start unconfigured.
    await configure('batch.cement_water_deviation', 5);
    await configure('batch.aggregate_deviation', 3);
    await configure('batch.yield_tolerance', 2);
    await admin.unsafe(
      `update rule_definitions set value = 24, unit = 'h', source_note = 'internal test reference'
        where company_id = $1 and code = $2`,
      ['CMP-0001', 'batch.scale_calibration_interval'],
    );

    const design = await designs.create(ctx('CMP-0001', 4), {
      plantId,
      code: `test.m3.mix.${tag}`,
      nameAr: 'خلط M3',
      nameEn: 'M3 mix',
      strengthClass: 'C35/45',
      components: [
        { materialId: 'MAT-001', role: 'cement', qtyPerM3: 350, unit: 'kg', moistureBasis: '' },
      ],
      strengthTests: [{ ageDays: 28, targetMinMpa: 30, sourceNote: 'client specification rev 1' }],
    } as never);
    await designs.submit(ctx('CMP-0001', 4), design.id, 1);
    const approved = await designs.approve(ctx('CMP-0001', 5), design.id, 1);
    approvedVersionId = approved.id;
    expect(approvedVersionId).not.toBe('');
  });

  afterAll(async () => {
    delete process.env.ICONCRETE_BATCH_MOISTURE_VALID_MINUTES;
    await app?.close();
    await admin?.close();
  });

  const plan = (batchNo: string, mixVersionId = approvedVersionId) =>
    batches.create(ctx('CMP-0001', 4), {
      plantId,
      batchNo,
      orderId: null,
      mixVersionId,
      plannedVolume: 8,
      operatorId: null,
    });

  dbTest('refuses an unapproved mix version as mandatory_failure', async () => {
    const draft = await designs.create(ctx('CMP-0001', 4), {
      plantId,
      code: `test.m3.draft.${tag}`,
      nameAr: 'خلط مسودة',
      nameEn: 'Draft mix',
      strengthClass: 'C35/45',
      components: [
        { materialId: 'MAT-001', role: 'cement', qtyPerM3: 350, unit: 'kg', moistureBasis: '' },
      ],
      strengthTests: [{ ageDays: 28, targetMinMpa: 30, sourceNote: 'client specification rev 1' }],
    } as never);
    const draftVersionId = draft.versions[0]?.id ?? '';

    const error = await expectM1(
      () => plan(`BO-${tag}-DRAFT`, draftVersionId),
      'mandatory_failure',
      422,
    );
    expect((error.details as Record<string, unknown>).check).toBe('mixVersionApproved');
  });

  dbTest('plans an approved batch, refuses a duplicate batch_no, and starts it', async () => {
    const created = await plan(`BO-${tag}-1`);
    batchId = created.id;
    expect(created.batch_no).toBe(`BO-${tag}-1`);
    expect(created.status).toBe('planned');

    const duplicate = await expectM1(() => plan(`BO-${tag}-1`), 'mandatory_failure', 409);
    expect((duplicate.details as Record<string, unknown>).check).toBe('batchNoUnique');

    const started = await batches.start(ctx('CMP-0001', 3), batchId, { operatorId: null });
    expect(started.status).toBe('in_progress');
  });

  dbTest('refuses completion without a moisture window and then accepts a refreshed reading', async () => {
    delete process.env.ICONCRETE_BATCH_MOISTURE_VALID_MINUTES;
    await batches.recordMoisture(ctx('CMP-0001', 3), batchId, {
      materialId: 'MAT-002',
      basis: 'dry',
      moisturePct: 3.2,
      absorptionPct: null,
      validUntil: new Date(Date.now() + 6 * 3600_000).toISOString(),
    });

    const blocked = await expectM1(
      () =>
        batches.complete(ctx('CMP-0001', 3), batchId, {
          actualVolume: 8,
          scaleCalibratedAt: new Date().toISOString(),
          components: [],
        }),
      'mandatory_failure',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('moistureReadingValid');

    process.env.ICONCRETE_BATCH_MOISTURE_VALID_MINUTES = '120';
    await batches.recordMoisture(ctx('CMP-0001', 3), batchId, {
      materialId: 'MAT-002',
      basis: 'dry',
      moisturePct: 3.4,
      absorptionPct: null,
      validUntil: new Date(Date.now() + 3 * 3600_000).toISOString(),
    });

    const completed = await batches.complete(ctx('CMP-0001', 3), batchId, {
      actualVolume: 8.05,
      scaleCalibratedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      components: [
        { materialId: 'MAT-001', targetWeight: 350, actualWeight: 355, unit: 'kg', tolerancePct: null },
        { materialId: 'MAT-006', targetWeight: 180, actualWeight: 182, unit: 'kg', tolerancePct: null },
        { materialId: 'MAT-002', targetWeight: 1800, actualWeight: 1810, unit: 'kg', tolerancePct: null },
      ],
    });
    expect(completed.status).toBe('completed');
    expect(completed.actual_volume).toBeCloseTo(8.05, 3);
    expect(completed.components).toHaveLength(3);
    expect(completed.checks.every((check) => check.outcome !== 'failure')).toBe(true);
  });

  dbTest('a completed batch is immutable, by the service and by direct SQL', async () => {
    const run = () => batches.cancel(ctx('CMP-0001', 4), batchId);
    await expectM1(run, 'invalid_transition', 409);

    let triggerFired = false;
    try {
      await admin.unsafe(`update batches set actual_volume = 1 where id = $1`, [batchId]);
    } catch (caught) {
      triggerFired = true;
      expect(String(caught)).toContain('cannot be edited');
    }
    expect(triggerFired).toBe(true);
  });

  dbTest('cement/water deviation outside the band blocks until an override is recorded', async () => {
    const created = await plan(`BO-${tag}-2`);
    overriddenBatchId = created.id;
    await batches.start(ctx('CMP-0001', 3), overriddenBatchId, { operatorId: null });

    const payload = {
      actualVolume: 8,
      scaleCalibratedAt: new Date().toISOString(),
      components: [
        { materialId: 'MAT-001', targetWeight: 350, actualWeight: 400, unit: 'kg', tolerancePct: null },
      ],
    };

    const blocked = await expectM1(
      () => batches.complete(ctx('CMP-0001', 3), overriddenBatchId, payload),
      'approval_required',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('cementWaterDeviation');

    const rules = await admin.unsafe<{ id: string }>(
      `select id from rule_definitions where company_id = 'CMP-0001' and code = 'batch.cement_water_deviation'`,
    );
    const ruleId = rules[0]?.id ?? '';
    expect(ruleId).not.toBe('');

    const override = await batches.override(ctx('CMP-0001', 4), overriddenBatchId, {
      ruleId,
      ruleCode: 'batch.cement_water_deviation',
      entityType: 'batch',
      entityId: overriddenBatchId,
      reason: 'client approved the wet mix in writing',
      decision: 'approved',
    });
    expect(override.actor).toBe('admin');
    expect(override.decision).toBe('approved');

    const stored = await admin.unsafe<{
      actor: string;
      reason: string;
      decision: string;
      rule_id: string;
      rule_code: string;
      decided_at: string;
    }>(
      `select actor, reason, decision, rule_id, rule_code, decided_at
         from batch_overrides where id = $1`,
      [override.id],
    );
    expect(stored[0]?.actor).toBe('admin');
    expect(stored[0]?.reason).toBe('client approved the wet mix in writing');
    expect(stored[0]?.decision).toBe('approved');
    expect(stored[0]?.rule_id).toBe(ruleId);
    expect(stored[0]?.rule_code).toBe('batch.cement_water_deviation');
    expect(Date.parse(stored[0]?.decided_at ?? '')).not.toBeNaN();

    const audits = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from audit_log where action = 'batch.override' and record_id = $1`,
      [overriddenBatchId],
    );
    expect(audits[0]?.n).toBe(1);

    const completed = await batches.complete(ctx('CMP-0001', 3), overriddenBatchId, payload);
    expect(completed.status).toBe('completed');
  });

  dbTest('an aggregate deviation is a warning and does not block completion', async () => {
    const created = await plan(`BO-${tag}-3`);
    warningBatchId = created.id;
    await batches.start(ctx('CMP-0001', 3), warningBatchId, { operatorId: null });

    const completed = await batches.complete(ctx('CMP-0001', 3), warningBatchId, {
      actualVolume: 8,
      scaleCalibratedAt: new Date().toISOString(),
      components: [
        { materialId: 'MAT-001', targetWeight: 350, actualWeight: 350, unit: 'kg', tolerancePct: null },
        { materialId: 'MAT-002', targetWeight: 1800, actualWeight: 1863, unit: 'kg', tolerancePct: null },
      ],
    });
    expect(completed.status).toBe('completed');
    const aggregate = completed.checks.find((check) => check.key === 'aggregateDeviation');
    expect(aggregate?.outcome).toBe('warning');
    expect(aggregate?.classification).toBe('warning');
  });

  dbTest('only one of two concurrent completions wins', async () => {
    const created = await plan(`BO-${tag}-4`);
    raceBatchId = created.id;
    await batches.start(ctx('CMP-0001', 3), raceBatchId, { operatorId: null });

    const payload = {
      actualVolume: 8,
      scaleCalibratedAt: new Date().toISOString(),
      components: [
        { materialId: 'MAT-001', targetWeight: 350, actualWeight: 350, unit: 'kg', tolerancePct: null },
      ],
    };

    const results = await Promise.allSettled([
      batches.complete(ctx('CMP-0001', 3), raceBatchId, payload),
      batches.complete(ctx('CMP-0001', 3), raceBatchId, payload),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const rows = await admin.unsafe<{ status: string }>(
      `select status from batches where company_id = 'CMP-0001' and id = $1`,
      [raceBatchId],
    );
    expect(rows[0]?.status).toBe('completed');
  });

  dbTest('keeps tenants and plants apart', async () => {
    const other = await batches.list(ctx('CMP-0002'));
    expect(other.some((row) => row.id === batchId)).toBe(false);

    await expectM1(() => batches.get(ctx('CMP-0002'), batchId), 'batch_not_found', 404);

    const scoped = await app.withTenant({ companyId: 'CMP-0002', plantIds: [], userId: 'USR-M3' }, (tx) =>
      tx.unsafe<{ n: number }>(`select count(*)::int as n from batches where id = $1`, [batchId]),
    );
    expect(scoped[0]?.n).toBe(0);
  });

  dbTest('enforces the level guards: level 1 reads, level 3 plans, level 4 holds', async () => {
    const readable = await batches.list(ctx('CMP-0001', 1));
    expect(readable.length).toBeGreaterThan(0);

    await expectM1(
      () =>
        batches.create(ctx('CMP-0001', 1), {
          plantId,
          batchNo: `BO-${tag}-NOPE`,
          orderId: null,
          mixVersionId: approvedVersionId,
          plannedVolume: 8,
          operatorId: null,
        }),
      'forbidden',
      403,
    );

    await expectM1(() => batches.hold(ctx('CMP-0001', 3), raceBatchId, 'waiting for a pump'), 'forbidden', 403);
    await expectM1(() => batches.hold(ctx('CMP-0001', 4), raceBatchId, ' x '), 'validation_error', 422);
  });
});
