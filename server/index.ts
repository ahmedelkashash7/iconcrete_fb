import {
  appendAudit,
  createStore,
  readEnv,
  type AppEnv,
  type AppStore,
} from './store';
import { authenticate, extractBearer, resolveSession, revokeSession, toSafeUser } from './auth';
import { buildErrorWorkbook, buildTemplateWorkbook, parseUpload } from './excel';
import { buildCustomersWorkbook, buildReportWorkbook } from './export';
import { buildReport, monthlySeries, REPORT_TYPES, type ReportType } from '../src/core/reports';
import { buildAlerts, balanceFor, computeKpis } from '../src/core/metrics';
import { customerOutstanding } from '../src/core/credit';
import { TEMPLATES, templateById } from '../src/core/excelSchema';
import { validateRows, type ReferenceIndex, type ValidationContext } from '../src/core/validation';
import { canExportReports } from '../src/core/rbac';
import type { Customer, InventoryItem, Lang, Material, RoleLevel } from '../src/types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
  handle: (request: Request) => Promise<Response>;
}

export const createApp = async (env: AppEnv = readEnv()): Promise<App> => {
  const store = await createStore(env);
  const captchas = new Map<string, Captcha>();
  const failedAttempts = new Map<string, number>();

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

  const sessionFor = (
    request: Request,
    minLevel: RoleLevel,
  ):
    | { ok: true; user: ReturnType<typeof toSafeUser>; roleLevel: RoleLevel }
    | { ok: false; response: Response } => {
    const lookup = resolveSession(store, extractBearer(request), {
      idleMinutes: env.idleMinutes,
      minLevel,
    });
    if (!lookup.ok) {
      return {
        ok: false,
        response: fail(lookup.code === 'forbidden' ? 403 : 401, lookup.code),
      };
    }
    return { ok: true, user: toSafeUser(lookup.user), roleLevel: lookup.user.role_level };
  };

  const customerRows = () =>
    store.dataset.customers.map((customer) => {
      const plant = store.dataset.plants.find((candidate) => candidate.id === customer.plant_id);
      const outstanding = customerOutstanding(customer.id, store.dataset.invoices);
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
        return json({
          status: 'ok',
          phase: 1,
          brand: { name: 'ICONCRETE', tagline: 'Concrete Management Solutions' },
          store: 'in-memory-demo',
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

      if (path === '/api/auth/login' && method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const company = String(body.company ?? '');
        const username = String(body.username ?? '');
        const password = String(body.password ?? '');
        const captcha = body.captcha as { challengeId?: string; answer?: string } | undefined;

        if (!company || !username || !password) {
          return fail(400, 'missing_credentials');
        }

        const requiresCaptcha = (failedAttempts.get(username.toLowerCase()) ?? 0) >= 3;
        if (requiresCaptcha) {
          const challengeId = captcha?.challengeId ?? '';
          const challenge = captchas.get(challengeId);
          if (!challenge || challenge.expiresAt < Date.now()) {
            return fail(400, 'captcha_required');
          }
          const answer = Number(captcha?.answer ?? '');
          if (!Number.isFinite(answer) || answer !== challenge.answer) {
            captchas.delete(challengeId);
            return fail(400, 'captcha_invalid');
          }
          captchas.delete(challengeId);
        }

        const result = await authenticate(
          store,
          { company, username, password, ip: clientIp(request), device: request.headers.get('user-agent') ?? 'unknown' },
          env,
        );

        if (!result.ok) {
          failedAttempts.set(username.toLowerCase(), (failedAttempts.get(username.toLowerCase()) ?? 0) + 1);
          const status = result.code === 'account_locked' ? 423 : 401;
          return json(
            {
              error: result.code,
              failedAttempts: result.failedAttempts,
              lockedUntil: result.lockedUntil ?? null,
              captchaRequired: (failedAttempts.get(username.toLowerCase()) ?? 0) >= 3,
            },
            status,
          );
        }

        failedAttempts.delete(username.toLowerCase());
        return json({
          token: result.token,
          expiresAt: result.expiresAt,
          user: result.user,
          company: { name_ar: result.companyNameAr, name_en: result.companyNameEn },
        });
      }

      if (path === '/api/auth/me' && method === 'GET') {
        const session = sessionFor(request, 1);
        if (!session.ok) return session.response;
        return json({
          user: session.user,
          company: { name_ar: store.dataset.company.name_ar, name_en: store.dataset.company.name_en },
        });
      }

      if (path === '/api/auth/logout' && method === 'POST') {
        const token = extractBearer(request);
        if (token) {
          const lookup = resolveSession(store, token, { idleMinutes: env.idleMinutes });
          if (lookup.ok) {
            appendAudit(store, {
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
        return json({ ok: true });
      }

      if (path === '/api/dashboard' && method === 'GET') {
        const session = sessionFor(request, 1);
        if (!session.ok) return session.response;
        const kpis = computeKpis(store.dataset);
        const balance = balanceFor(store.dataset);
        const restricted = session.roleLevel < 2;
        const qualityTests = store.dataset.qualityTests
          .slice()
          .sort((a, b) => (a.tested_at < b.tested_at ? 1 : -1))
          .slice(0, 8);

        return json({
          kpis,
          balance: restricted ? null : balance,
          balanceRestricted: restricted,
          alerts: buildAlerts(store.dataset),
          qualityTests,
          series: monthlySeries(store.dataset, 6),
          company: { name_ar: store.dataset.company.name_ar, name_en: store.dataset.company.name_en },
          plants: store.dataset.plants,
          generatedAt: new Date().toISOString(),
        });
      }

      if (path === '/api/customers' && method === 'GET') {
        const session = sessionFor(request, 4);
        if (!session.ok) return session.response;
        return json({ customers: customerRows(), total: store.dataset.customers.length });
      }

      if (path === '/api/plants' && method === 'GET') {
        const session = sessionFor(request, 5);
        if (!session.ok) return session.response;
        return json({ plants: store.dataset.plants });
      }

      if (path === '/api/users' && method === 'GET') {
        const session = sessionFor(request, 5);
        if (!session.ok) return session.response;
        return json({ users: store.users.map((user) => toSafeUser(user)) });
      }

      if (path === '/api/audit' && method === 'GET') {
        const session = sessionFor(request, 5);
        if (!session.ok) return session.response;
        return json({ entries: store.dataset.auditLog.slice(0, 200) });
      }

      if (path.startsWith('/api/reports/') && method === 'GET') {
        const session = sessionFor(request, 1);
        if (!session.ok) return session.response;
        const type = path.replace('/api/reports/', '') as ReportType;
        if (!REPORT_TYPES.includes(type)) return fail(404, 'not_found');
        const range = defaultRange();
        const report = buildReport(type, store.dataset, {
          from: url.searchParams.get('from') ?? range.from,
          to: url.searchParams.get('to') ?? range.to,
          ...(url.searchParams.get('customerId') ? { customerId: url.searchParams.get('customerId') ?? '' } : {}),
        });
        return json({ report, canExport: canExportReports(session.roleLevel) });
      }

      if (path.startsWith('/api/export/reports/') && method === 'GET') {
        const session = sessionFor(request, 2);
        if (!session.ok) return session.response;
        if (!canExportReports(session.roleLevel)) return fail(403, 'forbidden');
        const type = path.replace('/api/export/reports/', '').replace(/\.xlsx$/, '') as ReportType;
        if (!REPORT_TYPES.includes(type)) return fail(404, 'not_found');
        const range = defaultRange();
        const from = url.searchParams.get('from') ?? range.from;
        const to = url.searchParams.get('to') ?? range.to;
        const report = buildReport(type, store.dataset, {
          from,
          to,
          ...(url.searchParams.get('customerId') ? { customerId: url.searchParams.get('customerId') ?? '' } : {}),
        });
        const buffer = await buildReportWorkbook(report, detectLang(request));
        appendAudit(store, {
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
        const session = sessionFor(request, 4);
        if (!session.ok) return session.response;
        const lang = detectLang(request);
        const rows = customerRows().map((row) => ({
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
        appendAudit(store, {
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
        const session = sessionFor(request, 4);
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

      if (path.startsWith('/api/excel/templates/') && path.endsWith('.xlsx') && method === 'GET') {
        const session = sessionFor(request, 4);
        if (!session.ok) return session.response;
        const templateId = path.replace('/api/excel/templates/', '').replace(/\.xlsx$/, '');
        const template = templateById(templateId);
        if (!template) return fail(404, 'not_found');
        const buffer = await buildTemplateWorkbook(template);
        appendAudit(store, {
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
        const session = sessionFor(request, 4);
        if (!session.ok) return session.response;

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

        const bytes = new Uint8Array(await file.arrayBuffer());
        const checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
        let parsed;
        try {
          parsed = await parseUpload(new File([bytes], file.name, { type: file.type }), template);
        } catch {
          return fail(422, 'parse_error');
        }

        if (parsed.records.length === 0) return fail(422, 'no_rows');

        const result = validateRows(template, parsed.records, validationContext(template.id));
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

        appendAudit(store, {
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.validate',
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

        result.rows
          .filter((row) => row.issues.some((issue) => issue.severity === 'error'))
          .slice(0, 50)
          .forEach((row) => {
            appendAudit(store, {
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
        const session = sessionFor(request, 4);
        if (!session.ok) return session.response;
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const stagedId = String(body.stagedId ?? '');
        if (body.confirm !== true) return fail(400, 'confirmation_required');
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

        appendAudit(store, {
          user_id: session.user.id,
          username: session.user.username,
          company_id: session.user.company_id,
          action: 'excel.commit',
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

      if (path.startsWith('/api/excel/errors/') && path.endsWith('.xlsx') && method === 'GET') {
        const session = sessionFor(request, 4);
        if (!session.ok) return session.response;
        const stagedId = path.replace('/api/excel/errors/', '').replace(/\.xlsx$/, '');
        const staged = store.staged.get(stagedId);
        if (!staged) return fail(404, 'not_found');
        const template = templateById(staged.templateId);
        if (!template) return fail(400, 'invalid_template');
        const buffer = await buildErrorWorkbook(staged.result, template, staged.fileName);
        appendAudit(store, {
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

      if (path === '/api/excel/audit' && method === 'GET') {
        const session = sessionFor(request, 4);
        if (!session.ok) return session.response;
        return json({ entries: store.dataset.auditLog.filter((entry) => entry.action.startsWith('excel.')).slice(0, 100) });
      }

      return fail(404, 'not_found');
    } catch (error) {
      console.error('[ICONCRETE API] unhandled error', error);
      return fail(500, 'internal_error');
    }
  };

  return { store, env, handle };
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
  console.log(`ICONCRETE API listening on http://0.0.0.0:${port} (Phase 1, in-memory demo store)`);
}
