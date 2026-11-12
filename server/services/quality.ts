/** M4 quality and laboratory repository. Tenant-scoped; every check goes through src/core/quality. */
import {
  canCertificateTransition,
  canNcrTransition,
  checkCalibrationCurrent,
  checkCertificateEligible,
  checkChronology,
  checkCapaEffectiveness,
  checkFailedNeedsNcr,
  checkSpecLimitsPresent,
  checkSpecimenCount,
  checkResultInSpec,
  checkResultPresent,
  checkUnitMatches,
  isTestType,
  type NcrSeverity,
  type NcrStatus,
  type QualityCheck,
  type QualityCatalogueKey,
  type TestStatus,
  type TestType,
} from '../../src/core/quality';
import { MIN_OVERRIDE_REASON } from '../../src/core/rules';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
const iso = (value: unknown): string | null =>
  value === null || value === undefined ? null : new Date(String(value)).toISOString();

const newId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

export interface QualityTestRow {
  id: string;
  plant_id: string;
  plant_name_ar: string;
  plant_name_en: string;
  batch_id: string | null;
  batch_no: string | null;
  mix_version_id: string | null;
  test_type: TestType;
  sampled_at: string;
  tested_at: string | null;
  age_days: number | null;
  result_value: number | null;
  result_unit: string | null;
  spec_min: number | null;
  spec_max: number | null;
  spec_source_note: string;
  required_specimen_count: number | null;
  equipment_id: string | null;
  technician_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
  status: TestStatus;
  specimen_count: number;
  ncr_id: string | null;
  certificate_id: string | null;
}

export interface SpecimenRow {
  id: string;
  specimen_no: number;
  cast_at: string | null;
  cured_until: string | null;
  result_value: number | null;
  disposition: string;
}

export interface NcrRow {
  id: string;
  plant_id: string;
  test_id: string | null;
  batch_id: string | null;
  severity: NcrSeverity;
  description: string;
  containment: string;
  root_cause: string;
  status: NcrStatus;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  void_reason: string | null;
  capa: CapaRow[];
}

export interface CapaRow {
  id: string;
  ncr_id: string;
  action_type: 'corrective' | 'preventive';
  description: string;
  owner_id: string | null;
  due_date: string | null;
  effectiveness_check: string;
  verified_by: string | null;
  verified_at: string | null;
  status: string;
}

export interface CertificateRow {
  id: string;
  test_id: string;
  certificate_no: string;
  issued_by: string;
  issued_at: string;
  status: string;
  revoked_reason: string | null;
}

export interface TestDetail extends QualityTestRow {
  specimens: SpecimenRow[];
  ncr: NcrRow | null;
  certificate: CertificateRow | null;
  checks: QualityCheck[];
}

export interface EquipmentRow {
  id: string;
  plant_id: string;
  equipment_code: string;
  name: string;
  serial: string;
  status: string;
  calibration_interval_days: number | null;
  expires_at: string | null;
  calibration_status: 'current' | 'lapsed' | 'missing';
}

const toTest = (row: Row): QualityTestRow => ({
  id: str(row.id),
  plant_id: str(row.plant_id),
  plant_name_ar: str(row.plant_name_ar),
  plant_name_en: str(row.plant_name_en),
  batch_id: row.batch_id === null || row.batch_id === undefined ? null : str(row.batch_id),
  batch_no: row.batch_no === null || row.batch_no === undefined ? null : str(row.batch_no),
  mix_version_id:
    row.mix_version_id === null || row.mix_version_id === undefined ? null : str(row.mix_version_id),
  test_type: str(row.test_type) as TestType,
  sampled_at: str(row.sampled_at),
  tested_at: iso(row.tested_at),
  age_days: numOrNull(row.age_days),
  result_value: numOrNull(row.result_value),
  result_unit: row.result_unit === null || row.result_unit === undefined ? null : str(row.result_unit),
  spec_min: numOrNull(row.spec_min),
  spec_max: numOrNull(row.spec_max),
  spec_source_note: str(row.spec_source_note),
  required_specimen_count: numOrNull(row.required_specimen_count),
  equipment_id:
    row.equipment_id === null || row.equipment_id === undefined ? null : str(row.equipment_id),
  technician_id:
    row.technician_id === null || row.technician_id === undefined ? null : str(row.technician_id),
  verified_by: row.verified_by === null || row.verified_by === undefined ? null : str(row.verified_by),
  verified_at: iso(row.verified_at),
  status: str(row.status) as TestStatus,
  specimen_count: num(row.specimen_count),
  ncr_id: row.ncr_id === null || row.ncr_id === undefined ? null : str(row.ncr_id),
  certificate_id:
    row.certificate_id === null || row.certificate_id === undefined ? null : str(row.certificate_id),
});

const TEST_SELECT = `
  select t.id, t.plant_id, coalesce(p.name_ar, '') as plant_name_ar,
         coalesce(p.name_en, '') as plant_name_en, t.batch_id, b.batch_no, t.mix_version_id,
         t.test_type, t.sampled_at, t.tested_at, t.age_days, t.result_value::text as result_value,
         t.result_unit, t.spec_min::text as spec_min, t.spec_max::text as spec_max,
         t.spec_source_note, t.required_specimen_count, t.equipment_id, t.technician_id,
         t.verified_by, t.verified_at, t.status,
         (select count(*) from specimens s where s.company_id = t.company_id and s.test_id = t.id) as specimen_count,
         (select n.id from ncr n where n.company_id = t.company_id and n.test_id = t.id
             and n.status <> 'void' order by n.opened_at desc limit 1) as ncr_id,
         (select c.id from certificates c where c.company_id = t.company_id and c.test_id = t.id
             and c.status <> 'revoked' order by c.issued_at desc limit 1) as certificate_id
    from quality_tests t
    left join plants p on p.id = t.plant_id
    left join batches b on b.id = t.batch_id`;

const toCapa = (row: Row): CapaRow => ({
  id: str(row.id),
  ncr_id: str(row.ncr_id),
  action_type: str(row.action_type) === 'preventive' ? 'preventive' : 'corrective',
  description: str(row.description),
  owner_id: row.owner_id === null || row.owner_id === undefined ? null : str(row.owner_id),
  due_date: row.due_date === null || row.due_date === undefined ? null : str(row.due_date).slice(0, 10),
  effectiveness_check: str(row.effectiveness_check),
  verified_by: row.verified_by === null || row.verified_by === undefined ? null : str(row.verified_by),
  verified_at: iso(row.verified_at),
  status: str(row.status),
});

const toCertificate = (row: Row): CertificateRow => ({
  id: str(row.id),
  test_id: str(row.test_id),
  certificate_no: str(row.certificate_no),
  issued_by: str(row.issued_by),
  issued_at: str(row.issued_at),
  status: str(row.status),
  revoked_reason:
    row.revoked_reason === null || row.revoked_reason === undefined ? null : str(row.revoked_reason),
});

export class QualityService {
  constructor(private readonly db: Db) {}

  private requireLevel = (context: B1Context, min: number, what: string): void => {
    if (context.actor.roleLevel < min) {
      throw new M1Error('forbidden', 403, `only a level-${min} user may ${what}`);
    }
  };

  private checksFor = (test: QualityTestRow, specimens: readonly SpecimenRow[]): QualityCheck[] => {
    const checks: QualityCheck[] = [
      checkResultPresent(test.result_value),
      checkUnitMatches(test.result_unit ?? '', test.test_type),
      checkChronology({
        sampledAt: new Date(test.sampled_at),
        testedAt: test.tested_at ? new Date(test.tested_at) : new Date(test.sampled_at),
        castAt: specimens[0]?.cast_at ? new Date(specimens[0].cast_at) : null,
        ageDays: test.age_days,
      }),
      checkSpecLimitsPresent(test.spec_min, test.spec_max, test.spec_source_note),
      checkSpecimenCount(
        test.required_specimen_count,
        specimens.length,
      ),
      checkCertificateEligible(test.status, test.verified_at !== null),
    ];
    if (test.result_value !== null) {
      checks.push(checkResultInSpec(test.result_value, test.spec_min, test.spec_max));
    }
    return checks;
  };

  listTests = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; testType?: string } = {},
  ): Promise<QualityTestRow[]> => {
    this.requireLevel(context, 1, 'read quality tests');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `${TEST_SELECT}
          where t.company_id = $1 and t.deleted_at is null
            and ($2::text = '' or t.plant_id = $2)
            and ($3::text = '' or t.status = $3)
            and ($4::text = '' or t.test_type = $4)
          order by t.sampled_at desc, t.id`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? '', filters.testType ?? ''],
      ),
    );
    return rows.map(toTest);
  };

  getTest = async (context: B1Context, id: string): Promise<TestDetail> => {
    this.requireLevel(context, 1, 'read a quality test');
    return this.db.withTenant(context.tenant, (tx) => this.readTest(tx, context, id));
  };

  private readTest = async (tx: Executor, context: B1Context, id: string): Promise<TestDetail> => {
    const rows = await tx.unsafe<Row>(`${TEST_SELECT} where t.company_id = $1 and t.id = $2`, [
      context.tenant.companyId,
      id,
    ]);
    const row = rows[0];
    if (!row) throw new M1Error('quality_test_not_found', 404, `test ${id} does not exist`);

    const specimens = await tx.unsafe<Row>(
      `select id, specimen_no, cast_at, cured_until, result_value::text as result_value, disposition
         from specimens where company_id = $1 and test_id = $2 order by specimen_no`,
      [context.tenant.companyId, id],
    );
    const specimenRows: SpecimenRow[] = specimens.map((specimen) => ({
      id: str(specimen.id),
      specimen_no: num(specimen.specimen_no),
      cast_at: iso(specimen.cast_at),
      cured_until: iso(specimen.cured_until),
      result_value: numOrNull(specimen.result_value),
      disposition: str(specimen.disposition),
    }));

    const ncrRows = await tx.unsafe<Row>(
      `select id, plant_id, test_id, batch_id, severity, description, coalesce(containment, '') as containment,
              coalesce(root_cause, '') as root_cause, status, opened_by, opened_at, closed_by, closed_at,
              void_reason
         from ncr where company_id = $1 and test_id = $2 and status <> 'void'
        order by opened_at desc limit 1`,
      [context.tenant.companyId, id],
    );
    const ncr = ncrRows[0] ? await this.readNcr(tx, context, str(ncrRows[0].id)) : null;

    const certificateRows = await tx.unsafe<Row>(
      `select id, test_id, certificate_no, issued_by, issued_at, status, revoked_reason
         from certificates where company_id = $1 and test_id = $2
        order by issued_at desc limit 1`,
      [context.tenant.companyId, id],
    );
    const certificate = certificateRows[0] ? toCertificate(certificateRows[0]) : null;

    const test = toTest(row);
    return {
      ...test,
      specimens: specimenRows,
      ncr,
      certificate,
      checks: this.checksFor(test, specimenRows),
    };
  };

  createTest = async (
    context: B1Context,
    payload: {
      plantId: string;
      batchId: string | null;
      mixVersionId: string | null;
      testType: string;
      sampledAt: string;
      ageDays: number | null;
      requiredSpecimenCount: number | null;
      equipmentId: string | null;
      specMin: number | null;
      specMax: number | null;
      specSourceNote: string;
    },
  ): Promise<TestDetail> => {
    this.requireLevel(context, 3, 'record a quality test');
    if (!isTestType(payload.testType)) {
      throw new M1Error('validation_error', 422, `unknown test type ${payload.testType}`, {
        field: 'testType',
      });
    }
    const sampledAt = new Date(payload.sampledAt);
    if (Number.isNaN(sampledAt.getTime())) {
      throw new M1Error('validation_error', 422, 'sampledAt must be a valid timestamp', {
        field: 'sampledAt',
      });
    }
    if (sampledAt.getTime() > Date.now() + 5 * 60_000) {
      throw new M1Error('validation_error', 422, 'sampledAt cannot be in the future', {
        field: 'sampledAt',
      });
    }
    if (payload.ageDays !== null && (!Number.isInteger(payload.ageDays) || payload.ageDays < 1 || payload.ageDays > 365)) {
      throw new M1Error('validation_error', 422, 'ageDays must be a whole number between 1 and 365', {
        field: 'ageDays',
      });
    }
    if (
      payload.requiredSpecimenCount !== null &&
      (!Number.isInteger(payload.requiredSpecimenCount) ||
        payload.requiredSpecimenCount < 1 ||
        payload.requiredSpecimenCount > 20)
    ) {
      throw new M1Error('validation_error', 422, 'requiredSpecimenCount must be between 1 and 20', {
        field: 'requiredSpecimenCount',
      });
    }
    if (
      (payload.specMin === null) !== (payload.specMax === null) ||
      (payload.specMin !== null && payload.specMin < 0) ||
      (payload.specMax !== null && payload.specMax < 0) ||
      (payload.specMin !== null && payload.specMax !== null && payload.specMin > payload.specMax)
    ) {
      throw new M1Error('validation_error', 422, 'specMin and specMax must be a valid range', {
        field: 'specMin',
      });
    }
    if (payload.testType === 'cube_strength' && payload.specMax !== null && payload.specMax > 200) {
      throw new M1Error('validation_error', 422, 'a cube strength limit above 200 MPa is implausible', {
        field: 'specMax',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      if (payload.batchId) {
        const batch = await tx.unsafe<{ plant_id: string }>(
          `select plant_id from batches where company_id = $1 and id = $2`,
          [context.tenant.companyId, payload.batchId],
        );
        if (!batch[0]) throw new M1Error('batch_not_found', 404, `batch ${payload.batchId} does not exist`);
        if (str(batch[0].plant_id) !== payload.plantId) {
          throw new M1Error('mandatory_failure', 422, 'the batch belongs to another plant', {
            check: 'plantScope',
            classification: 'mandatory_failure',
          });
        }
      }
      const id = newId('QAT');
      await tx.unsafe(
        `insert into quality_tests (id, company_id, plant_id, batch_id, mix_version_id, test_type,
            sampled_at, age_days, required_specimen_count, equipment_id, spec_min, spec_max,
            spec_source_note, technician_id, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$14)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.batchId,
          payload.mixVersionId,
          payload.testType,
          payload.sampledAt,
          payload.ageDays,
          payload.requiredSpecimenCount,
          payload.equipmentId,
          payload.specMin,
          payload.specMax,
          payload.specSourceNote,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'test.sampled', id, {
        plantId: payload.plantId,
        testType: payload.testType,
        batchId: payload.batchId,
      });
      return this.readTest(tx, context, id);
    });
  };

  addSpecimen = async (
    context: B1Context,
    testId: string,
    payload: { specimenNo: number; castAt: string | null; curedUntil: string | null },
  ): Promise<TestDetail> => {
    this.requireLevel(context, 3, 'record a specimen');
    return this.db.withTenant(context.tenant, async (tx) => {
      const test = await this.readTest(tx, context, testId);
      if (test.status !== 'sampled' && test.status !== 'testing') {
        throw new M1Error('invalid_transition', 409, `test ${testId} is ${test.status}`, {
          from: test.status,
          to: 'testing',
        });
      }
      await tx.unsafe(
        `insert into specimens (id, company_id, test_id, specimen_no, cast_at, cured_until)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          newId('SPC'),
          context.tenant.companyId,
          testId,
          payload.specimenNo,
          payload.castAt,
          payload.curedUntil,
        ],
      );
      return this.readTest(tx, context, testId);
    });
  };

  recordResult = async (
    context: B1Context,
    testId: string,
    payload: { resultValue: number; resultUnit: string; testedAt: string; ageDays: number | null },
  ): Promise<TestDetail> => {
    this.requireLevel(context, 3, 'enter a test result');
    return this.db.withTenant(context.tenant, async (tx) => {
      const test = await this.readTest(tx, context, testId);
      if (test.status !== 'sampled' && test.status !== 'testing') {
        throw new M1Error('invalid_transition', 409, `test ${testId} is ${test.status}`, {
          from: test.status,
          to: 'testing',
        });
      }

      const present = checkResultPresent(payload.resultValue);
      if (present.outcome !== 'pass') {
        throw new M1Error(present.classification, 422, 'a positive result is required', {
          check: present.key,
          classification: present.classification,
        });
      }
      const unit = checkUnitMatches(payload.resultUnit, test.test_type);
      if (unit.outcome !== 'pass') {
        throw new M1Error(unit.classification, 422, `unit does not match ${test.test_type}`, {
          check: unit.key,
          classification: unit.classification,
        });
      }
      const ceilings: Record<string, number> = {
        slump: 300,
        cube_strength: 200,
        temperature: 100,
        density: 4000,
      };
      const ceiling = ceilings[test.test_type];
      if (ceiling !== undefined && payload.resultValue > ceiling) {
        throw new M1Error('validation_error', 422, `result exceeds the plausible range for ${test.test_type}`, {
          field: 'resultValue',
          max: ceiling,
        });
      }
      const chronology = checkChronology({
        sampledAt: new Date(test.sampled_at),
        testedAt: new Date(payload.testedAt),
        castAt: test.specimens[0]?.cast_at ? new Date(test.specimens[0].cast_at) : null,
        ageDays: payload.ageDays,
      });
      if (chronology.outcome !== 'pass') {
        throw new M1Error(chronology.classification, 422, 'the test chronology is inconsistent', {
          check: chronology.key,
          reasonKey: chronology.reasonKey,
          classification: chronology.classification,
        });
      }

      const limits = checkSpecLimitsPresent(test.spec_min, test.spec_max, test.spec_source_note);
      if (limits.outcome !== 'pass') {
        throw new M1Error(limits.classification, 422, 'acceptance limits are missing', {
          check: limits.key,
          classification: limits.classification,
        });
      }

      if (test.equipment_id) {
        const calibration = await tx.unsafe<{ expires_at: string }>(
          `select expires_at from equipment_calibrations
            where company_id = $1 and equipment_id = $2 order by expires_at desc limit 1`,
          [context.tenant.companyId, test.equipment_id],
        );
        const current = checkCalibrationCurrent(
          null,
          calibration[0] ? new Date(str(calibration[0].expires_at)) : null,
          new Date(payload.testedAt),
        );
        if (current.outcome !== 'pass') {
          throw new M1Error(current.classification, 422, 'the equipment calibration has lapsed', {
            check: current.key,
            classification: current.classification,
          });
        }
      }

      const inSpec = checkResultInSpec(payload.resultValue, test.spec_min, test.spec_max);
      const status: TestStatus = inSpec.outcome === 'pass' ? 'passed' : 'failed';

      await tx.unsafe(
        `update quality_tests
            set result_value = $3, result_unit = $4, tested_at = $5, age_days = $6,
                status = $7, updated_by = $8
          where company_id = $1 and id = $2`,
        [
          context.tenant.companyId,
          testId,
          payload.resultValue,
          payload.resultUnit,
          payload.testedAt,
          payload.ageDays,
          status,
          context.actor.username,
        ],
      );

      if (status === 'failed') {
        // Idempotent: the partial unique index refuses a second live NCR for the same test.
        await tx.unsafe(
          `insert into ncr (id, company_id, plant_id, test_id, batch_id, severity, description,
              opened_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (company_id, test_id) where test_id is not null and status <> 'void' do nothing`,
          [
            newId('NCR'),
            context.tenant.companyId,
            test.plant_id,
            testId,
            test.batch_id,
            'major',
            `Failed ${test.test_type} result ${payload.resultValue} ${payload.resultUnit} outside the acceptance limits`,
            context.actor.username,
          ],
        );
        await audit(tx, context, 'test.failed', testId, {
          resultValue: payload.resultValue,
          resultUnit: payload.resultUnit,
        });
      }

      await audit(tx, context, 'test.result_entered', testId, {
        resultValue: payload.resultValue,
        resultUnit: payload.resultUnit,
        status,
      });
      return this.readTest(tx, context, testId);
    });
  };

  verifyTest = async (context: B1Context, testId: string): Promise<TestDetail> => {
    this.requireLevel(context, 4, 'verify a test result');
    return this.db.withTenant(context.tenant, async (tx) => {
      const test = await this.readTest(tx, context, testId);
      if (test.status !== 'passed' && test.status !== 'failed') {
        throw new M1Error('invalid_transition', 409, `test ${testId} is ${test.status}`, {
          from: test.status,
          to: 'passed',
        });
      }
      const ncr = await tx.unsafe<{ id: string }>(
        `select id from ncr where company_id = $1 and test_id = $2 and status <> 'void' limit 1`,
        [context.tenant.companyId, testId],
      );
      const rule = checkFailedNeedsNcr(test.status, ncr.length > 0);
      if (rule.outcome !== 'pass') {
        throw new M1Error(rule.classification, 422, 'a failed result needs an NCR', {
          check: rule.key,
          classification: rule.classification,
        });
      }
      await tx.unsafe(
        `update quality_tests set verified_by = $3, verified_at = now(), updated_by = $3
          where company_id = $1 and id = $2 and verified_at is null`,
        [context.tenant.companyId, testId, context.actor.username],
      );
      await audit(tx, context, 'test.verified', testId, { status: test.status });
      return this.readTest(tx, context, testId);
    });
  };

  listEquipment = async (context: B1Context): Promise<EquipmentRow[]> => {
    this.requireLevel(context, 1, 'read lab equipment');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select e.id, e.plant_id, e.equipment_code, e.name, coalesce(e.serial, '') as serial,
                e.status, e.calibration_interval_days,
                (select c.expires_at from equipment_calibrations c
                  where c.company_id = e.company_id and c.equipment_id = e.id
                  order by c.expires_at desc limit 1) as expires_at
           from lab_equipment e
          where e.company_id = $1 and e.deleted_at is null
          order by e.equipment_code`,
        [context.tenant.companyId],
      ),
    );
    return rows.map((row) => {
      const expires = row.expires_at === null || row.expires_at === undefined ? null : str(row.expires_at);
      const calibration_status: EquipmentRow['calibration_status'] =
        expires === null ? 'missing' : new Date(expires).getTime() > Date.now() ? 'current' : 'lapsed';
      return {
        id: str(row.id),
        plant_id: str(row.plant_id),
        equipment_code: str(row.equipment_code),
        name: str(row.name),
        serial: str(row.serial),
        status: str(row.status),
        calibration_interval_days: numOrNull(row.calibration_interval_days),
        expires_at: expires,
        calibration_status,
      };
    });
  };

  createEquipment = async (
    context: B1Context,
    payload: { plantId: string; equipmentCode: string; name: string; serial: string; intervalDays: number | null },
  ): Promise<EquipmentRow> => {
    this.requireLevel(context, 4, 'register lab equipment');
    await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe(
        `insert into lab_equipment (id, company_id, plant_id, equipment_code, name, serial,
            calibration_interval_days, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          newId('EQP'),
          context.tenant.companyId,
          payload.plantId,
          payload.equipmentCode,
          payload.name,
          payload.serial,
          payload.intervalDays,
          context.actor.username,
        ],
      ),
    );
    const all = await this.listEquipment(context);
    const created = all.find((row) => row.equipment_code === payload.equipmentCode);
    if (!created) throw new M1Error('equipment_not_found', 404, 'equipment could not be read back');
    return created;
  };

  recordCalibration = async (
    context: B1Context,
    equipmentId: string,
    payload: { provider: string; calibratedAt: string; expiresAt: string; certificateRef: string },
  ): Promise<EquipmentRow> => {
    this.requireLevel(context, 4, 'record a calibration');
    if (new Date(payload.expiresAt).getTime() <= new Date(payload.calibratedAt).getTime()) {
      throw new M1Error('validation_error', 422, 'expiresAt must be after calibratedAt', {
        field: 'expiresAt',
      });
    }
    await this.db.withTenant(context.tenant, async (tx) => {
      const equipment = await tx.unsafe<{ id: string }>(
        `select id from lab_equipment where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, equipmentId],
      );
      if (!equipment[0]) throw new M1Error('equipment_not_found', 404, `equipment ${equipmentId} does not exist`);
      await tx.unsafe(
        `insert into equipment_calibrations (id, company_id, equipment_id, provider, calibrated_at,
            expires_at, certificate_ref, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId('CAL'),
          context.tenant.companyId,
          equipmentId,
          payload.provider,
          payload.calibratedAt,
          payload.expiresAt,
          payload.certificateRef,
          context.actor.username,
        ],
      );
      const current = new Date(payload.expiresAt).getTime() > Date.now();
      await tx.unsafe(
        `update lab_equipment set status = $3, updated_by = $4
          where company_id = $1 and id = $2 and status <> 'retired'`,
        [context.tenant.companyId, equipmentId, current ? 'active' : 'out_of_service', context.actor.username],
      );
      await audit(tx, context, 'equipment.calibration_recorded', equipmentId, {
        expiresAt: payload.expiresAt,
        certificateRef: payload.certificateRef,
      });
    });
    const all = await this.listEquipment(context);
    const updated = all.find((row) => row.id === equipmentId);
    if (!updated) throw new M1Error('equipment_not_found', 404, `equipment ${equipmentId} does not exist`);
    return updated;
  };

  getNcr = async (context: B1Context, id: string): Promise<NcrRow> => {
    this.requireLevel(context, 1, 'read an NCR');
    return this.db.withTenant(context.tenant, (tx) => this.readNcr(tx, context, id));
  };

  private readNcr = async (tx: Executor, context: B1Context, id: string): Promise<NcrRow> => {
    const rows = await tx.unsafe<Row>(
      `select id, plant_id, test_id, batch_id, severity, description, coalesce(containment, '') as containment,
              coalesce(root_cause, '') as root_cause, status, opened_by, opened_at, closed_by, closed_at,
              void_reason
         from ncr where company_id = $1 and id = $2`,
      [context.tenant.companyId, id],
    );
    const row = rows[0];
    if (!row) throw new M1Error('ncr_not_found', 404, `NCR ${id} does not exist`);
    const capa = await tx.unsafe<Row>(
      `select id, ncr_id, action_type, description, owner_id, due_date, effectiveness_check,
              verified_by, verified_at, status
         from capa where company_id = $1 and ncr_id = $2 order by created_at`,
      [context.tenant.companyId, id],
    );
    return {
      id: str(row.id),
      plant_id: str(row.plant_id),
      test_id: row.test_id === null || row.test_id === undefined ? null : str(row.test_id),
      batch_id: row.batch_id === null || row.batch_id === undefined ? null : str(row.batch_id),
      severity: str(row.severity) as NcrSeverity,
      description: str(row.description),
      containment: str(row.containment),
      root_cause: str(row.root_cause),
      status: str(row.status) as NcrStatus,
      opened_by: str(row.opened_by),
      opened_at: str(row.opened_at),
      closed_by: row.closed_by === null || row.closed_by === undefined ? null : str(row.closed_by),
      closed_at: iso(row.closed_at),
      void_reason: row.void_reason === null || row.void_reason === undefined ? null : str(row.void_reason),
      capa: capa.map(toCapa),
    };
  };

  transitionNcr = async (
    context: B1Context,
    id: string,
    to: NcrStatus,
    payload: { reason?: string; rootCause?: string } = {},
  ): Promise<NcrRow> => {
    this.requireLevel(context, 4, 'move an NCR through its lifecycle');
    const ncr = await this.db.withTenant(context.tenant, (tx) => this.readNcr(tx, context, id));
    if (!canNcrTransition(ncr.status, to)) {
      throw new M1Error('invalid_transition', 409, `NCR ${id} is ${ncr.status}`, {
        from: ncr.status,
        to,
      });
    }
    if (to === 'void' && (payload.reason ?? '').trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, {
        field: 'reason',
      });
    }
    if (to === 'closed') {
      const open = ncr.capa.filter((action) => action.status !== 'verified').length;
      const checked = ncr.capa.some((action) => action.effectiveness_check.trim().length > 0);
      const rule = checkCapaEffectiveness(open, checked);
      if (rule.outcome !== 'pass') {
        throw new M1Error(rule.classification, 422, 'the NCR needs a verified corrective action', {
          check: rule.key,
          classification: rule.classification,
        });
      }
    }

    return this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `update ncr
            set status = $3,
                root_cause = coalesce($4, root_cause),
                void_reason = case when $3 = 'void' then $5 else void_reason end,
                closed_by = case when $3 = 'closed' then $6 else closed_by end,
                closed_at = case when $3 = 'closed' then now() else closed_at end,
                updated_by = $6
          where company_id = $1 and id = $2`,
        [
          context.tenant.companyId,
          id,
          to,
          payload.rootCause ?? null,
          payload.reason ?? null,
          context.actor.username,
        ],
      );
      await audit(tx, context, to === 'closed' ? 'ncr.closed' : 'ncr.status_changed', id, {
        to,
        reason: payload.reason ?? null,
      });
      return this.readNcr(tx, context, id);
    });
  };

  addCapa = async (
    context: B1Context,
    ncrId: string,
    payload: { actionType: 'corrective' | 'preventive'; description: string; ownerId: string; dueDate: string | null },
  ): Promise<NcrRow> => {
    this.requireLevel(context, 4, 'raise a corrective action');
    if (payload.description.trim().length < 5) {
      throw new M1Error('validation_error', 422, 'description is required', { field: 'description' });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const ncr = await this.readNcr(tx, context, ncrId);
      if (ncr.status === 'closed' || ncr.status === 'void') {
        throw new M1Error('invalid_transition', 409, `NCR ${ncrId} is ${ncr.status}`, {
          from: ncr.status,
          to: 'capa_open',
        });
      }
      await tx.unsafe(
        `insert into capa (id, company_id, ncr_id, action_type, description, owner_id, due_date,
            created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          newId('CAPA'),
          context.tenant.companyId,
          ncrId,
          payload.actionType,
          payload.description.trim(),
          payload.ownerId,
          payload.dueDate,
          context.actor.username,
        ],
      );
      if (ncr.status !== 'capa_open') {
        await tx.unsafe(`update ncr set status = 'capa_open', updated_by = $3 where company_id = $1 and id = $2`, [
          context.tenant.companyId,
          ncrId,
          context.actor.username,
        ]);
      }
      await audit(tx, context, 'capa.created', ncrId, {
        actionType: payload.actionType,
        ownerId: payload.ownerId,
      });
      return this.readNcr(tx, context, ncrId);
    });
  };

  verifyCapa = async (
    context: B1Context,
    capaId: string,
    effectiveness: string,
  ): Promise<CapaRow> => {
    this.requireLevel(context, 5, 'verify a corrective action');
    if (effectiveness.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'the effectiveness check is required', {
        field: 'effectivenessCheck',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `update capa
            set status = 'verified', effectiveness_check = $3, verified_by = $4,
                verified_at = now(), updated_by = $4
          where company_id = $1 and id = $2
          returning id, ncr_id, action_type, description, owner_id, due_date, effectiveness_check,
                    verified_by, verified_at, status`,
        [context.tenant.companyId, capaId, effectiveness.trim(), context.actor.username],
      );
      const row = rows[0];
      if (!row) throw new M1Error('capa_not_found', 404, `CAPA ${capaId} does not exist`);
      await audit(tx, context, 'capa.verified', str(row.ncr_id), { capaId, effectiveness });
      return toCapa(row);
    });
  };

  issueCertificate = async (
    context: B1Context,
    testId: string,
  ): Promise<{ certificate: CertificateRow; test: TestDetail }> => {
    this.requireLevel(context, 4, 'issue a certificate');
    return this.db.withTenant(context.tenant, async (tx) => {
      const test = await this.readTest(tx, context, testId);
      const eligible = checkCertificateEligible(test.status, test.verified_at !== null);
      if (eligible.outcome !== 'pass') {
        throw new M1Error(eligible.classification, 422, 'this test cannot be certified', {
          check: eligible.key,
          classification: eligible.classification,
          reasonKey: eligible.reasonKey,
        });
      }
      const number = `CERT-${test.id.replace(/^QAT-/, '')}-${Date.now().toString(36).toUpperCase()}`;
      const rows = await tx.unsafe<Row>(
        `insert into certificates (id, company_id, plant_id, test_id, certificate_no, issued_by, status)
         values ($1,$2,$3,$4,$5,$6,'issued')
         returning id, test_id, certificate_no, issued_by, issued_at, status, revoked_reason`,
        [newId('CRT'), context.tenant.companyId, test.plant_id, testId, number, context.actor.username],
      );
      const row = rows[0];
      if (!row) throw new M1Error('certificate_not_issued', 500, 'the certificate could not be issued');
      await audit(tx, context, 'certificate.issued', str(row.id), { testId, certificateNo: number });
      return { certificate: toCertificate(row), test: await this.readTest(tx, context, testId) };
    });
  };

  revokeCertificate = async (
    context: B1Context,
    certificateId: string,
    reason: string,
  ): Promise<CertificateRow> => {
    this.requireLevel(context, 5, 'revoke a certificate');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, {
        field: 'reason',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await tx.unsafe<Row>(
        `select id, status from certificates where company_id = $1 and id = $2`,
        [context.tenant.companyId, certificateId],
      );
      const row = current[0];
      if (!row) throw new M1Error('certificate_not_found', 404, `certificate ${certificateId} does not exist`);
      if (!canCertificateTransition(str(row.status) as 'draft' | 'issued' | 'revoked', 'revoked')) {
        throw new M1Error('invalid_transition', 409, `certificate ${certificateId} is ${row.status}`, {
          from: str(row.status),
          to: 'revoked',
        });
      }
      const updated = await tx.unsafe<Row>(
        `update certificates
            set status = 'revoked', revoked_reason = $3, updated_by = $4
          where company_id = $1 and id = $2
          returning id, test_id, certificate_no, issued_by, issued_at, status, revoked_reason`,
        [context.tenant.companyId, certificateId, reason.trim(), context.actor.username],
      );
      await audit(tx, context, 'certificate.revoked', certificateId, { reason: reason.trim() });
      const out = updated[0];
      if (!out) throw new M1Error('certificate_not_found', 404, `certificate ${certificateId} does not exist`);
      return toCertificate(out);
    });
  };
}

const audit = async (
  tx: Executor,
  context: B1Context,
  action: string,
  recordId: string,
  details: Record<string, unknown>,
): Promise<void> => {
  await tx.unsafe(
    `insert into audit_log (company_id, plant_id, user_id, username, action, table_name, record_id,
       ip_address, request_id, details)
     values ($1,$2,$3,$4,$5,'quality_tests',$6,$7,$8,$9::jsonb)`,
    [
      context.tenant.companyId,
      context.tenant.plantIds[0] ?? null,
      context.actor.userId,
      context.actor.username,
      action,
      recordId,
      context.actor.ip ?? null,
      context.actor.requestId ?? null,
      JSON.stringify(details),
    ],
  );
};

export type { QualityCatalogueKey, QualityCheck };
