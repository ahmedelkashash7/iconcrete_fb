/**
 * R1 rule repository.
 *
 * Reads, value changes and overrides all run inside db.withTenant(), so RLS applies to the
 * statement and every query also carries an explicit company_id predicate. Evaluations are
 * produced by the pure engine in src/core/rules.ts and appended, never updated.
 */
import {
  evaluateRule,
  isRuleConfigured,
  MISSING_REFERENCE,
  MISSING_SOURCE,
  validateOverride,
  type LimitComparator,
  type OverrideDecision,
  type RuleClassification,
  type RuleEvaluation,
  type RuleModule,
  type RuleStatus,
} from '../../src/core/rules';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

type Row = Record<string, unknown>;

export interface RuleRow {
  id: string;
  code: string;
  module: RuleModule;
  classification: RuleClassification;
  value: number | null;
  unit: string;
  source_note: string;
  effective_from: string;
  approved_by: string;
  status: RuleStatus;
  configured: boolean;
  /** What the UI shows: the value with its unit, or the missing-reference sentence. */
  value_display: string;
  version: number;
}

export interface RuleValuePatch {
  value: number | null;
  unit: string;
  sourceNote: string;
  approvedBy?: string;
}

export interface EvaluationRequest {
  entityType: string;
  entityId: string;
  actual: number;
  comparator: LimitComparator;
}

export interface StoredEvaluation extends RuleEvaluation {
  id: string;
  entityType: string;
  entityId: string;
  evaluatedAt: string;
}

export interface OverrideRequest {
  entityType: string;
  entityId: string;
  reason: string;
  decision: OverrideDecision;
}

export interface StoredOverride {
  id: string;
  ruleCode: string;
  entityType: string;
  entityId: string;
  actor: string;
  reason: string;
  decision: OverrideDecision;
  decidedAt: string;
}

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const toRule = (row: Row): RuleRow => {
  const value = row.value === null || row.value === undefined ? null : Number(row.value);
  const rule = {
    code: str(row.code),
    module: str(row.module) as RuleModule,
    classification: str(row.classification) as RuleClassification,
    value,
    unit: str(row.unit),
    sourceNote: str(row.source_note),
    status: str(row.status) as RuleStatus,
  };
  const configured = isRuleConfigured(rule);
  return {
    id: str(row.id),
    code: rule.code,
    module: rule.module,
    classification: rule.classification,
    value,
    unit: rule.unit,
    source_note: rule.sourceNote,
    effective_from: str(row.effective_from).slice(0, 10),
    approved_by: str(row.approved_by),
    status: rule.status,
    configured,
    value_display:
      value === null
        ? MISSING_REFERENCE
        : configured
          ? `${value}${rule.unit ? ` ${rule.unit}` : ''}`
          : `${value}${rule.unit ? ` ${rule.unit}` : ''} — ${MISSING_SOURCE}`,
    version: Number(row.version ?? 1),
  };
};

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
     values ($1,$2,$3,$4,$5,'rule_definitions',$6,$7,$8,$9::jsonb)`,
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

const SELECT_RULE = `
  select id, code, module, classification, value::text as value, unit, source_note,
         effective_from, approved_by, status, version
    from rule_definitions
   where company_id = $1 and code = $2`;

const loadRule = async (tx: Executor, companyId: string, code: string): Promise<RuleRow> => {
  const rows = await tx.unsafe<Row>(SELECT_RULE, [companyId, code]);
  const row = rows[0];
  if (!row) throw new M1Error('rule_not_found', 404, `rule ${code} does not exist for this company`);
  return toRule(row);
};

const ruleDefinition = (rule: RuleRow) => ({
  code: rule.code,
  module: rule.module,
  classification: rule.classification,
  value: rule.value,
  unit: rule.unit,
  sourceNote: rule.source_note,
  status: rule.status,
});

export class RuleService {
  constructor(private readonly db: Db) {}

  list = async (
    context: B1Context,
    filters: { module?: string; status?: string } = {},
  ): Promise<RuleRow[]> => {
    const rows = await this.db.withTenant(context.tenant, async (tx) =>
      tx.unsafe<Row>(
        `select id, code, module, classification, value::text as value, unit, source_note,
                effective_from, approved_by, status, version
           from rule_definitions
          where company_id = $1
            and ($2::text = '' or module = $2)
            and ($3::text = '' or status = $3)
          order by module, code`,
        [context.tenant.companyId, filters.module ?? '', filters.status ?? ''],
      ),
    );
    return rows.map(toRule);
  };

  get = async (context: B1Context, code: string): Promise<RuleRow> =>
    this.db.withTenant(context.tenant, (tx) => loadRule(tx, context.tenant.companyId, code));

  /** Level 5 only. Records the before/after pair in the audit log in the same transaction. */
  updateValue = async (
    context: B1Context,
    code: string,
    patch: RuleValuePatch,
  ): Promise<RuleRow> => {
    if (context.actor.roleLevel < 5) {
      throw new M1Error('forbidden', 403, 'only a level-5 user may change a rule value');
    }
    if (patch.value !== null && !Number.isFinite(patch.value)) {
      throw new M1Error('validation_error', 422, 'value must be a finite number or null', {
        field: 'value',
      });
    }
    if (patch.unit.length > 32) {
      throw new M1Error('validation_error', 422, 'unit must be at most 32 characters', {
        field: 'unit',
      });
    }
    if (patch.sourceNote.length > 500) {
      throw new M1Error('validation_error', 422, 'sourceNote must be at most 500 characters', {
        field: 'sourceNote',
      });
    }

    return this.db.withTenant(context.tenant, async (tx) => {
      const before = await loadRule(tx, context.tenant.companyId, code);
      const rows = await tx.unsafe<Row>(
        `update rule_definitions
            set value = $3, unit = $4, source_note = $5,
                approved_by = $6, effective_from = current_date,
                updated_by = $7, version = version + 1
          where company_id = $1 and code = $2 and status = 'active'
          returning id, code, module, classification, value::text as value, unit, source_note,
                    effective_from, approved_by, status, version`,
        [
          context.tenant.companyId,
          code,
          patch.value,
          patch.unit,
          patch.sourceNote,
          patch.approvedBy ?? context.actor.username,
          context.actor.username,
        ],
      );
      const row = rows[0];
      if (!row) throw new M1Error('rule_not_found', 404, `rule ${code} is not active`);

      const after = toRule(row);
      await audit(tx, context, 'rule.value_changed', after.id, {
        code: after.code,
        before: {
          value: before.value,
          unit: before.unit,
          sourceNote: before.source_note,
        },
        after: {
          value: after.value,
          unit: after.unit,
          sourceNote: after.source_note,
        },
        approvedBy: after.approved_by,
      });
      return after;
    });
  };

  /** Runs the pure engine and appends the evidence. The rule itself is never modified. */
  evaluate = async (
    context: B1Context,
    code: string,
    request: EvaluationRequest,
  ): Promise<StoredEvaluation> => {
    const entityType = request.entityType.trim();
    const entityId = request.entityId.trim();
    if (!entityType || !entityId) {
      throw new M1Error('validation_error', 422, 'entityType and entityId are required', {
        field: entityType ? 'entityId' : 'entityType',
      });
    }

    return this.db.withTenant(context.tenant, async (tx) => {
      const rule = await loadRule(tx, context.tenant.companyId, code);
      const evaluation = evaluateRule(ruleDefinition(rule), {
        actual: request.actual,
        comparator: request.comparator,
      });

      const rows = await tx.unsafe<Row>(
        `insert into rule_evaluations (
           company_id, rule_id, rule_code, entity_type, entity_id, input_snapshot, outcome, evaluated_by
         ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         returning id::text as id, evaluated_at`,
        [
          context.tenant.companyId,
          rule.id,
          rule.code,
          entityType,
          entityId,
          JSON.stringify({
            actual: evaluation.actual,
            comparator: evaluation.comparator,
            value: evaluation.value,
            unit: evaluation.unit,
            unconfigured: evaluation.unconfigured,
          }),
          evaluation.outcome,
          context.actor.username,
        ],
      );

      return {
        ...evaluation,
        id: str(rows[0]?.id),
        entityType,
        entityId,
        evaluatedAt: new Date(rows[0]?.evaluated_at as string).toISOString(),
      };
    });
  };

  /** Appends an override with actor, reason, decision, rule id and time; audited too. */
  override = async (
    context: B1Context,
    code: string,
    request: OverrideRequest,
  ): Promise<StoredOverride> => {
    if (context.actor.roleLevel < 4) {
      throw new M1Error('forbidden', 403, 'only a level-4 user may decide an override');
    }

    const draft = {
      ruleCode: code,
      entityType: request.entityType,
      entityId: request.entityId,
      actor: context.actor.username,
      reason: request.reason,
      decision: request.decision,
    };
    const invalid = validateOverride(draft);
    if (invalid) throw new M1Error(invalid.code, 422, invalid.message, { field: invalid.field });

    return this.db.withTenant(context.tenant, async (tx) => {
      const rule = await loadRule(tx, context.tenant.companyId, code);
      const rows = await tx.unsafe<Row>(
        `insert into rule_overrides (
           company_id, rule_id, rule_code, entity_type, entity_id, actor, reason, decision
         ) values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id::text as id, decided_at`,
        [
          context.tenant.companyId,
          rule.id,
          rule.code,
          draft.entityType.trim(),
          draft.entityId.trim(),
          draft.actor,
          draft.reason.trim(),
          draft.decision,
        ],
      );

      const override: StoredOverride = {
        id: str(rows[0]?.id),
        ruleCode: rule.code,
        entityType: draft.entityType.trim(),
        entityId: draft.entityId.trim(),
        actor: draft.actor,
        reason: draft.reason.trim(),
        decision: draft.decision as OverrideDecision,
        decidedAt: new Date(rows[0]?.decided_at as string).toISOString(),
      };

      await audit(tx, context, 'rule.overridden', rule.id, {
        code: rule.code,
        decision: override.decision,
        reason: override.reason,
        entityType: override.entityType,
        entityId: override.entityId,
      });
      return override;
    });
  };
}
