/**
 * B1 tenant-scoped repositories: projects, orders and customer writes.
 *
 * Every query runs inside db.withTenant(), so PostgreSQL RLS applies to the statement,
 * and every query ALSO carries an explicit company_id predicate plus plant narrowing.
 * Application code never relies on RLS alone (spec §7); RLS is the second line.
 *
 * Money and quantity are numeric in the database and strings in TypeScript. They are
 * never parsed into floats (spec §7).
 */
import { validateOrderTransition, type OrderStatus } from '../../src/core/orders';
import type { Db, Executor, TenantContext } from '../db/client';
import { M1Error, type Actor } from './m1';

export interface B1Context {
  tenant: TenantContext;
  actor: Actor;
}

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const day = (value: unknown): string => (value ? String(value).slice(0, 10) : '');

const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/;
const PRICE = /^\d{1,12}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const audit = async (
  tx: Executor,
  context: B1Context,
  action: string,
  table: string,
  recordId: string | null,
  details: Record<string, unknown>,
): Promise<void> => {
  await tx.unsafe(
    `insert into audit_log (company_id, plant_id, user_id, username, action, table_name, record_id,
       ip_address, request_id, details)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      context.tenant.companyId,
      context.tenant.plantIds[0] ?? null,
      context.actor.userId,
      context.actor.username,
      action,
      table,
      recordId,
      context.actor.ip ?? null,
      context.actor.requestId ?? null,
      JSON.stringify(details),
    ],
  );
};

/** Plant narrowing: an empty assignment means "company-wide" (spec §7). */
const assertPlant = (context: B1Context, plantId: string | null): void => {
  if (!plantId) return;
  const allowed = context.tenant.plantIds;
  if (allowed.length > 0 && !allowed.includes(plantId)) {
    throw new M1Error('forbidden_plant', 403, `plant ${plantId} is outside the caller's scope`);
  }
};

const required = (value: string, field: string): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new M1Error('validation_error', 422, `${field} is required`, { field });
  return trimmed;
};

const uniqueId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const asNumeric = (value: unknown, pattern: RegExp, field: string): string => {
  const raw = str(value).trim();
  if (!pattern.test(raw)) {
    throw new M1Error('validation_error', 422, `${field} must be a positive decimal string`, { field });
  }
  return raw;
};

const asDate = (value: unknown, field: string): string | null => {
  const raw = str(value).trim();
  if (!raw) return null;
  if (!DATE.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new M1Error('validation_error', 422, `${field} must be YYYY-MM-DD`, { field });
  }
  return raw;
};

const asTime = (value: unknown, field: string): string | null => {
  const raw = str(value).trim();
  if (!raw) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    throw new M1Error('validation_error', 422, `${field} must be HH:MM`, { field });
  }
  return raw;
};

const duplicate = (error: unknown, code: string): never => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('duplicate key value')) {
    throw new M1Error(code, 409, 'a record with this code already exists');
  }
  throw error;
};

export interface ProjectRow {
  id: string;
  company_id: string;
  plant_id: string;
  customer_id: string;
  customer_name_ar: string;
  customer_name_en: string;
  code: string;
  name_ar: string;
  name_en: string;
  site_location: string;
  status: string;
  start_date: string;
  end_date: string;
  order_count: number;
  created_at: string;
}

export interface ProjectInput {
  customerId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  siteLocation: string;
  plantId: string | null;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface OrderRow {
  id: string;
  company_id: string;
  plant_id: string;
  customer_id: string;
  customer_name_ar: string;
  customer_name_en: string;
  project_id: string;
  project_code: string;
  order_no: string;
  concrete_grade: string;
  quantity_m3: string;
  unit_price: string;
  total_value: string;
  delivery_date: string;
  pour_window_start: string;
  pour_window_end: string;
  status: string;
  notes: string;
  created_at: string;
}

export interface OrderInput {
  customerId: string;
  projectId: string | null;
  orderNo: string;
  concreteGrade: string;
  quantityM3: string;
  unitPrice: string;
  plantId: string | null;
  deliveryDate?: string;
  pourWindowStart?: string;
  pourWindowEnd?: string;
  notes?: string;
}

const PROJECT_STATUSES = ['draft', 'active', 'on_hold', 'completed', 'cancelled'];

const PROJECT_SELECT = `
  select p.id, p.company_id, p.plant_id, p.customer_id,
         c.name_ar as customer_name_ar, c.name_en as customer_name_en,
         p.code, p.name_ar, p.name_en, p.site_location, p.status,
         p.start_date, p.end_date, p.created_at,
         (select count(*)::int from orders o
           where o.project_id = p.id and o.deleted_at is null) as order_count
    from projects p
    join customers c on c.id = p.customer_id and c.company_id = p.company_id
   where p.company_id = $1 and p.deleted_at is null
     and ($2::text[] = '{}'::text[] or p.plant_id = any($2::text[]))`;

/**
 * The single read model for both projects and orders. Derived values are computed in
 * SQL from the stored numeric columns, never copied into a second column (spec §68A).
 */
const ORDER_SELECT = `
  select o.id, o.company_id, o.plant_id, o.customer_id,
         c.name_ar as customer_name_ar, c.name_en as customer_name_en,
         coalesce(o.project_id, '') as project_id, coalesce(p.code, '') as project_code,
         o.order_no, o.concrete_grade, o.quantity_m3::text as quantity_m3,
         o.unit_price::text as unit_price,
         round(o.quantity_m3 * o.unit_price, 2)::text as total_value,
         o.delivery_date, o.pour_window_start, o.pour_window_end, o.status, o.notes, o.created_at
    from orders o
    join customers c on c.id = o.customer_id and c.company_id = o.company_id
    left join projects p on p.id = o.project_id and p.company_id = o.company_id
   where o.company_id = $1 and o.deleted_at is null
     and ($2::text[] = '{}'::text[] or o.plant_id = any($2::text[]))`;

const mapProject = (row: Row): ProjectRow => ({
  id: str(row.id),
  company_id: str(row.company_id),
  plant_id: str(row.plant_id),
  customer_id: str(row.customer_id),
  customer_name_ar: str(row.customer_name_ar),
  customer_name_en: str(row.customer_name_en),
  code: str(row.code),
  name_ar: str(row.name_ar),
  name_en: str(row.name_en),
  site_location: str(row.site_location),
  status: str(row.status),
  start_date: day(row.start_date),
  end_date: day(row.end_date),
  order_count: num(row.order_count),
  created_at: str(row.created_at),
});

const mapOrder = (row: Row): OrderRow => ({
  id: str(row.id),
  company_id: str(row.company_id),
  plant_id: str(row.plant_id),
  customer_id: str(row.customer_id),
  customer_name_ar: str(row.customer_name_ar),
  customer_name_en: str(row.customer_name_en),
  project_id: str(row.project_id),
  project_code: str(row.project_code),
  order_no: str(row.order_no),
  concrete_grade: str(row.concrete_grade),
  quantity_m3: str(row.quantity_m3),
  unit_price: str(row.unit_price),
  total_value: str(row.total_value),
  delivery_date: day(row.delivery_date),
  pour_window_start: str(row.pour_window_start).slice(0, 5),
  pour_window_end: str(row.pour_window_end).slice(0, 5),
  status: str(row.status),
  notes: str(row.notes),
  created_at: str(row.created_at),
});

export class ProjectsService {
  constructor(private readonly db: Db) {}

  async listProjects(context: B1Context, filters: { customerId?: string; status?: string } = {}): Promise<ProjectRow[]> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `${PROJECT_SELECT}
           and ($3::text = '' or p.customer_id = $3)
           and ($4::text = '' or p.status = $4)
         order by p.code`,
        [context.tenant.companyId, context.tenant.plantIds, filters.customerId ?? '', filters.status ?? ''],
      );
      return rows.map(mapProject);
    });
  }

  async getProject(context: B1Context, id: string): Promise<ProjectRow> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(`${PROJECT_SELECT} and p.id = $3`, [
        context.tenant.companyId,
        context.tenant.plantIds,
        id,
      ]);
      const row = rows[0];
      if (!row) throw new M1Error('not_found', 404, `project ${id} was not found in this company`);
      return mapProject(row);
    });
  }

  async createProject(context: B1Context, input: ProjectInput): Promise<ProjectRow> {
    const code = required(input.code, 'code');
    const nameAr = required(input.nameAr, 'nameAr');
    const nameEn = required(input.nameEn, 'nameEn');
    const customerId = required(input.customerId, 'customerId');
    const status = input.status && PROJECT_STATUSES.includes(input.status) ? input.status : 'draft';
    assertPlant(context, input.plantId);

    const id = uniqueId('PRJ');
    try {
      await this.db.withTenant(context.tenant, async (tx) => {
        const customer = await tx.unsafe<{ id: string }>(
          `select id from customers where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, customerId],
        );
        if (!customer[0]) throw new M1Error('customer_not_found', 422, `customer ${customerId} does not exist`);

        await tx.unsafe(
          `insert into projects (id, company_id, plant_id, customer_id, code, name_ar, name_en,
             site_location, status, start_date, end_date, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
          [
            id,
            context.tenant.companyId,
            input.plantId,
            customerId,
            code,
            nameAr,
            nameEn,
            input.siteLocation.trim(),
            status,
            asDate(input.startDate ?? '', 'startDate'),
            asDate(input.endDate ?? '', 'endDate'),
            context.actor.username,
          ],
        );
        await audit(tx, context, 'project.created', 'projects', id, { code, customerId, status });
      });
    } catch (error) {
      duplicate(error, 'duplicate_project_code');
    }
    return this.getProject(context, id);
  }

  async updateProject(
    context: B1Context,
    id: string,
    patch: Partial<ProjectInput>,
  ): Promise<ProjectRow> {
    const current = await this.getProject(context, id);
    const status = patch.status && PROJECT_STATUSES.includes(patch.status) ? patch.status : current.status;
    if (patch.plantId) assertPlant(context, patch.plantId);

    await this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `update projects
            set name_ar = $3, name_en = $4, site_location = $5, status = $6,
                start_date = $7, end_date = $8, updated_by = $9
          where company_id = $1 and id = $2 and deleted_at is null`,
        [
          context.tenant.companyId,
          id,
          patch.nameAr?.trim() || current.name_ar,
          patch.nameEn?.trim() || current.name_en,
          patch.siteLocation === undefined ? current.site_location : patch.siteLocation.trim(),
          status,
          patch.startDate === undefined ? current.start_date || null : asDate(patch.startDate, 'startDate'),
          patch.endDate === undefined ? current.end_date || null : asDate(patch.endDate, 'endDate'),
          context.actor.username,
        ],
      );
      await audit(tx, context, 'project.updated', 'projects', id, { status, from: current.status });
    });
    return this.getProject(context, id);
  }

  async listOrders(context: B1Context, filters: { customerId?: string; projectId?: string; status?: string } = {}): Promise<OrderRow[]> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `${ORDER_SELECT}
           and ($3::text = '' or o.customer_id = $3)
           and ($4::text = '' or o.project_id = $4)
           and ($5::text = '' or o.status = $5)
         order by o.delivery_date nulls last, o.order_no`,
        [
          context.tenant.companyId,
          context.tenant.plantIds,
          filters.customerId ?? '',
          filters.projectId ?? '',
          filters.status ?? '',
        ],
      );
      return rows.map(mapOrder);
    });
  }

  async getOrder(context: B1Context, id: string): Promise<OrderRow> {
    return this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(`${ORDER_SELECT} and o.id = $3`, [
        context.tenant.companyId,
        context.tenant.plantIds,
        id,
      ]);
      const row = rows[0];
      if (!row) throw new M1Error('not_found', 404, `order ${id} was not found in this company`);
      return mapOrder(row);
    });
  }

  async createOrder(context: B1Context, input: OrderInput): Promise<OrderRow> {
    const customerId = required(input.customerId, 'customerId');
    const orderNo = required(input.orderNo, 'orderNo');
    const grade = required(input.concreteGrade, 'concreteGrade');
    const quantity = asNumeric(input.quantityM3, QUANTITY, 'quantityM3');
    const unitPrice = asNumeric(input.unitPrice, PRICE, 'unitPrice');
    assertPlant(context, input.plantId);

    const deliveryDate = asDate(input.deliveryDate ?? '', 'deliveryDate');
    const windowStart = asTime(input.pourWindowStart ?? '', 'pourWindowStart');
    const windowEnd = asTime(input.pourWindowEnd ?? '', 'pourWindowEnd');
    if (windowStart && windowEnd && windowEnd <= windowStart) {
      throw new M1Error('validation_error', 422, 'pourWindowEnd must be after pourWindowStart', {
        field: 'pourWindowEnd',
      });
    }

    const id = uniqueId('ORD');
    try {
      await this.db.withTenant(context.tenant, async (tx) => {
        const customer = await tx.unsafe<{ id: string }>(
          `select id from customers where company_id = $1 and id = $2 and deleted_at is null`,
          [context.tenant.companyId, customerId],
        );
        if (!customer[0]) throw new M1Error('customer_not_found', 422, `customer ${customerId} does not exist`);

        if (input.projectId) {
          const project = await tx.unsafe<{ id: string; customer_id: string }>(
            `select id, customer_id from projects
              where company_id = $1 and id = $2 and deleted_at is null`,
            [context.tenant.companyId, input.projectId],
          );
          if (!project[0]) throw new M1Error('project_not_found', 422, `project ${input.projectId} does not exist`);
          if (project[0].customer_id !== customerId) {
            throw new M1Error('project_customer_mismatch', 422, 'the project belongs to another customer');
          }
        }

        await tx.unsafe(
          `insert into orders (id, company_id, plant_id, customer_id, project_id, order_no,
             concrete_grade, quantity_m3, unit_price, delivery_date, pour_window_start,
             pour_window_end, status, notes, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10,$11,$12,'draft',$13,$14,$14)`,
          [
            id,
            context.tenant.companyId,
            input.plantId,
            customerId,
            input.projectId,
            orderNo,
            grade,
            quantity,
            unitPrice,
            deliveryDate,
            windowStart,
            windowEnd,
            (input.notes ?? '').trim(),
            context.actor.username,
          ],
        );
        await audit(tx, context, 'order.created', 'orders', id, {
          orderNo,
          customerId,
          quantityM3: quantity,
          unitPrice,
          status: 'draft',
        });
      });
    } catch (error) {
      duplicate(error, 'duplicate_order_no');
    }
    return this.getOrder(context, id);
  }

  /**
   * Server-side lifecycle enforcement (spec §22). An invalid transition is rejected with
   * the allowed set; it is never coerced into a neighbouring status.
   */
  async transitionOrder(context: B1Context, id: string, to: string, note = ''): Promise<OrderRow> {
    const current = await this.getOrder(context, id);
    const rejection = validateOrderTransition(current.status as OrderStatus, to);
    if (rejection) {
      throw new M1Error('invalid_transition', 409, `${current.status} → ${to} is not allowed`, {
        from: rejection.from,
        to: rejection.to,
        allowed: rejection.allowed,
      });
    }

    await this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `update orders set status = $3, updated_by = $4
          where company_id = $1 and id = $2 and deleted_at is null and status = $5`,
        [context.tenant.companyId, id, to, context.actor.username, current.status],
      );
      await audit(tx, context, 'order.transitioned', 'orders', id, {
        from: current.status,
        to,
        note,
      });
    });
    return this.getOrder(context, id);
  }
}

export interface CustomerInput {
  nameAr: string;
  nameEn: string;
  taxId?: string;
  phone?: string;
  email?: string;
  address?: string;
  priorityTier?: string;
  creditDays?: number;
  creditLimitEgp?: string;
  status?: string;
  plantId?: string | null;
}

const TIERS = ['A', 'B', 'C'];
const CUSTOMER_STATUSES = ['active', 'suspended', 'archived'];

/**
 * Customer writes (spec §57 criterion 6). Rows land in the same `customers` table that
 * every list, detail and statement read model already reads, so an edit cannot leave a
 * stale copy behind anywhere.
 */
export class CustomerService {
  constructor(private readonly db: Db) {}

  async createCustomer(context: B1Context, input: CustomerInput): Promise<{ id: string }> {
    const nameAr = required(input.nameAr, 'nameAr');
    const nameEn = required(input.nameEn || input.nameAr, 'nameEn');
    assertPlant(context, input.plantId ?? null);
    const id = uniqueId('CUS');

    await this.db.withTenant(context.tenant, async (tx) => {
      await tx.unsafe(
        `insert into customers (id, company_id, plant_id, name_ar, name_en, tax_id, phone, email,
           address, priority_tier, credit_days, status, data_source, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active','manual',$12,$12)`,
        [
          id,
          context.tenant.companyId,
          input.plantId ?? null,
          nameAr,
          nameEn,
          (input.taxId ?? '').trim(),
          (input.phone ?? '').trim(),
          (input.email ?? '').trim(),
          (input.address ?? '').trim(),
          input.priorityTier && TIERS.includes(input.priorityTier) ? input.priorityTier : 'A',
          Math.max(0, Math.min(365, Math.trunc(input.creditDays ?? 0))),
          context.actor.username,
        ],
      );
      if (input.creditLimitEgp !== undefined) {
        await tx.unsafe(
          `insert into customer_credit_limits (id, company_id, customer_id, credit_limit, effective_from, created_by)
           values ($1,$2,$3,$4::numeric,current_date,$5)`,
          [uniqueId('CCL'), context.tenant.companyId, id, asNumeric(input.creditLimitEgp, PRICE, 'creditLimitEgp'), context.actor.username],
        );
      }
      await audit(tx, context, 'customer.created', 'customers', id, { nameAr, nameEn });
    });
    return { id };
  }

  async updateCustomer(context: B1Context, id: string, patch: Partial<CustomerInput>): Promise<{ id: string }> {
    await this.db.withTenant(context.tenant, async (tx) => {
      const rows = await tx.unsafe<Row>(
        `select id, name_ar, name_en, tax_id, phone, email, address, priority_tier,
                credit_days, status
           from customers where company_id = $1 and id = $2 and deleted_at is null`,
        [context.tenant.companyId, id],
      );
      const current = rows[0];
      if (!current) throw new M1Error('not_found', 404, `customer ${id} was not found in this company`);

      await tx.unsafe(
        `update customers
            set name_ar = $3, name_en = $4, tax_id = $5, phone = $6, email = $7, address = $8,
                priority_tier = $9, credit_days = $10, status = $11, updated_by = $12
          where company_id = $1 and id = $2 and deleted_at is null`,
        [
          context.tenant.companyId,
          id,
          patch.nameAr?.trim() || str(current.name_ar),
          patch.nameEn?.trim() || str(current.name_en),
          patch.taxId === undefined ? str(current.tax_id) : patch.taxId.trim(),
          patch.phone === undefined ? str(current.phone) : patch.phone.trim(),
          patch.email === undefined ? str(current.email) : patch.email.trim(),
          patch.address === undefined ? str(current.address) : patch.address.trim(),
          patch.priorityTier && TIERS.includes(patch.priorityTier) ? patch.priorityTier : str(current.priority_tier),
          patch.creditDays === undefined
            ? num(current.credit_days)
            : Math.max(0, Math.min(365, Math.trunc(patch.creditDays))),
          patch.status && CUSTOMER_STATUSES.includes(patch.status) ? patch.status : str(current.status),
          context.actor.username,
        ],
      );

      if (patch.creditLimitEgp !== undefined) {
        // Close the open limit and open a new one: credit history is never overwritten.
        await tx.unsafe(
          `update customer_credit_limits set effective_to = current_date
            where company_id = $1 and customer_id = $2 and effective_to is null`,
          [context.tenant.companyId, id],
        );
        await tx.unsafe(
          `insert into customer_credit_limits (id, company_id, customer_id, credit_limit, effective_from, created_by)
           values ($1,$2,$3,$4::numeric,current_date,$5)`,
          [uniqueId('CCL'), context.tenant.companyId, id, asNumeric(patch.creditLimitEgp, PRICE, 'creditLimitEgp'), context.actor.username],
        );
      }

      await audit(tx, context, 'customer.updated', 'customers', id, {
        fields: Object.keys(patch),
      });
    });
    return { id };
  }
}
