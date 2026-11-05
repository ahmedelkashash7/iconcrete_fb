/** M9 procurement API. Every route re-checks the level and the plant scope in the service. */
import { M1Error } from '../services/m1';
import { ProcurementService } from '../services/procurement';
import { contextFor, type B1Deps } from './b1';
import type { RoleLevel } from '../../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  json({ error: code, ...extra }, status);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];

export const handleProcurement = async (request: Request, deps: B1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();
  if (path !== '/api/procurement' && !path.startsWith('/api/procurement/')) return null;

  if (!deps.db) {
    return fail(503, 'postgres_required', {
      message: 'Procurement needs the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres.',
    });
  }

  const service = new ProcurementService(deps.db);
  const guarded = async (minLevel: RoleLevel) => {
    const auth = await deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    if (path === '/api/procurement/suppliers' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const suppliers = await service.listSuppliers(context, {
        q: url.searchParams.get('q') ?? '',
        status: url.searchParams.get('status') ?? '',
        grade: url.searchParams.get('grade') ?? '',
      });
      return json({ suppliers, total: suppliers.length });
    }

    const supplierMatch = /^\/api\/procurement\/suppliers\/([^/]+)$/.exec(path);
    if (supplierMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ supplier: await service.getSupplier(context, decodeURIComponent(supplierMatch[1] ?? '')) });
    }

    const supplierAction = /^\/api\/procurement\/suppliers\/([^/]+)\/(suspend|reactivate)$/.exec(path);
    if (supplierAction && method === 'POST') {
      const context = await guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const id = decodeURIComponent(supplierAction[1] ?? '');
      return json({
        supplier:
          supplierAction[2] === 'suspend'
            ? await service.suspendSupplier(context, id, str(payload.reason))
            : await service.reactivateSupplier(context, id),
      });
    }

    if (path === '/api/procurement/documents' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const document = await service.createDocument(context, {
        plantId: str(payload.plantId),
        supplierId: str(payload.supplierId),
        docType: str(payload.docType) as 'registration' | 'insurance' | 'licence' | 'quality_certificate',
        documentRef: str(payload.documentRef),
        validFrom: str(payload.validFrom),
        validUntil: str(payload.validUntil) || null,
        notes: str(payload.notes),
      });
      return json({ document }, 201);
    }

    const documentAction = /^\/api\/procurement\/documents\/([^/]+)\/(verify|reject|void)$/.exec(path);
    if (documentAction && method === 'POST') {
      const action = documentAction[2]!;
      const context = await guarded(action === 'void' ? 5 : 4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const id = decodeURIComponent(documentAction[1] ?? '');
      const document =
        action === 'verify'
          ? await service.verifyDocument(context, id)
          : action === 'reject'
            ? await service.rejectDocument(context, id, str(payload.reason))
            : await service.voidDocument(context, id, str(payload.reason));
      return json({ document });
    }

    if (path === '/api/procurement/evaluations' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const evaluation = await service.createEvaluation(context, {
        plantId: str(payload.plantId),
        supplierId: str(payload.supplierId),
        evaluationNo: str(payload.evaluationNo),
        periodStart: str(payload.periodStart),
        periodEnd: str(payload.periodEnd),
        quality: num(payload.quality),
        delivery: num(payload.delivery),
        price: num(payload.price),
        responsiveness: num(payload.responsiveness),
        evaluatorId: str(payload.evaluatorId),
        notes: str(payload.notes),
      });
      return json({ evaluation }, 201);
    }

    const evaluationAction = /^\/api\/procurement\/evaluations\/([^/]+)\/(publish|supersede)$/.exec(path);
    if (evaluationAction && method === 'POST') {
      const context = await guarded(evaluationAction[2] === 'publish' ? 4 : 5);
      if (context instanceof Response) return context;
      const id = decodeURIComponent(evaluationAction[1] ?? '');
      const evaluation =
        evaluationAction[2] === 'publish'
          ? await service.publishEvaluation(context, id)
          : await service.supersedeEvaluation(context, id);
      return json({ evaluation });
    }

    if (path === '/api/procurement/contracts' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const contract = await service.createContract(context, {
        plantId: str(payload.plantId),
        supplierId: str(payload.supplierId),
        contractNo: str(payload.contractNo),
        startDate: str(payload.startDate),
        endDate: str(payload.endDate) || null,
        paymentTerms: str(payload.paymentTerms),
        priceAdjustmentClause: str(payload.priceAdjustmentClause),
      });
      return json({ contract }, 201);
    }

    const contractAction = /^\/api\/procurement\/contracts\/([^/]+)\/(sign|activate|expire|void)$/.exec(path);
    if (contractAction && method === 'POST') {
      const action = contractAction[2]!;
      const context = await guarded(action === 'void' ? 5 : action === 'activate' ? 4 : 3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const contract = await service.transitionContract(
        context,
        decodeURIComponent(contractAction[1] ?? ''),
        action === 'sign' ? 'signed' : action === 'activate' ? 'active' : action === 'expire' ? 'expired' : 'void',
        str(payload.reason),
      );
      return json({ contract });
    }

    if (path === '/api/procurement/invoices' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const invoices = await service.listInvoices(context, {
        plantId: url.searchParams.get('plantId') ?? '',
        status: url.searchParams.get('status') ?? '',
        supplierId: url.searchParams.get('supplierId') ?? '',
      });
      return json({ invoices, total: invoices.length });
    }

    if (path === '/api/procurement/invoices' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const invoice = await service.createInvoice(context, {
        plantId: str(payload.plantId),
        supplierId: str(payload.supplierId),
        poId: str(payload.poId) || null,
        invoiceNo: str(payload.invoiceNo),
        invoiceDate: str(payload.invoiceDate),
        dueDate: str(payload.dueDate) || null,
        subtotal: numOrNull(payload.subtotal) ?? undefined,
        taxAmount: numOrNull(payload.taxAmount) ?? 0,
        totalAmount: numOrNull(payload.totalAmount) ?? undefined,
        notes: str(payload.notes),
        reason: str(payload.reason),
        items: rows(payload.items).map((item) => ({
          materialId: str(item.materialId),
          quantity: num(item.quantity),
          unitPrice: num(item.unitPrice),
          ...(item.total === undefined ? {} : { total: num(item.total) }),
        })),
      });
      return json({ invoice }, 201);
    }

    const invoiceMatch = /^\/api\/procurement\/invoices\/([^/]+)$/.exec(path);
    if (invoiceMatch && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      return json({ invoice: await service.getInvoice(context, decodeURIComponent(invoiceMatch[1] ?? '')) });
    }

    const invoiceAction = /^\/api\/procurement\/invoices\/([^/]+)\/(verify|approve|dispute|void)$/.exec(path);
    if (invoiceAction && method === 'POST') {
      const action = invoiceAction[2]!;
      const context = await guarded(action === 'verify' ? 3 : action === 'void' ? 5 : 4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const invoice = await service.transitionInvoice(
        context,
        decodeURIComponent(invoiceAction[1] ?? ''),
        action === 'verify' ? 'verified' : action === 'approve' ? 'approved' : action === 'dispute' ? 'disputed' : 'voided',
        str(payload.reason),
      );
      return json({ invoice });
    }

    if (path === '/api/procurement/payments' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const payments = await service.listVouchers(context, {
        status: url.searchParams.get('status') ?? '',
        paymentType: url.searchParams.get('paymentType') ?? '',
      });
      return json({ payments, total: payments.length });
    }

    if (path === '/api/procurement/payments' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const payment = await service.createVoucher(context, {
        plantId: str(payload.plantId),
        supplierId: str(payload.supplierId) || null,
        customerId: str(payload.customerId) || null,
        purchaseInvoiceId: str(payload.purchaseInvoiceId) || null,
        paymentType:
          payload.paymentType === 'customer_receipt' || payload.paymentType === 'expense'
            ? payload.paymentType
            : 'supplier_payment',
        amount: num(payload.amount),
        currency: str(payload.currency) || 'EGP',
        method:
          payload.method === 'cash' || payload.method === 'cheque' ? payload.method : 'bank_transfer',
        chequeNo: str(payload.chequeNo) || null,
        chequeDueDate: str(payload.chequeDueDate) || null,
        paidAt: str(payload.paidAt) || null,
        notes: str(payload.notes),
      });
      return json({ payment }, 201);
    }

    const paymentAction = /^\/api\/procurement\/payments\/([^/]+)\/(approve|pay|cancel|bounce)$/.exec(path);
    if (paymentAction && method === 'POST') {
      const action = paymentAction[2]!;
      const context = await guarded(action === 'pay' ? 3 : action === 'cancel' ? 5 : 4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const id = decodeURIComponent(paymentAction[1] ?? '');
      const payment =
        action === 'bounce'
          ? await service.bounceCheque(context, id, str(payload.reason))
          : await service.transitionVoucher(
              context,
              id,
              action === 'approve' ? 'approved' : action === 'pay' ? 'paid' : 'cancelled',
              str(payload.reason),
            );
      return json({ payment });
    }

    if (path === '/api/procurement/ap-aging' && method === 'GET') {
      const context = await guarded(1);
      if (context instanceof Response) return context;
      const asOf = url.searchParams.get('asOf') ?? '';
      return json({ rows: await service.apAging(context, asOf || undefined) });
    }

    if (path === '/api/procurement/ap-aging/snapshot' && method === 'POST') {
      const context = await guarded(3);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json({
        snapshot: await service.snapshotAging(
          context,
          str(payload.plantId),
          str(payload.asOf) || undefined,
        ),
      }, 201);
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) {
      return fail(error.status, error.code, { message: error.message, ...(error.details ?? {}) });
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, 'procurement_error', { message });
  }
};
