/**
 * M1 HTTP API. Mounted only when the durable adapter is active; in demo/test mode
 * these routes answer 503 `postgres_required` instead of pretending to persist.
 */
import type { Db, TenantContext } from '../db/client';
import { M1Error, M1Service, type Actor } from '../services/m1';
import type { SafeUser } from '../auth';
import type { RoleLevel } from '../../src/types';
import type { ChequeStatus } from '../../src/core/cheques';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  json({ error: code, ...extra }, status);

export interface M1Deps {
  db: Db;
  auth: (request: Request, minLevel: RoleLevel) => { ok: true; user: SafeUser } | { ok: false; response: Response };
  requireDb: () => Response | null;
}

const contextFor = (user: SafeUser, request: Request): { tenant: TenantContext; actor: Actor } => ({
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
  },
});

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const parsed = await request.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export const handleM1 = async (request: Request, deps: M1Deps): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.startsWith('/api/m1')) return null;

  const unavailable = deps.requireDb();
  if (unavailable) return unavailable;

  const method = request.method.toUpperCase();
  const service = new M1Service(deps.db);

  // Returns the authenticated context or the exact denial response (401 vs 403).
  const guarded = (minLevel: RoleLevel): ReturnType<typeof contextFor> | Response => {
    const auth = deps.auth(request, minLevel);
    return auth.ok ? contextFor(auth.user, request) : auth.response;
  };

  try {
    // ------------------------------------------------------------- journal
    if (path === '/api/m1/journal' && method === 'GET') {
      const context = guarded(2);
      if (context instanceof Response) return context;
      const entries = await service.listJournal(context, {
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        limit: url.searchParams.get('limit') ? num(url.searchParams.get('limit')) : undefined,
      });
      return json({ entries });
    }

    if (path === '/api/m1/journal' && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      const entry = await service.postJournal(context, {
        entryDate: str(payload.entryDate) || new Date().toISOString().slice(0, 10),
        memoAr: str(payload.memoAr),
        memoEn: str(payload.memoEn),
        plantId: payload.plantId ? str(payload.plantId) : null,
        sourceType: str(payload.sourceType) || 'manual',
        sourceId: payload.sourceId ? str(payload.sourceId) : null,
        lines: lines.map((line) => {
          const row = line as Record<string, unknown>;
          return {
            accountCode: str(row.accountCode),
            debit: num(row.debit),
            credit: num(row.credit),
            descriptionAr: str(row.descriptionAr),
            descriptionEn: str(row.descriptionEn),
            plantId: row.plantId ? str(row.plantId) : null,
          };
        }),
      });
      return json({ entry }, 201);
    }

    const reverseMatch = /^\/api\/m1\/journal\/(\d+)\/reverse$/.exec(path);
    if (reverseMatch && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const entry = await service.reverseJournal(context, Number(reverseMatch[1]), {
        ar: str(payload.memoAr) || 'قيد عكسي',
        en: str(payload.memoEn) || 'Reversing entry',
      });
      return json({ entry }, 201);
    }

    if (path === '/api/m1/trial-balance' && method === 'GET') {
      const context = guarded(2);
      if (context instanceof Response) return context;
      return json(await service.trialBalance(context, {
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
      }));
    }

    if (path === '/api/m1/ledger' && method === 'GET') {
      const context = guarded(2);
      if (context instanceof Response) return context;
      const account = url.searchParams.get('account');
      if (!account) return fail(400, 'account_required');
      return json(await service.generalLedger(context, account, {
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
      }));
    }

    // ------------------------------------------------------------ invoices
    if (path === '/api/m1/invoices' && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const invoice = await service.createInvoice(context, {
        customerId: str(payload.customerId),
        invoiceNo: str(payload.invoiceNo),
        issueDate: str(payload.issueDate),
        dueDate: str(payload.dueDate),
        plantId: payload.plantId ? str(payload.plantId) : null,
        taxPercent: payload.taxPercent === undefined ? 14 : num(payload.taxPercent),
        retentionPercent: payload.retentionPercent === undefined ? 0 : num(payload.retentionPercent),
        depositAmount: payload.depositAmount === undefined ? 0 : num(payload.depositAmount),
        items: items.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            quantity: num(row.quantity),
            unitPrice: num(row.unitPrice),
            descriptionAr: str(row.descriptionAr),
            descriptionEn: str(row.descriptionEn),
          };
        }),
      });
      return json(invoice, 201);
    }

    const invoicePost = /^\/api\/m1\/invoices\/([^/]+)\/post$/.exec(path);
    if (invoicePost && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      return json(await service.postInvoice(context, invoicePost[1] ?? ''));
    }

    if (path === '/api/m1/aging' && method === 'GET') {
      const context = guarded(2);
      if (context instanceof Response) return context;
      return json(await service.aging(context, url.searchParams.get('asOf') ?? undefined));
    }

    if (path === '/api/m1/payments' && method === 'POST') {
      const context = guarded(2);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const methodValue = str(payload.method);
      return json(
        await service.receivePayment(context, {
          customerId: str(payload.customerId),
          amount: num(payload.amount),
          method: methodValue === 'cash' || methodValue === 'cheque' ? methodValue : 'bank',
          paymentDate: str(payload.paymentDate) || new Date().toISOString().slice(0, 10),
          reference: str(payload.reference),
          bankAccountId: payload.bankAccountId ? str(payload.bankAccountId) : undefined,
          chequeId: payload.chequeId ? str(payload.chequeId) : undefined,
        }),
        201,
      );
    }

    // ------------------------------------------------------------- cheques
    const chequeTransition = /^\/api\/m1\/cheques\/([^/]+)\/transition$/.exec(path);
    if (chequeTransition && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const to = str(payload.to) as ChequeStatus;
      return json(
        await service.transitionCheque(context, chequeTransition[1] ?? '', to, {
          fee: payload.fee === undefined ? 0 : num(payload.fee),
          accountId: payload.accountId ? str(payload.accountId) : undefined,
          note: str(payload.note),
        }),
      );
    }

    // -------------------------------------------------------------- assets
    if (path === '/api/m1/assets' && method === 'POST') {
      const context = guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const category = str(payload.category);
      return json(
        await service.createAsset(context, {
          code: str(payload.code),
          nameAr: str(payload.nameAr),
          nameEn: str(payload.nameEn),
          category:
            category === 'vehicle' || category === 'it' || category === 'building' || category === 'other'
              ? category
              : 'plant_equipment',
          purchaseDate: str(payload.purchaseDate),
          purchaseCost: num(payload.purchaseCost),
          residualValue: payload.residualValue === undefined ? 0 : num(payload.residualValue),
          usefulLifeMonths: num(payload.usefulLifeMonths, 60),
        }),
        201,
      );
    }

    const depreciate = /^\/api\/m1\/assets\/([^/]+)\/depreciate$/.exec(path);
    if (depreciate && method === 'POST') {
      const context = guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        await service.depreciate(
          context,
          depreciate[1] ?? '',
          str(payload.throughPeriod) || new Date().toISOString().slice(0, 7) + '-01',
        ),
      );
    }

    // --------------------------------------------------------------- loans
    if (path === '/api/m1/loans' && method === 'POST') {
      const context = guarded(5);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        await service.createLoan(context, {
          bankNameAr: str(payload.bankNameAr),
          bankNameEn: str(payload.bankNameEn),
          principal: num(payload.principal),
          annualRate: num(payload.annualRate),
          termMonths: num(payload.termMonths, 12),
          startDate: str(payload.startDate) || new Date().toISOString().slice(0, 10),
        }),
        201,
      );
    }

    const loanInstallments = /^\/api\/m1\/loans\/([^/]+)\/installments$/.exec(path);
    if (loanInstallments && method === 'GET') {
      const context = guarded(2);
      if (context instanceof Response) return context;
      return json({ installments: await service.loanInstallments(context, loanInstallments[1] ?? '') });
    }

    // --------------------------------------------------------- procurement
    if (path === '/api/m1/purchase-orders' && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      return json(
        await service.createPurchaseOrder(context, {
          supplierId: str(payload.supplierId),
          poNo: str(payload.poNo),
          orderDate: str(payload.orderDate) || new Date().toISOString().slice(0, 10),
          plantId: payload.plantId ? str(payload.plantId) : null,
          lines: lines.map((line) => {
            const row = line as Record<string, unknown>;
            return {
              quantity: num(row.quantity),
              unitPrice: num(row.unitPrice),
              descriptionAr: str(row.descriptionAr),
              descriptionEn: str(row.descriptionEn),
              materialCode: str(row.materialCode),
            };
          }),
        }),
        201,
      );
    }

    if (path === '/api/m1/supplier-bills' && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      return json(
        await service.createSupplierBill(context, {
          supplierId: str(payload.supplierId),
          purchaseOrderId: str(payload.purchaseOrderId),
          billNo: str(payload.billNo),
          billDate: str(payload.billDate) || new Date().toISOString().slice(0, 10),
          dueDate: str(payload.dueDate) || new Date().toISOString().slice(0, 10),
          lines: lines.map((line) => {
            const row = line as Record<string, unknown>;
            return { quantity: num(row.quantity), unitPrice: num(row.unitPrice) };
          }),
        }),
        201,
      );
    }

    const billMatch = /^\/api\/m1\/supplier-bills\/([^/]+)\/match$/.exec(path);
    if (billMatch && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      return json(await service.matchSupplierBill(context, billMatch[1] ?? ''));
    }

    const billApprove = /^\/api\/m1\/supplier-bills\/([^/]+)\/approve$/.exec(path);
    if (billApprove && method === 'POST') {
      const context = guarded(5);
      if (context instanceof Response) return context;
      return json(await service.approveSupplierBill(context, billApprove[1] ?? ''));
    }

    // ------------------------------------------------------------ treasury
    if (path === '/api/m1/bank-reconciliations' && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      const statement = Array.isArray(payload.statement) ? payload.statement : [];
      return json(
        await service.reconcileBank(context, str(payload.accountId), {
          periodStart: str(payload.periodStart),
          periodEnd: str(payload.periodEnd),
          statementBalance: num(payload.statementBalance),
          statement: statement.map((line) => {
            const row = line as Record<string, unknown>;
            return {
              id: str(row.id),
              txnDate: str(row.txnDate),
              direction: row.direction === 'out' ? 'out' : 'in',
              amount: num(row.amount),
              reference: str(row.reference),
            };
          }),
        }),
        201,
      );
    }

    if (path === '/api/m1/cash-closings' && method === 'POST') {
      const context = guarded(4);
      if (context instanceof Response) return context;
      const payload = await body(request);
      return json(
        await service.cashDailyClosing(context, str(payload.accountId), str(payload.date), num(payload.countedBalance)),
        201,
      );
    }

    return fail(404, 'not_found');
  } catch (error) {
    if (error instanceof M1Error) {
      return fail(error.status, error.code, error.details ?? {});
    }
    console.error('[ICONCRETE M1] unhandled error', error);
    return fail(500, 'internal_error');
  }
};

export const postgresRequired = (): Response =>
  fail(503, 'postgres_required', {
    message:
      'M1 accounting endpoints require the durable PostgreSQL adapter. Set ICONCRETE_STORAGE_MODE=postgres and DATABASE_URL.',
  });
