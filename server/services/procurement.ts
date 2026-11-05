/**
 * M9 procurement repository: supplier standing, evaluations, documents, contracts,
 * purchase invoices, payment vouchers and AP aging.
 *
 * Every decision is delegated to src/core/procurement; this file only supplies the rows.
 * RLS and plant narrowing are applied on every statement, and every mutation is audited.
 */
import {
  apAging,
  canPaymentVoucherTransition,
  canPurchaseInvoiceTransition,
  canSupplierContractTransition,
  canSupplierDocumentTransition,
  canSupplierEvaluationTransition,
  checkDuplicateInvoice,
  checkEvaluationScores,
  checkInvoiceArithmetic,
  checkPayment,
  checkSupplierDocuments,
  checkSupplierStanding,
  chequeEarlyWarning,
  evaluationGrade,
  documentIsValid,
  MATCH_RULE_CODES,
  missingMatchRule,
  PROCUREMENT_LEVELS,
  threeWayMatch,
  type AgingInvoice,
  type DocumentStanding,
  type DocumentType,
  type MatchLine,
  type PaymentVoucherStatus,
  type PurchaseInvoiceStatus,
  type Scores,
  type SupplierContractStatus,
  type SupplierDocumentStatus,
  type SupplierEvaluationStatus,
  type SupplierGrade,
} from '../../src/core/procurement';
import { MIN_OVERRIDE_REASON, type RuleDefinition } from '../../src/core/rules';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const nullable = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : String(value);
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);
const today = (): string => new Date().toISOString().slice(0, 10);
const newId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
const documentNo = (prefix: string): string => {
  const year = new Date().getUTCFullYear();
  const tail = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${prefix}-${year}-${tail}`;
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
     values ($1,$2,$3,$4,$5,'procurement',$6,$7,$8,$9::jsonb)`,
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

export interface SupplierStanding {
  supplierId: string;
  status: string;
  grade: SupplierGrade | null;
  documents: DocumentStanding[];
}

/** Shared by the inventory PO path: one supplier's current standing, tenant-scoped. */
export const loadSupplierStanding = async (
  tx: Executor,
  companyId: string,
  supplierId: string,
): Promise<SupplierStanding | null> => {
  const rows = await tx.unsafe<Row>(
    `select s.id, s.status,
            (select e.overall_grade from supplier_evaluations e
              where e.company_id = s.company_id and e.supplier_id = s.id
                and e.status = 'published' and e.deleted_at is null
              order by e.evaluated_at desc limit 1) as overall_grade
       from suppliers s
      where s.company_id = $1 and s.id = $2 and s.deleted_at is null`,
    [companyId, supplierId],
  );
  const row = rows[0];
  if (!row) return null;
  const documents = await tx.unsafe<Row>(
    `select doc_type, status, valid_until::text as valid_until
       from supplier_documents
      where company_id = $1 and supplier_id = $2 and deleted_at is null`,
    [companyId, supplierId],
  );
  return {
    supplierId,
    status: str(row.status),
    grade: (nullable(row.overall_grade) as SupplierGrade | null) ?? null,
    documents: documents.map((document) => ({
      docType: str(document.doc_type),
      status: str(document.status),
      validUntil: nullable(document.valid_until),
    })),
  };
};

export const supplierPoBlock = (
  standing: SupplierStanding | null,
  asOf = today(),
): { blocked: boolean; reason: string; outcome: 'pass' | 'approval_required' | 'failure' } => {
  if (!standing) return { blocked: true, reason: 'supplier_not_found', outcome: 'failure' };
  const supply = checkSupplierStanding(standing.status, standing.grade);
  if (supply.outcome === 'failure') {
    return { blocked: true, reason: supply.reasonKey, outcome: 'failure' };
  }
  const docs = checkSupplierDocuments(standing.documents, asOf);
  if (docs.outcome !== 'pass') {
    return { blocked: true, reason: docs.reasonKey, outcome: 'approval_required' };
  }
  return { blocked: false, reason: 'rule.passed', outcome: 'pass' };
};

export interface SupplierDocumentInput {
  plantId: string;
  supplierId: string;
  docType: DocumentType;
  documentRef: string;
  validFrom: string;
  validUntil: string | null;
  notes?: string;
}

export interface EvaluationInput extends Scores {
  plantId: string;
  supplierId: string;
  evaluationNo?: string;
  periodStart: string;
  periodEnd: string;
  evaluatorId?: string;
  notes?: string;
}

export interface ContractInput {
  plantId: string;
  supplierId: string;
  contractNo?: string;
  startDate: string;
  endDate: string | null;
  paymentTerms?: string;
  priceAdjustmentClause?: string;
}

export interface InvoiceItemInput {
  materialId: string;
  quantity: number;
  unitPrice: number;
  total?: number;
}

export interface InvoiceInput {
  plantId: string;
  supplierId: string;
  poId: string | null;
  invoiceNo?: string;
  invoiceDate: string;
  dueDate: string | null;
  taxAmount: number;
  subtotal?: number;
  totalAmount?: number;
  notes?: string;
  items: InvoiceItemInput[];
  reason?: string;
}

export interface VoucherInput {
  plantId: string;
  supplierId: string | null;
  customerId: string | null;
  purchaseInvoiceId: string | null;
  paymentType: 'supplier_payment' | 'customer_receipt' | 'expense';
  amount: number;
  currency?: string;
  method: 'cash' | 'bank_transfer' | 'cheque';
  chequeNo?: string | null;
  chequeDueDate?: string | null;
  paidAt?: string | null;
  notes?: string;
}

export class ProcurementService {
  constructor(private readonly db: Db) {}

  private level = (context: B1Context, min: number, what: string): void => {
    if (context.actor.roleLevel < min) {
      throw new M1Error('forbidden', 403, `only a level-${min} user may ${what}`);
    }
  };

  private assertPlant = (context: B1Context, plantId: string): void => {
    if (!plantId.trim()) {
      throw new M1Error('validation_error', 422, 'plant is required', { field: 'plantId' });
    }
    if (context.tenant.plantIds.length > 0 && !context.tenant.plantIds.includes(plantId)) {
      throw new M1Error('plant_scope', 403, `plant ${plantId} is outside the caller's scope`, {
        plantId,
      });
    }
  };

  private rules = async (tx: Executor, companyId: string): Promise<Map<string, RuleDefinition>> => {
    const rows = await tx.unsafe<Row>(
      `select code, classification, value::text as value, unit, source_note, status
         from rule_definitions where company_id = $1 and module = 'procurement'`,
      [companyId],
    );
    const rules = new Map<string, RuleDefinition>();
    for (const row of rows) {
      rules.set(str(row.code), {
        code: str(row.code),
        module: 'procurement',
        classification: str(row.classification) as RuleDefinition['classification'],
        value: numOrNull(row.value),
        unit: str(row.unit),
        sourceNote: str(row.source_note),
        status: str(row.status) === 'retired' ? 'retired' : 'active',
      });
    }
    return rules;
  };

  private enforce = (
    check: ReturnType<typeof checkSupplierDocuments>,
    context: B1Context,
    reason: string,
  ): 'pass' | 'warning' | 'overridden' => {
    if (check.outcome === 'failure') {
      throw new M1Error(check.reasonKey.replace(/^procurement\./, ''), 422, check.reasonKey, {
        check: check.key,
      });
    }
    if (check.outcome !== 'pass' && check.outcome !== 'warning') {
      if (
        context.actor.roleLevel >= PROCUREMENT_LEVELS.approve &&
        reason.trim().length >= MIN_OVERRIDE_REASON
      ) {
        return 'overridden';
      }
      throw new M1Error('approval_required', 403, check.reasonKey, { check: check.key });
    }
    return check.outcome === 'warning' ? 'warning' : 'pass';
  };

  // ------------------------------------------------------------------ suppliers
  listSuppliers = async (
    context: B1Context,
    filters: { q?: string; status?: string; grade?: string } = {},
  ): Promise<Row[]> => {
    this.level(context, PROCUREMENT_LEVELS.read, 'read suppliers');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select s.id, s.supplier_code, s.name_ar, s.name_en, s.phone, s.contact, s.category,
                s.status, s.plant_id, s.payment_terms,
                e.id as evaluation_id, e.overall_grade, e.evaluated_at,
                (select count(*)::int from supplier_documents d
                  where d.company_id = s.company_id and d.supplier_id = s.id
                    and d.deleted_at is null and (d.status in ('expired','rejected')
                    or (d.valid_until is not null and d.valid_until < current_date))) as invalid_documents,
                (select count(*)::int from supplier_documents d
                  where d.company_id = s.company_id and d.supplier_id = s.id
                    and d.deleted_at is null) as document_count
           from suppliers s
           left join lateral (
             select x.id, x.overall_grade, x.evaluated_at
               from supplier_evaluations x
              where x.company_id = s.company_id and x.supplier_id = s.id
                and x.status = 'published' and x.deleted_at is null
              order by x.evaluated_at desc limit 1
           ) e on true
          where s.company_id = $1 and s.deleted_at is null
            and ($2 = '' or s.status = $2)
            and ($3 = '' or s.name_ar ilike '%' || $3 || '%' or s.name_en ilike '%' || $3 || '%'
                 or coalesce(s.supplier_code,'') ilike '%' || $3 || '%')
            and ($4 = '' or e.overall_grade = $4)
          order by s.name_en, s.id`,
        [
          context.tenant.companyId,
          filters.status ?? '',
          filters.q ?? '',
          filters.grade ?? '',
        ],
      );
      return rows;
    });
  };

  getSupplier = async (context: B1Context, id: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.read, 'read a supplier');
    return this.db.withTenant(context.tenant, async (tx) => {
      const suppliers = await this.listSuppliers(context, {});
      const supplier = suppliers.find((row) => str(row.id) === id);
      if (!supplier) throw new M1Error('supplier_not_found', 404, `supplier ${id} does not exist`);
      const documents = await tx.unsafe<Row>(
        `select id, doc_type, document_ref, valid_from::text as valid_from,
                valid_until::text as valid_until, verified_by, verified_at, status,
                reject_reason, notes
           from supplier_documents
          where company_id = $1 and supplier_id = $2 and deleted_at is null
          order by doc_type, valid_until desc nulls last`,
        [context.tenant.companyId, id],
      );
      const evaluations = await tx.unsafe<Row>(
        `select id, evaluation_no, period_start::text as period_start,
                period_end::text as period_end, quality_score_0_to_100::text as quality_score,
                delivery_score_0_to_100::text as delivery_score, price_score_0_to_100::text as price_score,
                responsiveness_score_0_to_100::text as responsiveness_score,
                overall_grade, evaluator_id, evaluated_at, notes, status
           from supplier_evaluations
          where company_id = $1 and supplier_id = $2 and deleted_at is null
          order by period_end desc, evaluated_at desc`,
        [context.tenant.companyId, id],
      );
      const contracts = await tx.unsafe<Row>(
        `select id, contract_no, start_date::text as start_date, end_date::text as end_date,
                payment_terms, price_adjustment_clause, status, signed_at, signed_by, void_reason
           from supplier_contracts
          where company_id = $1 and supplier_id = $2 and deleted_at is null
          order by start_date desc`,
        [context.tenant.companyId, id],
      );
      return { ...supplier, documents, evaluations, contracts };
    });
  };

  suspendSupplier = async (context: B1Context, id: string, reason: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.control, 'suspend a supplier');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a suspension reason is required', {
        field: 'reason',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `update suppliers set status = 'suspended', updated_by = $3
          where company_id = $1 and id = $2 and deleted_at is null returning id, status`,
        [context.tenant.companyId, id, context.actor.username],
      );
      if (!rows[0]) throw new M1Error('supplier_not_found', 404, `supplier ${id} does not exist`);
      await audit(tx, context, 'procurement.supplier_suspended', id, { reason: reason.trim() });
      return rows[0];
    });
  };

  reactivateSupplier = async (context: B1Context, id: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.control, 'reactivate a supplier');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `update suppliers set status = 'active', updated_by = $3
          where company_id = $1 and id = $2 and deleted_at is null returning id, status`,
        [context.tenant.companyId, id, context.actor.username],
      );
      if (!rows[0]) throw new M1Error('supplier_not_found', 404, `supplier ${id} does not exist`);
      await audit(tx, context, 'procurement.supplier_reactivated', id, {});
      return rows[0];
    });
  };

  // ------------------------------------------------------------------ documents
  createDocument = async (context: B1Context, input: SupplierDocumentInput): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.record, 'record a supplier document');
    this.assertPlant(context, input.plantId);
    if (!input.documentRef.trim()) {
      throw new M1Error('validation_error', 422, 'document_ref is required', {
        field: 'documentRef',
      });
    }
    if (!input.validFrom || (input.validUntil !== null && input.validUntil < input.validFrom)) {
      throw new M1Error('validation_error', 422, 'valid_until must not precede valid_from', {
        field: 'validUntil',
      });
    }
    const id = newId('SDOC');
    return this.db.withTenant(context.tenant, async (tx) => {
      const supplier = await tx.unsafe<Row>(
        `select id from suppliers where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, input.supplierId],
      );
      if (!supplier[0]) throw new M1Error('supplier_not_found', 404, 'supplier does not exist');
      await tx.unsafe(
        `insert into supplier_documents (id, company_id, plant_id, supplier_id, doc_type,
            document_ref, valid_from, valid_until, status, notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$10)`,
        [
          id,
          context.tenant.companyId,
          input.plantId,
          input.supplierId,
          input.docType,
          input.documentRef.trim(),
          input.validFrom,
          input.validUntil,
          input.notes ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'procurement.document_recorded', id, {
        supplierId: input.supplierId,
        docType: input.docType,
      });
      return this.readDocument(tx, context, id);
    });
  };

  private readDocument = async (tx: Executor, context: B1Context, id: string): Promise<Row> => {
    const rows = await tx.unsafe<Row>(
      `select id, supplier_id, doc_type, document_ref, valid_from::text as valid_from,
              valid_until::text as valid_until, verified_by, verified_at, status, reject_reason
         from supplier_documents where company_id = $1 and id = $2 and deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('document_not_found', 404, `document ${id} does not exist`);
    return rows[0];
  };

  verifyDocument = async (context: B1Context, id: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.approve, 'verify a supplier document');
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readDocument(tx, context, id);
      const from = str(current.status) as SupplierDocumentStatus;
      if (!canSupplierDocumentTransition(from, 'verified')) {
        throw new M1Error('invalid_transition', 409, `document is ${from}`);
      }
      if (nullable(current.valid_until) && str(current.valid_until) < today()) {
        throw new M1Error('document_expired', 422, 'an expired document cannot be verified');
      }
      await tx.unsafe(
        `update supplier_documents set status = 'verified', verified_by = $3, verified_at = now(),
            updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'procurement.document_verified', id, {});
      return this.readDocument(tx, context, id);
    });
  };

  rejectDocument = async (context: B1Context, id: string, reason: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.approve, 'reject a supplier document');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a rejection reason is required');
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readDocument(tx, context, id);
      if (!canSupplierDocumentTransition(str(current.status) as SupplierDocumentStatus, 'rejected')) {
        throw new M1Error('invalid_transition', 409, `document is ${str(current.status)}`);
      }
      await tx.unsafe(
        `update supplier_documents set status = 'rejected', reject_reason = $3,
            verified_by = $4, verified_at = now(), updated_by = $4
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason.trim(), context.actor.username],
      );
      await audit(tx, context, 'procurement.document_rejected', id, { reason: reason.trim() });
      return this.readDocument(tx, context, id);
    });
  };

  voidDocument = async (context: B1Context, id: string, reason: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.control, 'void a supplier document');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a void reason is required');
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readDocument(tx, context, id);
      await tx.unsafe(
        `update supplier_documents set deleted_at = now(), status = 'rejected',
            reject_reason = $3, updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason.trim(), context.actor.username],
      );
      await audit(tx, context, 'procurement.document_voided', id, {
        reason: reason.trim(),
        previousStatus: current.status,
      });
      return { ...current, status: 'rejected', deleted: true };
    });
  };

  // ---------------------------------------------------------------- evaluations
  createEvaluation = async (context: B1Context, input: EvaluationInput): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.record, 'record a supplier evaluation');
    this.assertPlant(context, input.plantId);
    if (!input.periodStart || !input.periodEnd || input.periodEnd < input.periodStart) {
      throw new M1Error('validation_error', 422, 'period_end must not precede period_start');
    }
    const range = checkEvaluationScores(input);
    if (range.outcome !== 'pass') {
      throw new M1Error('evaluation_score_range', 422, range.reasonKey);
    }
    const id = newId('SEV');
    const evaluationNo = input.evaluationNo?.trim() || documentNo('SEV');
    return this.db.withTenant(context.tenant, async (tx) => {
      const supplier = await tx.unsafe<Row>(
        `select id from suppliers where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, input.supplierId],
      );
      if (!supplier[0]) throw new M1Error('supplier_not_found', 404, 'supplier does not exist');
      const rules = await this.rules(tx, context.tenant.companyId);
      const threshold = numOrNull(rules.get('procurement.supplier_grade_d_threshold')?.value);
      const documents = await this.documentRows(tx, context, input.supplierId);
      const valid = documents.every((document) => documentIsValid(document, today()));
      const grade = threshold === null ? null : evaluationGrade(input, threshold, valid).grade;
      await tx.unsafe(
        `insert into supplier_evaluations (id, company_id, plant_id, evaluation_no, supplier_id,
            period_start, period_end, quality_score_0_to_100, delivery_score_0_to_100,
            price_score_0_to_100, responsiveness_score_0_to_100, overall_grade, evaluator_id,
            evaluated_at, notes, status, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14,'draft',$15,$15)`,
        [
          id,
          context.tenant.companyId,
          input.plantId,
          evaluationNo,
          input.supplierId,
          input.periodStart,
          input.periodEnd,
          input.quality,
          input.delivery,
          input.price,
          input.responsiveness,
          grade,
          input.evaluatorId?.trim() || context.actor.username,
          input.notes ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'procurement.evaluation_recorded', id, {
        supplierId: input.supplierId,
        grade,
      });
      return this.readEvaluation(tx, context, id);
    });
  };

  private readEvaluation = async (tx: Executor, context: B1Context, id: string): Promise<Row> => {
    const rows = await tx.unsafe<Row>(
      `select id, evaluation_no, supplier_id, period_start::text as period_start,
              period_end::text as period_end, quality_score_0_to_100::text as quality_score,
              delivery_score_0_to_100::text as delivery_score, price_score_0_to_100::text as price_score,
              responsiveness_score_0_to_100::text as responsiveness_score, overall_grade,
              evaluator_id, evaluated_at, notes, status
         from supplier_evaluations where company_id = $1 and id = $2 and deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('evaluation_not_found', 404, `evaluation ${id} does not exist`);
    return rows[0];
  };

  private documentRows = async (
    tx: Executor,
    context: B1Context,
    supplierId: string,
  ): Promise<DocumentStanding[]> => {
    const rows = await tx.unsafe<Row>(
      `select doc_type, status, valid_until::text as valid_until
         from supplier_documents
        where company_id = $1 and supplier_id = $2 and deleted_at is null`,
      [context.tenant.companyId, supplierId],
    );
    return rows.map((row) => ({
      docType: str(row.doc_type),
      status: str(row.status),
      validUntil: nullable(row.valid_until),
    }));
  };

  publishEvaluation = async (context: B1Context, id: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.approve, 'publish a supplier evaluation');
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readEvaluation(tx, context, id);
      const from = str(current.status) as SupplierEvaluationStatus;
      if (!canSupplierEvaluationTransition(from, 'published')) {
        throw new M1Error('invalid_transition', 409, `evaluation is ${from}`);
      }
      const rules = await this.rules(tx, context.tenant.companyId);
      const threshold = numOrNull(rules.get('procurement.supplier_grade_d_threshold')?.value);
      if (threshold === null) {
        throw new M1Error('approval_required', 403, 'procurement.grade_threshold_missing', {
          check: 'evaluationScores',
        });
      }
      const documents = await this.documentRows(tx, context, str(current.supplier_id));
      const valid = documents.every((document) => documentIsValid(document, today()));
      const scores: Scores = {
        quality: num(current.quality_score),
        delivery: num(current.delivery_score),
        price: num(current.price_score),
        responsiveness: num(current.responsiveness_score),
      };
      const derived = evaluationGrade(scores, threshold, valid);
      await tx.unsafe(
        `update supplier_evaluations set status = 'superseded', updated_by = $3
          where company_id = $1 and supplier_id = $2 and id <> $4
            and status = 'published' and deleted_at is null`,
        [context.tenant.companyId, str(current.supplier_id), context.actor.username, id],
      );
      await tx.unsafe(
        `update supplier_evaluations set status = 'published', overall_grade = $3,
            evaluated_at = now(), updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, derived.grade, context.actor.username],
      );
      if (derived.grade === 'D') {
        await tx.unsafe(
          `update suppliers set status = 'suspended', updated_by = $3
            where company_id = $1 and id = $2`,
          [context.tenant.companyId, str(current.supplier_id), context.actor.username],
        );
      }
      await audit(tx, context, 'procurement.evaluation_published', id, {
        grade: derived.grade,
        average: derived.average,
        failing: derived.failing,
        suspended: derived.grade === 'D',
      });
      if (derived.grade === 'D') {
        await audit(tx, context, 'procurement.supplier_suspended', str(current.supplier_id), {
          evaluationId: id,
          grade: derived.grade,
          failing: derived.failing,
        });
      }
      return this.readEvaluation(tx, context, id);
    });
  };

  supersedeEvaluation = async (context: B1Context, id: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.control, 'supersede a supplier evaluation');
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readEvaluation(tx, context, id);
      if (!canSupplierEvaluationTransition(str(current.status) as SupplierEvaluationStatus, 'superseded')) {
        throw new M1Error('invalid_transition', 409, `evaluation is ${str(current.status)}`);
      }
      await tx.unsafe(
        `update supplier_evaluations set status = 'superseded', updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'procurement.evaluation_superseded', id, {});
      return this.readEvaluation(tx, context, id);
    });
  };

  // ------------------------------------------------------------------ contracts
  createContract = async (context: B1Context, input: ContractInput): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.record, 'record a supplier contract');
    this.assertPlant(context, input.plantId);
    if (!input.startDate || (input.endDate !== null && input.endDate < input.startDate)) {
      throw new M1Error('validation_error', 422, 'end_date must not precede start_date');
    }
    const id = newId('SCN');
    const contractNo = input.contractNo?.trim() || documentNo('SCN');
    return this.db.withTenant(context.tenant, async (tx) => {
      const supplier = await tx.unsafe<Row>(
        `select id from suppliers where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, input.supplierId],
      );
      if (!supplier[0]) throw new M1Error('supplier_not_found', 404, 'supplier does not exist');
      await tx.unsafe(
        `insert into supplier_contracts (id, company_id, plant_id, contract_no, supplier_id,
            start_date, end_date, payment_terms, price_adjustment_clause, status, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$10)`,
        [
          id,
          context.tenant.companyId,
          input.plantId,
          contractNo,
          input.supplierId,
          input.startDate,
          input.endDate,
          input.paymentTerms ?? '',
          input.priceAdjustmentClause ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'procurement.contract_recorded', id, {
        supplierId: input.supplierId,
        contractNo,
      });
      return this.readContract(tx, context, id);
    });
  };

  private readContract = async (tx: Executor, context: B1Context, id: string): Promise<Row> => {
    const rows = await tx.unsafe<Row>(
      `select id, contract_no, supplier_id, start_date::text as start_date,
              end_date::text as end_date, payment_terms, price_adjustment_clause, status,
              signed_at, signed_by, void_reason
         from supplier_contracts where company_id = $1 and id = $2 and deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('contract_not_found', 404, `contract ${id} does not exist`);
    return rows[0];
  };

  transitionContract = async (
    context: B1Context,
    id: string,
    to: SupplierContractStatus,
    reason = '',
  ): Promise<Row> => {
    this.level(
      context,
      to === 'void' ? PROCUREMENT_LEVELS.control : to === 'active' ? PROCUREMENT_LEVELS.approve : PROCUREMENT_LEVELS.record,
      `${to} a supplier contract`,
    );
    if (to === 'void' && reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a void reason is required');
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readContract(tx, context, id);
      if (!canSupplierContractTransition(str(current.status) as SupplierContractStatus, to)) {
        throw new M1Error('invalid_transition', 409, `contract is ${str(current.status)}`);
      }
      await tx.unsafe(
        `update supplier_contracts set status = $3,
            signed_at = case when $3 = 'signed' then now() else signed_at end,
            signed_by = case when $3 = 'signed' then $4 else signed_by end,
            void_reason = case when $3 = 'void' then $5 else void_reason end,
            updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, to, context.actor.username, reason.trim()],
      );
      await audit(tx, context, `procurement.contract_${to}`, id, { reason: reason.trim() });
      return this.readContract(tx, context, id);
    });
  };

  // ------------------------------------------------------------ purchase invoices
  listInvoices = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; supplierId?: string } = {},
  ): Promise<Row[]> => {
    this.level(context, PROCUREMENT_LEVELS.read, 'read purchase invoices');
    return this.db.withTenant(context.tenant, async (tx) =>
      tx.unsafe<Row>(
        `select i.id, i.invoice_no, i.supplier_id, s.name_ar as supplier_name_ar,
                s.name_en as supplier_name_en, i.po_id, po.po_no, i.invoice_date::text as invoice_date,
                i.due_date::text as due_date, i.currency, i.subtotal::text as subtotal,
                i.tax_amount::text as tax_amount, i.total_amount::text as total_amount,
                i.paid_amount::text as paid_amount, i.status, i.match_status, i.plant_id,
                i.match_details, i.approved_at, i.verified_at
           from purchase_invoices i
           join suppliers s on s.company_id = i.company_id and s.id = i.supplier_id
           left join purchase_orders po on po.company_id = i.company_id and po.id = i.po_id
          where i.company_id = $1 and i.deleted_at is null
            and ($2 = '' or i.plant_id = $2)
            and ($3 = '' or i.status = $3)
            and ($4 = '' or i.supplier_id = $4)
          order by i.invoice_date desc, i.created_at desc`,
        [
          context.tenant.companyId,
          filters.plantId ?? '',
          filters.status ?? '',
          filters.supplierId ?? '',
        ],
      ),
    );
  };

  getInvoice = async (context: B1Context, id: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.read, 'read a purchase invoice');
    return this.db.withTenant(context.tenant, async (tx) => this.readInvoice(tx, context, id));
  };

  private readInvoice = async (tx: Executor, context: B1Context, id: string): Promise<Row> => {
    const rows = await tx.unsafe<Row>(
      `select i.id, i.invoice_no, i.supplier_id, s.name_ar as supplier_name_ar,
              s.name_en as supplier_name_en, s.supplier_code, i.po_id, po.po_no,
              i.invoice_date::text as invoice_date, i.due_date::text as due_date, i.currency,
              i.subtotal::text as subtotal, i.tax_amount::text as tax_amount,
              i.total_amount::text as total_amount, i.paid_amount::text as paid_amount,
              i.status, i.match_status, i.match_details, i.verified_by, i.verified_at,
              i.approved_by, i.approved_at, i.void_reason, i.notes, i.plant_id
         from purchase_invoices i
         join suppliers s on s.company_id = i.company_id and s.id = i.supplier_id
         left join purchase_orders po on po.company_id = i.company_id and po.id = i.po_id
        where i.company_id = $1 and i.id = $2 and i.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('invoice_not_found', 404, `invoice ${id} does not exist`);
    const matchDetails = rows[0].match_details;
    if (typeof matchDetails === 'string') {
      try {
        rows[0].match_details = JSON.parse(matchDetails) as unknown;
      } catch {
        rows[0].match_details = {};
      }
    }
    const items = await tx.unsafe<Row>(
      `select ii.id, ii.line_no, ii.material_id, m.material_code, m.name_ar, m.name_en,
              ii.quantity::text as quantity, ii.unit_price::text as unit_price,
              ii.total::text as total
         from purchase_invoice_items ii
         join materials m on m.company_id = ii.company_id and m.id = ii.material_id
        where ii.company_id = $1 and ii.invoice_id = $2 and ii.deleted_at is null
        order by ii.line_no`,
      [context.tenant.companyId, id],
    );
    return { ...rows[0], items };
  };

  createInvoice = async (context: B1Context, input: InvoiceInput): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.record, 'record a purchase invoice');
    this.assertPlant(context, input.plantId);
    if (input.items.length === 0) {
      throw new M1Error('validation_error', 422, 'at least one invoice line is required');
    }
    const invoiceNo = input.invoiceNo?.trim() || documentNo('PINV');
    const itemTotals = input.items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total ?? Math.round(item.quantity * item.unitPrice * 100) / 100,
    }));
    const subtotal =
      input.subtotal ?? Math.round(itemTotals.reduce((sum, item) => sum + item.total, 0) * 100) / 100;
    const total = input.totalAmount ?? Math.round((subtotal + input.taxAmount) * 100) / 100;
    const id = newId('PIVE');
    return this.db.withTenant(context.tenant, async (tx) => {
      const duplicate = await tx.unsafe<Row>(
        `select 1 from purchase_invoices
          where company_id = $1 and supplier_id = $2 and lower(invoice_no) = lower($3)
            and deleted_at is null`,
        [context.tenant.companyId, input.supplierId, invoiceNo],
      );
      const duplicateCheck = checkDuplicateInvoice(duplicate.length > 0);
      if (duplicateCheck.outcome === 'failure') {
        throw new M1Error('duplicate_invoice', 422, 'procurement.duplicate_invoice');
      }
      const arithmetic = checkInvoiceArithmetic(subtotal, input.taxAmount, total, itemTotals);
      if (arithmetic.outcome === 'failure') {
        throw new M1Error('invoice_arithmetic', 422, 'procurement.invoice_arithmetic');
      }
      const supplier = await tx.unsafe<Row>(
        `select id, status from suppliers
          where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, input.supplierId],
      );
      if (!supplier[0]) throw new M1Error('supplier_not_found', 404, 'supplier does not exist');

      let poLines: MatchLine[] = [];
      let receiptLines: MatchLine[] = [];
      if (input.poId) {
        const po = await tx.unsafe<Row>(
          `select id, supplier_id, status from purchase_orders
            where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, input.poId],
        );
        if (!po[0]) throw new M1Error('purchase_order_not_found', 404, 'purchase order does not exist');
        if (str(po[0].supplier_id) !== input.supplierId) {
          throw new M1Error('purchase_order_supplier_mismatch', 422, 'the PO belongs to another supplier');
        }
        poLines = (
          await tx.unsafe<Row>(
            `select material_id, quantity_ordered::text as quantity, unit_price::text as unit_price
               from po_items where company_id = $1 and po_id = $2`,
            [context.tenant.companyId, input.poId],
          )
        ).map((row) => ({
          materialId: str(row.material_id),
          quantity: num(row.quantity),
          unitPrice: num(row.unit_price),
        }));
        receiptLines = (
          await tx.unsafe<Row>(
            `select pi.material_id, ri.quantity_received::text as quantity,
                    ri.unit_cost::text as unit_price
               from receipt_items ri
               join goods_receipts gr on gr.company_id = ri.company_id and gr.id = ri.receipt_id
               join po_items pi on pi.company_id = ri.company_id and pi.id = ri.po_item_id
              where ri.company_id = $1 and gr.purchase_order_id = $2
                and gr.status = 'confirmed' and gr.deleted_at is null`,
            [context.tenant.companyId, input.poId],
          )
        ).map((row) => ({
          materialId: str(row.material_id),
          quantity: num(row.quantity),
          unitPrice: num(row.unit_price),
        }));
      }
      const rules = await this.rules(tx, context.tenant.companyId);
      const match = threeWayMatch({
        poId: input.poId,
        poLines,
        receiptLines,
        invoiceLines: itemTotals.map((item, index) => ({
          materialId: input.items[index]!.materialId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        qtyRule: rules.get(MATCH_RULE_CODES.quantity) ?? missingMatchRule('quantity'),
        priceRule: rules.get(MATCH_RULE_CODES.price) ?? missingMatchRule('price'),
      });
      const reason = input.reason ?? '';
      const override = this.enforce(
        {
          key: 'threeWayMatch',
          classification: 'approval_required',
          outcome: match.outcome,
          reasonKey: match.outcome === 'pass' ? 'rule.passed' : 'procurement.match_failed',
        },
        context,
        reason,
      );
      await tx.unsafe(
        `insert into purchase_invoices (id, company_id, plant_id, invoice_no, supplier_id, po_id,
            invoice_date, due_date, subtotal, tax_amount, total_amount, status, match_status,
            match_details, notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'received',$12,($13::text)::jsonb,$14,$15,$15)`,
        [
          id,
          context.tenant.companyId,
          input.plantId,
          invoiceNo,
          input.supplierId,
          input.poId,
          input.invoiceDate,
          input.dueDate,
          subtotal,
          input.taxAmount,
          total,
          override === 'overridden' ? 'matched' : match.status,
          JSON.stringify({ ...match.details, override: override === 'overridden', reason }),
          input.notes ?? '',
          context.actor.username,
        ],
      );
      for (const [index, item] of itemTotals.entries()) {
        await tx.unsafe(
          `insert into purchase_invoice_items (id, company_id, plant_id, invoice_id, line_no,
              material_id, quantity, unit_price, total, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [
            newId('PIVL'),
            context.tenant.companyId,
            input.plantId,
            id,
            index + 1,
            input.items[index]!.materialId,
            item.quantity,
            item.unitPrice,
            item.total,
            context.actor.username,
          ],
        );
      }
      await audit(tx, context, 'procurement.invoice_received', id, {
        invoiceNo,
        supplierId: input.supplierId,
        poId: input.poId,
        matchStatus: match.status,
        override: override === 'overridden',
        reasons: match.details.reasons,
      });
      return this.readInvoice(tx, context, id);
    });
  };

  transitionInvoice = async (
    context: B1Context,
    id: string,
    to: PurchaseInvoiceStatus,
    reason = '',
  ): Promise<Row> => {
    this.level(
      context,
      to === 'voided' ? PROCUREMENT_LEVELS.control : to === 'approved' ? PROCUREMENT_LEVELS.approve : PROCUREMENT_LEVELS.record,
      `${to} a purchase invoice`,
    );
    if ((to === 'voided' || to === 'disputed') && reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a reason is required');
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readInvoice(tx, context, id);
      if (!canPurchaseInvoiceTransition(str(current.status) as PurchaseInvoiceStatus, to)) {
        throw new M1Error('invalid_transition', 409, `invoice is ${str(current.status)}`);
      }
      await tx.unsafe(
        `update purchase_invoices set status = $3,
            verified_by = case when $3 = 'verified' then $4 else verified_by end,
            verified_at = case when $3 = 'verified' then now() else verified_at end,
            approved_by = case when $3 = 'approved' then $4 else approved_by end,
            approved_at = case when $3 = 'approved' then now() else approved_at end,
            void_reason = case when $3 = 'voided' then $5 else void_reason end,
            updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, to, context.actor.username, reason.trim()],
      );
      await audit(tx, context, `procurement.invoice_${to}`, id, { reason: reason.trim() });
      return this.readInvoice(tx, context, id);
    });
  };

  // ------------------------------------------------------------ payment vouchers
  listVouchers = async (
    context: B1Context,
    filters: { status?: string; paymentType?: string } = {},
  ): Promise<Row[]> => {
    this.level(context, PROCUREMENT_LEVELS.read, 'read payment vouchers');
    return this.db.withTenant(context.tenant, async (tx) =>
      tx.unsafe<Row>(
        `select v.id, v.voucher_no, v.supplier_id, s.name_ar as supplier_name_ar,
                s.name_en as supplier_name_en, v.customer_id, c.name_ar as customer_name_ar,
                c.name_en as customer_name_en, v.purchase_invoice_id, i.invoice_no,
                v.payment_type, v.amount::text as amount, v.currency, v.method, v.cheque_no,
                v.cheque_due_date::text as cheque_due_date, v.paid_at, v.recorded_by, v.status,
                v.exception_status, v.exception_reason, v.plant_id
           from payments_vouchers v
           left join suppliers s on s.company_id = v.company_id and s.id = v.supplier_id
           left join customers c on c.company_id = v.company_id and c.id = v.customer_id
           left join purchase_invoices i on i.company_id = v.company_id and i.id = v.purchase_invoice_id
          where v.company_id = $1 and v.deleted_at is null
            and ($2 = '' or v.status = $2)
            and ($3 = '' or v.payment_type = $3)
          order by v.created_at desc`,
        [context.tenant.companyId, filters.status ?? '', filters.paymentType ?? ''],
      ),
    );
  };

  private readVoucher = async (tx: Executor, context: B1Context, id: string): Promise<Row> => {
    const rows = await tx.unsafe<Row>(
      `select v.id, v.voucher_no, v.supplier_id, v.customer_id, v.purchase_invoice_id,
              v.payment_type, v.amount::text as amount, v.currency, v.method, v.cheque_no,
              v.cheque_due_date::text as cheque_due_date, v.paid_at, v.recorded_by, v.status,
              v.exception_status, v.exception_reason, v.notes, v.plant_id
         from payments_vouchers v
        where v.company_id = $1 and v.id = $2 and v.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('voucher_not_found', 404, `voucher ${id} does not exist`);
    return rows[0];
  };

  createVoucher = async (context: B1Context, input: VoucherInput): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.record, 'record a payment voucher');
    this.assertPlant(context, input.plantId);
    if (!(input.amount > 0)) {
      throw new M1Error('validation_error', 422, 'amount must be greater than zero');
    }
    if (input.method === 'cheque' && !input.chequeNo?.trim()) {
      throw new M1Error('validation_error', 422, 'a cheque number is required');
    }
    const id = newId('PVOU');
    const voucherNo = documentNo('PV');
    return this.db.withTenant(context.tenant, async (tx) => {
      let invoiceStatus: PurchaseInvoiceStatus | null = null;
      let invoiceTotal = 0;
      let invoicePaid = 0;
      let supplierId = input.supplierId;
      if (input.paymentType === 'supplier_payment') {
        if (!input.purchaseInvoiceId) {
          throw new M1Error('payment_invoice_not_approved', 422, 'an approved invoice is required');
        }
        const invoice = await tx.unsafe<Row>(
          `select id, supplier_id, status, total_amount::text as total_amount,
                  paid_amount::text as paid_amount
             from purchase_invoices
            where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, input.purchaseInvoiceId],
        );
        if (!invoice[0]) throw new M1Error('invoice_not_found', 404, 'invoice does not exist');
        invoiceStatus = str(invoice[0].status) as PurchaseInvoiceStatus;
        invoiceTotal = num(invoice[0].total_amount);
        invoicePaid = num(invoice[0].paid_amount);
        supplierId = str(invoice[0].supplier_id);
      }
      const checks = checkPayment({
        paymentType: input.paymentType,
        amount: input.amount,
        invoiceStatus,
        invoiceTotal,
        invoicePaid,
      });
      for (const check of checks) {
        if (check.outcome === 'failure') {
          throw new M1Error(
            check.reasonKey.replace(/^procurement\./, ''),
            422,
            check.reasonKey,
          );
        }
      }
      const warning = chequeEarlyWarning(input.method, input.paidAt ?? null, input.chequeDueDate ?? null);
      await tx.unsafe(
        `insert into payments_vouchers (id, company_id, plant_id, voucher_no, supplier_id,
            customer_id, purchase_invoice_id, payment_type, amount, currency, method, cheque_no,
            cheque_due_date, paid_at, recorded_by, status, notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16,$15,$15)`,
        [
          id,
          context.tenant.companyId,
          input.plantId,
          voucherNo,
          supplierId,
          input.customerId,
          input.purchaseInvoiceId,
          input.paymentType,
          input.amount,
          input.currency ?? 'EGP',
          input.method,
          input.chequeNo ?? null,
          input.chequeDueDate ?? null,
          input.paidAt ?? null,
          context.actor.username,
          input.notes ?? '',
        ],
      );
      await audit(tx, context, 'procurement.voucher_recorded', id, {
        paymentType: input.paymentType,
        amount: input.amount,
        invoiceId: input.purchaseInvoiceId,
        chequeWarning: warning.outcome,
      });
      return this.readVoucher(tx, context, id);
    });
  };

  transitionVoucher = async (
    context: B1Context,
    id: string,
    to: PaymentVoucherStatus,
    reason = '',
  ): Promise<Row> => {
    this.level(
      context,
      to === 'cancelled' ? PROCUREMENT_LEVELS.control : to === 'approved' ? PROCUREMENT_LEVELS.approve : PROCUREMENT_LEVELS.record,
      `${to} a payment voucher`,
    );
    if (to === 'cancelled' && reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a cancellation reason is required');
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readVoucher(tx, context, id);
      if (!canPaymentVoucherTransition(str(current.status) as PaymentVoucherStatus, to)) {
        throw new M1Error('invalid_transition', 409, `voucher is ${str(current.status)}`);
      }
      if (to === 'paid' && str(current.payment_type) === 'supplier_payment') {
        const invoice = await tx.unsafe<Row>(
          `select id, total_amount::text as total_amount, paid_amount::text as paid_amount, status
             from purchase_invoices
            where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, str(current.purchase_invoice_id)],
        );
        if (!invoice[0] || str(invoice[0].status) !== 'approved') {
          throw new M1Error('payment_invoice_not_approved', 422, 'the invoice is not approved');
        }
        const total = num(invoice[0].total_amount);
        const paid = num(invoice[0].paid_amount);
        const amount = num(current.amount);
        if (amount > total - paid + 0.005) {
          throw new M1Error('payment_exceeds_outstanding', 422, 'amount exceeds the invoice outstanding');
        }
        const nextPaid = Math.round((paid + amount) * 100) / 100;
        await tx.unsafe(
          `update purchase_invoices set paid_amount = $3,
              status = case when $3 >= total_amount then 'paid' else status end,
              updated_by = $4 where company_id = $1 and id = $2`,
          [context.tenant.companyId, str(current.purchase_invoice_id), nextPaid, context.actor.username],
        );
      }
      await tx.unsafe(
        `update payments_vouchers set status = $3,
            paid_at = case when $3 = 'paid' then coalesce(paid_at, now()) else paid_at end,
            approved_by = case when $3 = 'approved' then $4 else approved_by end,
            approved_at = case when $3 = 'approved' then now() else approved_at end,
            cancelled_reason = case when $3 = 'cancelled' then $5 else cancelled_reason end,
            updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, to, context.actor.username, reason.trim()],
      );
      await audit(tx, context, `procurement.voucher_${to}`, id, { reason: reason.trim() });
      return this.readVoucher(tx, context, id);
    });
  };

  bounceCheque = async (context: B1Context, id: string, reason: string): Promise<Row> => {
    this.level(context, PROCUREMENT_LEVELS.approve, 'record a bounced cheque');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a bounce reason is required');
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const current = await this.readVoucher(tx, context, id);
      if (str(current.method) !== 'cheque') {
        throw new M1Error('not_a_cheque', 422, 'only a cheque voucher can bounce');
      }
      if (str(current.exception_status) === 'open') {
        throw new M1Error('exception_already_open', 409, 'a cheque exception is already open');
      }
      await tx.unsafe(
        `update payments_vouchers set exception_status = 'open', exception_reason = $3,
            updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason.trim(), context.actor.username],
      );
      await audit(tx, context, 'procurement.cheque_bounced', id, { reason: reason.trim() });
      return this.readVoucher(tx, context, id);
    });
  };

  // -------------------------------------------------------------------- AP aging
  apAging = async (context: B1Context, asOf = today()): Promise<Row[]> => {
    this.level(context, PROCUREMENT_LEVELS.read, 'read AP aging');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select i.supplier_id, coalesce(i.due_date, i.invoice_date)::text as due_date,
                i.invoice_date::text as invoice_date, i.total_amount::text as total,
                i.paid_amount::text as paid
           from purchase_invoices i
          where i.company_id = $1 and i.deleted_at is null
            and i.status in ('received','verified','approved','paid')
            and i.total_amount > i.paid_amount`,
        [context.tenant.companyId],
      );
      const invoices: AgingInvoice[] = rows.map((row) => ({
        supplierId: str(row.supplier_id),
        dueDate: nullable(row.due_date),
        invoiceDate: str(row.invoice_date),
        total: num(row.total),
        paid: num(row.paid),
      }));
      const buckets = apAging(invoices, asOf);
      const names = await tx.unsafe<Row>(
        `select id, name_ar, name_en, supplier_code from suppliers where company_id = $1`,
        [context.tenant.companyId],
      );
      const lookup = new Map(names.map((row) => [str(row.id), row]));
      return buckets.map((row) => ({
        ...row,
        supplier_name_ar: str(lookup.get(row.supplierId)?.name_ar),
        supplier_name_en: str(lookup.get(row.supplierId)?.name_en),
        supplier_code: str(lookup.get(row.supplierId)?.supplier_code),
      }));
    });
  };

  snapshotAging = async (context: B1Context, plantId: string, asOf = today()): Promise<Row[]> => {
    this.level(context, PROCUREMENT_LEVELS.record, 'snapshot AP aging');
    this.assertPlant(context, plantId);
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select i.supplier_id, coalesce(i.due_date, i.invoice_date)::text as due_date,
                i.invoice_date::text as invoice_date, i.total_amount::text as total,
                i.paid_amount::text as paid
           from purchase_invoices i
          where i.company_id = $1 and i.plant_id = $2 and i.deleted_at is null
            and i.status in ('received','verified','approved','paid')
            and i.total_amount > i.paid_amount`,
        [context.tenant.companyId, plantId],
      );
      const buckets = apAging(
        rows.map((row) => ({
          supplierId: str(row.supplier_id),
          dueDate: nullable(row.due_date),
          invoiceDate: str(row.invoice_date),
          total: num(row.total),
          paid: num(row.paid),
        })),
        asOf,
      );
      for (const bucket of buckets) {
        const existing = await tx.unsafe<Row>(
          `select id from ap_aging_snapshot where company_id = $1 and plant_id = $2
             and supplier_id = $3 and snapshot_date = $4 and deleted_at is null`,
          [context.tenant.companyId, plantId, bucket.supplierId, asOf],
        );
        if (existing[0]) {
          await tx.unsafe(
            `update ap_aging_snapshot set bucket_0_30 = $5, bucket_31_60 = $6,
                bucket_61_90 = $7, bucket_90_plus = $8, total_due = $9, updated_by = $10
              where company_id = $1 and id = $2`,
            [
              context.tenant.companyId,
              str(existing[0].id),
              bucket.bucket0To30,
              bucket.bucket31To60,
              bucket.bucket61To90,
              bucket.bucket90Plus,
              bucket.totalDue,
              context.actor.username,
            ],
          );
        } else {
          await tx.unsafe(
            `insert into ap_aging_snapshot (id, company_id, plant_id, supplier_id, snapshot_date,
                bucket_0_30, bucket_31_60, bucket_61_90, bucket_90_plus, total_due,
                created_by, updated_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
            [
              newId('APAG'),
              context.tenant.companyId,
              plantId,
              bucket.supplierId,
              asOf,
              bucket.bucket0To30,
              bucket.bucket31To60,
              bucket.bucket61To90,
              bucket.bucket90Plus,
              bucket.totalDue,
              context.actor.username,
            ],
          );
        }
      }
      await audit(tx, context, 'procurement.ap_aging_snapshotted', plantId, {
        asOf,
        suppliers: buckets.length,
      });
      return buckets as unknown as Row[];
    });
  };
}
