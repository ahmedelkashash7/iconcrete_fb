/** M7 sales repository. Tenant-scoped; every decision goes through src/core/sales. */
import {
  buildContractSnapshot,
  buildQuotationSnapshot,
  canContractTransition,
  canQuotationTransition,
  canSalesOrderTransition,
  canTicketTransition,
  checkApprovedVersion,
  checkBatchCoverage,
  checkBlacklist,
  checkContractLimit,
  checkDiscounts,
  checkPositiveLines,
  checkPriceResolution,
  checkQuotationValidity,
  checkSalesReference,
  checkTicketReferences,
  checkUniqueDocument,
  checkVolumeVariance,
  creditDecision,
  deliveredVolume,
  isFullyDelivered,
  lineTotal,
  missingSalesRule,
  SALES_LEVELS,
  SALES_RULE_CODES,
  sumLines,
  type ContractStatus,
  type CreditDecision,
  type DeliveryTicketStatus,
  type QuotationStatus,
  type SalesCatalogueKey,
  type SalesCheck,
  type SalesLine,
  type SalesOrderStatus,
} from '../../src/core/sales';
import {
  canActivityTransition,
  canCommitmentTransition,
  canComplaintTransition,
  canPriceListTransition,
  checkComplaintNcr,
  checkFeedbackRating,
  checkPriceDecision,
  checkPriceListOverlap,
  checkSeasonWindow,
  choosePrice,
  commitmentDecision,
  CRM_LEVELS,
  isInsideSeason,
  missingCommitmentRule,
  type CommitmentStatus,
  type ComplaintStatus,
  type CrmCheck,
  type PriceCandidate,
  type PriceListStatus,
} from '../../src/core/crm';
import { COMMITMENT_RULE_CODES } from '../../src/core/crm';
import { MIN_OVERRIDE_REASON, type RuleDefinition } from '../../src/core/rules';
import type { Db, Executor } from '../db/client';
import { M1Error } from './m1';
import type { B1Context } from './projects';

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);
const bool = (value: unknown): boolean => value === true || value === 't' || value === 'true';

const newId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

const documentNo = (prefix: string): string => {
  const year = new Date().getUTCFullYear();
  const tail = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${prefix}-${year}-${tail}`;
};

const today = (): string => new Date().toISOString().slice(0, 10);

export interface CustomerRow {
  id: string;
  plant_id: string | null;
  customer_code: string | null;
  name_ar: string;
  name_en: string;
  contact_person: string;
  phone: string;
  email: string;
  billing_address: string;
  shipping_address: string;
  credit_limit: number | null;
  effective_limit: number;
  currency: string;
  credit_days: number;
  status: string;
  blacklisted: boolean;
  blacklist_reason: string | null;
  exposure: number;
  credit_ratio: number | null;
}

export interface ProjectRow {
  id: string;
  plant_id: string | null;
  customer_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  site_location: string;
  contact_person: string;
  contact_phone: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

export interface QuotationItemRow extends SalesLine {
  id: string;
  material_id: string | null;
  material_code: string;
  material_name: string;
  description: string;
  line_total: number;
}

export interface QuotationVersionRow {
  id: string;
  version_no: number;
  status: string;
  reason: string;
  created_at: string;
  created_by: string;
  snapshot: unknown;
}

export interface QuotationRow {
  id: string;
  plant_id: string;
  quotation_no: string;
  customer_id: string;
  customer_name: string;
  project_id: string | null;
  project_code: string | null;
  total_amount: number;
  currency: string;
  valid_until: string;
  status: QuotationStatus;
  quoted_by: string;
  current_version_id: string | null;
  items: QuotationItemRow[];
  versions: QuotationVersionRow[];
}

export interface ContractVersionRow {
  id: string;
  version_no: number;
  status: string;
  reason: string;
  created_at: string;
  created_by: string;
  snapshot: unknown;
}

export interface ContractRow {
  id: string;
  plant_id: string;
  contract_no: string;
  customer_id: string;
  customer_name: string;
  project_id: string | null;
  quotation_version_id: string;
  start_date: string | null;
  end_date: string | null;
  terms: string;
  status: ContractStatus;
  signed_at: string | null;
  signed_by: string | null;
  void_reason: string | null;
  versions: ContractVersionRow[];
}

export interface SalesOrderItemRow {
  id: string;
  material_id: string | null;
  material_code: string;
  material_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate: number;
  line_total: number;
  delivered_qty: number;
  invoiced_qty: number;
}

export interface SalesOrderRow {
  id: string;
  plant_id: string;
  order_no: string;
  customer_id: string;
  customer_name: string;
  project_id: string | null;
  project_code: string | null;
  quotation_id: string | null;
  contract_id: string | null;
  status: SalesOrderStatus;
  order_date: string | null;
  delivery_date: string | null;
  total_amount: number;
  credit_status: string | null;
  hold_reason: string | null;
  held_from_status: string | null;
  cancel_reason: string | null;
  items: SalesOrderItemRow[];
  delivered_qty: number;
  ordered_qty: number;
  delivery_state: 'none' | 'partial' | 'full';
  tickets: DeliveryTicketRow[];
}

export interface DeliveryTicketBatchRow {
  id: string;
  batch_id: string | null;
  batch_no: string;
  volume_m3: number;
  price_per_m3: number;
}

export interface DeliveryTicketRow {
  id: string;
  plant_id: string;
  ticket_no: string;
  order_id: string;
  order_no: string;
  trip_id: string;
  truck_id: string;
  truck_plate: string;
  driver_id: string | null;
  ticket_date: string;
  ticket_time: string | null;
  loaded_vol: number;
  delivered_vol: number;
  status: DeliveryTicketStatus;
  void_reason: string | null;
  batches: DeliveryTicketBatchRow[];
}

export interface SalesOrderItemInput {
  materialId?: string | null;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRate?: number;
}

export interface DeliveryTicketBatchInput {
  batchId?: string | null;
  volumeM3: number;
  pricePerM3?: number;
}

const creditBand = (decision: CreditDecision): string =>
  decision.band === 'approval_required' ? 'approval_required' : decision.band;

export class SalesService {
  constructor(private readonly db: Db) {}

  private level = (context: B1Context, min: number, what: string): void => {
    if (context.actor.roleLevel < min) {
      throw new M1Error('forbidden', 403, `only a level-${min} user may ${what}`);
    }
  };

  /** The plant scope is re-checked in the application, not delegated to RLS alone. */
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
         from rule_definitions where company_id = $1 and module = 'sales'`,
      [companyId],
    );
    const rules = new Map<string, RuleDefinition>();
    for (const row of rows) {
      rules.set(str(row.code), {
        code: str(row.code),
        module: 'sales',
        classification: str(row.classification) as RuleDefinition['classification'],
        value: numOrNull(row.value),
        unit: str(row.unit),
        sourceNote: str(row.source_note),
        status: str(row.status) === 'retired' ? 'retired' : 'active',
      });
    }
    return rules;
  };

  private ruleFor = (
    rules: Map<string, RuleDefinition>,
    key: SalesCatalogueKey,
  ): RuleDefinition | null => rules.get(SALES_RULE_CODES[key]) ?? missingSalesRule(key);

  /**
   * A mandatory failure is always refused. An approval gate passes only with a level-4 actor and
   * a reasoned approval; the reason is recorded by the caller's audit event. A warning is noted
   * and never blocks.
   */
  private enforce = (
    check: SalesCheck,
    context: B1Context,
    reason: string,
  ): 'pass' | 'warning' | 'overridden' => {
    if (check.outcome === 'failure') {
      throw new M1Error(check.reasonKey.replace(/^sales\./, ''), 422, check.reasonKey, {
        check: check.key,
      });
    }
    if (
      check.outcome === 'approval_required' ||
      check.outcome === 'engineering_hold' ||
      check.outcome === 'override_required'
    ) {
      if (context.actor.roleLevel >= SALES_LEVELS.approve && reason.trim().length >= MIN_OVERRIDE_REASON) {
        return 'overridden';
      }
      throw new M1Error('approval_required', 403, check.reasonKey, { check: check.key });
    }
    return check.outcome === 'warning' ? 'warning' : 'pass';
  };

  private enforceCrm = (
    check: CrmCheck,
    context: B1Context,
    reason: string,
  ): 'pass' | 'warning' | 'overridden' => {
    if (check.outcome === 'failure') {
      throw new M1Error(check.reasonKey.replace(/^sales\./, ''), 422, check.reasonKey, {
        check: check.key,
      });
    }
    if (check.outcome !== 'pass' && check.outcome !== 'warning') {
      if (context.actor.roleLevel >= CRM_LEVELS.approve && reason.trim().length >= MIN_OVERRIDE_REASON) {
        return 'overridden';
      }
      throw new M1Error('approval_required', 403, check.reasonKey, { check: check.key });
    }
    return check.outcome === 'warning' ? 'warning' : 'pass';
  };

  /** Every price source that applies to one order line on the order date. */
  private priceCandidates = async (
    tx: Executor,
    context: B1Context,
    payload: {
      plantId: string;
      customerId: string;
      contractId: string | null;
      orderDate: string;
      materialId: string | null;
      description: string;
      quantity: number;
    },
  ): Promise<PriceCandidate[]> => {
    const candidates: PriceCandidate[] = [];
    const description = payload.description.trim().toLowerCase();
    const materialMatches = (line: { materialId?: string; description?: string }): boolean => {
      const lineMaterial = (line.materialId ?? '').trim();
      if (payload.materialId && lineMaterial) return lineMaterial === payload.materialId;
      const lineDescription = (line.description ?? '').trim().toLowerCase();
      return description.length > 0 && lineDescription === description;
    };

    const contractRows = await tx.unsafe<Row>(
      `select c.id, c.contract_no, qv.snapshot_json
         from contracts c
         join quotation_versions qv
           on qv.company_id = c.company_id and qv.id = c.quotation_version_id
        where c.company_id = $1 and c.customer_id = $2 and c.deleted_at is null
          and c.status in ('signed', 'active')
          and (c.start_date is null or c.start_date <= $3::date)
          and (c.end_date is null or c.end_date >= $3::date)
          and ($4::text = '' or c.id = $4)
        order by c.signed_at nulls last, c.created_at`,
      [context.tenant.companyId, payload.customerId, payload.orderDate, payload.contractId ?? ''],
    );
    for (const row of contractRows) {
      const snapshot = row.snapshot_json as
        | { lines?: Array<{ materialId?: string; description?: string; unitPrice?: number }> }
        | undefined;
      for (const line of snapshot?.lines ?? []) {
        if (!materialMatches(line)) continue;
        candidates.push({
          sourceType: 'contract',
          sourceId: str(row.id),
          price: num(line.unitPrice),
          label: str(row.contract_no),
        });
      }
    }

    if (payload.materialId) {
      const commitmentRows = await tx.unsafe<Row>(
        `select id, commitment_no, special_price::text as special_price
           from volume_commitments
          where company_id = $1 and plant_id = $2 and customer_id = $3 and material_id = $4
            and status = 'active' and deleted_at is null
            and period_start <= $5::date and period_end >= $5::date
            and ($6::text = '' or contract_id is null or contract_id = $6)`,
        [
          context.tenant.companyId,
          payload.plantId,
          payload.customerId,
          payload.materialId,
          payload.orderDate,
          payload.contractId ?? '',
        ],
      );
      for (const row of commitmentRows) {
        candidates.push({
          sourceType: 'volume_commitment',
          sourceId: str(row.id),
          price: num(row.special_price),
          label: str(row.commitment_no),
        });
      }

      const seasonalRows = await tx.unsafe<Row>(
        `select id, unit_price::text as unit_price, season_start::text as season_start,
                season_end::text as season_end
           from seasonal_prices
          where company_id = $1 and plant_id = $2 and material_id = $3
            and status = 'active' and deleted_at is null
            and (customer_id is null or customer_id = $4)`,
        [context.tenant.companyId, payload.plantId, payload.materialId, payload.customerId],
      );
      for (const row of seasonalRows) {
        if (!isInsideSeason(str(row.season_start), str(row.season_end), payload.orderDate)) continue;
        candidates.push({
          sourceType: 'seasonal',
          sourceId: str(row.id),
          price: num(row.unit_price),
        });
      }

      const listRows = await tx.unsafe<Row>(
        `select pl.id, pl.list_code, pli.unit_price::text as unit_price,
                pli.discount_pct::text as discount_pct
           from price_lists pl
           join price_list_items pli
             on pli.company_id = pl.company_id and pli.price_list_id = pl.id
            and pli.deleted_at is null
          where pl.company_id = $1 and pl.plant_id = $2 and pl.status = 'active'
            and pl.deleted_at is null
            and pl.valid_from <= $3::date and (pl.valid_until is null or pl.valid_until >= $3::date)
            and pli.material_id = $4 and pli.min_quantity <= $5::numeric
            and (pli.valid_from is null or pli.valid_from <= $3::date)
            and (pli.valid_until is null or pli.valid_until >= $3::date)`,
        [
          context.tenant.companyId,
          payload.plantId,
          payload.orderDate,
          payload.materialId,
          payload.quantity,
        ],
      );
      for (const row of listRows) {
        const discount = num(row.discount_pct);
        const net = num(row.unit_price) * (1 - discount / 100);
        candidates.push({
          sourceType: 'price_list',
          sourceId: str(row.id),
          price: Math.round(net * 100) / 100,
          label: str(row.list_code),
        });
      }
    }

    return candidates;
  };

  // ------------------------------------------------------------------ customers

  private customerSelect = `
    select c.id, c.plant_id, c.customer_code, c.name_ar, c.name_en, c.contact_person, c.phone,
           c.email, c.billing_address, c.shipping_address, c.credit_limit::text as credit_limit,
           coalesce(c.currency, 'EGP') as currency, c.credit_days, c.status, c.blacklisted,
           c.blacklist_reason,
           coalesce(
             c.credit_limit,
             (select cl.credit_limit from customer_credit_limits cl
               where cl.company_id = c.company_id and cl.customer_id = c.id
               order by cl.effective_from desc, cl.version desc limit 1),
             0)::text as effective_limit,
           (coalesce((select sum(i.grand_total) from invoices i
                        where i.company_id = c.company_id and i.customer_id = c.id
                          and i.deleted_at is null
                          and i.status in ('issued', 'partially_paid', 'overdue')), 0)
            + coalesce((select sum(coalesce(o.total_amount, o.quantity_m3 * o.unit_price))
                          from orders o
                         where o.company_id = c.company_id and o.customer_id = c.id
                           and o.deleted_at is null
                           and o.status not in ('closed', 'cancelled')), 0))::text as exposure
      from customers c
     where c.company_id = $1 and c.deleted_at is null`;

  private toCustomer = (row: Row): CustomerRow => {
    const limit = num(row.effective_limit);
    const exposure = num(row.exposure);
    return {
      id: str(row.id),
      plant_id: nullable(row.plant_id),
      customer_code: nullable(row.customer_code),
      name_ar: str(row.name_ar),
      name_en: str(row.name_en),
      contact_person: str(row.contact_person),
      phone: str(row.phone),
      email: str(row.email),
      billing_address: str(row.billing_address),
      shipping_address: str(row.shipping_address),
      credit_limit: numOrNull(row.credit_limit),
      effective_limit: limit,
      currency: str(row.currency) || 'EGP',
      credit_days: num(row.credit_days),
      status: str(row.status),
      blacklisted: bool(row.blacklisted),
      blacklist_reason: nullable(row.blacklist_reason),
      exposure,
      credit_ratio: limit > 0 ? (exposure / limit) * 100 : null,
    };
  };

  listCustomers = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; blacklisted?: boolean; q?: string; minLimit?: number } = {},
  ): Promise<CustomerRow[]> => {
    this.level(context, SALES_LEVELS.read, 'read customers');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `${this.customerSelect}
           and ($2::text = '' or c.plant_id = $2)
           and ($3::text = '' or c.status = $3)
           and ($4::boolean is null or c.blacklisted = $4)
           and ($5::numeric is null or coalesce(c.credit_limit, 0) >= $5)
           and ($6::text = '' or c.name_ar ilike '%' || $6 || '%'
                or c.name_en ilike '%' || $6 || '%' or c.customer_code ilike '%' || $6 || '%')
         order by c.name_ar`,
        [
          context.tenant.companyId,
          filters.plantId ?? '',
          filters.status ?? '',
          filters.blacklisted === undefined ? null : filters.blacklisted,
          filters.minLimit ?? null,
          filters.q ?? '',
        ],
      ),
    );
    return rows.map(this.toCustomer);
  };

  getCustomer = async (context: B1Context, id: string): Promise<CustomerRow> => {
    this.level(context, SALES_LEVELS.read, 'read a customer');
    return this.db.withTenant(context.tenant, (tx) => this.readCustomer(tx, context, id));
  };

  private readCustomer = async (tx: Executor, context: B1Context, id: string): Promise<CustomerRow> => {
    const rows = await tx.unsafe<Row>(`${this.customerSelect} and c.id = $2`, [
      context.tenant.companyId,
      id,
    ]);
    if (!rows[0]) throw new M1Error('customer_not_found', 404, `customer ${id} does not exist`);
    return this.toCustomer(rows[0]);
  };

  createCustomer = async (
    context: B1Context,
    payload: {
      plantId: string;
      customerCode?: string;
      nameAr: string;
      nameEn?: string;
      contactPerson?: string;
      phone?: string;
      email?: string;
      billingAddress?: string;
      shippingAddress?: string;
      creditLimit?: number | null;
      currency?: string;
      creditDays?: number;
      blacklisted?: boolean;
      blacklistReason?: string;
    },
  ): Promise<CustomerRow> => {
    this.level(context, SALES_LEVELS.approve, 'create a customer');
    if (!payload.nameAr.trim()) {
      throw new M1Error('validation_error', 422, 'nameAr is required', { field: 'nameAr' });
    }
    const id = newId('CUS');
    return this.db.withTenant(context.tenant, async (tx) => {
      if (payload.plantId) this.assertPlant(context, payload.plantId);
      const code = (payload.customerCode ?? '').trim() || documentNo('CUS');
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from customers where company_id = $1 and lower(customer_code) = lower($2)
               and deleted_at is null`,
            [context.tenant.companyId, code],
          )
        ).length > 0;
      const unique = checkUniqueDocument(duplicate, 'customer');
      if (unique.outcome === 'failure') {
        throw new M1Error('duplicate_customer', 422, 'customer code must be unique', { check: unique.key });
      }
      await tx.unsafe(
        `insert into customers (id, company_id, plant_id, customer_code, name_ar, name_en,
            contact_person, phone, email, billing_address, shipping_address, credit_limit, currency,
            credit_days, status, blacklisted, blacklisted_at, blacklist_reason, data_source,
            created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,
                 case when $15 then now() else null end,$16,'manual',$17,$17)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId || null,
          code,
          payload.nameAr.trim(),
          payload.nameEn ?? '',
          payload.contactPerson ?? '',
          payload.phone ?? '',
          payload.email ?? '',
          payload.billingAddress ?? '',
          payload.shippingAddress ?? '',
          payload.creditLimit ?? null,
          (payload.currency ?? 'EGP').slice(0, 3).toUpperCase(),
          payload.creditDays ?? 0,
          payload.blacklisted === true,
          payload.blacklistReason ?? null,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.customer_created', id, {
        customerCode: code,
        creditLimit: payload.creditLimit ?? null,
        blacklisted: payload.blacklisted === true,
      });
      return this.readCustomer(tx, context, id);
    });
  };

  updateCustomer = async (
    context: B1Context,
    id: string,
    payload: {
      nameAr?: string;
      nameEn?: string;
      contactPerson?: string;
      phone?: string;
      email?: string;
      billingAddress?: string;
      shippingAddress?: string;
      creditLimit?: number | null;
      currency?: string;
      status?: string;
      blacklisted?: boolean;
      blacklistReason?: string;
    },
  ): Promise<CustomerRow> => {
    this.level(context, SALES_LEVELS.approve, 'change a customer');
    return this.db.withTenant(context.tenant, async (tx) => {
      await this.readCustomer(tx, context, id);
      await tx.unsafe(
        `update customers set
            name_ar = coalesce($3, name_ar), name_en = coalesce($4, name_en),
            contact_person = coalesce($5, contact_person), phone = coalesce($6, phone),
            email = coalesce($7, email), billing_address = coalesce($8, billing_address),
            shipping_address = coalesce($9, shipping_address),
            credit_limit = case when $16::boolean then $10::numeric else credit_limit end,
            currency = coalesce($11, currency), status = coalesce($12, status),
            blacklisted = coalesce($13, blacklisted),
            blacklisted_at = case when $13 is true then coalesce(blacklisted_at, now())
                                  when $13 is false then null else blacklisted_at end,
            blacklist_reason = case when $13 is true then coalesce($14, blacklist_reason)
                                    when $13 is false then null else blacklist_reason end,
            updated_by = $15
          where company_id = $1 and id = $2`,
        [
          context.tenant.companyId,
          id,
          payload.nameAr ?? null,
          payload.nameEn ?? null,
          payload.contactPerson ?? null,
          payload.phone ?? null,
          payload.email ?? null,
          payload.billingAddress ?? null,
          payload.shippingAddress ?? null,
          payload.creditLimit === undefined ? null : payload.creditLimit,
          payload.currency ?? null,
          payload.status ?? null,
          payload.blacklisted === undefined ? null : payload.blacklisted,
          payload.blacklistReason ?? null,
          context.actor.username,
          payload.creditLimit !== undefined,
        ],
      );
      await audit(tx, context, 'sales.customer_updated', id, {
        blacklisted: payload.blacklisted ?? null,
      });
      return this.readCustomer(tx, context, id);
    });
  };

  // ------------------------------------------------------------------- projects

  listProjects = async (
    context: B1Context,
    filters: { customerId?: string; plantId?: string; status?: string } = {},
  ): Promise<ProjectRow[]> => {
    this.level(context, SALES_LEVELS.read, 'read projects');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select id, plant_id, customer_id, code, name_ar, name_en, site_location,
                contact_person, contact_phone, status, start_date::text as start_date,
                end_date::text as end_date
           from projects
          where company_id = $1 and deleted_at is null
            and ($2::text = '' or customer_id = $2)
            and ($3::text = '' or plant_id = $3)
            and ($4::text = '' or status = $4)
          order by code`,
        [context.tenant.companyId, filters.customerId ?? '', filters.plantId ?? '', filters.status ?? ''],
      ),
    );
    return rows.map((row) => ({
      id: str(row.id),
      plant_id: nullable(row.plant_id),
      customer_id: str(row.customer_id),
      code: str(row.code),
      name_ar: str(row.name_ar),
      name_en: str(row.name_en),
      site_location: str(row.site_location),
      contact_person: str(row.contact_person),
      contact_phone: str(row.contact_phone),
      status: str(row.status),
      start_date: nullable(row.start_date),
      end_date: nullable(row.end_date),
    }));
  };

  createProject = async (
    context: B1Context,
    payload: {
      plantId: string;
      customerId: string;
      code: string;
      nameAr: string;
      nameEn?: string;
      siteLocation?: string;
      contactPerson?: string;
      contactPhone?: string;
      startDate?: string | null;
      endDate?: string | null;
    },
  ): Promise<ProjectRow> => {
    this.level(context, SALES_LEVELS.create, 'create a project');
    if (!payload.customerId.trim()) {
      throw new M1Error('validation_error', 422, 'customer is required', { field: 'customerId' });
    }
    if (!payload.code.trim() || !payload.nameAr.trim()) {
      throw new M1Error('validation_error', 422, 'project code and name are required', {
        field: 'code',
      });
    }
    const id = newId('PRJ');
    return this.db.withTenant(context.tenant, async (tx) => {
      this.assertPlant(context, payload.plantId);
      await this.readCustomer(tx, context, payload.customerId);
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from projects where company_id = $1 and lower(code) = lower($2)
               and deleted_at is null`,
            [context.tenant.companyId, payload.code.trim()],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_project', 422, 'project code must be unique', {
          field: 'code',
        });
      }
      await tx.unsafe(
        `insert into projects (id, company_id, plant_id, customer_id, code, name_ar, name_en,
            site_location, contact_person, contact_phone, status, start_date, end_date,
            created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13,$13)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.customerId,
          payload.code.trim(),
          payload.nameAr.trim(),
          payload.nameEn ?? '',
          payload.siteLocation ?? '',
          payload.contactPerson ?? '',
          payload.contactPhone ?? '',
          payload.startDate ?? null,
          payload.endDate ?? null,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.project_created', id, { code: payload.code.trim() });
      const rows = await tx.unsafe<Row>(
        `select id, plant_id, customer_id, code, name_ar, name_en, site_location,
                contact_person, contact_phone, status, start_date::text as start_date,
                end_date::text as end_date
           from projects where company_id = $1 and id = $2`,
        [context.tenant.companyId, id],
      );
      const row = rows[0]!;
      return {
        id: str(row.id),
        plant_id: nullable(row.plant_id),
        customer_id: str(row.customer_id),
        code: str(row.code),
        name_ar: str(row.name_ar),
        name_en: str(row.name_en),
        site_location: str(row.site_location),
        contact_person: str(row.contact_person),
        contact_phone: str(row.contact_phone),
        status: str(row.status),
        start_date: nullable(row.start_date),
        end_date: nullable(row.end_date),
      };
    });
  };

  // ----------------------------------------------------------------- quotations

  private toQuotationItem = (row: Row): QuotationItemRow => ({
    id: str(row.id),
    material_id: nullable(row.material_id),
    material_code: str(row.material_code),
    material_name: str(row.material_name),
    description: str(row.description),
    quantity: num(row.quantity),
    unitPrice: num(row.unit_price),
    discountPct: num(row.discount_pct),
    taxRate: num(row.tax_rate),
    line_total: num(row.line_total),
  });

  private readQuotation = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<QuotationRow> => {
    const rows = await tx.unsafe<Row>(
      `select q.id, q.plant_id, q.quotation_no, q.customer_id, q.project_id,
              q.total_amount::text as total_amount, q.currency,
              q.valid_until::text as valid_until, q.status, q.quoted_by, q.current_version_id,
              c.name_ar as customer_name_ar, c.name_en as customer_name_en,
              p.code as project_code
         from quotations q
         join customers c on c.id = q.customer_id and c.company_id = q.company_id
         left join projects p on p.id = q.project_id and p.company_id = q.company_id
        where q.company_id = $1 and q.id = $2 and q.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    const row = rows[0];
    if (!row) throw new M1Error('quotation_not_found', 404, `quotation ${id} does not exist`);
    const items = await tx.unsafe<Row>(
      `select i.id, i.material_id, i.description, i.quantity::text as quantity,
              i.unit_price::text as unit_price, i.discount_pct::text as discount_pct,
              i.tax_rate::text as tax_rate, i.line_total::text as line_total,
              coalesce(m.material_code, '') as material_code,
              coalesce(m.name_ar, '') as material_name
         from quotation_items i
         left join materials m on m.id = i.material_id and m.company_id = i.company_id
        where i.company_id = $1 and i.quotation_id = $2 and i.deleted_at is null
        order by i.line_no`,
      [context.tenant.companyId, id],
    );
    const versions = await tx.unsafe<Row>(
      `select id, version_no::text as version_no, coalesce(snapshot_json->>'status', 'approved') as status,
              reason, created_at::text as created_at, coalesce(created_by, '') as created_by,
              snapshot_json
         from quotation_versions
        where company_id = $1 and quotation_id = $2
        order by version_no desc`,
      [context.tenant.companyId, id],
    );
    return {
      id: str(row.id),
      plant_id: str(row.plant_id),
      quotation_no: str(row.quotation_no),
      customer_id: str(row.customer_id),
      customer_name: str(row.customer_name_ar) || str(row.customer_name_en),
      project_id: nullable(row.project_id),
      project_code: nullable(row.project_code),
      total_amount: num(row.total_amount),
      currency: str(row.currency) || 'EGP',
      valid_until: str(row.valid_until),
      status: str(row.status) as QuotationStatus,
      quoted_by: str(row.quoted_by),
      current_version_id: nullable(row.current_version_id),
      items: items.map(this.toQuotationItem),
      versions: versions.map((version) => ({
        id: str(version.id),
        version_no: num(version.version_no),
        status: str(version.status),
        reason: str(version.reason),
        created_at: str(version.created_at),
        created_by: str(version.created_by),
        snapshot: version.snapshot_json,
      })),
    };
  };

  listQuotations = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; customerId?: string; q?: string } = {},
  ): Promise<QuotationRow[]> => {
    this.level(context, SALES_LEVELS.read, 'read quotations');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select q.id from quotations q
          where q.company_id = $1 and q.deleted_at is null
            and ($2::text = '' or q.plant_id = $2)
            and ($3::text = '' or q.status = $3)
            and ($4::text = '' or q.customer_id = $4)
            and ($5::text = '' or q.quotation_no ilike '%' || $5 || '%')
          order by q.created_at desc`,
        [
          context.tenant.companyId,
          filters.plantId ?? '',
          filters.status ?? '',
          filters.customerId ?? '',
          filters.q ?? '',
        ],
      );
      const quotations: QuotationRow[] = [];
      for (const row of rows) quotations.push(await this.readQuotation(tx, context, str(row.id)));
      return quotations;
    });
  };

  getQuotation = async (context: B1Context, id: string): Promise<QuotationRow> => {
    this.level(context, SALES_LEVELS.read, 'read a quotation');
    return this.db.withTenant(context.tenant, (tx) => this.readQuotation(tx, context, id));
  };

  createQuotation = async (
    context: B1Context,
    payload: {
      plantId: string;
      quotationNo?: string;
      customerId: string;
      projectId?: string | null;
      validUntil: string;
      currency?: string;
      items: SalesOrderItemInput[];
      reason?: string;
    },
  ): Promise<QuotationRow> => {
    this.level(context, SALES_LEVELS.create, 'create a quotation');
    const validity = checkQuotationValidity(payload.validUntil, today());
    if (validity.outcome === 'failure') {
      throw new M1Error('quotation_expired', 422, 'valid_until must not be in the past', {
        check: validity.key,
      });
    }
    const positive = checkPositiveLines(payload.items);
    if (positive.outcome !== 'pass') {
      throw new M1Error('positive_value', 422, 'quantity and price must be positive', {
        check: positive.key,
      });
    }
    const id = newId('QTN');
    return this.db.withTenant(context.tenant, async (tx) => {
      this.assertPlant(context, payload.plantId);
      const customer = await this.readCustomer(tx, context, payload.customerId);
      const rules = await this.rules(tx, context.tenant.companyId);
      const discount = checkDiscounts(
        this.ruleFor(rules, 'discountApproval'),
        this.ruleFor(rules, 'discountMax'),
        payload.items.map((item) => ({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountPct: item.discountPct ?? 0,
          taxRate: item.taxRate ?? 0,
        })),
      );
      const decision = this.enforce(discount, context, payload.reason ?? '');
      const number = (payload.quotationNo ?? '').trim() || documentNo('QTN');
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from quotations where company_id = $1 and lower(quotation_no) = lower($2)
               and deleted_at is null`,
            [context.tenant.companyId, number],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_quotation', 422, 'quotation number must be unique', {
          check: 'uniqueDocument',
        });
      }
      const lines = payload.items.map((item, index) => ({
        ...item,
        discountPct: item.discountPct ?? 0,
        taxRate: item.taxRate ?? 0,
        lineNo: index + 1,
      }));
      const total = sumLines(lines);
      await tx.unsafe(
        `insert into quotations (id, company_id, plant_id, quotation_no, customer_id, project_id,
            total_amount, currency, valid_until, status, quoted_by, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$10,$10)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          number,
          payload.customerId,
          payload.projectId ?? null,
          total,
          (payload.currency ?? customer.currency ?? 'EGP').slice(0, 3).toUpperCase(),
          payload.validUntil,
          context.actor.username,
        ],
      );
      for (const line of lines) {
        await tx.unsafe(
          `insert into quotation_items (id, company_id, plant_id, quotation_id, line_no,
              material_id, description, quantity, unit_price, discount_pct, tax_rate, line_total,
              created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
          [
            newId('QTI'),
            context.tenant.companyId,
            payload.plantId,
            id,
            line.lineNo,
            line.materialId ?? null,
            line.description ?? '',
            line.quantity,
            line.unitPrice,
            line.discountPct,
            line.taxRate,
            lineTotal(line),
            context.actor.username,
          ],
        );
      }
      await audit(tx, context, 'sales.quote_created', id, {
        quotationNo: number,
        total,
        discountApproved: decision === 'overridden',
      });
      return this.readQuotation(tx, context, id);
    });
  };

  submitQuotation = async (context: B1Context, id: string): Promise<QuotationRow> =>
    this.quotationTransition(context, id, 'submitted', SALES_LEVELS.create, 'submit a quotation');

  approveQuotation = async (
    context: B1Context,
    id: string,
    reason = '',
  ): Promise<QuotationRow> => {
    this.level(context, SALES_LEVELS.approve, 'approve a quotation');
    return this.db.withTenant(context.tenant, async (tx) => {
      const quotation = await this.readQuotation(tx, context, id);
      if (!canQuotationTransition(quotation.status, 'approved')) {
        throw new M1Error('invalid_transition', 409, `quotation ${id} is ${quotation.status}`, {
          from: quotation.status,
          to: 'approved',
        });
      }
      const snapshot = buildQuotationSnapshot({
        quotationId: quotation.id,
        customerId: quotation.customer_id,
        validUntil: quotation.valid_until,
        status: 'approved',
        lines: quotation.items.map((item) => ({
          materialId: item.material_id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountPct: item.discountPct,
          taxRate: item.taxRate,
        })),
        capturedAt: new Date().toISOString(),
      });
      const next = await tx.unsafe<Row>(
        `select coalesce(max(version_no), 0)::text as version_no from quotation_versions
          where company_id = $1 and quotation_id = $2`,
        [context.tenant.companyId, id],
      );
      const versionNo = num(next[0]?.version_no) + 1;
      const versionId = newId('QTV');
      await tx.unsafe(
        `insert into quotation_versions (id, company_id, plant_id, quotation_id, version_no,
            snapshot_json, reason, created_by)
         values ($1,$2,$3,$4,$5,$6::text::jsonb,$7,$8)`,
        [
          versionId,
          context.tenant.companyId,
          quotation.plant_id,
          id,
          versionNo,
          JSON.stringify(snapshot),
          reason,
          context.actor.username,
        ],
      );
      await tx.unsafe(
        `update quotations set status = 'approved', current_version_id = $3,
            total_amount = $4, updated_by = $5
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, versionId, snapshot.total, context.actor.username],
      );
      await audit(tx, context, 'sales.quote_approved', id, { versionNo, total: snapshot.total });
      return this.readQuotation(tx, context, id);
    });
  };

  reviseQuotation = async (context: B1Context, id: string, reason = ''): Promise<QuotationRow> => {
    this.level(context, SALES_LEVELS.create, 'revise a quotation');
    return this.db.withTenant(context.tenant, async (tx) => {
      const quotation = await this.readQuotation(tx, context, id);
      if (!['approved', 'superseded'].includes(quotation.status)) {
        throw new M1Error('invalid_transition', 409, `quotation ${id} is ${quotation.status}`, {
          from: quotation.status,
          to: 'draft',
        });
      }
      await tx.unsafe(
        `update quotations set status = 'draft', current_version_id = null, updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'sales.quote_revision_started', id, { reason });
      return this.readQuotation(tx, context, id);
    });
  };

  cancelQuotation = async (context: B1Context, id: string, reason: string): Promise<QuotationRow> => {
    this.level(context, SALES_LEVELS.void, 'cancel a quotation');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a cancellation reason is required', {
        field: 'reason',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const quotation = await this.readQuotation(tx, context, id);
      if (!canQuotationTransition(quotation.status, 'cancelled')) {
        throw new M1Error('invalid_transition', 409, `quotation ${id} is ${quotation.status}`, {
          from: quotation.status,
          to: 'cancelled',
        });
      }
      await tx.unsafe(
        `update quotations set status = 'cancelled', updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'sales.quote_cancelled', id, { reason });
      return this.readQuotation(tx, context, id);
    });
  };

  private quotationTransition = async (
    context: B1Context,
    id: string,
    to: QuotationStatus,
    minLevel: number,
    what: string,
  ): Promise<QuotationRow> => {
    this.level(context, minLevel, what);
    return this.db.withTenant(context.tenant, async (tx) => {
      const quotation = await this.readQuotation(tx, context, id);
      if (!canQuotationTransition(quotation.status, to)) {
        throw new M1Error('invalid_transition', 409, `quotation ${id} is ${quotation.status}`, {
          from: quotation.status,
          to,
        });
      }
      await tx.unsafe(
        `update quotations set status = $3, updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, to, context.actor.username],
      );
      await audit(tx, context, `sales.quote_${to}`, id, {});
      return this.readQuotation(tx, context, id);
    });
  };

  // ------------------------------------------------------------------ contracts

  private readContract = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<ContractRow> => {
    const rows = await tx.unsafe<Row>(
      `select ct.id, ct.plant_id, ct.contract_no, ct.customer_id, ct.project_id,
              ct.quotation_version_id, ct.start_date::text as start_date,
              ct.end_date::text as end_date, ct.terms, ct.status,
              ct.signed_at::text as signed_at, ct.signed_by, ct.void_reason,
              c.name_ar as customer_name_ar, c.name_en as customer_name_en
         from contracts ct
         join customers c on c.id = ct.customer_id and c.company_id = ct.company_id
        where ct.company_id = $1 and ct.id = $2 and ct.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    const row = rows[0];
    if (!row) throw new M1Error('contract_not_found', 404, `contract ${id} does not exist`);
    const versions = await tx.unsafe<Row>(
      `select id, version_no::text as version_no, coalesce(snapshot_json->>'status', 'signed') as status,
              reason, created_at::text as created_at, coalesce(created_by, '') as created_by,
              snapshot_json
         from contract_versions where company_id = $1 and contract_id = $2
        order by version_no desc`,
      [context.tenant.companyId, id],
    );
    return {
      id: str(row.id),
      plant_id: str(row.plant_id),
      contract_no: str(row.contract_no),
      customer_id: str(row.customer_id),
      customer_name: str(row.customer_name_ar) || str(row.customer_name_en),
      project_id: nullable(row.project_id),
      quotation_version_id: str(row.quotation_version_id),
      start_date: nullable(row.start_date),
      end_date: nullable(row.end_date),
      terms: str(row.terms),
      status: str(row.status) as ContractStatus,
      signed_at: nullable(row.signed_at),
      signed_by: nullable(row.signed_by),
      void_reason: nullable(row.void_reason),
      versions: versions.map((version) => ({
        id: str(version.id),
        version_no: num(version.version_no),
        status: str(version.status),
        reason: str(version.reason),
        created_at: str(version.created_at),
        created_by: str(version.created_by),
        snapshot: version.snapshot_json,
      })),
    };
  };

  listContracts = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; customerId?: string } = {},
  ): Promise<ContractRow[]> => {
    this.level(context, SALES_LEVELS.read, 'read contracts');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id from contracts where company_id = $1 and deleted_at is null
            and ($2::text = '' or plant_id = $2)
            and ($3::text = '' or status = $3)
            and ($4::text = '' or customer_id = $4)
          order by created_at desc`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? '', filters.customerId ?? ''],
      );
      const contracts: ContractRow[] = [];
      for (const row of rows) contracts.push(await this.readContract(tx, context, str(row.id)));
      return contracts;
    });
  };

  getContract = async (context: B1Context, id: string): Promise<ContractRow> => {
    this.level(context, SALES_LEVELS.read, 'read a contract');
    return this.db.withTenant(context.tenant, (tx) => this.readContract(tx, context, id));
  };

  createContract = async (
    context: B1Context,
    payload: {
      plantId: string;
      contractNo?: string;
      quotationVersionId: string;
      customerId?: string;
      projectId?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      terms?: string;
    },
  ): Promise<ContractRow> => {
    this.level(context, SALES_LEVELS.create, 'create a contract');
    const id = newId('CTR');
    return this.db.withTenant(context.tenant, async (tx) => {
      this.assertPlant(context, payload.plantId);
      const version = await tx.unsafe<Row>(
        `select qv.id, coalesce(qv.snapshot_json->>'status', '') as version_status,
                qv.quotation_id, qv.snapshot_json,
                q.customer_id, q.status as quotation_status
           from quotation_versions qv
           join quotations q on q.id = qv.quotation_id and q.company_id = qv.company_id
          where qv.company_id = $1 and qv.id = $2`,
        [context.tenant.companyId, payload.quotationVersionId],
      );
      const source = version[0];
      if (!source) {
        throw new M1Error('quotation_version_not_found', 404, 'quotation version does not exist');
      }
      const approved = checkApprovedVersion(str(source.version_status) || str(source.quotation_status));
      if (approved.outcome !== 'pass') {
        throw new M1Error('version_not_approved', 422, 'a contract needs an approved quotation version', {
          check: approved.key,
        });
      }
      if (payload.customerId && payload.customerId !== str(source.customer_id)) {
        throw new M1Error('customer_mismatch', 422, 'contract customer differs from the quotation', {
          field: 'customerId',
        });
      }
      const number = (payload.contractNo ?? '').trim() || documentNo('CTR');
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from contracts where company_id = $1 and lower(contract_no) = lower($2)
               and deleted_at is null`,
            [context.tenant.companyId, number],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_contract', 422, 'contract number must be unique', {
          check: 'uniqueDocument',
        });
      }
      await tx.unsafe(
        `insert into contracts (id, company_id, plant_id, contract_no, customer_id, project_id,
            quotation_version_id, start_date, end_date, terms, status, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$11)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          number,
          str(source.customer_id),
          payload.projectId ?? null,
          payload.quotationVersionId,
          payload.startDate ?? null,
          payload.endDate ?? null,
          payload.terms ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.contract_created', id, {
        contractNo: number,
        quotationVersionId: payload.quotationVersionId,
      });
      return this.readContract(tx, context, id);
    });
  };

  signContract = async (context: B1Context, id: string): Promise<ContractRow> => {
    this.level(context, SALES_LEVELS.sign, 'sign a contract');
    return this.db.withTenant(context.tenant, async (tx) => {
      const contract = await this.readContract(tx, context, id);
      if (!canContractTransition(contract.status, 'signed')) {
        throw new M1Error('invalid_transition', 409, `contract ${id} is ${contract.status}`, {
          from: contract.status,
          to: 'signed',
        });
      }
      const version = await tx.unsafe<Row>(
        `select coalesce(snapshot_json->>'status', '') as status from quotation_versions
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, contract.quotation_version_id],
      );
      const approved = checkApprovedVersion(str(version[0]?.status));
      if (approved.outcome !== 'pass') {
        throw new M1Error('version_not_approved', 422, 'the pinned quotation version is not approved', {
          check: approved.key,
        });
      }
      const snapshot = buildContractSnapshot({
        contractId: contract.id,
        customerId: contract.customer_id,
        quotationVersionId: contract.quotation_version_id,
        startDate: contract.start_date,
        endDate: contract.end_date,
        terms: contract.terms,
        status: 'signed',
        capturedAt: new Date().toISOString(),
      });
      const next = await tx.unsafe<Row>(
        `select coalesce(max(version_no), 0)::text as version_no from contract_versions
          where company_id = $1 and contract_id = $2`,
        [context.tenant.companyId, id],
      );
      const versionNo = num(next[0]?.version_no) + 1;
      await tx.unsafe(
        `insert into contract_versions (id, company_id, plant_id, contract_id, version_no,
            snapshot_json, reason, created_by)
         values ($1,$2,$3,$4,$5,$6::text::jsonb,$7,$8)`,
        [
          newId('CTV'),
          context.tenant.companyId,
          contract.plant_id,
          id,
          versionNo,
          JSON.stringify(snapshot),
          '',
          context.actor.username,
        ],
      );
      await tx.unsafe(
        `update contracts set status = 'signed', signed_at = now(), signed_by = $3,
            updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'sales.contract_signed', id, {
        versionNo,
        quotationVersionId: contract.quotation_version_id,
      });
      return this.readContract(tx, context, id);
    });
  };

  activateContract = async (context: B1Context, id: string): Promise<ContractRow> => {
    this.level(context, SALES_LEVELS.sign, 'activate a contract');
    return this.db.withTenant(context.tenant, async (tx) => {
      const contract = await this.readContract(tx, context, id);
      if (!canContractTransition(contract.status, 'active')) {
        throw new M1Error('invalid_transition', 409, `contract ${id} is ${contract.status}`, {
          from: contract.status,
          to: 'active',
        });
      }
      await tx.unsafe(
        `update contracts set status = 'active', updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'sales.contract_activated', id, {});
      return this.readContract(tx, context, id);
    });
  };

  voidContract = async (context: B1Context, id: string, reason: string): Promise<ContractRow> => {
    this.level(context, SALES_LEVELS.void, 'void a contract');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a void reason is required', { field: 'reason' });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const contract = await this.readContract(tx, context, id);
      if (!canContractTransition(contract.status, 'void')) {
        throw new M1Error('invalid_transition', 409, `contract ${id} is ${contract.status}`, {
          from: contract.status,
          to: 'void',
        });
      }
      const snapshot = buildContractSnapshot({
        contractId: contract.id,
        customerId: contract.customer_id,
        quotationVersionId: contract.quotation_version_id,
        startDate: contract.start_date,
        endDate: contract.end_date,
        terms: contract.terms,
        status: 'void',
        capturedAt: new Date().toISOString(),
      });
      const next = await tx.unsafe<Row>(
        `select coalesce(max(version_no), 0)::text as version_no from contract_versions
          where company_id = $1 and contract_id = $2`,
        [context.tenant.companyId, id],
      );
      await tx.unsafe(
        `insert into contract_versions (id, company_id, plant_id, contract_id, version_no,
            snapshot_json, reason, created_by)
         values ($1,$2,$3,$4,$5,$6::text::jsonb,$7,$8)`,
        [
          newId('CTV'),
          context.tenant.companyId,
          contract.plant_id,
          id,
          num(next[0]?.version_no) + 1,
          JSON.stringify(snapshot),
          reason,
          context.actor.username,
        ],
      );
      await tx.unsafe(
        `update contracts set status = 'void', void_reason = $3, updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason],
      );
      await audit(tx, context, 'sales.contract_voided', id, { reason });
      return this.readContract(tx, context, id);
    });
  };

  // --------------------------------------------------------------------- orders

  private toOrderItem = (row: Row): SalesOrderItemRow => ({
    id: str(row.id),
    material_id: nullable(row.material_id),
    material_code: str(row.material_code),
    material_name: str(row.material_name),
    description: str(row.description),
    quantity: num(row.quantity),
    unit_price: num(row.unit_price),
    discount_pct: num(row.discount_pct),
    tax_rate: num(row.tax_rate),
    line_total: num(row.line_total),
    delivered_qty: num(row.delivered_qty),
    invoiced_qty: num(row.invoiced_qty),
  });

  private toTicket = (row: Row, batches: DeliveryTicketBatchRow[]): DeliveryTicketRow => ({
    id: str(row.id),
    plant_id: str(row.plant_id),
    ticket_no: str(row.ticket_no),
    order_id: str(row.order_id),
    order_no: str(row.order_no),
    trip_id: str(row.trip_id),
    truck_id: str(row.truck_id),
    truck_plate: str(row.truck_plate),
    driver_id: nullable(row.driver_id),
    ticket_date: str(row.ticket_date),
    ticket_time: nullable(row.ticket_time),
    loaded_vol: num(row.loaded_vol),
    delivered_vol: num(row.delivered_vol),
    status: str(row.status) as DeliveryTicketStatus,
    void_reason: nullable(row.void_reason),
    batches,
  });

  private readOrder = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<SalesOrderRow> => {
    const rows = await tx.unsafe<Row>(
      `select o.id, o.plant_id, o.order_no, o.customer_id, o.project_id, o.quotation_id,
              o.contract_id, o.status, o.order_date::text as order_date,
              o.delivery_date::text as delivery_date,
              coalesce(o.total_amount, o.quantity_m3 * o.unit_price)::text as total_amount,
              o.credit_status, o.hold_reason, o.held_from_status, o.cancel_reason,
              coalesce(c.name_ar, '') as customer_name_ar, coalesce(c.name_en, '') as customer_name_en,
              p.code as project_code
         from orders o
         left join customers c on c.id = o.customer_id and c.company_id = o.company_id
         left join projects p on p.id = o.project_id and p.company_id = o.company_id
        where o.company_id = $1 and o.id = $2 and o.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    const row = rows[0];
    if (!row) throw new M1Error('order_not_found', 404, `order ${id} does not exist`);
    const items = await tx.unsafe<Row>(
      `select i.id, i.material_id, i.description, i.quantity::text as quantity,
              i.unit_price::text as unit_price, i.discount_pct::text as discount_pct,
              i.tax_rate::text as tax_rate, i.line_total::text as line_total,
              i.delivered_qty::text as delivered_qty, i.invoiced_qty::text as invoiced_qty,
              coalesce(m.material_code, '') as material_code,
              coalesce(m.name_ar, '') as material_name
         from sales_order_items i
         left join materials m on m.id = i.material_id and m.company_id = i.company_id
        where i.company_id = $1 and i.order_id = $2 and i.deleted_at is null
        order by i.line_no`,
      [context.tenant.companyId, id],
    );
    const ticketRows = await tx.unsafe<Row>(
      `select t.id, t.plant_id, t.ticket_no, t.order_id, o.order_no, t.trip_id, t.truck_id,
              t.driver_id, t.ticket_date::text as ticket_date, t.ticket_time::text as ticket_time,
              t.loaded_vol::text as loaded_vol, t.delivered_vol::text as delivered_vol, t.status,
              t.void_reason, tr.plate_no as truck_plate
         from delivery_tickets t
         join orders o on o.id = t.order_id and o.company_id = t.company_id
         join trucks tr on tr.id = t.truck_id and tr.company_id = t.company_id
        where t.company_id = $1 and t.order_id = $2 and t.deleted_at is null
        order by t.ticket_date, t.ticket_time nulls last, t.ticket_no`,
      [context.tenant.companyId, id],
    );
    const tickets: DeliveryTicketRow[] = [];
    for (const ticket of ticketRows) {
      const batchRows = await tx.unsafe<Row>(
        `select b.id, b.batch_id, coalesce(bt.batch_no, '') as batch_no,
                b.volume_m3::text as volume_m3, b.price_per_m3::text as price_per_m3
           from delivery_ticket_batches b
           left join batches bt on bt.id = b.batch_id and bt.company_id = b.company_id
          where b.company_id = $1 and b.ticket_id = $2 and b.deleted_at is null
          order by b.created_at`,
        [context.tenant.companyId, str(ticket.id)],
      );
      tickets.push(
        this.toTicket(
          ticket,
          batchRows.map((batch) => ({
            id: str(batch.id),
            batch_id: nullable(batch.batch_id),
            batch_no: str(batch.batch_no),
            volume_m3: num(batch.volume_m3),
            price_per_m3: num(batch.price_per_m3),
          })),
        ),
      );
    }
    const ordered = items.reduce((sum, item) => sum + num(item.quantity), 0);
    const delivered = deliveredVolume(
      tickets.map((ticket) => ({ status: ticket.status, deliveredVol: ticket.delivered_vol })),
    );
    return {
      id: str(row.id),
      plant_id: str(row.plant_id),
      order_no: str(row.order_no),
      customer_id: str(row.customer_id),
      customer_name: str(row.customer_name_ar) || str(row.customer_name_en),
      project_id: nullable(row.project_id),
      project_code: nullable(row.project_code),
      quotation_id: nullable(row.quotation_id),
      contract_id: nullable(row.contract_id),
      status: str(row.status) as SalesOrderStatus,
      order_date: nullable(row.order_date),
      delivery_date: nullable(row.delivery_date),
      total_amount: num(row.total_amount),
      credit_status: nullable(row.credit_status),
      hold_reason: nullable(row.hold_reason),
      held_from_status: nullable(row.held_from_status),
      cancel_reason: nullable(row.cancel_reason),
      items: items.map(this.toOrderItem),
      delivered_qty: delivered,
      ordered_qty: ordered,
      delivery_state:
        delivered <= 0 ? 'none' : delivered + 1e-9 >= ordered ? 'full' : 'partial',
      tickets,
    };
  };

  listOrders = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; customerId?: string; q?: string } = {},
  ): Promise<SalesOrderRow[]> => {
    this.level(context, SALES_LEVELS.read, 'read sales orders');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id from orders where company_id = $1 and deleted_at is null
            and (cardinality($6::text[]) = 0 or plant_id = any($6::text[]))
            and ($2::text = '' or plant_id = $2)
            and ($3::text = '' or status = $3)
            and ($4::text = '' or customer_id = $4)
            and ($5::text = '' or order_no ilike '%' || $5 || '%')
          order by created_at desc`,
        [
          context.tenant.companyId,
          filters.plantId ?? '',
          filters.status ?? '',
          filters.customerId ?? '',
          filters.q ?? '',
          context.tenant.plantIds,
        ],
      );
      const orders: SalesOrderRow[] = [];
      for (const row of rows) orders.push(await this.readOrder(tx, context, str(row.id)));
      return orders;
    });
  };

  getOrder = async (context: B1Context, id: string): Promise<SalesOrderRow> => {
    this.level(context, SALES_LEVELS.read, 'read a sales order');
    return this.db.withTenant(context.tenant, (tx) => this.readOrder(tx, context, id));
  };

  /** Posted receivables plus open orders, before the candidate order is added. */
  private exposureFor = async (
    tx: Executor,
    context: B1Context,
    customerId: string,
  ): Promise<number> => {
    const rows = await tx.unsafe<Row>(
      `select (
          coalesce((select sum(i.grand_total) from invoices i
                      where i.company_id = $1 and i.customer_id = $2 and i.deleted_at is null
                        and i.status in ('issued', 'partially_paid', 'overdue')), 0)
        + coalesce((select sum(coalesce(o.total_amount, o.quantity_m3 * o.unit_price))
                      from orders o
                     where o.company_id = $1 and o.customer_id = $2 and o.deleted_at is null
                       and o.status not in ('closed', 'cancelled')), 0)
       )::text as exposure`,
      [context.tenant.companyId, customerId],
    );
    return num(rows[0]?.exposure);
  };

  createSalesOrder = async (
    context: B1Context,
    payload: {
      plantId: string;
      orderNo?: string;
      customerId: string;
      projectId?: string | null;
      quotationId?: string | null;
      contractId?: string | null;
      orderDate?: string | null;
      deliveryDate?: string | null;
      items: Array<Omit<SalesOrderItemInput, 'unitPrice'> & { unitPrice?: number }>;
      notes?: string;
      reason?: string;
    },
  ): Promise<SalesOrderRow> => {
    this.level(context, SALES_LEVELS.create, 'create a sales order');
    const id = newId('SO');
    const reason = payload.reason ?? '';
    return this.db.withTenant(context.tenant, async (tx) => {
      this.assertPlant(context, payload.plantId);
      const customer = await this.readCustomer(tx, context, payload.customerId);
      const blacklist = checkBlacklist(customer.blacklisted);
      if (blacklist.outcome === 'failure') {
        throw new M1Error('customer_blacklisted', 422, 'a blacklisted customer cannot be ordered for', {
          check: blacklist.key,
        });
      }
      const orderDate = payload.orderDate?.trim() || today();
      const rules = await this.rules(tx, context.tenant.companyId);

      let quotationId = payload.quotationId?.trim() || null;
      let contractId = payload.contractId?.trim() || null;
      let contractLimit: number | null = null;

      if (contractId) {
        const contractRows = await tx.unsafe<Row>(
          `select id, status, customer_id, quotation_version_id from contracts
            where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, contractId],
        );
        const contract = contractRows[0];
        if (!contract) throw new M1Error('contract_not_found', 404, 'contract does not exist');
        if (!['signed', 'active'].includes(str(contract.status))) {
          throw new M1Error('contract_not_signed', 422, `contract is ${str(contract.status)}`, {
            field: 'contractId',
          });
        }
        if (str(contract.customer_id) !== customer.id) {
          throw new M1Error('customer_mismatch', 422, 'contract belongs to another customer', {
            field: 'customerId',
          });
        }
        const version = await tx.unsafe<Row>(
          `select id, quotation_id, snapshot_json from quotation_versions
            where company_id = $1 and id = $2`,
          [context.tenant.companyId, str(contract.quotation_version_id)],
        );
        const snapshot = version[0]?.snapshot_json as
          | { lines?: Array<{ quantity?: number }> }
          | undefined;
        if (quotationId && quotationId !== str(version[0]?.quotation_id)) {
          throw new M1Error('quotation_mismatch', 422, 'quotation differs from the signed contract', {
            field: 'quotationId',
          });
        }
        quotationId = str(version[0]?.quotation_id);
        contractLimit = (snapshot?.lines ?? []).reduce(
          (sum, line) => sum + num(line.quantity),
          0,
        );
      }

      if (quotationId) {
        const quotationRows = await tx.unsafe<Row>(
          `select id, customer_id, valid_until::text as valid_until, status
             from quotations where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, quotationId],
        );
        const quotation = quotationRows[0];
        if (!quotation) throw new M1Error('quotation_not_found', 404, 'quotation does not exist');
        if (str(quotation.customer_id) !== customer.id) {
          throw new M1Error('customer_mismatch', 422, 'quotation belongs to another customer', {
            field: 'customerId',
          });
        }
        const validity = checkQuotationValidity(str(quotation.valid_until), orderDate);
        if (validity.outcome === 'failure') {
          throw new M1Error('quotation_expired', 422, 'the quotation has expired', {
            check: validity.key,
          });
        }
      }

      interface ResolvedPricing {
        candidate: PriceCandidate;
        rule: string;
      }
      const lines: Array<
        SalesLine & { materialId: string | null; description: string; pricing: ResolvedPricing | null }
      > = [];
      const commitmentUses: Array<{
        commitmentId: string;
        quantity: number;
        decision: ReturnType<typeof commitmentDecision>;
      }> = [];

      for (const item of payload.items) {
        const supplied = Number(item.unitPrice);
        let unitPrice = supplied;
        let pricing: ResolvedPricing | null = null;

        if (!Number.isFinite(supplied) || supplied <= 0) {
          const candidates = await this.priceCandidates(tx, context, {
            plantId: payload.plantId,
            customerId: customer.id,
            contractId,
            orderDate,
            materialId: item.materialId ?? null,
            description: item.description ?? '',
            quantity: item.quantity,
          });
          const decision = choosePrice(candidates);
          if (decision.outcome === 'none') {
            throw new M1Error('approval_required', 403, 'no applicable price for this line', {
              check: 'pricePrecedence',
              line: item.materialId ?? item.description ?? '',
            });
          }
          if (decision.outcome === 'ambiguous') {
            this.enforceCrm(checkPriceDecision(decision), context, reason);
            const chosen = [...decision.candidates].sort(
              (a, b) => a.price - b.price || a.sourceId.localeCompare(b.sourceId),
            )[0]!;
            unitPrice = chosen.price;
            pricing = { candidate: chosen, rule: 'precedence_ambiguity_override' };
          } else {
            unitPrice = decision.candidate.price;
            pricing = { candidate: decision.candidate, rule: `precedence:${decision.candidate.sourceType}` };
          }

          if (pricing.candidate.sourceType === 'volume_commitment') {
            const commitmentRows = await tx.unsafe<Row>(
              `select committed_quantity_m3::text as committed,
                      fulfilled_quantity_m3::text as fulfilled
                 from volume_commitments
                where company_id = $1 and id = $2 and deleted_at is null`,
              [context.tenant.companyId, pricing.candidate.sourceId],
            );
            const commitment = commitmentRows[0];
            if (commitment) {
              const decisionC = commitmentDecision(
                num(commitment.committed),
                num(commitment.fulfilled),
                item.quantity,
                rules.get(COMMITMENT_RULE_CODES.warn) ?? missingCommitmentRule('warn'),
                rules.get(COMMITMENT_RULE_CODES.approval) ?? missingCommitmentRule('approval'),
              );
              this.enforceCrm(decisionC.check, context, reason);
              commitmentUses.push({
                commitmentId: pricing.candidate.sourceId,
                quantity: item.quantity,
                decision: decisionC,
              });
            }
          }
        }

        lines.push({
          materialId: item.materialId ?? null,
          description: item.description ?? '',
          quantity: item.quantity,
          unitPrice,
          discountPct: item.discountPct ?? 0,
          taxRate: item.taxRate ?? 0,
          pricing,
        });
      }

      const positive = checkPositiveLines(lines);
      if (positive.outcome !== 'pass') {
        throw new M1Error('positive_value', 422, 'quantity and price must be positive', {
          check: positive.key,
        });
      }
      const price = checkPriceResolution(lines.map((line) => line.unitPrice));
      if (price.outcome !== 'pass') {
        throw new M1Error('approval_required', 403, 'every line needs a resolved price', {
          check: price.key,
        });
      }

      const resolvedContract = lines.find(
        (line) => line.pricing?.candidate.sourceType === 'contract',
      )?.pricing?.candidate.sourceId;
      if (!contractId && resolvedContract) contractId = resolvedContract;
      const reference = lines.some((line) => line.pricing)
        ? checkSalesReference('resolved', null)
        : checkSalesReference(quotationId, contractId);
      this.enforce(reference, context, reason);

      if (contractLimit !== null) {
        const committedRows = await tx.unsafe<Row>(
          `select coalesce(sum(coalesce(o.total_amount, o.quantity_m3 * o.unit_price)), 0)::text as total,
                  coalesce(sum(o.quantity_m3), 0)::text as quantity
             from orders o
            where o.company_id = $1 and o.contract_id = $2 and o.deleted_at is null
              and o.status <> 'cancelled'`,
          [context.tenant.companyId, contractId],
        );
        const committed = num(committedRows[0]?.quantity) + lines.reduce((sum, line) => sum + line.quantity, 0);
        const limitCheck = checkContractLimit(committed, contractLimit);
        this.enforce(limitCheck, context, reason);
      }

      const discounts = checkDiscounts(
        this.ruleFor(rules, 'discountApproval'),
        this.ruleFor(rules, 'discountMax'),
        lines,
      );
      this.enforce(discounts, context, reason);

      const total = sumLines(lines);
      const exposureBefore = await this.exposureFor(tx, context, customer.id);
      const credit = creditDecision(exposureBefore + total, customer.effective_limit || null);
      this.enforce(credit.check, context, reason);

      const number = (payload.orderNo ?? '').trim() || documentNo('SO');
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from orders where company_id = $1 and lower(order_no) = lower($2)
               and deleted_at is null`,
            [context.tenant.companyId, number],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_order', 422, 'order number must be unique', {
          check: 'uniqueDocument',
        });
      }

      const grade =
        lines[0]?.description?.trim() ||
        lines[0]?.materialId?.trim() ||
        'unspecified';
      const headerQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
      await tx.unsafe(
        `insert into orders (id, company_id, plant_id, customer_id, project_id, order_no,
            concrete_grade, quantity_m3, unit_price, order_date, delivery_date, status, notes,
            quotation_id, contract_id, total_amount, credit_status, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$14,$15,$16,$17,$17)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.customerId,
          payload.projectId ?? null,
          number,
          grade,
          headerQuantity,
          lines[0]?.unitPrice ?? 0,
          orderDate,
          payload.deliveryDate ?? null,
          payload.notes ?? '',
          quotationId,
          contractId,
          total,
          creditBand(credit),
          context.actor.username,
        ],
      );
      for (const [index, line] of lines.entries()) {
        const itemId = newId('SOI');
        await tx.unsafe(
          `insert into sales_order_items (id, company_id, plant_id, order_id, line_no, material_id,
              description, quantity, unit_price, discount_pct, tax_rate, line_total,
              created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
          [
            itemId,
            context.tenant.companyId,
            payload.plantId,
            id,
            index + 1,
            line.materialId ?? null,
            line.description ?? '',
            line.quantity,
            line.unitPrice,
            line.discountPct,
            line.taxRate,
            lineTotal(line),
            context.actor.username,
          ],
        );
        if (line.pricing) {
          await tx.unsafe(
            `insert into price_resolutions (id, company_id, plant_id, order_id, order_item_id,
                line_no, material_id, quantity_m3, source_type, source_id, resolved_price,
                resolved_by_rule, decided_by, created_by, updated_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13)`,
            [
              newId('PRS'),
              context.tenant.companyId,
              payload.plantId,
              id,
              itemId,
              index + 1,
              line.materialId,
              line.quantity,
              line.pricing.candidate.sourceType,
              line.pricing.candidate.sourceId,
              line.unitPrice,
              line.pricing.rule,
              context.actor.username,
            ],
          );
        }
      }
      for (const use of commitmentUses) {
        await tx.unsafe(
          `update volume_commitments
              set fulfilled_quantity_m3 = fulfilled_quantity_m3 + $3,
                  status = case when fulfilled_quantity_m3 + $3 = committed_quantity_m3
                                then 'fulfilled' else status end,
                  updated_by = $4
            where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, use.commitmentId, use.quantity, context.actor.username],
        );
        if (use.decision.outcome === 'warning') {
          await audit(tx, context, 'sales.commitment_warned', use.commitmentId, {
            orderId: id,
            ratio: use.decision.ratio,
            projected: use.decision.projected,
          });
        }
      }
      if (credit.band === 'warn') {
        await audit(tx, context, 'sales.credit_warned', id, {
          exposure: exposureBefore + total,
          limit: customer.effective_limit,
          ratio: credit.ratio,
        });
      }
      await audit(tx, context, 'sales.order_created', id, {
        orderNo: number,
        total,
        creditStatus: creditBand(credit),
        reason,
      });
      return this.readOrder(tx, context, id);
    });
  };

  confirmOrder = async (context: B1Context, id: string, reason = ''): Promise<SalesOrderRow> => {
    this.level(context, SALES_LEVELS.approve, 'confirm a sales order');
    return this.orderTransition(context, id, 'confirmed', reason);
  };

  holdOrder = async (context: B1Context, id: string, reason: string): Promise<SalesOrderRow> => {
    this.level(context, SALES_LEVELS.approve, 'hold a sales order');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a hold reason is required', { field: 'reason' });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const order = await this.readOrder(tx, context, id);
      if (!canSalesOrderTransition(order.status, 'on_hold')) {
        throw new M1Error('invalid_transition', 409, `order ${id} is ${order.status}`, {
          from: order.status,
          to: 'on_hold',
        });
      }
      await tx.unsafe(
        `update orders set status = 'on_hold', held_from_status = $3, hold_reason = $4,
            updated_by = $5 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, order.status, reason, context.actor.username],
      );
      await audit(tx, context, 'sales.order_held', id, { reason });
      return this.readOrder(tx, context, id);
    });
  };

  resumeOrder = async (context: B1Context, id: string): Promise<SalesOrderRow> => {
    this.level(context, SALES_LEVELS.approve, 'resume a sales order');
    return this.db.withTenant(context.tenant, async (tx) => {
      const order = await this.readOrder(tx, context, id);
      if (order.status !== 'on_hold') {
        throw new M1Error('invalid_transition', 409, `order ${id} is ${order.status}`, {
          from: order.status,
          to: 'resume',
        });
      }
      const target = (['confirmed', 'scheduled', 'in_production'] as SalesOrderStatus[]).includes(
        (order.held_from_status ?? '') as SalesOrderStatus,
      )
        ? (order.held_from_status as SalesOrderStatus)
        : 'confirmed';
      await tx.unsafe(
        `update orders set status = $3, held_from_status = null, hold_reason = null,
            updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, target, context.actor.username],
      );
      await audit(tx, context, 'sales.order_resumed', id, { to: target });
      return this.readOrder(tx, context, id);
    });
  };

  cancelOrder = async (context: B1Context, id: string, reason: string): Promise<SalesOrderRow> => {
    this.level(context, SALES_LEVELS.approve, 'cancel a sales order');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a cancellation reason is required', {
        field: 'reason',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const order = await this.readOrder(tx, context, id);
      if (!canSalesOrderTransition(order.status, 'cancelled')) {
        throw new M1Error('invalid_transition', 409, `order ${id} is ${order.status}`, {
          from: order.status,
          to: 'cancelled',
        });
      }
      await tx.unsafe(
        `update orders set status = 'cancelled', cancelled_at = now(), cancelled_by = $3,
            cancel_reason = $4, updated_by = $3 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username, reason],
      );
      await audit(tx, context, 'sales.order_cancelled', id, { reason });
      return this.readOrder(tx, context, id);
    });
  };

  private orderTransition = async (
    context: B1Context,
    id: string,
    to: SalesOrderStatus,
    reason = '',
  ): Promise<SalesOrderRow> => {
    return this.db.withTenant(context.tenant, async (tx) => {
      const order = await this.readOrder(tx, context, id);
      if (!canSalesOrderTransition(order.status, to)) {
        throw new M1Error('invalid_transition', 409, `order ${id} is ${order.status}`, {
          from: order.status,
          to,
        });
      }
      if (to === 'delivered' && !isFullyDelivered(order.ordered_qty, order.delivered_qty)) {
        if (context.actor.roleLevel >= SALES_LEVELS.sign && reason.trim().length >= MIN_OVERRIDE_REASON) {
          await audit(tx, context, 'sales.short_closed', id, {
            ordered: order.ordered_qty,
            delivered: order.delivered_qty,
            reason,
          });
        } else {
          throw new M1Error('approval_required', 403, 'delivery is short and needs a level-5 short-close', {
            check: 'volumeVariance',
          });
        }
      }
      await tx.unsafe(
        `update orders set status = $3, updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, to, context.actor.username],
      );
      await audit(tx, context, `sales.order_${to}`, id, { reason });
      return this.readOrder(tx, context, id);
    });
  };

  advanceOrder = async (
    context: B1Context,
    id: string,
    to: SalesOrderStatus,
    reason = '',
  ): Promise<SalesOrderRow> => {
    this.level(context, to === 'closed' ? SALES_LEVELS.approve : SALES_LEVELS.create, `move an order to ${to}`);
    return this.orderTransition(context, id, to, reason);
  };

  // ------------------------------------------------------------ delivery tickets

  private readTicket = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<DeliveryTicketRow> => {
    const rows = await tx.unsafe<Row>(
      `select t.id, t.plant_id, t.ticket_no, t.order_id, o.order_no, t.trip_id, t.truck_id,
              t.driver_id, t.ticket_date::text as ticket_date, t.ticket_time::text as ticket_time,
              t.loaded_vol::text as loaded_vol, t.delivered_vol::text as delivered_vol, t.status,
              t.void_reason, tr.plate_no as truck_plate
         from delivery_tickets t
         join orders o on o.id = t.order_id and o.company_id = t.company_id
         join trucks tr on tr.id = t.truck_id and tr.company_id = t.company_id
        where t.company_id = $1 and t.id = $2 and t.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    const row = rows[0];
    if (!row) throw new M1Error('ticket_not_found', 404, `ticket ${id} does not exist`);
    const batches = await tx.unsafe<Row>(
      `select b.id, b.batch_id, coalesce(bt.batch_no, '') as batch_no,
              b.volume_m3::text as volume_m3, b.price_per_m3::text as price_per_m3
         from delivery_ticket_batches b
         left join batches bt on bt.id = b.batch_id and bt.company_id = b.company_id
        where b.company_id = $1 and b.ticket_id = $2 and b.deleted_at is null
        order by b.created_at`,
      [context.tenant.companyId, id],
    );
    return this.toTicket(
      row,
      batches.map((batch) => ({
        id: str(batch.id),
        batch_id: nullable(batch.batch_id),
        batch_no: str(batch.batch_no),
        volume_m3: num(batch.volume_m3),
        price_per_m3: num(batch.price_per_m3),
      })),
    );
  };

  listDeliveryTickets = async (
    context: B1Context,
    filters: { orderId?: string; status?: string; plantId?: string } = {},
  ): Promise<DeliveryTicketRow[]> => {
    this.level(context, SALES_LEVELS.read, 'read delivery tickets');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id from delivery_tickets where company_id = $1 and deleted_at is null
            and ($2::text = '' or order_id = $2)
            and ($3::text = '' or status = $3)
            and ($4::text = '' or plant_id = $4)
          order by created_at desc`,
        [context.tenant.companyId, filters.orderId ?? '', filters.status ?? '', filters.plantId ?? ''],
      );
      const tickets: DeliveryTicketRow[] = [];
      for (const row of rows) tickets.push(await this.readTicket(tx, context, str(row.id)));
      return tickets;
    });
  };

  createDeliveryTicket = async (
    context: B1Context,
    payload: {
      ticketNo?: string;
      orderId: string;
      tripId: string;
      truckId: string;
      driverId?: string | null;
      ticketDate?: string;
      ticketTime?: string | null;
      loadedVol: number;
      deliveredVol?: number;
      batches?: DeliveryTicketBatchInput[];
      reason?: string;
    },
  ): Promise<DeliveryTicketRow> => {
    this.level(context, SALES_LEVELS.create, 'create a delivery ticket');
    const id = newId('DT');
    const reason = payload.reason ?? '';
    const references = checkTicketReferences(payload.tripId, payload.truckId);
    if (references.outcome === 'failure') {
      throw new M1Error('ticket_references', 422, 'a ticket needs both a trip and a truck', {
        check: references.key,
      });
    }
    if (!Number.isFinite(payload.loadedVol) || payload.loadedVol <= 0) {
      throw new M1Error('positive_value', 422, 'loaded volume must be positive', {
        field: 'loadedVol',
      });
    }
    const delivered = payload.deliveredVol ?? payload.loadedVol;
    const variance = checkVolumeVariance(payload.loadedVol, delivered);
    this.enforce(variance, context, reason);
    const batches = payload.batches ?? [];
    const coverage = checkBatchCoverage(
      batches.map((batch) => batch.volumeM3),
      payload.loadedVol,
    );
    if (coverage.outcome === 'failure') {
      throw new M1Error('batch_coverage', 422, 'linked batches must cover the loaded volume', {
        check: coverage.key,
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const order = await this.readOrder(tx, context, payload.orderId);
      this.assertPlant(context, order.plant_id);
      if (!['confirmed', 'scheduled', 'in_production'].includes(order.status)) {
        throw new M1Error('invalid_transition', 409, `order ${order.order_no} is ${order.status}`, {
          from: order.status,
          to: 'ticket',
        });
      }
      if (payload.loadedVol > order.ordered_qty - order.delivered_qty + 1e-9) {
        throw new M1Error('ticket_over_order', 422, 'loaded volume exceeds the remaining order quantity', {
          check: 'volumeVariance',
        });
      }
      const trip = await tx.unsafe<Row>(
        `select id, truck_id, plant_id from trips where company_id = $1 and id = $2`,
        [context.tenant.companyId, payload.tripId],
      );
      if (!trip[0]) throw new M1Error('trip_not_found', 404, 'trip does not exist');
      if (str(trip[0].truck_id) !== payload.truckId) {
        throw new M1Error('trip_truck_mismatch', 422, 'the trip belongs to another truck', {
          field: 'truckId',
        });
      }
      const number = (payload.ticketNo ?? '').trim() || documentNo('DT');
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from delivery_tickets where company_id = $1 and lower(ticket_no) = lower($2)
               and deleted_at is null`,
            [context.tenant.companyId, number],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_ticket', 422, 'ticket number must be unique', {
          check: 'uniqueDocument',
        });
      }
      await tx.unsafe(
        `insert into delivery_tickets (id, company_id, plant_id, ticket_no, order_id, trip_id,
            truck_id, driver_id, ticket_date, ticket_time, loaded_vol, delivered_vol, status,
            created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$13)`,
        [
          id,
          context.tenant.companyId,
          order.plant_id,
          number,
          payload.orderId,
          payload.tripId,
          payload.truckId,
          payload.driverId ?? null,
          payload.ticketDate ?? today(),
          payload.ticketTime ?? null,
          payload.loadedVol,
          delivered,
          context.actor.username,
        ],
      );
      for (const batch of batches) {
        if (batch.batchId) {
          const found = await tx.unsafe<Row>(
            `select 1 from batches where company_id = $1 and id = $2`,
            [context.tenant.companyId, batch.batchId],
          );
          if (!found[0]) {
            throw new M1Error('batch_not_found', 404, `batch ${batch.batchId} does not exist`);
          }
        }
        await tx.unsafe(
          `insert into delivery_ticket_batches (id, company_id, plant_id, ticket_id, batch_id,
              volume_m3, price_per_m3, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
          [
            newId('DTB'),
            context.tenant.companyId,
            order.plant_id,
            id,
            batch.batchId ?? null,
            batch.volumeM3,
            batch.pricePerM3 ?? 0,
            context.actor.username,
          ],
        );
      }
      await audit(tx, context, 'delivery.ticket_issued', id, {
        ticketNo: number,
        loaded: payload.loadedVol,
        delivered,
        batches: batches.length,
      });
      return this.readTicket(tx, context, id);
    });
  };

  confirmDeliveryTicket = async (
    context: B1Context,
    id: string,
  ): Promise<DeliveryTicketRow> => {
    this.level(context, SALES_LEVELS.create, 'confirm a delivery ticket');
    return this.ticketTransition(context, id, 'confirmed', '');
  };

  deliverDeliveryTicket = async (
    context: B1Context,
    id: string,
    payload: { deliveredVol?: number; reason?: string } = {},
  ): Promise<DeliveryTicketRow> => {
    this.level(context, SALES_LEVELS.create, 'mark a delivery ticket delivered');
    return this.db.withTenant(context.tenant, async (tx) => {
      const ticket = await this.readTicket(tx, context, id);
      if (!canTicketTransition(ticket.status, 'delivered')) {
        throw new M1Error('invalid_transition', 409, `ticket ${id} is ${ticket.status}`, {
          from: ticket.status,
          to: 'delivered',
        });
      }
      const delivered = payload.deliveredVol ?? ticket.delivered_vol;
      const variance = checkVolumeVariance(ticket.loaded_vol, delivered);
      this.enforce(variance, context, payload.reason ?? '');
      await tx.unsafe(
        `update delivery_tickets set status = 'delivered', delivered_vol = $3,
            delivered_at = now(), updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, delivered, context.actor.username],
      );
      await audit(tx, context, 'delivery.ticket_delivered', id, { delivered });
      return this.readTicket(tx, context, id);
    });
  };

  voidDeliveryTicket = async (
    context: B1Context,
    id: string,
    reason: string,
  ): Promise<DeliveryTicketRow> => {
    this.level(context, SALES_LEVELS.void, 'void a delivery ticket');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a void reason is required', { field: 'reason' });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const ticket = await this.readTicket(tx, context, id);
      if (!canTicketTransition(ticket.status, 'voided')) {
        throw new M1Error('invalid_transition', 409, `ticket ${id} is ${ticket.status}`, {
          from: ticket.status,
          to: 'voided',
        });
      }
      await tx.unsafe(
        `update delivery_tickets set status = 'voided', void_reason = $3, updated_by = $4
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, reason, context.actor.username],
      );
      await audit(tx, context, 'delivery.ticket_voided', id, { reason });
      return this.readTicket(tx, context, id);
    });
  };

  private ticketTransition = async (
    context: B1Context,
    id: string,
    to: DeliveryTicketStatus,
    reason: string,
  ): Promise<DeliveryTicketRow> =>
    this.db.withTenant(context.tenant, async (tx) => {
      const ticket = await this.readTicket(tx, context, id);
      if (!canTicketTransition(ticket.status, to)) {
        throw new M1Error('invalid_transition', 409, `ticket ${id} is ${ticket.status}`, {
          from: ticket.status,
          to,
        });
      }
      await tx.unsafe(
        `update delivery_tickets set status = $3, confirmed_at = case when $3 = 'confirmed' then now() else confirmed_at end,
            confirmed_by = case when $3 = 'confirmed' then $4 else confirmed_by end,
            updated_by = $4 where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, to, context.actor.username],
      );
      await audit(tx, context, `delivery.ticket_${to}`, id, { reason });
      return this.readTicket(tx, context, id);
    });
  // ---------------------------------------------------------------- M8 price lists

  private toPriceList = (row: Row): Record<string, unknown> => ({
    id: str(row.id),
    plant_id: str(row.plant_id),
    list_code: str(row.list_code),
    name: str(row.name),
    currency: str(row.currency),
    valid_from: str(row.valid_from),
    valid_until: nullable(row.valid_until),
    status: str(row.status) as PriceListStatus,
    notes: str(row.notes),
    item_count: num(row.item_count),
    items: row.items ?? undefined,
  });

  private toPriceListItem = (row: Row): Record<string, unknown> => ({
    id: str(row.id),
    price_list_id: str(row.price_list_id),
    material_id: str(row.material_id),
    material_code: str(row.material_code),
    material_name: str(row.material_name),
    unit_price: num(row.unit_price),
    min_quantity: num(row.min_quantity),
    discount_pct: num(row.discount_pct),
    valid_from: nullable(row.valid_from),
    valid_until: nullable(row.valid_until),
  });

  listPriceLists = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; q?: string } = {},
  ): Promise<Array<Record<string, unknown>>> => {
    this.level(context, CRM_LEVELS.read, 'read price lists');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select pl.id, pl.plant_id, pl.list_code, pl.name, pl.currency,
                pl.valid_from::text as valid_from, pl.valid_until::text as valid_until,
                pl.status, pl.notes,
                (select count(*) from price_list_items i
                  where i.company_id = pl.company_id and i.price_list_id = pl.id
                    and i.deleted_at is null)::text as item_count
           from price_lists pl
          where pl.company_id = $1 and pl.deleted_at is null
            and ($2::text = '' or pl.plant_id = $2)
            and ($3::text = '' or pl.status = $3)
            and ($4::text = '' or pl.list_code ilike '%' || $4 || '%' or pl.name ilike '%' || $4 || '%')
          order by pl.valid_from desc, pl.list_code`,
        [context.tenant.companyId, filters.plantId ?? '', filters.status ?? '', filters.q ?? ''],
      ),
    );
    return rows.map(this.toPriceList);
  };

  getPriceList = async (context: B1Context, id: string): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.read, 'read a price list');
    return this.db.withTenant(context.tenant, (tx) => this.readPriceList(tx, context, id));
  };

  private readPriceList = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<Record<string, unknown>> => {
    const rows = await tx.unsafe<Row>(
      `select pl.id, pl.plant_id, pl.list_code, pl.name, pl.currency,
              pl.valid_from::text as valid_from, pl.valid_until::text as valid_until,
              pl.status, pl.notes
         from price_lists pl
        where pl.company_id = $1 and pl.id = $2 and pl.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('price_list_not_found', 404, `price list ${id} does not exist`);
    const items = await tx.unsafe<Row>(
      `select i.id, i.price_list_id, i.material_id, m.material_code, m.name_en as material_name,
              i.unit_price::text as unit_price, i.min_quantity::text as min_quantity,
              i.discount_pct::text as discount_pct, i.valid_from::text as valid_from,
              i.valid_until::text as valid_until
         from price_list_items i
         join materials m on m.company_id = i.company_id and m.id = i.material_id
        where i.company_id = $1 and i.price_list_id = $2 and i.deleted_at is null
        order by m.material_code, i.min_quantity`,
      [context.tenant.companyId, id],
    );
    return { ...this.toPriceList(rows[0]), items: items.map(this.toPriceListItem) };
  };

  createPriceList = async (
    context: B1Context,
    payload: {
      plantId: string;
      listCode: string;
      name: string;
      currency?: string;
      validFrom: string;
      validUntil?: string | null;
      notes?: string;
    },
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.pricing, 'create a price list');
    this.assertPlant(context, payload.plantId);
    if (!payload.listCode.trim() || !payload.name.trim()) {
      throw new M1Error('validation_error', 422, 'list code and name are required', {
        field: 'listCode',
      });
    }
    if (!payload.validFrom || (payload.validUntil && payload.validUntil < payload.validFrom)) {
      throw new M1Error('validation_error', 422, 'the validity window is invalid', {
        field: 'validFrom',
      });
    }
    const id = newId('PRL');
    return this.db.withTenant(context.tenant, async (tx) => {
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from price_lists where company_id = $1 and lower(list_code) = lower($2)
               and deleted_at is null`,
            [context.tenant.companyId, payload.listCode.trim()],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_price_list', 422, 'price list code must be unique');
      }
      await tx.unsafe(
        `insert into price_lists (id, company_id, plant_id, list_code, name, currency, valid_from,
            valid_until, notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.listCode.trim(),
          payload.name.trim(),
          payload.currency ?? 'EGP',
          payload.validFrom,
          payload.validUntil ?? null,
          payload.notes ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.price_list_created', id, { listCode: payload.listCode });
      return this.readPriceList(tx, context, id);
    });
  };

  addPriceListItem = async (
    context: B1Context,
    priceListId: string,
    payload: {
      materialId: string;
      unitPrice: number;
      minQuantity?: number;
      discountPct?: number;
      validFrom?: string | null;
      validUntil?: string | null;
    },
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.pricing, 'add a price list item');
    if (!Number.isFinite(payload.unitPrice) || payload.unitPrice <= 0) {
      throw new M1Error('positive_value', 422, 'unit price must be positive', { field: 'unitPrice' });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const list = await this.readPriceList(tx, context, priceListId);
      if (str(list.status) !== 'draft') {
        throw new M1Error('price_list_locked', 422, 'items may only be added to a draft price list');
      }
      const material = await tx.unsafe<Row>(
        `select id from materials where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, payload.materialId],
      );
      if (!material[0]) throw new M1Error('material_not_found', 404, 'material does not exist');
      const id = newId('PLI');
      await tx.unsafe(
        `insert into price_list_items (id, company_id, plant_id, price_list_id, material_id,
            unit_price, min_quantity, discount_pct, valid_from, valid_until, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          id,
          context.tenant.companyId,
          str(list.plant_id),
          priceListId,
          payload.materialId,
          payload.unitPrice,
          payload.minQuantity ?? 0,
          payload.discountPct ?? 0,
          payload.validFrom ?? null,
          payload.validUntil ?? null,
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.price_list_item_added', id, { priceListId });
      return this.readPriceList(tx, context, priceListId);
    });
  };

  activatePriceList = async (
    context: B1Context,
    id: string,
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.approve, 'activate a price list');
    return this.db.withTenant(context.tenant, async (tx) => {
      const list = await this.readPriceList(tx, context, id);
      if (!canPriceListTransition(list.status as PriceListStatus, 'active')) {
        throw new M1Error('invalid_transition', 409, `price list ${id} is ${str(list.status)}`);
      }
      const items = (list.items ?? []) as Array<Record<string, unknown>>;
      if (items.length === 0) {
        throw new M1Error('validation_error', 422, 'a price list needs at least one item');
      }
      const active = await tx.unsafe<Row>(
        `select distinct pl.list_code, pl.valid_from::text as valid_from,
                pl.valid_until::text as valid_until, i.material_id
           from price_lists pl
           join price_list_items i
             on i.company_id = pl.company_id and i.price_list_id = pl.id and i.deleted_at is null
          where pl.company_id = $1 and pl.plant_id = $2 and pl.status = 'active'
            and pl.deleted_at is null and pl.id <> $3
            and i.material_id in (select material_id from price_list_items
                                   where company_id = $1 and price_list_id = $3
                                     and deleted_at is null)`,
        [context.tenant.companyId, str(list.plant_id), id],
      );
      for (const row of active) {
        const overlap = checkPriceListOverlap(
          { from: str(list.valid_from), to: nullable(list.valid_until) },
          [{ from: str(row.valid_from), to: nullable(row.valid_until) }],
        );
        if (overlap.outcome === 'failure') {
          throw new M1Error('price_list_overlap', 422, 'an active price list already covers this material and window', {
            check: overlap.key,
            listCode: str(row.list_code),
            materialId: str(row.material_id),
          });
        }
      }
      await tx.unsafe(
        `update price_lists set status = 'active', updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'sales.price_list_activated', id, { listCode: str(list.list_code) });
      return this.readPriceList(tx, context, id);
    });
  };

  expirePriceList = async (
    context: B1Context,
    id: string,
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.approve, 'expire a price list');
    return this.db.withTenant(context.tenant, async (tx) => {
      const list = await this.readPriceList(tx, context, id);
      if (!canPriceListTransition(list.status as PriceListStatus, 'expired')) {
        throw new M1Error('invalid_transition', 409, `price list ${id} is ${str(list.status)}`);
      }
      await tx.unsafe(
        `update price_lists set status = 'expired', updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'sales.price_list_expired', id, {});
      return this.readPriceList(tx, context, id);
    });
  };

  supersedePriceList = async (
    context: B1Context,
    id: string,
    reason: string,
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.supersede, 'supersede an active price list');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, `reason must be at least ${MIN_OVERRIDE_REASON} characters`, {
        field: 'reason',
      });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const list = await this.readPriceList(tx, context, id);
      if (!canPriceListTransition(list.status as PriceListStatus, 'superseded')) {
        throw new M1Error('invalid_transition', 409, `price list ${id} is ${str(list.status)}`);
      }
      await tx.unsafe(
        `update price_lists set status = 'superseded', updated_by = $3
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, context.actor.username],
      );
      await audit(tx, context, 'sales.price_list_superseded', id, { reason });
      return this.readPriceList(tx, context, id);
    });
  };

  // ----------------------------------------------------------- M8 commitments

  private toCommitment = (row: Row): Record<string, unknown> => {
    const committed = num(row.committed_quantity_m3);
    const fulfilled = num(row.fulfilled_quantity_m3);
    return {
      id: str(row.id),
      plant_id: str(row.plant_id),
      commitment_no: str(row.commitment_no),
      customer_id: str(row.customer_id),
      customer_name: str(row.customer_name),
      contract_id: nullable(row.contract_id),
      material_id: str(row.material_id),
      material_code: str(row.material_code),
      material_name: str(row.material_name),
      committed_quantity_m3: committed,
      fulfilled_quantity_m3: fulfilled,
      fulfilment_pct: committed > 0 ? (fulfilled / committed) * 100 : 0,
      period_start: str(row.period_start),
      period_end: str(row.period_end),
      special_price: num(row.special_price),
      status: str(row.status) as CommitmentStatus,
      notes: str(row.notes),
    };
  };

  listVolumeCommitments = async (
    context: B1Context,
    filters: { plantId?: string; status?: string; customerId?: string } = {},
  ): Promise<Array<Record<string, unknown>>> => {
    this.level(context, CRM_LEVELS.read, 'read volume commitments');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select v.id, v.plant_id, v.commitment_no, v.customer_id, c.name_ar as customer_name,
                v.contract_id, v.material_id, m.material_code, m.name_en as material_name,
                v.committed_quantity_m3::text as committed_quantity_m3,
                v.fulfilled_quantity_m3::text as fulfilled_quantity_m3,
                v.period_start::text as period_start, v.period_end::text as period_end,
                v.special_price::text as special_price, v.status, v.notes
           from volume_commitments v
           join customers c on c.company_id = v.company_id and c.id = v.customer_id
           join materials m on m.company_id = v.company_id and m.id = v.material_id
          where v.company_id = $1 and v.deleted_at is null
            and ($2::text = '' or v.plant_id = $2)
            and ($3::text = '' or v.status = $3)
            and ($4::text = '' or v.customer_id = $4)
          order by v.period_start desc, v.commitment_no`,
        [
          context.tenant.companyId,
          filters.plantId ?? '',
          filters.status ?? '',
          filters.customerId ?? '',
        ],
      ),
    );
    return rows.map(this.toCommitment);
  };

  createVolumeCommitment = async (
    context: B1Context,
    payload: {
      plantId: string;
      commitmentNo: string;
      customerId: string;
      contractId?: string | null;
      materialId: string;
      committedQuantityM3: number;
      periodStart: string;
      periodEnd: string;
      specialPrice: number;
      notes?: string;
    },
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.pricing, 'create a volume commitment');
    this.assertPlant(context, payload.plantId);
    if (
      !Number.isFinite(payload.committedQuantityM3) ||
      payload.committedQuantityM3 <= 0 ||
      !Number.isFinite(payload.specialPrice) ||
      payload.specialPrice <= 0 ||
      !payload.periodStart ||
      !payload.periodEnd ||
      payload.periodEnd < payload.periodStart
    ) {
      throw new M1Error('validation_error', 422, 'commitment quantity, price and period are required');
    }
    const id = newId('VCM');
    return this.db.withTenant(context.tenant, async (tx) => {
      const customer = await this.readCustomer(tx, context, payload.customerId);
      if (customer.plant_id && customer.plant_id !== payload.plantId) {
        throw new M1Error('plant_scope', 403, 'customer belongs to another plant');
      }
      if (payload.contractId) {
        const contract = await tx.unsafe<Row>(
          `select id, customer_id, status from contracts
            where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, payload.contractId],
        );
        if (!contract[0]) throw new M1Error('contract_not_found', 404, 'contract does not exist');
        if (str(contract[0].customer_id) !== payload.customerId) {
          throw new M1Error('customer_mismatch', 422, 'contract belongs to another customer');
        }
      }
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from volume_commitments where company_id = $1
               and lower(commitment_no) = lower($2) and deleted_at is null`,
            [context.tenant.companyId, payload.commitmentNo.trim()],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_commitment', 422, 'commitment number must be unique');
      }
      await tx.unsafe(
        `insert into volume_commitments (id, company_id, plant_id, commitment_no, customer_id,
            contract_id, material_id, committed_quantity_m3, period_start, period_end, special_price,
            notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.commitmentNo.trim(),
          payload.customerId,
          payload.contractId ?? null,
          payload.materialId,
          payload.committedQuantityM3,
          payload.periodStart,
          payload.periodEnd,
          payload.specialPrice,
          payload.notes ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.commitment_created', id, {
        commitmentNo: payload.commitmentNo,
      });
      return this.readCommitment(tx, context, id);
    });
  };

  private readCommitment = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<Record<string, unknown>> => {
    const rows = await tx.unsafe<Row>(
      `select v.id, v.plant_id, v.commitment_no, v.customer_id, c.name_ar as customer_name,
              v.contract_id, v.material_id, m.material_code, m.name_en as material_name,
              v.committed_quantity_m3::text as committed_quantity_m3,
              v.fulfilled_quantity_m3::text as fulfilled_quantity_m3,
              v.period_start::text as period_start, v.period_end::text as period_end,
              v.special_price::text as special_price, v.status, v.notes
         from volume_commitments v
         join customers c on c.company_id = v.company_id and c.id = v.customer_id
         join materials m on m.company_id = v.company_id and m.id = v.material_id
        where v.company_id = $1 and v.id = $2 and v.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('commitment_not_found', 404, 'commitment does not exist');
    return this.toCommitment(rows[0]);
  };

  private commitmentTransition = async (
    context: B1Context,
    id: string,
    to: CommitmentStatus,
    reason: string,
  ): Promise<Record<string, unknown>> =>
    this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select status from volume_commitments
          where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      if (!rows[0]) throw new M1Error('commitment_not_found', 404, 'commitment does not exist');
      const from = str(rows[0].status) as CommitmentStatus;
      if (!canCommitmentTransition(from, to)) {
        throw new M1Error('invalid_transition', 409, `commitment ${id} is ${from}`, { from, to });
      }
      await tx.unsafe(
        `update volume_commitments set status = $3, updated_by = $4
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, to, context.actor.username],
      );
      await audit(tx, context, `sales.commitment_${to}`, id, { reason });
      return this.readCommitment(tx, context, id);
    });

  activateCommitment = async (context: B1Context, id: string): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.pricing, 'activate a volume commitment');
    return this.commitmentTransition(context, id, 'active', 'activated');
  };

  breachCommitment = async (
    context: B1Context,
    id: string,
    reason: string,
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.supersede, 'record a commitment breach');
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'a breach needs a reason', { field: 'reason' });
    }
    return this.commitmentTransition(context, id, 'breached', reason);
  };

  expireCommitment = async (
    context: B1Context,
    id: string,
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.approve, 'expire a volume commitment');
    return this.commitmentTransition(context, id, 'expired', 'expired');
  };

  cancelCommitment = async (
    context: B1Context,
    id: string,
    reason: string,
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.pricing, 'cancel a volume commitment');
    return this.commitmentTransition(context, id, 'cancelled', reason);
  };

  // -------------------------------------------------------------- M8 seasonal prices

  listSeasonalPrices = async (
    context: B1Context,
    filters: { plantId?: string; materialId?: string; customerId?: string } = {},
  ): Promise<Array<Record<string, unknown>>> => {
    this.level(context, CRM_LEVELS.read, 'read seasonal prices');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select s.id, s.plant_id, s.customer_id, c.name_ar as customer_name, s.material_id,
                m.material_code, m.name_en as material_name,
                s.season_start::text as season_start, s.season_end::text as season_end,
                s.unit_price::text as unit_price, s.status, s.notes
           from seasonal_prices s
           join materials m on m.company_id = s.company_id and m.id = s.material_id
           left join customers c on c.company_id = s.company_id and c.id = s.customer_id
          where s.company_id = $1 and s.deleted_at is null
            and ($2::text = '' or s.plant_id = $2)
            and ($3::text = '' or s.material_id = $3)
            and ($4::text = '' or s.customer_id = $4)
          order by s.season_start desc`,
        [
          context.tenant.companyId,
          filters.plantId ?? '',
          filters.materialId ?? '',
          filters.customerId ?? '',
        ],
      ),
    );
    return rows.map((row) => ({
      id: str(row.id),
      plant_id: str(row.plant_id),
      customer_id: nullable(row.customer_id),
      customer_name: str(row.customer_name),
      material_id: str(row.material_id),
      material_code: str(row.material_code),
      material_name: str(row.material_name),
      season_start: str(row.season_start),
      season_end: str(row.season_end),
      unit_price: num(row.unit_price),
      status: str(row.status),
      notes: str(row.notes),
    }));
  };

  createSeasonalPrice = async (
    context: B1Context,
    payload: {
      plantId: string;
      customerId?: string | null;
      materialId: string;
      seasonStart: string;
      seasonEnd: string;
      unitPrice: number;
      notes?: string;
    },
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.pricing, 'create a seasonal price');
    this.assertPlant(context, payload.plantId);
    const window = checkSeasonWindow(payload.seasonStart, payload.seasonEnd);
    this.enforceCrm(window, context, '');
    if (!Number.isFinite(payload.unitPrice) || payload.unitPrice <= 0) {
      throw new M1Error('positive_value', 422, 'unit price must be positive');
    }
    const id = newId('SEA');
    return this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `insert into seasonal_prices (id, company_id, plant_id, customer_id, material_id,
            season_start, season_end, unit_price, notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.customerId ?? null,
          payload.materialId,
          payload.seasonStart,
          payload.seasonEnd,
          payload.unitPrice,
          payload.notes ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.seasonal_price_created', id, {});
      const rows = await this.listSeasonalPrices(context, { plantId: payload.plantId });
      return rows.find((row) => row.id === id)!;
    });
  };

  // ------------------------------------------------------------------ M8 CRM

  listActivities = async (
    context: B1Context,
    filters: { customerId?: string; activityType?: string; status?: string; plantId?: string } = {},
  ): Promise<Array<Record<string, unknown>>> => {
    this.level(context, CRM_LEVELS.read, 'read customer activities');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select a.id, a.plant_id, a.activity_no, a.customer_id, c.name_ar as customer_name,
                a.activity_type, a.subject, a.description, a.occurred_at::text as occurred_at,
                a.due_at::text as due_at, a.assigned_to, a.status, a.outcome
           from customer_activities a
           join customers c on c.company_id = a.company_id and c.id = a.customer_id
          where a.company_id = $1 and a.deleted_at is null
            and ($2::text = '' or a.customer_id = $2)
            and ($3::text = '' or a.activity_type = $3)
            and ($4::text = '' or a.status = $4)
            and ($5::text = '' or a.plant_id = $5)
          order by a.occurred_at desc`,
        [
          context.tenant.companyId,
          filters.customerId ?? '',
          filters.activityType ?? '',
          filters.status ?? '',
          filters.plantId ?? '',
        ],
      ),
    );
    return rows.map((row) => ({
      id: str(row.id),
      plant_id: str(row.plant_id),
      activity_no: str(row.activity_no),
      customer_id: str(row.customer_id),
      customer_name: str(row.customer_name),
      activity_type: str(row.activity_type),
      subject: str(row.subject),
      description: str(row.description),
      occurred_at: str(row.occurred_at),
      due_at: nullable(row.due_at),
      assigned_to: str(row.assigned_to),
      status: str(row.status),
      outcome: str(row.outcome),
    }));
  };

  createActivity = async (
    context: B1Context,
    payload: {
      plantId: string;
      activityNo?: string;
      customerId: string;
      activityType: string;
      subject: string;
      description?: string;
      occurredAt?: string;
      dueAt?: string | null;
      assignedTo?: string;
    },
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.activity, 'create a customer activity');
    this.assertPlant(context, payload.plantId);
    if (!payload.subject.trim()) {
      throw new M1Error('validation_error', 422, 'subject is required', { field: 'subject' });
    }
    const id = newId('ACT');
    return this.db.withTenant(context.tenant, async (tx) => {
      const number = (payload.activityNo ?? '').trim() || documentNo('ACT');
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from customer_activities where company_id = $1
               and lower(activity_no) = lower($2) and deleted_at is null`,
            [context.tenant.companyId, number],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_activity', 422, 'activity number must be unique');
      }
      await tx.unsafe(
        `insert into customer_activities (id, company_id, plant_id, activity_no, customer_id,
            activity_type, subject, description, occurred_at, due_at, assigned_to, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz, now()),$10,$11,$12,$12)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          number,
          payload.customerId,
          payload.activityType,
          payload.subject.trim(),
          payload.description ?? '',
          payload.occurredAt ?? null,
          payload.dueAt ?? null,
          payload.assignedTo ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.activity_created', id, { activityNo: number });
      return this.readActivity(tx, context, id);
    });
  };

  private readActivity = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<Record<string, unknown>> => {
    const rows = await tx.unsafe<Row>(
      `select a.id, a.plant_id, a.activity_no, a.customer_id, c.name_ar as customer_name,
              a.activity_type, a.subject, a.description, a.occurred_at::text as occurred_at,
              a.due_at::text as due_at, a.assigned_to, a.status, a.outcome
         from customer_activities a
         join customers c on c.company_id = a.company_id and c.id = a.customer_id
        where a.company_id = $1 and a.id = $2 and a.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('activity_not_found', 404, 'activity does not exist');
    return {
      id: str(rows[0].id),
      plant_id: str(rows[0].plant_id),
      activity_no: str(rows[0].activity_no),
      customer_id: str(rows[0].customer_id),
      customer_name: str(rows[0].customer_name),
      activity_type: str(rows[0].activity_type),
      subject: str(rows[0].subject),
      description: str(rows[0].description),
      occurred_at: str(rows[0].occurred_at),
      due_at: nullable(rows[0].due_at),
      assigned_to: str(rows[0].assigned_to),
      status: str(rows[0].status),
      outcome: str(rows[0].outcome),
    };
  };

  closeActivity = async (
    context: B1Context,
    id: string,
    status: 'done' | 'cancelled',
    outcome = '',
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.activity, 'close a customer activity');
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select status from customer_activities where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      if (!rows[0]) throw new M1Error('activity_not_found', 404, 'activity does not exist');
      if (!canActivityTransition(str(rows[0].status) as 'open', status)) {
        throw new M1Error('invalid_transition', 409, `activity ${id} is ${str(rows[0].status)}`);
      }
      await tx.unsafe(
        `update customer_activities set status = $3, outcome = $4, updated_by = $5
          where company_id = $1 and id = $2`,
        [context.tenant.companyId, id, status, outcome, context.actor.username],
      );
      await audit(tx, context, `sales.activity_${status}`, id, { outcome });
      return this.readActivity(tx, context, id);
    });
  };

  listFeedback = async (
    context: B1Context,
    filters: { customerId?: string; status?: string; plantId?: string } = {},
  ): Promise<Array<Record<string, unknown>>> => {
    this.level(context, CRM_LEVELS.read, 'read customer feedback');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select f.id, f.plant_id, f.customer_id, c.name_ar as customer_name, f.source,
                f.rating_1_to_5, f.category, f.comment, f.submitted_at::text as submitted_at,
                f.handled_by, f.resolution, f.status
           from customer_feedback f
           join customers c on c.company_id = f.company_id and c.id = f.customer_id
          where f.company_id = $1 and f.deleted_at is null
            and ($2::text = '' or f.customer_id = $2)
            and ($3::text = '' or f.status = $3)
            and ($4::text = '' or f.plant_id = $4)
          order by f.submitted_at desc`,
        [
          context.tenant.companyId,
          filters.customerId ?? '',
          filters.status ?? '',
          filters.plantId ?? '',
        ],
      ),
    );
    return rows.map((row) => ({
      id: str(row.id),
      plant_id: str(row.plant_id),
      customer_id: str(row.customer_id),
      customer_name: str(row.customer_name),
      source: str(row.source),
      rating_1_to_5: num(row.rating_1_to_5),
      category: str(row.category),
      comment: str(row.comment),
      submitted_at: str(row.submitted_at),
      handled_by: str(row.handled_by),
      resolution: str(row.resolution),
      status: str(row.status),
    }));
  };

  createFeedback = async (
    context: B1Context,
    payload: {
      plantId: string;
      customerId: string;
      source: string;
      rating: number;
      category?: string;
      comment?: string;
    },
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.activity, 'create customer feedback');
    this.assertPlant(context, payload.plantId);
    this.enforceCrm(checkFeedbackRating(payload.rating), context, '');
    if (!payload.source.trim()) {
      throw new M1Error('validation_error', 422, 'source is required', { field: 'source' });
    }
    const id = newId('FBK');
    return this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `insert into customer_feedback (id, company_id, plant_id, customer_id, source,
            rating_1_to_5, category, comment, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          payload.customerId,
          payload.source.trim(),
          payload.rating,
          payload.category ?? '',
          payload.comment ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.feedback_created', id, { rating: payload.rating });
      return this.readFeedback(tx, context, id);
    });
  };

  private readFeedback = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<Record<string, unknown>> => {
    const rows = await tx.unsafe<Row>(
      `select f.id, f.plant_id, f.customer_id, c.name_ar as customer_name, f.source,
              f.rating_1_to_5, f.category, f.comment, f.submitted_at::text as submitted_at,
              f.handled_by, f.resolution, f.status
         from customer_feedback f
         join customers c on c.company_id = f.company_id and c.id = f.customer_id
        where f.company_id = $1 and f.id = $2 and f.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('feedback_not_found', 404, 'feedback does not exist');
    return {
      id: str(rows[0].id),
      plant_id: str(rows[0].plant_id),
      customer_id: str(rows[0].customer_id),
      customer_name: str(rows[0].customer_name),
      source: str(rows[0].source),
      rating_1_to_5: num(rows[0].rating_1_to_5),
      category: str(rows[0].category),
      comment: str(rows[0].comment),
      submitted_at: str(rows[0].submitted_at),
      handled_by: str(rows[0].handled_by),
      resolution: str(rows[0].resolution),
      status: str(rows[0].status),
    };
  };

  handleFeedback = async (
    context: B1Context,
    id: string,
    payload: { resolution: string; status?: 'handled' | 'closed' },
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.activity, 'handle customer feedback');
    return this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `update customer_feedback set resolution = $3, status = $4, handled_by = $5,
            updated_by = $5 where company_id = $1 and id = $2 and deleted_at is null`,
        [
          context.tenant.companyId,
          id,
          payload.resolution,
          payload.status ?? 'handled',
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.feedback_handled', id, {});
      return this.readFeedback(tx, context, id);
    });
  };

  // --------------------------------------------------------------- M8 complaints

  listComplaints = async (
    context: B1Context,
    filters: { customerId?: string; status?: string; plantId?: string } = {},
  ): Promise<Array<Record<string, unknown>>> => {
    this.level(context, CRM_LEVELS.read, 'read complaints');
    const rows = await this.db.withTenant(context.tenant, (tx) =>
      tx.unsafe<Row>(
        `select k.id, k.plant_id, k.complaint_no, k.feedback_id, k.customer_id,
                c.name_ar as customer_name, k.order_id, o.order_no, k.ticket_id,
                k.quality_related, k.ncr_id, k.severity, k.description,
                k.opened_at::text as opened_at, k.opened_by, k.investigation_notes,
                k.root_cause, k.status, k.rejection_reason, k.closed_at::text as closed_at,
                k.closed_by
           from complaints k
           join customers c on c.company_id = k.company_id and c.id = k.customer_id
           left join orders o on o.company_id = k.company_id and o.id = k.order_id
          where k.company_id = $1 and k.deleted_at is null
            and ($2::text = '' or k.customer_id = $2)
            and ($3::text = '' or k.status = $3)
            and ($4::text = '' or k.plant_id = $4)
          order by k.opened_at desc`,
        [
          context.tenant.companyId,
          filters.customerId ?? '',
          filters.status ?? '',
          filters.plantId ?? '',
        ],
      ),
    );
    return rows.map((row) => ({
      id: str(row.id),
      plant_id: str(row.plant_id),
      complaint_no: str(row.complaint_no),
      feedback_id: nullable(row.feedback_id),
      customer_id: str(row.customer_id),
      customer_name: str(row.customer_name),
      order_id: nullable(row.order_id),
      order_no: nullable(row.order_no),
      ticket_id: nullable(row.ticket_id),
      quality_related: bool(row.quality_related),
      ncr_id: nullable(row.ncr_id),
      severity: str(row.severity),
      description: str(row.description),
      opened_at: str(row.opened_at),
      opened_by: str(row.opened_by),
      investigation_notes: str(row.investigation_notes),
      root_cause: str(row.root_cause),
      status: str(row.status) as ComplaintStatus,
      rejection_reason: nullable(row.rejection_reason),
      closed_at: nullable(row.closed_at),
      closed_by: nullable(row.closed_by),
    }));
  };

  createComplaint = async (
    context: B1Context,
    payload: {
      plantId: string;
      complaintNo?: string;
      feedbackId?: string | null;
      customerId: string;
      orderId?: string | null;
      ticketId?: string | null;
      qualityRelated?: boolean;
      ncrId?: string | null;
      severity?: string;
      description: string;
    },
  ): Promise<Record<string, unknown>> => {
    this.level(context, CRM_LEVELS.activity, 'open a complaint');
    this.assertPlant(context, payload.plantId);
    if (!payload.description.trim()) {
      throw new M1Error('validation_error', 422, 'description is required', { field: 'description' });
    }
    const ncr = checkComplaintNcr(payload.qualityRelated === true, payload.ncrId ?? null);
    this.enforceCrm(ncr, context, '');
    const id = newId('CMP');
    return this.db.withTenant(context.tenant, async (tx) => {
      if (payload.ncrId) {
        const ncrRows = await tx.unsafe<Row>(
          `select id from ncr where company_id = $1 and id = $2 and plant_id = $3`,
          [context.tenant.companyId, payload.ncrId, payload.plantId],
        );
        if (!ncrRows[0]) throw new M1Error('ncr_not_found', 404, 'NCR does not exist');
      }
      if (payload.feedbackId) {
        const fb = await tx.unsafe<Row>(
          `select customer_id from customer_feedback
            where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, payload.feedbackId],
        );
        if (!fb[0]) throw new M1Error('feedback_not_found', 404, 'feedback does not exist');
        if (str(fb[0].customer_id) !== payload.customerId) {
          throw new M1Error('customer_mismatch', 422, 'feedback belongs to another customer');
        }
      }
      const number = (payload.complaintNo ?? '').trim() || documentNo('CMP');
      const duplicate =
        (
          await tx.unsafe<Row>(
            `select 1 from complaints where company_id = $1 and lower(complaint_no) = lower($2)
               and deleted_at is null`,
            [context.tenant.companyId, number],
          )
        ).length > 0;
      if (duplicate) {
        throw new M1Error('duplicate_complaint', 422, 'complaint number must be unique');
      }
      await tx.unsafe(
        `insert into complaints (id, company_id, plant_id, complaint_no, feedback_id, customer_id,
            order_id, ticket_id, quality_related, ncr_id, severity, description, opened_by,
            created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13)`,
        [
          id,
          context.tenant.companyId,
          payload.plantId,
          number,
          payload.feedbackId ?? null,
          payload.customerId,
          payload.orderId ?? null,
          payload.ticketId ?? null,
          payload.qualityRelated === true,
          payload.ncrId ?? null,
          payload.severity ?? 'medium',
          payload.description.trim(),
          context.actor.username,
        ],
      );
      await audit(tx, context, 'sales.complaint_opened', id, { complaintNo: number });
      return this.readComplaint(tx, context, id);
    });
  };

  private readComplaint = async (
    tx: Executor,
    context: B1Context,
    id: string,
  ): Promise<Record<string, unknown>> => {
    const rows = await tx.unsafe<Row>(
      `select k.id, k.plant_id, k.complaint_no, k.feedback_id, k.customer_id,
              c.name_ar as customer_name, k.order_id, o.order_no, k.ticket_id,
              k.quality_related, k.ncr_id, k.severity, k.description,
              k.opened_at::text as opened_at, k.opened_by, k.investigation_notes,
              k.root_cause, k.status, k.rejection_reason, k.closed_at::text as closed_at,
              k.closed_by
         from complaints k
         join customers c on c.company_id = k.company_id and c.id = k.customer_id
         left join orders o on o.company_id = k.company_id and o.id = k.order_id
        where k.company_id = $1 and k.id = $2 and k.deleted_at is null`,
      [context.tenant.companyId, id],
    );
    if (!rows[0]) throw new M1Error('complaint_not_found', 404, 'complaint does not exist');
    return {
      id: str(rows[0].id),
      plant_id: str(rows[0].plant_id),
      complaint_no: str(rows[0].complaint_no),
      feedback_id: nullable(rows[0].feedback_id),
      customer_id: str(rows[0].customer_id),
      customer_name: str(rows[0].customer_name),
      order_id: nullable(rows[0].order_id),
      order_no: nullable(rows[0].order_no),
      ticket_id: nullable(rows[0].ticket_id),
      quality_related: bool(rows[0].quality_related),
      ncr_id: nullable(rows[0].ncr_id),
      severity: str(rows[0].severity),
      description: str(rows[0].description),
      opened_at: str(rows[0].opened_at),
      opened_by: str(rows[0].opened_by),
      investigation_notes: str(rows[0].investigation_notes),
      root_cause: str(rows[0].root_cause),
      status: str(rows[0].status) as ComplaintStatus,
      rejection_reason: nullable(rows[0].rejection_reason),
      closed_at: nullable(rows[0].closed_at),
      closed_by: nullable(rows[0].closed_by),
    };
  };

  transitionComplaint = async (
    context: B1Context,
    id: string,
    to: ComplaintStatus,
    payload: { reason?: string; investigationNotes?: string; rootCause?: string } = {},
  ): Promise<Record<string, unknown>> => {
    const required = to === 'resolved' || to === 'closed' || to === 'rejected' ? CRM_LEVELS.approve : CRM_LEVELS.pricing;
    this.level(context, required, `${to} a complaint`);
    if (to === 'rejected' && (payload.reason ?? '').trim().length < MIN_OVERRIDE_REASON) {
      throw new M1Error('validation_error', 422, 'rejection reason is required', { field: 'reason' });
    }
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select status from complaints where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      if (!rows[0]) throw new M1Error('complaint_not_found', 404, 'complaint does not exist');
      const from = str(rows[0].status) as ComplaintStatus;
      if (!canComplaintTransition(from, to)) {
        throw new M1Error('invalid_transition', 409, `complaint ${id} is ${from}`, { from, to });
      }
      await tx.unsafe(
        `update complaints
            set status = $3,
                investigation_notes = case when $4::text = '' then investigation_notes else $4 end,
                root_cause = case when $5::text = '' then root_cause else $5 end,
                rejection_reason = case when $3 = 'rejected' then $6 else rejection_reason end,
                closed_at = case when $3 in ('closed', 'rejected') then now() else closed_at end,
                closed_by = case when $3 in ('closed', 'rejected') then $7 else closed_by end,
                updated_by = $7
          where company_id = $1 and id = $2`,
        [
          context.tenant.companyId,
          id,
          to,
          payload.investigationNotes ?? '',
          payload.rootCause ?? '',
          payload.reason ?? '',
          context.actor.username,
        ],
      );
      await audit(tx, context, `sales.complaint_${to}`, id, { reason: payload.reason ?? '' });
      return this.readComplaint(tx, context, id);
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
     values ($1,$2,$3,$4,$5,'sales',$6,$7,$8,$9::jsonb)`,
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
