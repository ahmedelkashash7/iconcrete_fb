/** M7 sales API. Every route re-checks the level and the plant scope in the service. */
import type { SalesOrderStatus } from '../../src/core/sales';
import { M1Error } from '../services/m1';
import { SalesService } from '../services/sales';
import { contextFor, type B1Deps } from './b1';
import type { RoleLevel } from '../../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  json({ error: code, ...extra }, status);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const num = (value: unknown): number => numOrNull(value) ?? Number.NaN;

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

const lines = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];

const orderLines = (value: unknown) =>
  lines(value).map((line) => ({
    materialId: str(line.materialId) || null,
    description: str(line.description),
    quantity: num(line.quantity),
    unitPrice: num(line.unitPrice),
    discountPct: numOrNull(line.discountPct) ?? 0,
    taxRate: numOrNull(line.taxRate) ?? 0,
  }));

export const handleSales = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (path !== '/api/sales' && !path.startsWith('/api/sales/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'Sales needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres.',
    });
  }

  const sales = new SalesService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/sales/customers' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const customers = await sales.listCustomers(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
        blacklisted:
          url.searchParams.get('blacklisted') === '' || url.searchParams.get('blacklisted') === null
            ? undefined
            : url.searchParams.get('blacklisted') === 'true',
        q: url.searchParams.get('q') ?? '',
        minLimit: numOrNull(url.searchParams.get('minLimit')) ?? undefined,
      });
      return json({ customers, total: customers.length, storage: 'postgres' });
    }

    if (path === '/api/sales/customers' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const customer = await sales.createCustomer(context, {
        plantId: str(payload.plantId),
        customerCode: str(payload.customerCode),
        nameAr: str(payload.nameAr),
        nameEn: str(payload.nameEn),
        contactPerson: str(payload.contactPerson),
        phone: str(payload.phone),
        email: str(payload.email),
        billingAddress: str(payload.billingAddress),
        shippingAddress: str(payload.shippingAddress),
        creditLimit: numOrNull(payload.creditLimit),
        currency: str(payload.currency) || 'EGP',
        creditDays: numOrNull(payload.creditDays) ?? 0,
        blacklisted: payload.blacklisted === true,
        blacklistReason: str(payload.blacklistReason),
      });
      return json({ customer }, 201);
    }

    const customerMatch = /^\/api\/sales\/customers\/([^/]+)$/.exec(path);
    if (customerMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ customer: await sales.getCustomer(context, decodeURIComponent(customerMatch[1] ?? '')) });
    }
    if (customerMatch && method === 'PATCH') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const customer = await sales.updateCustomer(context, decodeURIComponent(customerMatch[1] ?? ''), {
        nameAr: payload.nameAr === undefined ? undefined : str(payload.nameAr),
        nameEn: payload.nameEn === undefined ? undefined : str(payload.nameEn),
        contactPerson: payload.contactPerson === undefined ? undefined : str(payload.contactPerson),
        phone: payload.phone === undefined ? undefined : str(payload.phone),
        email: payload.email === undefined ? undefined : str(payload.email),
        billingAddress: payload.billingAddress === undefined ? undefined : str(payload.billingAddress),
        shippingAddress: payload.shippingAddress === undefined ? undefined : str(payload.shippingAddress),
        creditLimit: payload.creditLimit === undefined ? undefined : numOrNull(payload.creditLimit),
        currency: payload.currency === undefined ? undefined : str(payload.currency),
        status: payload.status === undefined ? undefined : str(payload.status),
        blacklisted: payload.blacklisted === undefined ? undefined : payload.blacklisted === true,
        blacklistReason: payload.blacklistReason === undefined ? undefined : str(payload.blacklistReason),
      });
      return json({ customer });
    }

    if (path === '/api/sales/projects' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({
        projects: await sales.listProjects(context, {
          customerId: url.searchParams.get('customerId') ?? '',
          plantId: url.searchParams.get('plantId') ?? '',
          status: url.searchParams.get('status') ?? '',
        }),
      });
    }

    if (path === '/api/sales/projects' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const project = await sales.createProject(context, {
        plantId: str(payload.plantId),
        customerId: str(payload.customerId),
        code: str(payload.code),
        nameAr: str(payload.nameAr),
        nameEn: str(payload.nameEn),
        siteLocation: str(payload.siteLocation),
        contactPerson: str(payload.contactPerson),
        contactPhone: str(payload.contactPhone),
        startDate: str(payload.startDate) || null,
        endDate: str(payload.endDate) || null,
      });
      return json({ project }, 201);
    }

    if (path === '/api/sales/quotations' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const quotations = await sales.listQuotations(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
        customerId: url.searchParams.get('customerId') ?? '',
        q: url.searchParams.get('q') ?? '',
      });
      return json({ quotations, total: quotations.length, storage: 'postgres' });
    }

    if (path === '/api/sales/quotations' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const quotation = await sales.createQuotation(context, {
        plantId: str(payload.plantId),
        quotationNo: str(payload.quotationNo),
        customerId: str(payload.customerId),
        projectId: str(payload.projectId) || null,
        validUntil: str(payload.validUntil),
        currency: str(payload.currency),
        items: orderLines(payload.items),
        reason: str(payload.reason),
      });
      return json({ quotation }, 201);
    }

    const quotationMatch = /^\/api\/sales\/quotations\/([^/]+)$/.exec(path);
    if (quotationMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ quotation: await sales.getQuotation(context, decodeURIComponent(quotationMatch[1] ?? '')) });
    }

    const quotationAction = /^\/api\/sales\/quotations\/([^/]+)\/(submit|approve|revise|cancel)$/.exec(path);
    if (quotationAction && method === 'POST') {
      const action = quotationAction[2]!;
      const context = await guarded(action === 'cancel' ? 5 : action === 'approve' ? 4 : 3);
      if (context instanceof Response) return context;
      const id = decodeURIComponent(quotationAction[1] ?? '');
      const payload = await body(request);
      const quotation =
        action === 'submit'
          ? await sales.submitQuotation(context, id)
          : action === 'approve'
            ? await sales.approveQuotation(context, id, str(payload.reason))
            : action === 'revise'
              ? await sales.reviseQuotation(context, id, str(payload.reason))
              : await sales.cancelQuotation(context, id, str(payload.reason));
      return json({ quotation });
    }

    if (path === '/api/sales/contracts' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({
        contracts: await sales.listContracts(context, {
          plantId: url.searchParams.get('plantId') ?? '',
          status: url.searchParams.get('status') ?? '',
          customerId: url.searchParams.get('customerId') ?? '',
        }),
      });
    }

    if (path === '/api/sales/contracts' && method === 'POST') {
      const context = await guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const contract = await sales.createContract(context, {
        plantId: str(payload.plantId),
        contractNo: str(payload.contractNo),
        quotationVersionId: str(payload.quotationVersionId),
        customerId: str(payload.customerId) || undefined,
        projectId: str(payload.projectId) || null,
        startDate: str(payload.startDate) || null,
        endDate: str(payload.endDate) || null,
        terms: str(payload.terms),
      });
      return json({ contract }, 201);
    }

    const contractMatch = /^\/api\/sales\/contracts\/([^/]+)$/.exec(path);
    if (contractMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ contract: await sales.getContract(context, decodeURIComponent(contractMatch[1] ?? '')) });
    }

    const contractAction = /^\/api\/sales\/contracts\/([^/]+)\/(sign|activate|void)$/.exec(path);
    if (contractAction && method === 'POST') {
      const action = contractAction[2]!;
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const id = decodeURIComponent(contractAction[1] ?? '');
      const payload = await body(request);
      const contract =
        action === 'sign'
          ? await sales.signContract(context, id)
          : action === 'activate'
            ? await sales.activateContract(context, id)
            : await sales.voidContract(context, id, str(payload.reason));
      return json({ contract });
    }

    if (path === '/api/sales/orders' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const orders = await sales.listOrders(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
        customerId: url.searchParams.get('customerId') ?? '',
        q: url.searchParams.get('q') ?? '',
      });
      return json({ orders, total: orders.length, storage: 'postgres' });
    }

    if (path === '/api/sales/orders' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const order = await sales.createSalesOrder(context, {
        plantId: str(payload.plantId),
        orderNo: str(payload.orderNo),
        customerId: str(payload.customerId),
        projectId: str(payload.projectId) || null,
        quotationId: str(payload.quotationId) || null,
        contractId: str(payload.contractId) || null,
        orderDate: str(payload.orderDate) || null,
        deliveryDate: str(payload.deliveryDate) || null,
        items: orderLines(payload.items),
        notes: str(payload.notes),
        reason: str(payload.reason),
      });
      return json({ order }, 201);
    }

    const orderMatch = /^\/api\/sales\/orders\/([^/]+)$/.exec(path);
    if (orderMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ order: await sales.getOrder(context, decodeURIComponent(orderMatch[1] ?? '')) });
    }

    const orderAction =
      /^\/api\/sales\/orders\/([^/]+)\/(confirm|hold|resume|cancel|schedule|start|deliver|invoice|close)$/.exec(
        path,
      );
    if (orderAction && method === 'POST') {
      const action = orderAction[2]!;
      const context = await guarded(['confirm', 'hold', 'resume', 'cancel', 'close'].includes(action) ? 4 : 3);
      if (context instanceof Response) return context;
      const id = decodeURIComponent(orderAction[1] ?? '');
      const payload = await body(request);
      const reason = str(payload.reason);
      const order =
        action === 'confirm'
          ? await sales.confirmOrder(context, id, reason)
          : action === 'hold'
            ? await sales.holdOrder(context, id, reason)
            : action === 'resume'
              ? await sales.resumeOrder(context, id)
              : action === 'cancel'
                ? await sales.cancelOrder(context, id, reason)
                : await sales.advanceOrder(
                    context,
                    id,
                    ({
                      schedule: 'scheduled',
                      start: 'in_production',
                      deliver: 'delivered',
                      invoice: 'invoiced',
                      close: 'closed',
                    }[action] ?? 'draft') as SalesOrderStatus,
                    reason,
                  );
      return json({ order });
    }

    if (path === '/api/sales/tickets' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({
        tickets: await sales.listDeliveryTickets(context, {
          orderId: url.searchParams.get('orderId') ?? '',
          status: url.searchParams.get('status') ?? '',
          plantId: url.searchParams.get('plantId') ?? '',
        }),
      });
    }

    if (path === '/api/sales/tickets' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const ticket = await sales.createDeliveryTicket(context, {
        ticketNo: str(payload.ticketNo),
        orderId: str(payload.orderId),
        tripId: str(payload.tripId),
        truckId: str(payload.truckId),
        driverId: str(payload.driverId) || null,
        ticketDate: str(payload.ticketDate) || undefined,
        ticketTime: str(payload.ticketTime) || null,
        loadedVol: num(payload.loadedVol),
        deliveredVol: numOrNull(payload.deliveredVol) ?? undefined,
        batches: lines(payload.batches).map((batch) => ({
          batchId: str(batch.batchId) || null,
          volumeM3: num(batch.volumeM3),
          pricePerM3: numOrNull(batch.pricePerM3) ?? 0,
        })),
        reason: str(payload.reason),
      });
      return json({ ticket }, 201);
    }

    const ticketMatch = /^\/api\/sales\/tickets\/([^/]+)$/.exec(path);
    if (ticketMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const tickets = await sales.listDeliveryTickets(context, {
        orderId: url.searchParams.get('orderId') ?? '',
      });
      const id = decodeURIComponent(ticketMatch[1] ?? '');
      const ticket = tickets.find((row) => row.id === id);
      if (!ticket) return fail(404, 'ticket_not_found');
      return json({ ticket });
    }

    const ticketAction = /^\/api\/sales\/tickets\/([^/]+)\/(confirm|deliver|void)$/.exec(path);
    if (ticketAction && method === 'POST') {
      const action = ticketAction[2]!;
      const context = await guarded(action === 'void' ? 5 : 3);
      if (context instanceof Response) return context;
      const id = decodeURIComponent(ticketAction[1] ?? '');
      const payload = await body(request);
      const ticket =
        action === 'confirm'
          ? await sales.confirmDeliveryTicket(context, id)
          : action === 'deliver'
            ? await sales.deliverDeliveryTicket(context, id, {
                deliveredVol: numOrNull(payload.deliveredVol) ?? undefined,
                reason: str(payload.reason),
              })
            : await sales.voidDeliveryTicket(context, id, str(payload.reason));
      return json({ ticket });
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) {
      return fail(error.status, error.code, { message: error.message, ...(error.details ?? {}) });
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, 'sales_error', { message });
  }
};
