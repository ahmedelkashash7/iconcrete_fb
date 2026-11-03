/**
 * M4 — quality and laboratory.
 *
 * The pure block proves the classifications and lifecycles. The database block proves what only
 * PostgreSQL and the repository can: a lapsed calibration holds the result until recalibration,
 * a failed result opens exactly one NCR, certificates are refused for failed or unverified
 * tests, an NCR cannot close over an unverified corrective action, missing acceptance limits are
 * refused instead of auto-passed, a specimen shortfall is a recorded warning, and RLS keeps
 * tenants apart.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { QualityService } from '../../server/services/quality';
import type { B1Context } from '../../server/services/projects';
import {
  canCertificateTransition,
  canNcrTransition,
  canTestTransition,
  checkCalibrationCurrent,
  checkCapaEffectiveness,
  checkCertificateEligible,
  checkChronology,
  checkResultInSpec,
  checkSpecLimitsPresent,
  checkSpecimenCount,
  requiredAgeDays,
} from '../../src/core/quality';

const ctx = (companyId: string, roleLevel = 5): B1Context => ({
  tenant: { companyId, plantIds: [], userId: 'USR-M4', requestId: 'm4-test' },
  actor: { userId: 'USR-M4', username: 'admin', roleLevel, ip: '127.0.0.1', requestId: 'm4-test' },
});

describe('quality core', () => {
  test('lifecycles only allow the documented transitions', () => {
    expect(canTestTransition('sampled', 'testing')).toBe(true);
    expect(canTestTransition('testing', 'passed')).toBe(true);
    expect(canTestTransition('passed', 'failed')).toBe(false);
    expect(canNcrTransition('open', 'investigation')).toBe(true);
    expect(canNcrTransition('closed', 'open')).toBe(false);
    expect(canCertificateTransition('issued', 'revoked')).toBe(true);
    expect(canCertificateTransition('revoked', 'issued')).toBe(false);
  });

  test('missing acceptance limits are approval_required, never a pass', () => {
    expect(checkSpecLimitsPresent(null, 40, 'project spec').outcome).toBe('approval_required');
    expect(checkSpecLimitsPresent(20, 40, '   ').outcome).toBe('approval_required');
    expect(checkSpecLimitsPresent(20, 40, 'project spec rev A').outcome).toBe('pass');
  });

  test('a result inside the band passes, outside fails', () => {
    expect(checkResultInSpec(30, 20, 40).outcome).toBe('pass');
    expect(checkResultInSpec(19.9, 20, 40).outcome).toBe('failure');
    expect(checkResultInSpec(40.1, 20, 40).outcome).toBe('failure');
  });

  test('chronology rejects testing before sampling and a cast date after the test', () => {
    const sampled = new Date('2026-11-03T08:00:00Z');
    expect(checkChronology({ sampledAt: sampled, testedAt: new Date('2026-11-03T07:00:00Z'), castAt: null, ageDays: null }).outcome).toBe('failure');
    expect(checkChronology({ sampledAt: sampled, testedAt: new Date('2026-11-30T08:00:00Z'), castAt: new Date('2026-12-01T08:00:00Z'), ageDays: 27 }).outcome).toBe('failure');
    expect(checkChronology({ sampledAt: sampled, testedAt: new Date('2026-11-30T08:00:00Z'), castAt: new Date('2026-11-02T08:00:00Z'), ageDays: 28 }).outcome).toBe('pass');
  });

  test('calibration, certificate eligibility and CAPA effectiveness carry their classes', () => {
    expect(checkCalibrationCurrent(null, new Date(Date.now() - 3_600_000), new Date()).outcome).toBe('engineering_hold');
    expect(checkCalibrationCurrent(null, new Date(Date.now() + 3_600_000), new Date()).outcome).toBe('pass');
    expect(checkCertificateEligible('failed', true).outcome).toBe('failure');
    expect(checkCertificateEligible('passed', false).outcome).toBe('failure');
    expect(checkCertificateEligible('passed', true).outcome).toBe('pass');
    expect(checkCapaEffectiveness(1, false).outcome).toBe('approval_required');
    expect(checkCapaEffectiveness(1, true).outcome).toBe('pass');
  });

  test('specimen shortfall is a warning, and required ages have no default', () => {
    const short = checkSpecimenCount(3, 1);
    expect(short.outcome).toBe('warning');
    expect(short.classification).toBe('warning');
    expect(checkSpecimenCount(3, 3).outcome).toBe('pass');
    expect(checkSpecimenCount(null, 1).outcome).toBe('warning');
    expect(requiredAgeDays(null, 28)).toBeNull();
    expect(requiredAgeDays([7, 28, 56], 28)).toBe(true);
  });
});

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run quality tests.';

if (SKIP_REASON) console.warn(`[M4 quality tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

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

describeDb('quality repository', () => {
  let admin: Db;
  let app: Db;
  let quality: QualityService;
  let plantId = '';
  let otherPlantId = '';
  let equipmentId = '';

  const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

  const newTest = async (overrides: Record<string, unknown> = {}) =>
    quality.createTest(ctx('CMP-0001', 3), {
      plantId,
      batchId: null,
      mixVersionId: null,
      testType: 'cube_strength',
      sampledAt: iso(-3_600_000),
      ageDays: 28,
      requiredSpecimenCount: 3,
      equipmentId: null,
      specMin: 20,
      specMax: 40,
      specSourceNote: 'project specification rev A',
      ...overrides,
    } as never);

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    quality = new QualityService(app);

    const plants = await admin.unsafe<{ id: string }>(
      `select id from plants where company_id = 'CMP-0001' and deleted_at is null order by id`,
    );
    plantId = plants[0]?.id ?? '';
    otherPlantId = plants[1]?.id ?? plants[0]?.id ?? '';
    expect(plantId).not.toBe('');
  });

  afterAll(async () => {
    await app?.close();
    await admin?.close();
  });

  dbTest('a lapsed calibration raises engineering_hold and releases after recalibration', async () => {
    const equipment = await quality.createEquipment(ctx('CMP-0001', 4), {
      plantId,
      equipmentCode: `EQ-${tag}`,
      name: 'Compression machine',
      serial: 'SN-1',
      intervalDays: 365,
    });
    equipmentId = equipment.id;

    await quality.recordCalibration(ctx('CMP-0001', 4), equipmentId, {
      provider: 'internal workshop',
      calibratedAt: iso(-10 * 86_400_000),
      expiresAt: iso(-86_400_000),
      certificateRef: 'CAL-OLD',
    });

    const lapsed = await quality.listEquipment(ctx('CMP-0001', 1));
    const row = lapsed.find((candidate) => candidate.id === equipmentId);
    expect(row?.calibration_status).toBe('lapsed');
    expect(row?.status).toBe('out_of_service');

    const test = await newTest({ equipmentId });
    const blocked = await expectM1(
      () =>
        quality.recordResult(ctx('CMP-0001', 3), test.id, {
          resultValue: 30,
          resultUnit: 'MPa',
          testedAt: iso(),
          ageDays: null,
        }),
      'engineering_hold',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('calibrationCurrent');

    await quality.recordCalibration(ctx('CMP-0001', 4), equipmentId, {
      provider: 'accredited lab',
      calibratedAt: iso(),
      expiresAt: iso(365 * 86_400_000),
      certificateRef: 'CAL-NEW',
    });

    const passed = await quality.recordResult(ctx('CMP-0001', 3), test.id, {
      resultValue: 30,
      resultUnit: 'MPa',
      testedAt: iso(),
      ageDays: null,
    });
    expect(passed.status).toBe('passed');
    expect(passed.result_value).toBe(30);
  });

  dbTest('a failed result opens exactly one NCR, even on a double submit', async () => {
    const test = await newTest({ specMin: 50, specMax: 60 });
    const failed = await quality.recordResult(ctx('CMP-0001', 3), test.id, {
      resultValue: 10,
      resultUnit: 'MPa',
      testedAt: iso(),
      ageDays: null,
    });
    expect(failed.status).toBe('failed');
    expect(failed.ncr_id).not.toBeNull();

    const count = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from ncr where company_id = 'CMP-0001' and test_id = $1 and status <> 'void'`,
      [test.id],
    );
    expect(count[0]?.n).toBe(1);

    await expectM1(
      () =>
        quality.recordResult(ctx('CMP-0001', 3), test.id, {
          resultValue: 10,
          resultUnit: 'MPa',
          testedAt: iso(),
          ageDays: null,
        }),
      'invalid_transition',
      409,
    );
    const after = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from ncr where company_id = 'CMP-0001' and test_id = $1 and status <> 'void'`,
      [test.id],
    );
    expect(after[0]?.n).toBe(1);
  });

  dbTest('certificates are refused for a failed or unverified test and frozen once issued', async () => {
    const failedTest = await newTest({ specMin: 50, specMax: 60 });
    await quality.recordResult(ctx('CMP-0001', 3), failedTest.id, {
      resultValue: 5,
      resultUnit: 'MPa',
      testedAt: iso(),
      ageDays: null,
    });
    await expectM1(
      () => quality.issueCertificate(ctx('CMP-0001', 4), failedTest.id),
      'mandatory_failure',
      422,
    );

    const pending = await newTest();
    await quality.recordResult(ctx('CMP-0001', 3), pending.id, {
      resultValue: 30,
      resultUnit: 'MPa',
      testedAt: iso(),
      ageDays: null,
    });
    const unverified = await expectM1(
      () => quality.issueCertificate(ctx('CMP-0001', 4), pending.id),
      'mandatory_failure',
      422,
    );
    expect((unverified.details as Record<string, unknown>).check).toBe('certificateEligible');

    const verified = await quality.verifyTest(ctx('CMP-0001', 4), pending.id);
    expect(verified.verified_by).toBe('admin');

    const issued = await quality.issueCertificate(ctx('CMP-0001', 4), pending.id);
    expect(issued.certificate.status).toBe('issued');

    let frozen = false;
    try {
      await admin.unsafe(`update certificates set certificate_no = 'TAMPERED' where id = $1`, [
        issued.certificate.id,
      ]);
    } catch (caught) {
      frozen = true;
      expect(String(caught)).toContain('immutable');
    }
    expect(frozen).toBe(true);

    await expectM1(
      () => quality.revokeCertificate(ctx('CMP-0001', 4), issued.certificate.id, 'recall'),
      'forbidden',
      403,
    );
    const revoked = await quality.revokeCertificate(
      ctx('CMP-0001', 5),
      issued.certificate.id,
      'test specimen was mishandled in transit',
    );
    expect(revoked.status).toBe('revoked');
  });

  dbTest('an NCR cannot close until its CAPA has a recorded effectiveness check', async () => {
    const test = await newTest({ specMin: 80, specMax: 90 });
    const failed = await quality.recordResult(ctx('CMP-0001', 3), test.id, {
      resultValue: 20,
      resultUnit: 'MPa',
      testedAt: iso(),
      ageDays: null,
    });
    const ncrId = failed.ncr_id ?? '';
    expect(ncrId).not.toBe('');

    const withCapa = await quality.addCapa(ctx('CMP-0001', 4), ncrId, {
      actionType: 'corrective',
      description: 'recalibrate the batching scale and re-train the operator',
      ownerId: 'USR-M4',
      dueDate: null,
    });
    expect(withCapa.status).toBe('capa_open');
    const capaId = withCapa.capa[0]?.id ?? '';
    expect(capaId).not.toBe('');

    await quality.transitionNcr(ctx('CMP-0001', 4), ncrId, 'verification');
    const blocked = await expectM1(
      () => quality.transitionNcr(ctx('CMP-0001', 4), ncrId, 'closed'),
      'approval_required',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('capaEffectiveness');

    await expectM1(
      () => quality.verifyCapa(ctx('CMP-0001', 4), capaId, 'checked'),
      'forbidden',
      403,
    );
    await quality.verifyCapa(ctx('CMP-0001', 5), capaId, 'verified on three consecutive batches');
    const closed = await quality.transitionNcr(ctx('CMP-0001', 4), ncrId, 'closed');
    expect(closed.status).toBe('closed');
    expect(closed.closed_by).toBe('admin');
    expect(closed.closed_at).not.toBeNull();

    const audits = await admin.unsafe<{ n: number }>(
      `select count(*)::int as n from audit_log where action = 'ncr.closed' and record_id = $1`,
      [ncrId],
    );
    expect(audits[0]?.n).toBe(1);
  });

  dbTest('a result without acceptance limits is refused, not auto-passed', async () => {
    const test = await newTest({ specMin: null, specMax: null, specSourceNote: '' });
    const blocked = await expectM1(
      () =>
        quality.recordResult(ctx('CMP-0001', 3), test.id, {
          resultValue: 30,
          resultUnit: 'MPa',
          testedAt: iso(),
          ageDays: null,
        }),
      'approval_required',
      422,
    );
    expect((blocked.details as Record<string, unknown>).check).toBe('specLimitsPresent');
  });

  dbTest('a specimen shortfall is a recorded warning, not a silent pass', async () => {
    const test = await newTest({ requiredSpecimenCount: 3, equipmentId: null });
    await quality.addSpecimen(ctx('CMP-0001', 3), test.id, {
      specimenNo: 1,
      castAt: iso(-3_600_000),
      curedUntil: iso(86_400_000),
    });
    const detail = await quality.getTest(ctx('CMP-0001', 3), test.id);
    const check = detail.checks.find((candidate) => candidate.key === 'specimenCount');
    expect(check?.outcome).toBe('warning');
    expect(check?.classification).toBe('warning');
    expect(detail.specimens).toHaveLength(1);
  });

  dbTest('keeps tenants apart: another company reads no tests, NCRs or certificates', async () => {
    const mine = await newTest({ specMin: 10, specMax: 20 });
    const fire = await quality.recordResult(ctx('CMP-0001', 3), mine.id, {
      resultValue: 15,
      resultUnit: 'MPa',
      testedAt: iso(),
      ageDays: null,
    });
    expect(fire.status).toBe('passed');

    const otherTests = await quality.listTests(ctx('CMP-0002'));
    expect(otherTests.some((row) => row.id === mine.id)).toBe(false);
    await expectM1(() => quality.getTest(ctx('CMP-0002'), mine.id), 'quality_test_not_found', 404);

    const scoped = await app.withTenant({ companyId: 'CMP-0002', plantIds: [], userId: 'USR-M4' }, (tx) =>
      tx.unsafe<{ n: number }>(`select count(*)::int as n from quality_tests where id = $1`, [mine.id]),
    );
    expect(scoped[0]?.n).toBe(0);

    const otherPlant = otherPlantId;
    expect(otherPlant).not.toBe('');
    const foreign = await quality.listTests(ctx('CMP-0001'), { plantId: otherPlant });
    expect(foreign.every((row) => row.plant_id === otherPlant)).toBe(true);
  });
});
