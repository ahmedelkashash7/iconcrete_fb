import { beforeAll, describe, expect, test } from 'bun:test';
import { createApp, type App } from '../server/index';
import type { AppEnv } from '../server/store';

const env: AppEnv = {
  environment: 'development',
  adminPassword: 'Demo@2026',
  idleMinutes: 30,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  maxUploadBytes: 2 * 1024 * 1024,
  // This file pins the opt-in second step; application defaults keep it off.
  twoFactorEnabled: true,
};

interface LoginBody {
  token?: string;
  expiresAt?: string;
  user?: { username: string; role_level: number };
  error?: string;
  captchaRequired?: boolean;
}

interface ValidateBody {
  stagedId: string;
  result: {
    summary: { totalRows: number; validRows: number; errorRows: number; errorCount: number };
    rows: Array<{ rowNumber: number; issues: Array<{ code: string; severity: string }> }>;
  };
  missingHeaders: string[];
}

const CSV_UPLOAD = `customer_id,name_ar,name_en,tax_id,phone,email,address,priority_tier,credit_limit_egp,credit_days,status,plant_id
CUS-2000,شركة اختبار الاستيراد,Import Test Co,TAX-2000,+201000000099,import@example.com,القاهرة,A,1000000,30,active,PLT-0001
BAD,,Bad Co,TAX-2001,+201000000098,bad@example.com,القاهرة,Z,-5,999,weird,PLT-9999
`;

describe('ICONCRETE API', () => {
  let app: App;

  beforeAll(async () => {
    app = await createApp(env);
  });

  const call = (path: string, init: RequestInit = {}) =>
    app.handle(new Request(`http://localhost${path}`, init));

  const login = async (
    username: string,
    password = 'Demo@2026',
    captcha?: { challengeId: string; answer: string },
    company = 'ICONCRETE Demo Company',
  ) => {
    const response = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company,
        username,
        password,
        ...(captcha ? { captcha } : {}),
      }),
    });
    const body = (await response.json()) as LoginBody;
    return { response, body };
  };

  const adminToken = async (): Promise<string> => {
    const { body } = await login('admin');
    if (!body.token) throw new Error('admin login failed');
    return body.token;
  };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  test('health endpoint reports the locked brand', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      brand: { name: string; tagline: string };
      phase: number;
      storage: { mode: string; adapter: string; durable: boolean };
    };
    expect(body.brand.name).toBe('ICONCRETE');
    expect(body.brand.tagline).toBe('Concrete Management Solutions');
    expect(body.phase).toBe(2);
    // Default mode for the test process is the in-memory adapter, reported explicitly.
    expect(body.storage.mode).toBe('demo');
    expect(body.storage.adapter).toBe('memory');
    expect(body.storage.durable).toBe(false);
  });

  test('admin can sign in and receives a session token', async () => {
    const { response, body } = await login('admin');
    expect(response.status).toBe(200);
    expect(body.token?.startsWith('ic_')).toBe(true);
    expect(body.user?.role_level).toBe(5);
    expect(new Date(body.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  test('a saved company label with different qualifiers still signs in', async () => {
    const arabicReportLabel = await login('admin', 'Demo@2026', undefined, 'IConcrete التجربة');
    expect(arabicReportLabel.response.status).toBe(200);
    expect(arabicReportLabel.body.user?.username).toBe('admin');

    const shortLabel = await login('admin', 'Demo@2026', undefined, 'IConcrete');
    expect(shortLabel.response.status).toBe(200);
  });

  test('wrong password and unknown company are rejected', async () => {
    const wrongPassword = await login('admin', 'NotThePassword');
    expect(wrongPassword.response.status).toBe(401);
    expect(wrongPassword.body.error).toBe('invalid_credentials');

    const response = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: 'Unknown Company', username: 'admin', password: 'Demo@2026' }),
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as LoginBody).error).toBe('company_not_found');
  });

  test('protected endpoints reject missing sessions', async () => {
    const response = await call('/api/dashboard');
    expect(response.status).toBe(401);
    const customers = await call('/api/customers');
    expect(customers.status).toBe(401);
  });

  test('viewer gets a restricted dashboard and no customer access', async () => {
    const token = (await login('viewer')).body.token;
    expect(token).toBeDefined();
    if (!token) return;

    const dashboard = await call('/api/dashboard', { headers: auth(token) });
    expect(dashboard.status).toBe(200);
    const body = (await dashboard.json()) as { balance: unknown; balanceRestricted: boolean; kpis: { producedTodayM3: number } };
    expect(body.balanceRestricted).toBe(true);
    expect(body.balance).toBeNull();
    expect(body.kpis.producedTodayM3).toBeGreaterThanOrEqual(0);

    expect((await call('/api/customers', { headers: auth(token) })).status).toBe(403);
    expect((await call('/api/excel/templates', { headers: auth(token) })).status).toBe(403);
    expect(
      (await call('/api/export/reports/general_balance?from=2026-01-01&to=2026-12-31', { headers: auth(token) })).status,
    ).toBe(403);
    expect((await call('/api/reports/general_balance', { headers: auth(token) })).status).toBe(200);
  });

  test('admin dashboard exposes the derived balance', async () => {
    const token = await adminToken();
    const response = await call('/api/dashboard', { headers: auth(token) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      balance: { debitTotal: number; creditTotal: number; net: number; debit: unknown[]; credit: unknown[] };
      alerts: unknown[];
      series: unknown[];
      qualityTests: unknown[];
    };
    expect(body.balance.debit.length).toBe(6);
    expect(body.balance.credit.length).toBe(6);
    expect(body.balance.net).toBeCloseTo(body.balance.debitTotal - body.balance.creditTotal, 2);
    expect(body.alerts.length).toBeGreaterThan(0);
    expect(body.series.length).toBe(6);
    expect(body.qualityTests.length).toBeGreaterThan(0);
  });

  test('customers list is derived and requires level 4', async () => {
    const token = await adminToken();
    const response = await call('/api/customers', { headers: auth(token) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { customers: Array<{ id: string; available_credit: number; outstanding_amount: number }> };
    expect(body.customers.length).toBeGreaterThanOrEqual(20);
    const first = body.customers[0];
    expect(first).toBeDefined();
    expect(typeof first?.available_credit).toBe('number');
  });

  test('reports and Excel export produce real workbooks', async () => {
    const token = await adminToken();
    const report = await call('/api/reports/customer_statement?from=2020-01-01&to=2030-12-31', { headers: auth(token) });
    expect(report.status).toBe(200);
    const reportBody = (await report.json()) as {
      canExport: boolean;
      report: { rows: unknown[]; columns: unknown[] };
      generatedAt?: string;
      dataSource?: { mode?: string; adapter?: string; report?: string; filters?: Record<string, string> };
    };
    expect(reportBody.canExport).toBe(true);
    expect(reportBody.report.columns.length).toBeGreaterThan(0);
    // Gap A5: the report must declare where its numbers came from, and which filters ran.
    expect(reportBody.dataSource?.mode).toBe('demo');
    expect(reportBody.dataSource?.adapter).toBe('memory');
    expect(reportBody.dataSource?.report).toBe('customer_statement');
    expect(reportBody.dataSource?.filters).toMatchObject({ from: '2020-01-01', to: '2030-12-31' });
    expect(typeof reportBody.generatedAt).toBe('string');

    const exported = await call('/api/export/reports/general_balance?from=2026-01-01&to=2026-12-31&lang=ar', {
      headers: auth(token),
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('spreadsheetml');
    const bytes = new Uint8Array(await exported.arrayBuffer());
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const customersExport = await call('/api/export/customers.xlsx?lang=ar', { headers: auth(token) });
    expect(customersExport.status).toBe(200);
    const customerBytes = new Uint8Array(await customersExport.arrayBuffer());
    expect(customerBytes[0]).toBe(0x50);
  });

  test('template download and staged import flow work end to end', async () => {
    const token = await adminToken();
    const templates = await call('/api/excel/templates', { headers: auth(token) });
    expect(templates.status).toBe(200);
    const list = (await templates.json()) as { templates: Array<{ id: string; version: string }> };
    expect(list.templates).toHaveLength(15);

    const templateFile = await call('/api/excel/templates/customers.xlsx', { headers: auth(token) });
    expect(templateFile.status).toBe(200);
    const templateBytes = new Uint8Array(await templateFile.arrayBuffer());
    expect(templateBytes[0]).toBe(0x50);

    const form = new FormData();
    form.append('templateId', 'customers');
    form.append('file', new File([CSV_UPLOAD], 'customers_demo.csv', { type: 'text/csv' }));
    const validation = await call('/api/excel/validate', { method: 'POST', headers: auth(token), body: form });
    expect(validation.status).toBe(200);
    const staged = (await validation.json()) as ValidateBody;
    expect(staged.result.summary.totalRows).toBe(2);
    expect(staged.result.summary.validRows).toBe(1);
    expect(staged.result.summary.errorRows).toBe(1);
    expect(staged.result.rows[1]?.issues.map((issue) => issue.code)).toContain('INVALID_ENUM');

    const errorBook = await call(`/api/excel/errors/${staged.stagedId}.xlsx`, { headers: auth(token) });
    expect(errorBook.status).toBe(200);
    expect(new Uint8Array(await errorBook.arrayBuffer())[0]).toBe(0x50);

    // B2: the same staged errors are downloadable as a bilingual CSV report.
    const errorCsv = await call(`/api/excel/errors/${staged.stagedId}.csv`, { headers: auth(token) });
    expect(errorCsv.status).toBe(200);
    expect(errorCsv.headers.get('content-type')).toContain('text/csv');
    const errorLines = (await errorCsv.text()).trim().split('\r\n');
    expect(errorLines[0]).toContain('message_ar');
    expect(errorLines[0]).toContain('message_en');
    expect(errorLines.length).toBeGreaterThan(1);
    expect(errorLines.slice(1).every((line) => line.includes('customers'))).toBe(true);

    expect((await call(`/api/excel/errors/${staged.stagedId}.csv`)).status).toBe(401);

    const before = await call('/api/customers', { headers: auth(token) });
    const beforeCount = ((await before.json()) as { total: number }).total;

    const noConfirm = await call('/api/excel/commit', {
      method: 'POST',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({ stagedId: staged.stagedId }),
    });
    expect(noConfirm.status).toBe(400);

    const commit = await call('/api/excel/commit', {
      method: 'POST',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({ stagedId: staged.stagedId, confirm: true }),
    });
    expect(commit.status).toBe(200);
    const commitBody = (await commit.json()) as { importedRows: number; skippedRows: number };
    expect(commitBody.importedRows).toBe(1);
    expect(commitBody.skippedRows).toBe(1);

    const after = await call('/api/customers', { headers: auth(token) });
    expect(((await after.json()) as { total: number }).total).toBe(beforeCount + 1);

    const duplicateCommit = await call('/api/excel/commit', {
      method: 'POST',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({ stagedId: staged.stagedId, confirm: true }),
    });
    expect(duplicateCommit.status).toBe(409);

    const audit = await call('/api/excel/audit', { headers: auth(token) });
    const auditBody = (await audit.json()) as { entries: Array<{ action: string }> };
    const actions = auditBody.entries.map((entry) => entry.action);
    expect(actions).toContain('excel.validation_completed');
    expect(actions).toContain('excel.row_rejected');
    expect(actions).toContain('excel.staged_committed');
    expect(actions).toContain('excel.error_report_download');
  });

  test('unsupported uploads are rejected', async () => {
    const token = await adminToken();
    const form = new FormData();
    form.append('templateId', 'customers');
    form.append('file', new File(['malicious'], 'customers.xlsm', { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }));
    const response = await call('/api/excel/validate', { method: 'POST', headers: auth(token), body: form });
    expect(response.status).toBe(415);
  });

  test('logout revokes the session', async () => {
    const token = await adminToken();
    expect((await call('/api/auth/logout', { method: 'POST', headers: auth(token) })).status).toBe(200);
    expect((await call('/api/auth/me', { headers: auth(token) })).status).toBe(401);
  });

  test('repeated failures require a captcha and then lock the account', async () => {
    const lockedApp = await createApp(env);
    const attempt = (password: string, captcha?: { challengeId: string; answer: string }) =>
      lockedApp.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            company: 'ICONCRETE Demo Company',
            username: 'operator',
            password,
            ...(captcha ? { captcha } : {}),
          }),
        }),
      );

    const solve = async (): Promise<{ challengeId: string; answer: string }> => {
      const response = await lockedApp.handle(
        new Request('http://localhost/api/auth/captcha', { method: 'POST' }),
      );
      const challenge = (await response.json()) as { challengeId: string; questionEn: string };
      const numbers = /(\d+)\s*\+\s*(\d+)/.exec(challenge.questionEn);
      const answer = String(Number(numbers?.[1] ?? 0) + Number(numbers?.[2] ?? 0));
      return { challengeId: challenge.challengeId, answer };
    };

    let lastStatus = 0;
    let lastError = '';
    for (let index = 0; index < 5; index += 1) {
      let response = await attempt('WrongPassword');
      let body = (await response.json()) as LoginBody;
      if (body.error === 'captcha_required') {
        const captcha = await solve();
        response = await attempt('WrongPassword', captcha);
        body = (await response.json()) as LoginBody;
      }
      lastStatus = response.status;
      lastError = body.error ?? '';
    }

    expect(lastStatus).toBe(423);
    expect(lastError).toBe('account_locked');

    const correct = await attempt('Demo@2026', await solve());
    expect(correct.status).toBe(423);
  });
});
