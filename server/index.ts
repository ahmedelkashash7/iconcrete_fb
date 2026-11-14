import {
  appendAudit,
  createStore,
  readEnv,
  type AppEnv,
  type AppStore,
} from './store';
import {
  authenticate,
  authenticatePg,
  extractBearer,
  extractCookie,
  hashToken,
  resolveSession,
  resolveSessionPg,
  revokeSession,
  revokeSessionPg,
  toSafeUser,
  type AuthRequestMeta,
  type SafeUser,
} from './auth';
import { PgAuthRepository, safeUserFromRow } from './db/authRepo';
import { PgImportRepository } from './db/importRepo';
import { loadDatasetForTenant } from './db/datasetRepo';
import { loadCompanyForTenant, loadPlantsForTenant, loadUsersForTenant } from './db/orgRepo';
import { loadExcelContext } from './db/excelRepo';
import { kpiStates, unavailableKpiStates } from '../src/core/availability';
import { buildErrorCsv, buildErrorWorkbook, buildTemplateWorkbook, parseUpload } from './excel';
import { buildCustomersWorkbook, buildReportWorkbook } from './export';
import { buildReport, monthlySeries, REPORT_TYPES, type ReportType } from '../src/core/reports';
import { buildAlerts, balanceFor, computeKpis } from '../src/core/metrics';
import { customerOutstanding } from '../src/core/credit';
import { TEMPLATES, templateById } from '../src/core/excelSchema';
import { validateRows, type ReferenceIndex, type ValidationContext } from '../src/core/validation';
import { canExportReports } from '../src/core/rbac';
import { createDb, type Db } from './db/client';
import { readStorageSettings, type StorageMode, type StorageSettings } from './db/mode';
import { handleM1, postgresRequired } from './api/m1';
import { handleB1 } from './api/b1';
import { handleRules } from './api/rules';
import { handleMixDesigns } from './api/mixDesigns';
import { handleBatches } from './api/batches';
import { handleQuality } from './api/quality';
import { handleFleet } from './api/fleet';
import { handleDispatch } from './api/dispatch';
import { handleCost } from './api/cost';
import { handleInventory } from './api/inventory';
import { handleSales } from './api/sales';
import { handleProcurement } from './api/procurement';
import { handleCsv } from './api/csv';
import type { Customer, DemoDataset, InventoryItem, Lang, Material, RoleLevel } from '../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SESSION_COOKIE = 'ic_session';
const TOKEN_STORAGE_KEY = 'iconcrete.token';

const html = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );

const secureRequest = (request: Request): boolean =>
  new URL(request.url).protocol === 'https:' ||
  (request.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim() === 'https';

const sessionCookie = (request: Request, token: string, maxAgeSeconds: number): string => {
  const secure = secureRequest(request);
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${secure ? 'None' : 'Lax'}`,
    ...(secure ? ['Secure'] : []),
    `Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`,
  ].join('; ');
};

const withSessionCookie = (
  response: Response,
  request: Request,
  token: string,
  maxAgeSeconds: number,
): Response => {
  response.headers.append('set-cookie', sessionCookie(request, token, maxAgeSeconds));
  return response;
};

const clearSessionCookie = (response: Response, request: Request): Response => {
  const secure = secureRequest(request);
  response.headers.append(
    'set-cookie',
    [
      `${SESSION_COOKIE}=`,
      'Path=/',
      'HttpOnly',
      `SameSite=${secure ? 'None' : 'Lax'}`,
      ...(secure ? ['Secure'] : []),
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ].join('; '),
  );
  return response;
};

const authLog = (
  route: string,
  status: number,
  code: string,
  request: Request,
  detail = '',
): void => {
  const line =
    `[auth] ${route} status=${status} code=${code} ` +
    `bearer=${extractBearer(request) ? 'present' : 'absent'} ` +
    `cookie=${extractCookie(request, SESSION_COOKIE) ? 'present' : 'absent'}` +
    (detail ? ` ${detail}` : '');
  if (status >= 400) console.warn(line);
  else console.log(line);
};

const magicPage = (title: string, body: string): string => `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:1rem;line-height:1.7}a{display:inline-block;padding:.8rem 1.2rem;background:#6d28d9;color:#fff;text-decoration:none;border-radius:.5rem}code{direction:ltr;unicode-bidi:embed}</style>
</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

const magicLinkPage = (url: string, expiresAt: string): string =>
  magicPage(
    'دخول ICONCRETE المباشر',
    `<p>اضغط الرابط التالي مرة واحدة للدخول. ينتهي في <code>${escapeHtml(expiresAt)}</code>.</p>
     <p><a href="${escapeHtml(url)}">افتح ICONCRETE</a></p>
     <p>إذا لم يعمل الرابط، افتح هذا العنوان مباشرة:</p><p><code>${escapeHtml(url)}</code></p>`,
  );

const magicSuccessPage = (token: string): string =>
  magicPage(
    'تم إنشاء الجلسة',
    `<p>جارٍ تحويلك إلى الصفحة الرئيسية…</p>
     <script>
       try { localStorage.setItem('${TOKEN_STORAGE_KEY}', ${JSON.stringify(token)}); } catch (error) {}
       try { localStorage.removeItem('iconcrete.session'); } catch (error) {}
       try { sessionStorage.removeItem('${TOKEN_STORAGE_KEY}'); sessionStorage.removeItem('iconcrete.session'); } catch (error) {}
       location.replace('/#/dashboard');
     </script>
     <noscript>فعّل JavaScript أو استخدم تسجيل الدخول العادي.</noscript>`,
  );

const magicErrorPage = (code: string): string =>
  magicPage(
    'تعذر الدخول',
    `<p>رمز الدخول غير صالح أو انتهت صلاحيته.</p><p><code>${escapeHtml(code)}</code></p>`,
  );

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  json({ error: code, ...extra }, status);

const xlsx = (buffer: Buffer, filename: string): Response =>
  new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': XLSX_TYPE,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });

const clientIp = (request: Request): string =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';

const detectLang = (request: Request): Lang => {
  const url = new URL(request.url);
  return url.searchParams.get('lang') === 'en' ? 'en' : 'ar';
};

const defaultRange = (): { from: string; to: string } => {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
};

interface Captcha {
  answer: number;
  expiresAt: number;
}

export interface App {
  store: AppStore;
  env: AppEnv;
  db: Db | null;
  storageMode: StorageMode;
  handle: (request: Request) => Promise<Response>;
}

export const createApp = async (
  env: AppEnv = readEnv(),
  settings: StorageSettings = readStorageSettings(),
): Promise<App> => {
  const storage = settings;
  const db = await createDb({ mode: storage.mode, databaseUrl: storage.databaseUrl });
  // Durable sessions and audit in postgres mode; the in-memory adapter stays demo/test-only.
  const authRepo = db ? new PgAuthRepository(db) : null;
  const importRepo = db ? new PgImportRepository(db) : null;
  const store = await createStore(env);
  const captchas = new Map<string, Captcha>();
  const failedAttempts = new Map<string, number>();
  const magicTokens = new Map<string, { userId: string; companyId: string; expiresAt: string }>();

  const references = (): ReferenceIndex => ({
    customers: store.dataset.customers.map((customer) => customer.id),
    suppliers: store.dataset.suppliers.map((supplier) => supplier.id),
    materials: store.dataset.materials.map((material) => material.id),
    plants: store.dataset.plants.map((plant) => plant.id),
    mix_designs: [],
    employees: [],
    trucks: store.dataset.trucks.map((truck) => truck.id),
  });

  const existingIdsFor = (templateId: string): string[] => {
    switch (templateId) {
      case 'customers':
        return store.dataset.customers.map((customer) => customer.id);
      case 'suppliers':
        return store.dataset.suppliers.map((supplier) => supplier.id);
      case 'materials':
        return store.dataset.inventory.map((item) => item.id);
      default:
        return store.imports
          .filter((record) => record.templateId === templateId)
          .map((record) => {
            const firstKey = Object.keys(record.values)[0];
            return firstKey ? (record.values[firstKey] ?? '') : '';
          });
    }
  };

  const validationContext = (templateId: string): ValidationContext => ({
    references: references(),
    existingIds: existingIdsFor(templateId),
    credit: store.dataset.customers.map((customer) => ({
      customerId: customer.id,
      creditLimit: customer.credit_limit_egp,
      outstanding: customerOutstanding(customer.id, store.dataset.invoices),
      status: customer.status,
    })),
  });

  const requestMeta = (request: Request): AuthRequestMeta => ({
    ip: clientIp(request),
    device: request.headers.get('user-agent') ?? 'unknown',
    requestId: request.headers.get('x-request-id') ?? null,
  });

  /** Audit events: durable in postgres mode, in-memory only for the demo adapter. */
  const audit = async (entry: Parameters<typeof appendAudit>[1]): Promise<void> => {
    if (authRepo) {
      await authRepo.audit(entry);
      return;
    }
    appendAudit(store, entry);
  };

  const sessionFor = async (
    request: Request,
    minLevel: RoleLevel,
  ): Promise<
    | { ok: true; user: SafeUser; roleLevel: RoleLevel }
    | { ok: false; response: Response; code: string }
  > => {
    // Accept either transport on every request. Bearer is primary in iframe previews;
    // cookie remains available for normal same-origin deployments.
    const token = extractBearer(request) ?? extractCookie(request, SESSION_COOKIE);

    if (authRepo) {
      const lookup = await resolveSessionPg(
        authRepo,
        token,
        { idleMinutes: env.idleMinutes, minLevel },
        requestMeta(request),
      );
      if (!lookup.ok) {
        return {
          ok: false,
          response: fail(lookup.code === 'forbidden' ? 403 : 401, lookup.code),
          code: lookup.code,
        };
      }
      return { ok: true, user: lookup.user, roleLevel: lookup.user.role_level };
    }

    const lookup = resolveSession(store, token, {
      idleMinutes: env.idleMinutes,
      minLevel,
    });
    if (!lookup.ok) {
      return {
        ok: false,
        response: fail(lookup.code === 'forbidden' ? 403 : 401, lookup.code),
        code: lookup.code,
      };
    }
    return { ok: true, user: toSafeUser(lookup.user), roleLevel: lookup.user.role_level };
  };

  // Phase 1 read models are still the demo dataset (company CMP-0001). A session from
  // another company must not read it: filter-free reads used to be a cross-tenant leak.
  const tenantDataGuard = (user: SafeUser): Response | null =>
    authRepo && user.company_id !== store.dataset.company.id
      ? fail(403, 'tenant_data_unavailable', {
          message:
            'This phase serves the demo tenant dataset only. The requested company data is not available yet.',
        })
      : null;

  const tenantContext = (user: SafeUser) => ({
    companyId: user.company_id,
    plantIds: user.assigned_plant_ids ?? [],
    userId: user.id,
  });

  /**
   * Dashboard, reports and customer reads come from PostgreSQL under RLS when a database is
   * configured. The demo dataset is only a fallback for demo/test mode.
   */
  const datasetFor = async (user: SafeUser): Promise<DemoDataset> => {
    if (!db) return store.dataset;
    return loadDatasetForTenant(db, tenantContext(user));
  };

  const customerRows = (dataset: DemoDataset) =>
    dataset.customers.map((customer) => {
      const plant = dataset.plants.find((candidate) => candidate.id === customer.plant_id);
      const outstanding = customerOutstanding(customer.id, dataset.invoices);
      return {
        ...customer,
        plant_ar: plant?.name_ar ?? customer.plant_id,
        plant_en: plant?.name_en ?? customer.plant_id,
        outstanding_amount: outstanding,
        available_credit: Math.round((customer.credit_limit_egp - outstanding) * 100) / 100,
      };
    });

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      if (path === '/api/health') {
        const ping = db ? await db.ping() : null;
        return json({
          status: 'ok',
          phase: 3,
          module: 'M11',
          brand: { name: 'ICONCRETE', tagline: 'Concrete Management Solutions' },
          storage: {
            mode: storage.mode,
            adapter: db ? 'postgres' : 'memory',
            durable: Boolean(db),
            database: ping ? { connected: ping.ok, version: ping.ok ? ping.version : null } : null,
            rls: Boolean(db),
            durableSessions: Boolean(authRepo),
            durableAudit: Boolean(authRepo),
            durableImports: Boolean(importRepo),
            authAdapter: authRepo ? 'postgres' : 'memory',
          },
          // Kept for Phase 1 clients that read this field.
          store: db ? 'postgres' : 'in-memory-demo',
          timestamp: new Date().toISOString(),
        });
      }

      if (path === '/api/auth/captcha' && method === 'POST') {
        const a = 3 + Math.floor(Math.random() * 9);
        const b = 2 + Math.floor(Math.random() * 8);
        const challengeId = crypto.randomUUID();
        captchas.set(challengeId, { answer: a + b, expiresAt: Date.now() + 5 * 60_000 });
        return json({
          challengeId,
          questionAr: `كم يساوي ${a} + ${b}؟`,
          questionEn: `What is ${a} + ${b}?`,
        });
      }

      if (path === '/api/auth/magic' && method === 'GET') {
        if (!env.magicLogin) {
          authLog('auth/magic', 404, 'magic_login_disabled', request);
          return fail(404, 'magic_login_disabled');
        }
        const username = (url.searchParams.get('user') ?? '').trim();
        const companyHint = (url.searchParams.get('company') ?? '').trim();
        if (!username) return fail(400, 'missing_credentials');

        const rawToken = `mg_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
        const tokenHash = hashToken(rawToken);
        let expiresAt: string;

        if (authRepo) {
          const issued = await authRepo.issueMagicToken(username, tokenHash, companyHint, 5);
          if (!issued) {
            authLog('auth/magic', 404, 'magic_user_not_found', request);
            return fail(404, 'magic_user_not_found');
          }
          expiresAt = new Date(issued.expires_at).toISOString();
        } else {
          const candidates = store.users.filter(
            (candidate) => candidate.is_active && candidate.username.toLowerCase() === username.toLowerCase(),
          );
          if (candidates.length !== 1) {
            authLog('auth/magic', 404, 'magic_user_not_found', request);
            return fail(404, 'magic_user_not_found');
          }
          const user = candidates[0];
          if (!user) return fail(404, 'magic_user_not_found');
          expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
          magicTokens.set(tokenHash, {
            userId: user.id,
            companyId: user.company_id,
            expiresAt,
          });
        }

        const base = (process.env.ICONCRETE_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/+$/, '');
        const magicUrl = `${base}/api/auth/magic/consume?token=${encodeURIComponent(rawToken)}`;
        authLog('auth/magic', 200, 'ok', request);

        const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
        if (wantsHtml) return html(magicLinkPage(magicUrl, expiresAt));
        return json({ url: magicUrl, expiresAt });
      }

      if (path === '/api/auth/magic/consume' && method === 'GET') {
        const rawToken = url.searchParams.get('token') ?? '';
        const wantsJson = (request.headers.get('accept') ?? '').includes('application/json') ||
          url.searchParams.get('format') === 'json';
        const magicFailure = (status: number, code: string): Response => {
          authLog('auth/magic/consume', status, code, request);
          return wantsJson ? fail(status, code) : html(magicErrorPage(code), status);
        };

        if (!env.magicLogin) return magicFailure(404, 'magic_login_disabled');
        if (!rawToken) return magicFailure(400, 'magic_token_missing');

        const magicHash = hashToken(rawToken);
        const sessionToken = `ic_${crypto.randomUUID()}${crypto.randomUUID()}`;
        const sessionId = `SES-${crypto.randomUUID().slice(0, 12)}`;
        let sessionExpiresAt: string;
        let user: SafeUser;
        let company: { name_ar: string; name_en: string };

        if (authRepo) {
          const consumed = await authRepo.consumeMagicToken({
            magicHash,
            sessionId,
            sessionHash: hashToken(sessionToken),
            ip: clientIp(request),
            device: request.headers.get('user-agent') ?? 'unknown',
            idleMinutes: env.idleMinutes,
          });
          if (!consumed) return magicFailure(401, 'magic_token_invalid');
          sessionExpiresAt = new Date(consumed.expires_at).toISOString();
          user = safeUserFromRow(consumed) as SafeUser;
          company = { name_ar: consumed.company_name_ar, name_en: consumed.company_name_en };
        } else {
          const stored = magicTokens.get(magicHash);
          const userRecord = stored ? store.users.find((candidate) => candidate.id === stored.userId) : null;
          if (!stored || !userRecord || new Date(stored.expiresAt).getTime() <= Date.now()) {
            if (stored) magicTokens.delete(magicHash);
            return magicFailure(401, 'magic_token_invalid');
          }
          magicTokens.delete(magicHash);
          sessionExpiresAt = new Date(Date.now() + env.idleMinutes * 60_000).toISOString();
          store.sessions.set(hashToken(sessionToken), {
            id: sessionId,
            user_id: userRecord.id,
            token_hash: hashToken(sessionToken),
            ip_address: clientIp(request),
            device_info: request.headers.get('user-agent') ?? 'unknown',
            created_at: new Date().toISOString(),
            expires_at: sessionExpiresAt,
            revoked_at: null,
          });
          user = toSafeUser(userRecord);
          company = { name_ar: store.dataset.company.name_ar, name_en: store.dataset.company.name_en };
        }

        await audit({
          user_id: user.id,
          username: user.username,
          company_id: user.company_id,
          action: 'auth.magic_login',
          table_name: 'sessions',
          record_id: sessionId,
          ip_address: clientIp(request),
          details: { method: 'magic_link', session_id: sessionId },
        });
        authLog('auth/magic/consume', 200, 'ok', request);

        const response = wantsJson
          ? json({ ok: true, token: sessionToken, expiresAt: sessionExpiresAt, user, company })
          : html(magicSuccessPage(sessionToken));
        return withSessionCookie(response, request, sessionToken, env.idleMinutes * 60);
      }

      if (path === '/api/auth/login' && method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const company = String(body.company ?? '');
        const username = String(body.username ?? '');
        const password = String(body.password ?? '');
        const captcha = body.captcha as { challengeId?: string; answer?: string } | undefined;

        if (!company || !username || !password) {
          authLog('auth/login', 400, 'missing_credentials', request);
          return fail(400, 'missing_credentials');
        }

        // Second step is opt-in. It stays disabled until SMTP/OTP delivery exists; the
        // password, lockout and audit controls below remain active either way.
        const requiresCaptcha =
          env.twoFactorEnabled === true && (failedAttempts.get(username.toLowerCase()) ?? 0) >= 3;
        if (requiresCaptcha) {
          const challengeId = captcha?.challengeId ?? '';
          const challenge = captchas.get(challengeId);
          if (!challenge || challenge.expiresAt < Date.now()) {
            authLog('auth/login', 400, 'captcha_required', request);
            return fail(400, 'captcha_required');
          }
          const answer = Number(captcha?.answer ?? '');
          if (!Number.isFinite(answer) || answer !== challenge.answer) {
            captchas.delete(challengeId);
            authLog('auth/login', 400, 'captcha_invalid', request);
            return fail(400, 'captcha_invalid');
          }
          captchas.delete(challengeId);
        }

        const credentials = {
          company,
          username,
          password,
          ip: clientIp(request),
          device: request.headers.get('user-agent') ?? 'unknown',
        };
        const result = authRepo
          ? await authenticatePg(authRepo, credentials, env, requestMeta(request))
          : await authenticate(store, credentials, env);

        if (!result.ok) {
          failedAttempts.set(username.toLowerCase(), (failedAttempts.get(username.toLowerCase()) ?? 0) + 1);
          const status = result.code === 'account_locked' ? 423 : 401;
          authLog(
            'auth/login',
            status,
            result.code,
            request,
            `company=${JSON.stringify(company)} username=${JSON.stringify(username)}`,
          );
          return json(
            {
              error: result.code,
              failedAttempts: result.failedAttempts,
              lockedUntil: result.lockedUntil ?? null,
              captchaRequired:
                env.twoFactorEnabled === true &&
                (failedAttempts.get(username.toLowerCase()) ?? 0) >= 3,
            },
            status,
          );
        }

        failedAttempts.delete(username.toLowerCase());
        authLog('auth/login', 200, 'ok', request);
        return withSessionCookie(
          json({
            token: result.token,
            expiresAt: result.expiresAt,
            user: result.user,
            company: { name_ar: result.companyNameAr, name_en: result.companyNameEn },
          }),
          request,
          result.token,
          env.idleMinutes * 60,
        );
      }

      if (path === '/api/auth/me' && method === 'GET') {
        const session = await sessionFor(request, 1);
        if (!session.ok) {
          authLog('auth/me', session.response.status, session.code, request);
          return session.response;
        }
        authLog('auth/me', 200, 'ok', request);
        const company = db
          ? await loadCompanyForTenant(db, tenantContext(session.user))
          : store.dataset.company;
        return json({
          user: session.user,
          company: {
            name_ar: company?.name_ar ?? '',
            name_en: company?.name_en ?? '',
          },
          storage: db ? 'postgres' : 'memory',
        });
      }

      if (path === '/api/auth/logout' && method === 'POST') {
        const token = extractBearer(request) ?? extractCookie(request, SESSION_COOKIE);
        if (authRepo) {
          // Writes auth.logout + auth.session.revoked; the session is dead immediately.
          await revokeSessionPg(authRepo, token, requestMeta(request));
          return clearSessionCookie(json({ ok: true }), request);
        }
        if (token) {
          const lookup = resolveSession(store, token, { idleMinutes: env.idleMinutes });
          if (lookup.ok) {
            await audit({
              user_id: lookup.user.id,
              username: lookup.user.username,
              company_id: lookup.user.company_id,
              action: 'auth.logout',
              table_name: 'sessions',
              record_id: lookup.session.id,
              ip_address: clientIp(request),
              details: {},
            });
          }
          revokeSession(store, token);
        }
        return clearSessionCookie(json({ ok: true }), request);
      }

      if (path === '/api/dashboard' && method === 'GET') {
        const session = await sessionFor(request, 1);
        if (!session.ok) return session.response;
        let dataset: DemoDataset;
        try {
          dataset = await datasetFor(session.user);
        } catch (error) {
          // A failed read is not a zero: label the source unavailable and say so.
          console.error('[ICONCRETE API] dashboard dataset unavailable', error);
          return json(
            {
              error: 'data_source_unavailable',
              retryable: true,
              message:
                'The database read failed, so KPIs are reported as unavailable instead of zero.',
              dataSource: { mode: storage.mode, adapter: db ? 'postgres' : 'memory' },
              kpiStates: unavailableKpiStates(storage.mode),
            },
            503,
          );
        }
        const kpis = computeKpis(dataset);
        const balance = balanceFor(dataset);
        const restricted = session.roleLevel < 2;
        const qualityTests = dataset.qualityTests
          .slice()
          .sort((a, b) => (a.tested_at < b.tested_at ? 1 : -1))
          .slice(0, 8);

        return json({
          kpis,
          balance: restricted ? null : balance,
          balanceRestricted: restricted,
          alerts: buildAlerts(dataset),
          qualityTests,
          series: monthlySeries(dataset, 6),
          company: { name_ar: dataset.company.name_ar, name_en: dataset.company.name_en },
          plants: dataset.plants,
          generatedAt: new Date().toISOString(),
          storageMode: storage.mode,
          dataSource: {
            mode: storage.mode,
            adapter: db ? 'postgres' : 'memory',
            tables: db ? 'tenant_rls' : 'demo_memory',
          },
          kpiStates: kpiStates(dataset, kpis, storage.mode),
        });
      }

      if (path === '/api/customers' && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const dataset = await datasetFor(session.user);
        return json({ customers: customerRows(dataset), total: dataset.customers.length });
      }

      if (path === '/api/plants' && method === 'GET') {
        const session = await sessionFor(request, 5);
        if (!session.ok) return session.response;
        if (db) {
          const plants = await loadPlantsForTenant(db, tenantContext(session.user));
          return json({
            plants,
            total: plants.length,
            scope: {
              companyId: session.user.company_id,
              plantIds: session.user.assigned_plant_ids,
              plantScoped: session.user.assigned_plant_ids.length > 0,
            },
            storage: 'postgres',
          });
        }
        return json({
          plants: store.dataset.plants,
          total: store.dataset.plants.length,
          storage: 'memory',
        });
      }

      if (path === '/api/users' && method === 'GET') {
        const session = await sessionFor(request, 5);
        if (!session.ok) return session.response;
        if (db) {
          const users = await loadUsersForTenant(db, tenantContext(session.user));
          return json({
            users,
            total: users.length,
            scope: {
              companyId: session.user.company_id,
              plantIds: session.user.assigned_plant_ids,
              plantScoped: session.user.assigned_plant_ids.length > 0,
            },
            storage: 'postgres',
          });
        }
        return json({
          users: store.users.map((user) => toSafeUser(user)),
          total: store.users.length,
          storage: 'memory',
        });
      }

      if (path === '/api/audit' && method === 'GET') {
        const session = await sessionFor(request, 5);
        if (!session.ok) return session.response;
        const entries = authRepo
          ? await authRepo.listAudit(session.user.company_id, 200)
          : store.dataset.auditLog.slice(0, 200);
        return json({ entries });
      }

      if (path.startsWith('/api/reports/') && method === 'GET') {
        const session = await sessionFor(request, 1);
        if (!session.ok) return session.response;
        const type = path.replace('/api/reports/', '') as ReportType;
        if (!REPORT_TYPES.includes(type)) return fail(404, 'not_found');
        const dataset = await datasetFor(session.user);
        const range = defaultRange();
        const reportFrom = url.searchParams.get('from') ?? range.from;
        const reportTo = url.searchParams.get('to') ?? range.to;
        const reportCustomer = url.searchParams.get('customerId') ?? '';
        const report = buildReport(type, dataset, {
          from: reportFrom,
          to: reportTo,
          ...(reportCustomer ? { customerId: reportCustomer } : {}),
        });
        return json({
          report,
          canExport: canExportReports(session.roleLevel),
          generatedAt: new Date().toISOString(),
          dataSource: {
            mode: storage.mode,
            adapter: db ? 'postgres' : 'memory',
            tables: db ? 'tenant_rls' : 'demo_memory',
            report: type,
            filters: { from: reportFrom, to: reportTo, customerId: reportCustomer },
          },
        });
      }

      if (path.startsWith('/api/export/reports/') && method === 'GET') {
        const session = await sessionFor(request, 2);
        if (!session.ok) return session.response;
        if (!canExportReports(session.roleLevel)) return fail(403, 'forbidden');
        const type = path.replace('/api/export/reports/', '').replace(/\.xlsx$/, '') as ReportType;
        if (!REPORT_TYPES.includes(type)) return fail(404, 'not_found');
        const range = defaultRange();
        const from = url.searchParams.get('from') ?? range.from;
        const to = url.searchParams.get('to') ?? range.to;
        const dataset = await datasetFor(session.user);
        const report = buildReport(type, dataset, {
          from,
          to,
          ...(url.searchParams.get('customerId') ? { customerId: url.searchParams.get('customerId') ?? '' } : {}),
        });
        const buffer = await buildReportWorkbook(report, detectLang(request));
        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'report.export',
          table_name: 'reports',
          record_id: type,
          ip_address: clientIp(request),
          details: { type, from, to, rows: report.meta.rowCount },
        });
        return xlsx(buffer, `ICONCRETE_report_${type}_${Date.now()}.xlsx`);
      }

      if (path === '/api/export/customers.xlsx' && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const dataset = await datasetFor(session.user);
        const lang = detectLang(request);
        const rows = customerRows(dataset).map((row) => ({
          id: row.id,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          plantAr: row.plant_ar,
          tier: row.priority_tier,
          creditLimit: row.credit_limit_egp,
          outstanding: row.outstanding_amount,
          available: row.available_credit,
          creditDays: row.credit_days,
          status: row.status,
          phone: row.phone,
        }));
        const buffer = await buildCustomersWorkbook(rows, lang);
        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'report.export',
          table_name: 'customers',
          record_id: 'customers',
          ip_address: clientIp(request),
          details: { rows: rows.length, format: 'xlsx' },
        });
        return xlsx(buffer, `ICONCRETE_customers_${Date.now()}.xlsx`);
      }

      if (path === '/api/excel/templates' && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        return json({
          templates: TEMPLATES.map((template) => ({
            id: template.id,
            entity: template.entity,
            version: template.version,
            sheetName: template.sheetName,
            descriptionAr: template.descriptionAr,
            descriptionEn: template.descriptionEn,
            columnCount: template.columns.length,
          })),
        });
      }

      if (path.startsWith('/api/excel/templates/') && path.endsWith('/dictionary') && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const templateId = path.replace('/api/excel/templates/', '').replace(/\/dictionary$/, '');
        const template = templateById(templateId);
        if (!template) return fail(404, 'not_found');
        return json({
          templateId: template.id,
          entity: template.entity,
          schemaVersion: template.version,
          sheetName: template.sheetName,
          uniqueKeys: template.uniqueKeys,
          requiredFields: template.columns
            .filter((column) => column.required)
            .map((column) => column.key),
          fields: template.columns.map((column) => ({
            key: column.key,
            labelAr: column.labelAr,
            labelEn: column.labelEn,
            type: column.type,
            required: column.required,
            allowedValues: column.enumValues ?? null,
            min: column.min ?? null,
            max: column.max ?? null,
            reference: column.reference ?? null,
            example: column.example,
          })),
        });
      }

      if (path.startsWith('/api/excel/templates/') && path.endsWith('.xlsx') && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const templateId = path.replace('/api/excel/templates/', '').replace(/\.xlsx$/, '');
        const template = templateById(templateId);
        if (!template) return fail(404, 'not_found');
        const buffer = await buildTemplateWorkbook(template);
        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.template_download',
          table_name: 'excel_templates',
          record_id: template.id,
          ip_address: clientIp(request),
          details: { version: template.version },
        });
        return xlsx(buffer, `ICONCRETE_${template.id}_template_v${template.version}.xlsx`);
      }

      if (path === '/api/excel/validate' && method === 'POST') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const scope = tenantDataGuard(session.user);
        if (scope) return scope;

        const form = await request.formData().catch(() => null);
        const file = form?.get('file');
        const templateId = String(form?.get('templateId') ?? '');
        if (!(file instanceof File)) return fail(400, 'file_required');
        const template = templateById(templateId);
        if (!template) return fail(400, 'invalid_template');
        if (file.size > env.maxUploadBytes) return fail(413, 'file_too_large');
        const lowerName = file.name.toLowerCase();
        if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.csv')) {
          return fail(415, 'unsupported_type');
        }

        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.validation_started',
          table_name: 'excel_imports',
          record_id: null,
          ip_address: clientIp(request),
          details: {
            templateId: template.id,
            templateVersion: template.version,
            fileName: file.name,
            bytes: file.size,
          },
        });

        const bytes = new Uint8Array(await file.arrayBuffer());
        const checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
        let parsed;
        try {
          parsed = await parseUpload(new File([bytes], file.name, { type: file.type }), template);
        } catch {
          return fail(422, 'parse_error');
        }

        if (parsed.records.length === 0) return fail(422, 'no_rows');

        // Validate against the caller's tenant rows in postgres mode (never the demo fixture).
        const context = db
          ? await loadExcelContext(db, tenantContext(session.user), template.id)
          : validationContext(template.id);
        const result = validateRows(template, parsed.records, context);
        const stagedId = `STG-${crypto.randomUUID().slice(0, 12)}`;
        store.staged.set(stagedId, {
          id: stagedId,
          templateId: template.id,
          templateVersion: template.version,
          fileName: file.name,
          checksum,
          bytes: file.size,
          createdAt: new Date().toISOString(),
          createdBy: session.user.username,
          result,
          committed: false,
          importedRows: 0,
        });

        // Durable staging (G1): the parsed result survives a restart and is tenant scoped.
        let stagedDuplicate: { duplicate: boolean; id: string } | null = null;
        if (importRepo) {
          const saved = await importRepo.saveStaged(tenantContext(session.user), {
            id: stagedId,
            templateId: template.id,
            templateVersion: template.version,
            fileName: file.name,
            checksum,
            bytes: file.size,
            result,
            plantId:
              session.user.assigned_plant_ids.length === 1
                ? session.user.assigned_plant_ids[0] ?? null
                : null,
          });
          stagedDuplicate = { duplicate: saved.duplicate, id: saved.record.id };
        }

        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.validation_completed',
          table_name: 'excel_imports',
          record_id: stagedId,
          ip_address: clientIp(request),
          details: {
            templateId: template.id,
            templateVersion: template.version,
            fileName: file.name,
            checksum,
            bytes: file.size,
            missingHeaders: parsed.missingHeaders,
            validRows: result.summary.validRows,
            errorRows: result.summary.errorRows,
          },
        });

        const rejected = result.rows
          .filter((row) => row.issues.some((issue) => issue.severity === 'error'))
          .slice(0, 50);
        for (const row of rejected) {
          await audit({
            user_id: session.user.id,
            username: session.user.username,
            company_id: session.user.company_id,
            action: 'excel.row_rejected',
            table_name: 'excel_imports',
            record_id: stagedId,
            ip_address: clientIp(request),
            details: {
              rowNumber: row.rowNumber,
              codes: row.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
              columns: row.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.column),
            },
          });
        }

        if (stagedDuplicate?.duplicate) {
          store.staged.delete(stagedId);
          await audit({
            user_id: session.user.id,
            username: session.user.username,
            company_id: session.user.company_id,
            action: 'excel.duplicate_rejected',
            table_name: 'excel_imports',
            record_id: stagedDuplicate.id,
            ip_address: clientIp(request),
            details: {
              templateId: template.id,
              checksum,
              fileName: file.name,
              reason: 'identical checksum already staged for this tenant and template',
            },
          });
          return fail(409, 'duplicate_import', {
            stagedId: stagedDuplicate.id,
            checksum,
            message:
              'This exact file was already staged. Review or discard the existing upload first.',
          });
        }

        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.staged_created',
          table_name: 'excel_imports',
          record_id: stagedId,
          ip_address: clientIp(request),
          details: {
            templateId: template.id,
            templateVersion: template.version,
            checksum,
            bytes: file.size,
            durable: Boolean(importRepo),
            validRows: result.summary.validRows,
            errorRows: result.summary.errorRows,
          },
        });

        return json({
          stagedId,
          fileName: file.name,
          checksum,
          template: {
            id: template.id,
            version: template.version,
            entity: template.entity,
            sheetName: template.sheetName,
            columns: template.columns,
          },
          result,
          missingHeaders: parsed.missingHeaders,
          checkedAt: new Date().toISOString(),
        });
      }

      if (path === '/api/excel/commit' && method === 'POST') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const scope = tenantDataGuard(session.user);
        if (scope) return scope;
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const stagedId = String(body.stagedId ?? '');
        if (body.confirm !== true) return fail(400, 'confirmation_required');
        if (importRepo) {
          const outcome = await importRepo.commit(tenantContext(session.user), stagedId);
          if (!outcome.ok) return fail(outcome.status, outcome.code);
          await audit({
            user_id: session.user.id,
            username: session.user.username,
            company_id: session.user.company_id,
            action: 'excel.staged_committed',
            table_name: outcome.templateId,
            record_id: stagedId,
            ip_address: clientIp(request),
            details: {
              templateId: outcome.templateId,
              fileName: outcome.fileName,
              importedRows: outcome.importedRows,
              skippedRows: outcome.skippedRows,
              durable: true,
            },
          });
          return json({
            ok: true,
            importedRows: outcome.importedRows,
            skippedRows: outcome.skippedRows,
            stagedId,
            storage: 'postgres',
          });
        }
        const staged = store.staged.get(stagedId);
        if (!staged) return fail(404, 'not_found');
        if (staged.committed) return fail(409, 'already_committed');

        const template = templateById(staged.templateId);
        if (!template) return fail(400, 'invalid_template');
        const validRows = staged.result.rows.filter(
          (row) => !row.issues.some((issue) => issue.severity === 'error'),
        );
        if (validRows.length === 0) return fail(409, 'no_valid_rows');

        const now = new Date().toISOString();
        validRows.forEach((row) => {
          store.imports.push({
            id: `IMP-${crypto.randomUUID().slice(0, 12)}`,
            templateId: template.id,
            values: row.values,
            importedBy: session.user.username,
            importedAt: now,
          });

          if (template.id === 'customers') {
            const customer: Customer = {
              id: row.values.customer_id ?? '',
              company_id: store.dataset.company.id,
              plant_id: row.values.plant_id ?? store.dataset.plants[0]?.id ?? 'PLT-0001',
              name_ar: row.values.name_ar ?? '',
              name_en: row.values.name_en ?? row.values.name_ar ?? '',
              tax_id: row.values.tax_id ?? '',
              phone: row.values.phone ?? '',
              email: row.values.email ?? '',
              address: row.values.address ?? '',
              priority_tier: (row.values.priority_tier === 'B' || row.values.priority_tier === 'C'
                ? row.values.priority_tier
                : 'A'),
              credit_limit_egp: Number(row.values.credit_limit_egp ?? 0),
              credit_days: Number(row.values.credit_days ?? 0),
              status:
                row.values.status === 'suspended' || row.values.status === 'archived'
                  ? row.values.status
                  : 'active',
              data_source: 'import',
              created_at: now,
            };
            store.dataset.customers.push(customer);
          }

          if (template.id === 'materials') {
            const materialId = row.values.material_id ?? '';
            if (!store.dataset.materials.some((material) => material.id === materialId)) {
              const material: Material = {
                id: materialId,
                code: row.values.code ?? materialId,
                name_ar: row.values.name_ar ?? materialId,
                name_en: row.values.name_ar ?? materialId,
                unit: (['ton', 'm3', 'liter', 'kg'] as const).includes(
                  (row.values.unit ?? '') as 'ton' | 'm3' | 'liter' | 'kg',
                )
                  ? ((row.values.unit ?? 'ton') as Material['unit'])
                  : 'ton',
                specific_gravity: Number(row.values.specific_gravity ?? 1),
                reorder_level: Number(row.values.reorder_level ?? 0),
                data_source: 'import',
              };
              store.dataset.materials.push(material);
              const inventoryItem: InventoryItem = {
                id: row.values.balance_id ?? `INV-${material.id}`,
                plant_id: row.values.plant_id ?? 'PLT-0001',
                material_id: material.id,
                quantity: Number(row.values.opening_qty ?? 0),
                unit_cost: Number(row.values.unit_cost ?? 0),
              };
              store.dataset.inventory.push(inventoryItem);
            }
          }
        });

        staged.committed = true;
        staged.importedRows = validRows.length;

        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.staged_committed',
          table_name: template.entity,
          record_id: stagedId,
          ip_address: clientIp(request),
          details: {
            templateId: template.id,
            templateVersion: staged.templateVersion,
            fileName: staged.fileName,
            checksum: staged.checksum,
            importedRows: validRows.length,
            skippedRows: staged.result.summary.errorRows,
          },
        });

        return json({
          ok: true,
          importedRows: validRows.length,
          skippedRows: staged.result.summary.errorRows,
          stagedId,
        });
      }

      if (path === '/api/excel/discard' && method === 'POST') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const scope = tenantDataGuard(session.user);
        if (scope) return scope;
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const stagedId = String(body.stagedId ?? '');
        if (!stagedId) return fail(400, 'staged_id_required');

        if (importRepo) {
          const discarded = await importRepo.discard(tenantContext(session.user), stagedId);
          if (!discarded) return fail(409, 'not_discardable');
        } else {
          const staged = store.staged.get(stagedId);
          if (!staged) return fail(404, 'not_found');
          if (staged.committed) return fail(409, 'already_committed');
          store.staged.delete(stagedId);
        }

        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.staged_discarded',
          table_name: 'excel_imports',
          record_id: stagedId,
          ip_address: clientIp(request),
          details: { durable: Boolean(importRepo) },
        });
        return json({ ok: true, stagedId });
      }

      if (path === '/api/excel/staged' && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const scope = tenantDataGuard(session.user);
        if (scope) return scope;
        if (!importRepo) {
          return json({
            staged: [...store.staged.values()].map((staged) => ({
              id: staged.id,
              templateId: staged.templateId,
              fileName: staged.fileName,
              committed: staged.committed,
              importedRows: staged.importedRows,
              createdAt: staged.createdAt,
            })),
            storage: 'memory',
          });
        }
        const staged = await importRepo.listStaged(tenantContext(session.user));
        return json({ staged, storage: 'postgres' });
      }

      if (path.startsWith('/api/excel/errors/') && path.endsWith('.xlsx') && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const scope = tenantDataGuard(session.user);
        if (scope) return scope;
        const stagedId = path.replace('/api/excel/errors/', '').replace(/\.xlsx$/, '');
        const durable = importRepo
          ? await importRepo.getStaged(tenantContext(session.user), stagedId)
          : null;
        const staged = durable ?? store.staged.get(stagedId) ?? null;
        if (!staged) return fail(404, 'not_found');
        const template = templateById(staged.templateId);
        if (!template) return fail(400, 'invalid_template');
        const buffer = await buildErrorWorkbook(staged.result, template, staged.fileName);
        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.error_report_download',
          table_name: 'excel_imports',
          record_id: stagedId,
          ip_address: clientIp(request),
          details: { fileName: staged.fileName },
        });
        return xlsx(buffer, `ICONCRETE_errors_${template.id}_${Date.now()}.xlsx`);
      }

      if (path.startsWith('/api/excel/errors/') && path.endsWith('.csv') && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const scope = tenantDataGuard(session.user);
        if (scope) return scope;
        const stagedId = path.replace('/api/excel/errors/', '').replace(/\.csv$/, '');
        const durable = importRepo
          ? await importRepo.getStaged(tenantContext(session.user), stagedId)
          : null;
        const staged = durable ?? store.staged.get(stagedId) ?? null;
        if (!staged) return fail(404, 'not_found');
        const template = templateById(staged.templateId);
        if (!template) return fail(400, 'invalid_template');
        const csv = buildErrorCsv(staged.result, template, staged.fileName);
        await audit({
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.error_report_download',
          table_name: 'excel_imports',
          record_id: stagedId,
          ip_address: clientIp(request),
          details: { fileName: staged.fileName, format: 'csv' },
        });
        return new Response(csv, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="ICONCRETE_errors_${template.id}_${Date.now()}.csv"`,
            'cache-control': 'no-store',
          },
        });
      }

      if (path === '/api/excel/audit' && method === 'GET') {
        const session = await sessionFor(request, 4);
        if (!session.ok) return session.response;
        const requested = Number(url.searchParams.get('limit') ?? 100);
        const limit = Number.isFinite(requested) ? requested : 100;
        if (authRepo) {
          // Gap G2: the feed is read from audit_log under RLS; never from process memory.
          const entries = await authRepo.listExcelAudit(tenantContext(session.user), limit);
          return json({ entries, total: entries.length, storage: 'postgres' });
        }
        const scope = tenantDataGuard(session.user);
        if (scope) return scope;
        return json({
          entries: store.dataset.auditLog
            .filter((entry) => entry.action.startsWith('excel.'))
            .slice(0, limit),
          storage: 'memory',
        });
      }

      if (path === '/api/csv' || path.startsWith('/api/csv/')) {
        return (
          (await handleCsv(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (
        path.startsWith('/api/projects') ||
        path.startsWith('/api/orders') ||
        (path === '/api/m1/customers' && method !== 'GET')
      ) {
        return (
          (await handleB1(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/rules' || path.startsWith('/api/rules/')) {
        return (
          (await handleRules(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/mix-designs' || path.startsWith('/api/mix-designs/')) {
        return (
          (await handleMixDesigns(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/fleet' || path.startsWith('/api/fleet/')) {
        return (
          (await handleFleet(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (
        path === '/api/trips' ||
        path.startsWith('/api/trips/') ||
        path === '/api/trucks' ||
        path.startsWith('/api/trucks/')
      ) {
        return (
          (await handleDispatch(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/cost' || path.startsWith('/api/cost/')) {
        return (
          (await handleCost(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/sales' || path.startsWith('/api/sales/')) {
        return (
          (await handleSales(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/procurement' || path.startsWith('/api/procurement/')) {
        return (
          (await handleProcurement(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/inventory' || path.startsWith('/api/inventory/')) {
        return (
          (await handleInventory(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/quality' || path.startsWith('/api/quality/')) {
        return (
          (await handleQuality(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path === '/api/batches' || path.startsWith('/api/batches/')) {
        return (
          (await handleBatches(request, {
            db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
          })) ?? fail(404, 'not_found')
        );
      }

      if (path.startsWith('/api/m1')) {
        return (
          (await handleM1(request, {
            db: db as Db,
            auth: async (req, minLevel) => {
              const session = await sessionFor(req, minLevel);
              return session.ok ? { ok: true, user: session.user } : session;
            },
            requireDb: () => (db ? null : postgresRequired()),
          })) ?? fail(404, 'not_found')
        );
      }

      return fail(404, 'not_found');
    } catch (error) {
      console.error('[ICONCRETE API] unhandled error', error);
      return fail(500, 'internal_error');
    }
  };

  return { store, env, db, storageMode: storage.mode, handle };
};

const serveDist = async (request: Request): Promise<Response | null> => {
  if (process.env.ICONCRETE_SERVE_DIST !== '1') return null;
  const url = new URL(request.url);
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = Bun.file(`./dist${path}`);
  if (await file.exists()) return new Response(file);
  const index = Bun.file('./dist/index.html');
  if (await index.exists()) return new Response(index);
  return null;
};

if (import.meta.main) {
  const app = await createApp();
  const port = Number(process.env.API_PORT ?? 3001);
  Bun.serve({
    port,
    maxRequestBodySize: 8 * 1024 * 1024,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return app.handle(request);
      const staticResponse = await serveDist(request);
      return staticResponse ?? new Response('Not found', { status: 404 });
    },
  });
  console.log(
    `ICONCRETE API listening on http://0.0.0.0:${port} (storage: ${app.storageMode}${app.db ? ', postgres' : ', memory'})`,
  );
  console.log(
    `ICONCRETE login second step: ${app.env.twoFactorEnabled ? 'enabled' : 'disabled'} (ICONCRETE_2FA_ENABLED=${app.env.twoFactorEnabled ? 'true' : 'false'})`,
  );
}
