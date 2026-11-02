/**
 * B1 HTTP API: projects, orders and customer writes.
 *
 * Reads are level 2 (operator and above); every write is level 4 (plant manager),
 * per the RBAC matrix in PART 2.2 and spec §22. Commands run only against the durable
 * adapter: in demo mode they answer 503 instead of pretending to persist.
 */
import type { Db } from '../db/client';
import { M1Error, type Actor } from '../services/m1';
import { CustomerService, ProjectsService, type B1Context } from '../services/projects';
import type { SafeUser } from '../auth';
import type { RoleLevel } from '../../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  json({ error: code, ...extra }, status);

export interface B1Deps {
  db: Db | null;
  auth: (
    request: Request,
    minLevel: RoleLevel,
  ) => Promise<{ ok: true; user: SafeUser } | { ok: false; response: Response }>;
}

export const contextFor = (user: SafeUser, request: Request): B1Context => ({
  tenant: {
    companyId: user.company_id,
    plantIds: user.assigned_plant_ids,
    userId: user.id,
    requestId: request.headers.get('x-request-id') ?? undefined,
  },
  actor: {
    userId: user.id,
    username: user.username,
    roleLevel: user.role_level,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1',
    requestId: request.headers.get('x-request-id') ?? undefined,
  } satisfies Actor,
});

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export const handleB1 = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  const ownsProjects = path === '/api/projects' || /^\/api\/projects\/[^/]+$/.test(path);
  const ownsOrders =
    path === '/api/orders' || /^\/api\/orders\/[^/]+$/.test(path) || /^\/api\/orders\/[^/]+\/transition$/.test(path);
  const ownsCustomerWrite =
    (path === '/api/m1/customers' && method === 'POST') ||
    (/^\/api\/m1\/customers\/[^/]+$/.test(path) && (method === 'PATCH' || method === 'PUT'));

  if (!ownsProjects && !ownsOrders && !ownsCustomerWrite) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message:
        'Projects, orders and customer writes need the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres and DATABASE_URL.',
    });
  }

  const db = deps.db;
  const projects = new ProjectsService(db);
  const customers = new CustomerService(db);

  const guarded = async (minLevel: RoleLevel): Promise<B1Context | Response> => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    // ------------------------------------------------------------- projects
    if (path === '/api/projects' && method === 'GET') {
      const context = await guarded(2);
      if (context instanceof Response) return context;
      const rows = await projects.listProjects(context, {
        customerId: url.searchParams.get('customerId') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
      });
      return json({ projects: rows, total: rows.length, storage: 'postgres' });
    }

    if (path === '/api/projects' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const project = await projects.createProject(context, {
        customerId: str(payload.customerId),
        code: str(payload.code),
        nameAr: str(payload.nameAr),
        nameEn: str(payload.nameEn),
        siteLocation: str(payload.siteLocation),
        plantId: payload.plantId ? str(payload.plantId) : null,
        ...(payload.status ? { status: str(payload.status) } : {}),
        ...(payload.startDate ? { startDate: str(payload.startDate) } : {}),
        ...(payload.endDate ? { endDate: str(payload.endDate) } : {}),
      });
      return json({ project }, 201);
    }

    const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (projectMatch && method === 'GET') {
      const context = await guarded(2);
      if (context instanceof Response) return context;
      return json({ project: await projects.getProject(context, projectMatch[1] ?? '') });
    }

    if (projectMatch && (method === 'PATCH' || method === 'PUT')) {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const project = await projects.updateProject(context, projectMatch[1] ?? '', {
        ...(payload.nameAr === undefined ? {} : { nameAr: str(payload.nameAr) }),
        ...(payload.nameEn === undefined ? {} : { nameEn: str(payload.nameEn) }),
        ...(payload.siteLocation === undefined ? {} : { siteLocation: str(payload.siteLocation) }),
        ...(payload.status === undefined ? {} : { status: str(payload.status) }),
        ...(payload.startDate === undefined ? {} : { startDate: str(payload.startDate) }),
        ...(payload.endDate === undefined ? {} : { endDate: str(payload.endDate) }),
      });
      return json({ project });
    }

    // --------------------------------------------------------------- orders
    if (path === '/api/orders' && method === 'GET') {
      const context = await guarded(2);
      if (context instanceof Response) return context;
      const rows = await projects.listOrders(context, {
        customerId: url.searchParams.get('customerId') ?? undefined,
        projectId: url.searchParams.get('projectId') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
      });
      return json({ orders: rows, total: rows.length, storage: 'postgres' });
    }

    if (path === '/api/orders' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const order = await projects.createOrder(context, {
        customerId: str(payload.customerId),
        projectId: payload.projectId ? str(payload.projectId) : null,
        orderNo: str(payload.orderNo),
        concreteGrade: str(payload.concreteGrade),
        quantityM3: str(payload.quantityM3),
        unitPrice: str(payload.unitPrice),
        plantId: payload.plantId ? str(payload.plantId) : null,
        deliveryDate: str(payload.deliveryDate),
        pourWindowStart: str(payload.pourWindowStart),
        pourWindowEnd: str(payload.pourWindowEnd),
        notes: str(payload.notes),
      });
      return json({ order }, 201);
    }

    const orderTransition = /^\/api\/orders\/([^/]+)\/transition$/.exec(path);
    if (orderTransition && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const order = await projects.transitionOrder(
        context,
        orderTransition[1] ?? '',
        str(payload.to),
        str(payload.note),
      );
      return json({ order });
    }

    const orderMatch = /^\/api\/orders\/([^/]+)$/.exec(path);
    if (orderMatch && method === 'GET') {
      const context = await guarded(2);
      if (context instanceof Response) return context;
      return json({ order: await projects.getOrder(context, orderMatch[1] ?? '') });
    }

    // ---------------------------------------------------- customer writes
    if (path === '/api/m1/customers' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const created = await customers.createCustomer(context, {
        nameAr: str(payload.nameAr),
        nameEn: str(payload.nameEn),
        taxId: str(payload.taxId),
        phone: str(payload.phone),
        email: str(payload.email),
        address: str(payload.address),
        priorityTier: str(payload.priorityTier),
        ...(payload.creditDays === undefined ? {} : { creditDays: Number(payload.creditDays) }),
        ...(payload.creditLimitEgp === undefined ? {} : { creditLimitEgp: String(payload.creditLimitEgp) }),
        plantId: payload.plantId ? str(payload.plantId) : null,
      });
      return json(created, 201);
    }

    const customerMatch = /^\/api\/m1\/customers\/([^/]+)$/.exec(path);
    if (customerMatch) {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const updated = await customers.updateCustomer(context, customerMatch[1] ?? '', {
        ...(payload.nameAr === undefined ? {} : { nameAr: str(payload.nameAr) }),
        ...(payload.nameEn === undefined ? {} : { nameEn: str(payload.nameEn) }),
        ...(payload.taxId === undefined ? {} : { taxId: str(payload.taxId) }),
        ...(payload.phone === undefined ? {} : { phone: str(payload.phone) }),
        ...(payload.email === undefined ? {} : { email: str(payload.email) }),
        ...(payload.address === undefined ? {} : { address: str(payload.address) }),
        ...(payload.priorityTier === undefined ? {} : { priorityTier: str(payload.priorityTier) }),
        ...(payload.creditDays === undefined ? {} : { creditDays: Number(payload.creditDays) }),
        ...(payload.creditLimitEgp === undefined ? {} : { creditLimitEgp: String(payload.creditLimitEgp) }),
        ...(payload.status === undefined ? {} : { status: str(payload.status) }),
      });
      return json(updated);
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) return fail(error.status, error.code, error.details ?? {});
    console.error('[ICONCRETE B1] unhandled error', error);
    return fail(500, 'internal_error');
  }
};
