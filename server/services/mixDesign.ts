/**
 * M2 mix design repository.
 *
 * Reads and writes run inside db.withTenant(), so RLS applies and every statement also
 * carries an explicit company_id. The lifecycle and the rule checks come from the pure
 * module src/core/mixDesign.ts: this file stores what the engine decided and refuses what
 * it refuses — an approved version is never edited, an override is recorded with actor,
 * reason, time, rule id and decision, and nothing is corrected silently.
 */
import {
  blockingChecks,
  canTransition,
  checkCodeUnique,
  checkComponentQty,
  checkStrengthClass,
  checkStrengthSource,
  checkVersionEditable,
  evaluateMixDraft,
  MIX_RULES,
  type MixCheck,
  type MixComponentInput,
  type MixStrengthTestInput,
  type MixVersionStatus,
} from '../../src/core/mixDesign';
import { MIN_OVERRIDE_REASON } from '../../src/core/rules';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));

const newId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

export interface MixDesignRow {
  id: string;
  plant_id: string;
  plant_name_ar: string;
  plant_name_en: string;
  code: string;
  name_ar: string;
  name_en: string;
  current_version: number;
  version_count: number;
  approved_version: number;
  current_status: MixVersionStatus;
  created_at: string;
}

export interface MixComponentRow {
  id: string;
  material_id: string;
  role: string;
  qty_per_m3: number;
  unit: string;
  moisture_basis: string;
}

export interface MixStrengthTestRow {
  id: string;
  age_days: number;
  target_min_mpa: number | null;
  source_note: string;
}

export interface MixVersionRow {
  id: string;
  mix_id: string;
  version_no: number;
  status: MixVersionStatus;
  strength_class: string;
  notes: string;
  approved_by: string;
  approved_at: string | null;
  immutable: boolean;
  components: MixComponentRow[];
  strength_tests: MixStrengthTestRow[];
}

export interface MixDesignDetail extends MixDesignRow {
  versions: MixVersionRow[];
  /** Checks on the working version, in the order the engine evaluates them. */
  checks: MixCheck[];
}

export interface MixCreatePayload {
  plantId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  strengthClass: string;
  components: MixComponentInput[];
  strengthTests: MixStrengthTestInput[];
}

export interface MixDraftPatch {
  strengthClass?: string;
  notes?: string;
  components?: MixComponentInput[];
  strengthTests?: MixStrengthTestInput[];
}

export interface MixDesignPatch {
  code?: string;
  nameAr?: string;
  nameEn?: string;
  plantId?: string;
}

export interface StoredMixOverride {
  id: string;
  ruleCode: string;
  entityType: string;
  entityId: string;
  actor: string;
  reason: string;
  decision: 'approved' | 'rejected';
  decidedAt: string;
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
     values ($1,$2,$3,$4,$5,'mix_designs',$6,$7,$8,$9::jsonb)`,
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

const requireLevel = (context: B1Context, min: number, what: string): void => {
  if (context.actor.roleLevel < min) {
    throw new M1Error('forbidden', 403, `only a level-${min} user may ${what}`);
  }
};

const toDesign = (row: Row): MixDesignRow => ({
  id: str(row.id),
  plant_id: str(row.plant_id),
  plant_name_ar: str(row.plant_name_ar),
  plant_name_en: str(row.plant_name_en),
  code: str(row.code),
  name_ar: str(row.name_ar),
  name_en: str(row.name_en),
  current_version: num(row.current_version),
  version_count: num(row.version_count),
  approved_version: num(row.approved_version),
  current_status: str(row.current_status) as MixVersionStatus,
  created_at: str(row.created_at),
});

const toComponent = (row: Row): MixComponentRow => ({
  id: str(row.id),
  material_id: str(row.material_id),
  role: str(row.role),
  qty_per_m3: num(row.qty_per_m3),
  unit: str(row.unit),
  moisture_basis: str(row.moisture_basis),
});

const toStrengthTest = (row: Row): MixStrengthTestRow => ({
  id: str(row.id),
  age_days: num(row.age_days),
  target_min_mpa: row.target_min_mpa === null || row.target_min_mpa === undefined ? null : num(row.target_min_mpa),
  source_note: str(row.source_note),
});

const toVersion = (row: Row): MixVersionRow => ({
  id: str(row.id),
  mix_id: str(row.mix_id),
  version_no: num(row.version_no),
  status: str(row.status) as MixVersionStatus,
  strength_class: str(row.strength_class),
  notes: str(row.notes),
  approved_by: str(row.approved_by),
  approved_at: row.approved_at ? str(row.approved_at) : null,
  immutable: Boolean(row.immutable),
  components: [],
  strength_tests: [],
});

const DESIGN_COLUMNS = `
  d.id, d.company_id, d.plant_id, coalesce(p.name_ar, '') as plant_name_ar,
  coalesce(p.name_en, '') as plant_name_en, d.code, d.name_ar, d.name_en,
  d.current_version, d.created_at`;

const loadComponents = async (tx: Executor, companyId: string, versionId: string): Promise<MixComponentRow[]> => {
  const rows = await tx.unsafe<Row>(
    `select id, material_id, role, qty_per_m3::text as qty_per_m3, unit, moisture_basis
       from mix_components
      where company_id = $1 and version_id = $2
      order by id`,
    [companyId, versionId],
  );
  return rows.map(toComponent);
};

const loadStrengthTests = async (
  tx: Executor,
  companyId: string,
  versionId: string,
): Promise<MixStrengthTestRow[]> => {
  const rows = await tx.unsafe<Row>(
    `select id, age_days, target_min_mpa::text as target_min_mpa, source_note
       from mix_strength_tests
      where company_id = $1 and version_id = $2
      order by age_days, id`,
    [companyId, versionId],
  );
  return rows.map(toStrengthTest);
};

const loadDesign = async (tx: Executor, companyId: string, id: string): Promise<MixDesignRow> => {
  const rows = await tx.unsafe<Row>(
    `select ${DESIGN_COLUMNS},
            (select count(*) from mix_design_versions v where v.mix_id = d.id)::int as version_count,
            coalesce((select max(version_no) from mix_design_versions v
                       where v.mix_id = d.id and v.status = 'approved'), 0)::int as approved_version,
            coalesce((select status from mix_design_versions v
                       where v.mix_id = d.id and v.version_no = d.current_version), '') as current_status
       from mix_designs d
       left join plants p on p.id = d.plant_id
      where d.company_id = $1 and d.id = $2`,
    [companyId, id],
  );
  const row = rows[0];
  if (!row) throw new M1Error('mix_design_not_found', 404, `mix design ${id} does not exist for this company`);
  return toDesign(row);
};

const loadVersion = async (
  tx: Executor,
  companyId: string,
  mixId: string,
  versionNo: number,
): Promise<MixVersionRow> => {
  const rows = await tx.unsafe<Row>(
    `select id, mix_id, version_no, status, strength_class, notes, approved_by, approved_at, immutable
       from mix_design_versions
      where company_id = $1 and mix_id = $2 and version_no = $3`,
    [companyId, mixId, versionNo],
  );
  const row = rows[0];
  if (!row) {
    throw new M1Error('mix_version_not_found', 404, `version ${versionNo} does not exist for mix ${mixId}`);
  }
  const version = toVersion(row);
  version.components = await loadComponents(tx, companyId, version.id);
  version.strength_tests = await loadStrengthTests(tx, companyId, version.id);
  return version;
};

const insertVersionRows = async (
  tx: Executor,
  context: B1Context,
  mixId: string,
  version: {
    versionNo: number;
    status: MixVersionStatus;
    strengthClass: string;
    notes: string;
    components: MixComponentInput[];
    strengthTests: MixStrengthTestInput[];
  },
): Promise<string> => {
  const versionId = newId('MXV');
  await tx.unsafe(
    `insert into mix_design_versions (id, company_id, mix_id, version_no, status, strength_class, notes, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    [
      versionId,
      context.tenant.companyId,
      mixId,
      version.versionNo,
      version.status,
      version.strengthClass,
      version.notes,
      context.actor.username,
    ],
  );
  for (const [index, component] of version.components.entries()) {
    await tx.unsafe(
      `insert into mix_components (id, company_id, version_id, material_id, role, qty_per_m3, unit, moisture_basis)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        newId(`MXC${index}`),
        context.tenant.companyId,
        versionId,
        component.materialId,
        component.role,
        component.qtyPerM3,
        component.unit,
        component.moistureBasis,
      ],
    );
  }
  for (const [index, test] of version.strengthTests.entries()) {
    await tx.unsafe(
      `insert into mix_strength_tests (id, company_id, version_id, age_days, target_min_mpa, source_note)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        newId(`MXT${index}`),
        context.tenant.companyId,
        versionId,
        test.ageDays,
        test.targetMinMpa,
        test.sourceNote,
      ],
    );
  }
  return versionId;
};

/** Refuses anything the pure module refuses, reporting the classification, not a guess. */
const assertDraftInputs = (
  components: readonly MixComponentInput[],
  strengthTests: readonly MixStrengthTestInput[],
): void => {
  components.forEach((component, index) => {
    const check = checkComponentQty(component.qtyPerM3);
    if (check.outcome !== 'pass') {
      throw new M1Error(check.classification, 422, `component ${index + 1}: quantity must be a positive number`, {
        check: check.key,
        classification: check.classification,
        field: 'qtyPerM3',
        index,
      });
    }
  });
  strengthTests.forEach((test, index) => {
    const check = checkStrengthSource(test.sourceNote);
    if (check.outcome !== 'pass') {
      throw new M1Error(check.classification, 422, `strength test ${index + 1}: ${check.reasonKey}`, {
        check: check.key,
        classification: check.classification,
        field: 'sourceNote',
        index,
      });
    }
  });
};

export class MixDesignService {
  constructor(private readonly db: Db) {}

  list = async (
    context: B1Context,
    filters: { plantId?: string } = {},
  ): Promise<MixDesignRow[]> => {
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select ${DESIGN_COLUMNS},
                (select count(*) from mix_design_versions v where v.mix_id = d.id)::int as version_count,
                coalesce((select max(version_no) from mix_design_versions v
                           where v.mix_id = d.id and v.status = 'approved'), 0)::int as approved_version,
                coalesce((select status from mix_design_versions v
                           where v.mix_id = d.id and v.version_no = d.current_version), '') as current_status
           from mix_designs d
           left join plants p on p.id = d.plant_id
          where d.company_id = $1
            and ($2::text = '' or d.plant_id = $2)
          order by d.created_at desc, d.code`,
        [context.tenant.companyId, filters.plantId ?? ''],
      ),
    );
    return rows.map(toDesign);
  };

  get = async (context: B1Context, id: string): Promise<MixDesignDetail> =>
    this.db.withTenant(context.tenant, async (tx) => {
      const design = await loadDesign(tx, context.tenant.companyId, id);
      const versionRows = await tx.unsafe<Row>(
        `select id, mix_id, version_no, status, strength_class, notes, approved_by, approved_at, immutable
           from mix_design_versions
          where company_id = $1 and mix_id = $2
          order by version_no desc`,
        [context.tenant.companyId, id],
      );
      const versions: MixVersionRow[] = [];
      for (const row of versionRows) {
        const version = toVersion(row);
        version.components = await loadComponents(tx, context.tenant.companyId, version.id);
        version.strength_tests = await loadStrengthTests(tx, context.tenant.companyId, version.id);
        versions.push(version);
      }

      const working =
        versions.find((version) => version.version_no === design.current_version) ?? versions[0] ?? null;
      const checks: MixCheck[] = working
        ? evaluateMixDraft({
            codeTaken: false,
            strengthClass: working.strength_class,
            versionStatus: working.status,
            components: working.components.map((component) => ({
              materialId: component.material_id,
              role: component.role,
              qtyPerM3: component.qty_per_m3,
              unit: component.unit,
              moistureBasis: component.moisture_basis,
            })),
            strengthTests: working.strength_tests.map((test) => ({
              ageDays: test.age_days,
              targetMinMpa: test.target_min_mpa,
              sourceNote: test.source_note,
            })),
          })
        : [];

      return { ...design, versions, checks };
    });

  /** Level 4: creates the design and its first draft version in one transaction. */
  create = async (context: B1Context, payload: MixCreatePayload): Promise<MixDesignDetail> => {
    requireLevel(context, 4, 'create a mix design');
    const code = payload.code.trim();
    if (!code) {
      throw new M1Error('validation_error', 422, 'code is required', { field: 'code' });
    }
    if (!payload.plantId.trim()) {
      throw new M1Error('validation_error', 422, 'plantId is required', { field: 'plantId' });
    }
    assertDraftInputs(payload.components, payload.strengthTests);

    const created = await this.db.withTenant(context.tenant, async (tx) => {
      const plant = await tx.unsafe<{ id: string }>(
        `select id from plants where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.plantId],
      );
      if (!plant[0]) {
        throw new M1Error('validation_error', 422, 'plant does not belong to this company', { field: 'plantId' });
      }

      const taken = await tx.unsafe<{ id: string }>(
        `select id from mix_designs where company_id = $1 and lower(code) = lower($2)`,
        [context.tenant.companyId, code],
      );
      const uniqueness = checkCodeUnique(Boolean(taken[0]));
      if (uniqueness.outcome !== 'pass') {
        throw new M1Error(uniqueness.classification, 409, `mix design code ${code} already exists`, {
          check: uniqueness.key,
          classification: uniqueness.classification,
          field: 'code',
        });
      }

      const id = newId('MIX');
      await tx.unsafe(
        `insert into mix_designs (id, company_id, plant_id, code, name_ar, name_en, current_version, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,1,$7,$7)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          code,
          payload.nameAr.trim(),
          payload.nameEn.trim(),
          context.actor.username,
        ],
      );
      await insertVersionRows(tx, context, id, {
        versionNo: 1,
        status: 'draft',
        strengthClass: payload.strengthClass.trim(),
        notes: '',
        components: payload.components,
        strengthTests: payload.strengthTests,
      });
      await audit(tx, context, 'mix.design_created', id, {
        code,
        plantId: payload.plantId,
        strengthClass: payload.strengthClass.trim(),
        components: payload.components.length,
        strengthTests: payload.strengthTests.length,
      });
      return id;
    });

    return this.get(context, created);
  };

  /** Level 4: metadata only. The recipe lives in versions, which are immutable once approved. */
  updateDesign = async (context: B1Context, id: string, patch: MixDesignPatch): Promise<MixDesignRow> => {
    requireLevel(context, 4, 'edit a mix design');
    return this.db.withTenant(context.tenant, async (tx) => {
      const before = await loadDesign(tx, context.tenant.companyId, id);
      const nextCode = patch.code?.trim() || before.code;
      const nextPlant = patch.plantId?.trim() || before.plant_id;

      if (nextCode.toLowerCase() !== before.code.toLowerCase()) {
        const taken = await tx.unsafe<{ id: string }>(
          `select id from mix_designs where company_id = $1 and lower(code) = lower($2) and id <> $3`,
          [context.tenant.companyId, nextCode, id],
        );
        const uniqueness = checkCodeUnique(Boolean(taken[0]));
        if (uniqueness.outcome !== 'pass') {
          throw new M1Error(uniqueness.classification, 409, `mix design code ${nextCode} already exists`, {
            check: uniqueness.key,
            classification: uniqueness.classification,
            field: 'code',
          });
        }
      }
      if (nextPlant !== before.plant_id) {
        const plant = await tx.unsafe<{ id: string }>(
          `select id from plants where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, nextPlant],
        );
        if (!plant[0]) {
          throw new M1Error('validation_error', 422, 'plant does not belong to this company', { field: 'plantId' });
        }
      }

      const rows = await tx.unsafe<Row>(
        `update mix_designs
            set code = $3, name_ar = $4, name_en = $5, plant_id = $6, updated_by = $7
          where company_id = $1 and id = $2
          returning id, plant_id, code, name_ar, name_en, current_version, created_at`,
        [
          context.tenant.companyId,
          id,
          nextCode,
          patch.nameAr?.trim() ?? before.name_ar,
          patch.nameEn?.trim() ?? before.name_en,
          nextPlant,
          context.actor.username,
        ],
      );
      const after = toDesign({ ...rows[0], version_count: before.version_count, approved_version: before.approved_version, current_status: before.current_status, plant_name_ar: before.plant_name_ar, plant_name_en: before.plant_name_en });
      await audit(tx, context, 'mix.design_updated', id, {
        before: { code: before.code, plantId: before.plant_id, nameAr: before.name_ar, nameEn: before.name_en },
        after: { code: after.code, plantId: after.plant_id, nameAr: after.name_ar, nameEn: after.name_en },
      });
      return after;
    });
  };

  /** Level 4: replaces the content of a draft version; approved versions refuse edits. */
  updateDraft = async (
    context: B1Context,
    id: string,
    versionNo: number,
    patch: MixDraftPatch,
  ): Promise<MixVersionRow> => {
    requireLevel(context, 4, 'edit a mix version');
    return this.db.withTenant(context.tenant, async (tx) => {
      const design = await loadDesign(tx, context.tenant.companyId, id);
      const version = await loadVersion(tx, context.tenant.companyId, id, versionNo);

      const editable = checkVersionEditable(version.status);
      if (editable.outcome !== 'pass') {
        throw new M1Error(editable.classification, 409, `version ${versionNo} is ${version.status} and cannot be edited`, {
          check: editable.key,
          classification: editable.classification,
          status: version.status,
        });
      }

      const components = patch.components ?? version.components.map((component) => ({
        materialId: component.material_id,
        role: component.role,
        qtyPerM3: component.qty_per_m3,
        unit: component.unit,
        moistureBasis: component.moisture_basis,
      }));
      const strengthTests = patch.strengthTests ?? version.strength_tests.map((test) => ({
        ageDays: test.age_days,
        targetMinMpa: test.target_min_mpa,
        sourceNote: test.source_note,
      }));
      assertDraftInputs(components, strengthTests);

      await tx.unsafe(
        `update mix_design_versions
            set strength_class = $4, notes = $5, updated_by = $6
          where company_id = $1 and mix_id = $2 and version_no = $3`,
        [
          context.tenant.companyId,
          id,
          versionNo,
          patch.strengthClass?.trim() ?? version.strength_class,
          patch.notes ?? version.notes,
          context.actor.username,
        ],
      );
      await tx.unsafe(`delete from mix_components where company_id = $1 and version_id = $2`, [
        context.tenant.companyId,
        version.id,
      ]);
      await tx.unsafe(`delete from mix_strength_tests where company_id = $1 and version_id = $2`, [
        context.tenant.companyId,
        version.id,
      ]);
      for (const [index, component] of components.entries()) {
        await tx.unsafe(
          `insert into mix_components (id, company_id, version_id, material_id, role, qty_per_m3, unit, moisture_basis)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            newId(`MXC${index}`),
            context.tenant.companyId,
            version.id,
            component.materialId,
            component.role,
            component.qtyPerM3,
            component.unit,
            component.moistureBasis,
          ],
        );
      }
      for (const [index, test] of strengthTests.entries()) {
        await tx.unsafe(
          `insert into mix_strength_tests (id, company_id, version_id, age_days, target_min_mpa, source_note)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            newId(`MXT${index}`),
            context.tenant.companyId,
            version.id,
            test.ageDays,
            test.targetMinMpa,
            test.sourceNote,
          ],
        );
      }

      await audit(tx, context, 'mix.version_edited', design.id, {
        versionNo,
        components: components.length,
        strengthTests: strengthTests.length,
        strengthClass: patch.strengthClass?.trim() ?? version.strength_class,
      });
      return loadVersion(tx, context.tenant.companyId, id, versionNo);
    });
  };

  /** Level 4: draft → submitted. */
  submit = async (context: B1Context, id: string, versionNo: number): Promise<MixVersionRow> => {
    requireLevel(context, 4, 'submit a mix version');
    return this.db.withTenant(context.tenant, async (tx) => {
      const version = await loadVersion(tx, context.tenant.companyId, id, versionNo);
      if (!canTransition(version.status, 'submitted')) {
        throw new M1Error('invalid_transition', 409, `version ${versionNo} is ${version.status}`, {
          from: version.status,
          to: 'submitted',
        });
      }
      await tx.unsafe(
        `update mix_design_versions
            set status = 'submitted', updated_by = $4
          where company_id = $1 and mix_id = $2 and version_no = $3`,
        [context.tenant.companyId, id, versionNo, context.actor.username],
      );
      await audit(tx, context, 'mix.version_submitted', id, { versionNo });
      return loadVersion(tx, context.tenant.companyId, id, versionNo);
    });
  };

  /**
   * Level 5: submitted → approved. Every rule check runs first; a single blocking check
   * refuses the approval with its classification. No value, class or source note is ever
   * filled in to make an approval succeed.
   */
  approve = async (context: B1Context, id: string, versionNo: number): Promise<MixVersionRow> => {
    requireLevel(context, 5, 'approve a mix version');
    return this.db.withTenant(context.tenant, async (tx) => {
      const version = await loadVersion(tx, context.tenant.companyId, id, versionNo);
      if (!canTransition(version.status, 'approved')) {
        throw new M1Error('invalid_transition', 409, `version ${versionNo} is ${version.status}`, {
          from: version.status,
          to: 'approved',
        });
      }

      const components: MixComponentInput[] = version.components.map((component) => ({
        materialId: component.material_id,
        role: component.role,
        qtyPerM3: component.qty_per_m3,
        unit: component.unit,
        moistureBasis: component.moisture_basis,
      }));
      const checks: MixCheck[] = [
        ...components.map((component) => checkComponentQty(component.qtyPerM3)),
        checkStrengthClass(version.strength_class),
        ...version.strength_tests.map((test) => checkStrengthSource(test.source_note)),
      ];
      const blocking = blockingChecks(checks);
      if (blocking.length > 0) {
        const first = blocking[0]!;
        throw new M1Error(first.classification, 422, `version ${versionNo} cannot be approved: ${first.reasonKey}`, {
          check: first.key,
          classification: first.classification,
          blocking: blocking.map((check) => ({ key: check.key, classification: check.classification, outcome: check.outcome })),
        });
      }

      await tx.unsafe(
        `update mix_design_versions
            set status = 'approved', approved_by = $4, approved_at = now(), updated_by = $4
          where company_id = $1 and mix_id = $2 and version_no = $3`,
        [context.tenant.companyId, id, versionNo, context.actor.username],
      );
      await tx.unsafe(
        `update mix_designs set current_version = $3, updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, versionNo, context.actor.username],
      );
      await audit(tx, context, 'mix.version_approved', id, {
        versionNo,
        approvedBy: context.actor.username,
        checks: checks.map((check) => ({ key: check.key, outcome: check.outcome })),
      });
      return loadVersion(tx, context.tenant.companyId, id, versionNo);
    });
  };

  /**
   * Level 5: approved → superseded, with a new draft version copied from it. This is the
   * only way an approved mix changes, and it records the override of the
   * `mix.approved_version_edit` rule with actor, reason, time, rule id and decision.
   */
  supersede = async (
    context: B1Context,
    id: string,
    versionNo: number,
    reason: string,
  ): Promise<{ version: MixVersionRow; override: StoredMixOverride }> => {
    requireLevel(context, 5, 'supersede a mix version');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, {
        field: 'reason',
      });
    }

    return this.db.withTenant(context.tenant, async (tx) => {
      const design = await loadDesign(tx, context.tenant.companyId, id);
      const version = await loadVersion(tx, context.tenant.companyId, id, versionNo);
      if (!canTransition(version.status, 'superseded')) {
        throw new M1Error('invalid_transition', 409, `version ${versionNo} is ${version.status}`, {
          from: version.status,
          to: 'superseded',
        });
      }

      const ruleCode = 'mix.approved_version_edit';
      const ruleId = `RUL-${context.tenant.companyId}-${ruleCode.replace(/\./g, '_')}`;
      await tx.unsafe(
        `insert into rule_definitions (id, company_id, code, module, classification, unit, created_by, updated_by)
         values ($1,$2,$3,'mix_design',$4,'',$5,$5)
         on conflict (id) do nothing`,
        [ruleId, context.tenant.companyId, ruleCode, MIX_RULES.version_editable, context.actor.username],
      );

      const overrideRows = await tx.unsafe<Row>(
        `insert into rule_overrides (company_id, rule_id, rule_code, entity_type, entity_id, actor, reason, decision)
         values ($1,$2,$3,'mix_design_version',$4,$5,$6,'approved')
         returning id::text as id, decided_at`,
        [context.tenant.companyId, ruleId, ruleCode, version.id, context.actor.username, reason.trim()],
      );
      const override: StoredMixOverride = {
        id: str(overrideRows[0]?.id),
        ruleCode,
        entityType: 'mix_design_version',
        entityId: version.id,
        actor: context.actor.username,
        reason: reason.trim(),
        decision: 'approved',
        decidedAt: new Date(str(overrideRows[0]?.decided_at)).toISOString(),
      };

      await tx.unsafe(
        `update mix_design_versions
            set status = 'superseded', updated_by = $4
          where company_id = $1 and mix_id = $2 and version_no = $3`,
        [context.tenant.companyId, id, versionNo, context.actor.username],
      );

      const nextNo = versionNo + 1;
      await insertVersionRows(tx, context, id, {
        versionNo: nextNo,
        status: 'draft',
        strengthClass: version.strength_class,
        notes: version.notes,
        components: version.components.map((component) => ({
          materialId: component.material_id,
          role: component.role,
          qtyPerM3: component.qty_per_m3,
          unit: component.unit,
          moistureBasis: component.moisture_basis,
        })),
        strengthTests: version.strength_tests.map((test) => ({
          ageDays: test.age_days,
          targetMinMpa: test.target_min_mpa,
          sourceNote: test.source_note,
        })),
      });
      await tx.unsafe(
        `update mix_designs set current_version = $3, updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, nextNo, context.actor.username],
      );
      await audit(tx, context, 'mix.version_superseded', design.id, {
        versionNo,
        nextVersionNo: nextNo,
        override,
      });

      return { version: await loadVersion(tx, context.tenant.companyId, id, nextNo), override };
    });
  };

  /** Level 4: a design that carries an approved version keeps its history and refuses deletion. */
  remove = async (context: B1Context, id: string): Promise<void> => {
    requireLevel(context, 4, 'delete a mix design');
    await this.db.withTenant(context.tenant, async (tx) => {
      const design = await loadDesign(tx, context.tenant.companyId, id);
      const approved = await tx.unsafe<{ n: number }>(
        `select count(*)::int as n from mix_design_versions
          where company_id = $1 and mix_id = $2 and status in ('approved', 'superseded')`,
        [context.tenant.companyId, id],
      );
      if (approved[0]!.n > 0) {
        const check = checkVersionEditable('approved');
        throw new M1Error(check.classification, 409, 'a mix with an approved version cannot be deleted', {
          check: check.key,
          classification: check.classification,
          approvedVersion: design.approved_version,
        });
      }
      await tx.unsafe(`delete from mix_designs where company_id = $1 and id = $2`, [context.tenant.companyId, id]);
      await audit(tx, context, 'mix.design_deleted', id, { code: design.code });
    });
  };
}
