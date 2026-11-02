/**
 * Full Excel template path (gap G6) per template: schema → validation → durable staging
 * → durable commit → domain row. Uses the restricted application role so RLS applies.
 *
 * A template is only marked implemented when this path passes for it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { PgImportRepository } from '../../server/db/importRepo';
import { templateById } from '../../src/core/excelSchema';
import { validateRows, type ValidationContext } from '../../src/core/validation';

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? '';
const SKIP_REASON =
  ADMIN_URL && RLS_URL
    ? null
    : 'PostgreSQL not configured: set DATABASE_URL and ICONCRETE_RLS_URL to run Excel template tests.';

if (SKIP_REASON) console.warn(`[excel template tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const ORDER = [
  'chart_of_accounts',
  'suppliers',
  'invoices',
  'invoice_items',
  'payments',
  'expenses',
  'cheques',
  'fixed_assets',
  'loans',
] as const;

const TABLE: Record<string, string> = {
  chart_of_accounts: 'gl_accounts',
  suppliers: 'suppliers',
  invoices: 'invoices',
  invoice_items: 'invoice_items',
  payments: 'payments',
  expenses: 'expenses',
  cheques: 'cheques',
  fixed_assets: 'fixed_assets',
  loans: 'loans',
};

const tag = `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const ACCOUNT_ID = `ACC-${tag}`;
const SUPPLIER_ID = `SUP-${tag}`;
const INVOICE_ID = `INV-${tag}`;
const PAYMENT_ID = `PMT-${tag}`;

let admin: Db;
let app: Db;
let repo: PgImportRepository;
let customerId = 'CUS-0001';
let plantId = 'PLT-0001';
let accountCode = '1100';

const ctx = { companyId: 'CMP-0001', plantIds: [] as string[], userId: 'USR-0001' };

const valuesFor = (id: string): Record<string, string> => {
  const template = templateById(id);
  if (!template) throw new Error(`template ${id} missing`);
  const base = Object.fromEntries(template.columns.map((column) => [column.key, column.example]));
  switch (id) {
    case 'chart_of_accounts':
      return { ...base, account_id: ACCOUNT_ID, code: `9${tag.slice(-4)}`, account_type: 'asset', normal_side: 'debit' };
    case 'suppliers':
      return { ...base, supplier_id: SUPPLIER_ID, name_ar: 'مورد اختبار', phone: '+201000000099' };
    case 'invoices':
      return {
        ...base,
        invoice_id: INVOICE_ID,
        invoice_no: `INV-N-${tag}`,
        customer_id: customerId,
        plant_id: plantId,
        issue_date: '2026-03-01',
        due_date: '2026-04-01',
        subtotal: '10000',
        tax_percent: '14',
        tax_amount: '1400',
        grand_total: '11400',
        status: 'draft',
      };
    case 'invoice_items':
      return {
        ...base,
        line_key: `${INVOICE_ID}:1`,
        invoice_id: INVOICE_ID,
        line_no: '1',
        description_ar: 'خرسانة C30',
        quantity: '5',
        unit_price: '2000',
        line_total: '10000',
      };
    case 'payments':
      return {
        ...base,
        payment_id: PAYMENT_ID,
        customer_id: customerId,
        method: 'bank',
        amount: '5000',
        payment_date: '2026-03-05',
        reference: `TPL-${tag}`,
        allocated_invoice_id: INVOICE_ID,
        allocated_amount: '5000',
      };
    case 'expenses':
      return {
        ...base,
        expense_id: `EXP-${tag}`,
        expense_date: '2026-03-02',
        plant_id: plantId,
        supplier_id: SUPPLIER_ID,
        gl_account_code: accountCode,
        amount: '750',
      };
    case 'cheques':
      return {
        ...base,
        cheque_id: `CHQ-${tag}`,
        cheque_no: `C${tag}`,
        plant_id: plantId,
        issue_date: '2026-03-01',
        due_date: '2026-05-01',
        amount: '2500',
      };
    case 'fixed_assets':
      return {
        ...base,
        asset_id: `AST-${tag}`,
        code: `AST-${tag}`,
        plant_id: plantId,
        purchase_cost: '100000',
        useful_life_months: '60',
      };
    case 'loans':
      return { ...base, loan_id: `LN-${tag}`, principal: '500000', term_months: '24' };
    default:
      return base;
  }
};

const context = (): ValidationContext => ({
  references: {
    customers: [customerId],
    suppliers: [SUPPLIER_ID],
    plants: [plantId],
    invoices: [INVOICE_ID],
    gl_accounts: [accountCode],
    materials: [],
    mix_designs: [],
    employees: [],
    trucks: [],
  },
  existingIds: [],
});

describeDb('Excel template end-to-end path', () => {
  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    repo = new PgImportRepository(app);

    const customer = await admin.unsafe<{ id: string }>(
      `select id from customers where company_id = 'CMP-0001' and deleted_at is null order by id limit 1`,
    );
    customerId = customer[0]?.id ?? customerId;
    const plant = await admin.unsafe<{ id: string }>(
      `select id from plants where company_id = 'CMP-0001' and deleted_at is null order by id limit 1`,
    );
    plantId = plant[0]?.id ?? plantId;
    const account = await admin.unsafe<{ code: string }>(
      `select code from gl_accounts where company_id = 'CMP-0001' and deleted_at is null order by code limit 1`,
    );
    accountCode = account[0]?.code ?? accountCode;
  });

  afterAll(async () => {
    await admin?.unsafe(`delete from payment_allocations where payment_id = $1`, [PAYMENT_ID]);
    await admin?.unsafe(`delete from payments where id = $1`, [PAYMENT_ID]);
    await admin?.unsafe(`delete from invoice_items where invoice_id = $1`, [INVOICE_ID]);
    await admin?.unsafe(`delete from invoices where id = $1`, [INVOICE_ID]);
    await admin?.unsafe(`delete from expenses where id = $1`, [`EXP-${tag}`]);
    await admin?.unsafe(`delete from cheques where id = $1`, [`CHQ-${tag}`]);
    await admin?.unsafe(`delete from fixed_assets where id = $1`, [`AST-${tag}`]);
    await admin?.unsafe(`delete from loans where id = $1`, [`LN-${tag}`]);
    await admin?.unsafe(`delete from suppliers where id = $1`, [SUPPLIER_ID]);
    await admin?.unsafe(`delete from gl_accounts where id = $1`, [ACCOUNT_ID]);
    await admin?.unsafe(`delete from import_records where staged_id in (select id from staged_imports where file_name like $1)`, [`tmpl-%${tag}%`]);
    await admin?.unsafe(`delete from staged_imports where file_name like $1`, [`tmpl-%${tag}%`]);
    await app?.close();
    await admin?.close();
  });

  dbTest('validates, stages, commits and persists every accounting template', async () => {
    for (const templateId of ORDER) {
      const template = templateById(templateId);
      if (!template) throw new Error(`template ${templateId} missing`);
      const values = valuesFor(templateId);

      const validation = validateRows(template, [values], context());
      const errors = validation.rows[0]?.issues.filter((issue) => issue.severity === 'error') ?? [];
      expect(`${templateId}:${errors.map((issue) => issue.code).join(',')}`).toBe(`${templateId}:`);
      expect(validation.summary.validRows).toBe(1);

      const saved = await repo.saveStaged(ctx, {
        templateId,
        templateVersion: template.version,
        fileName: `tmpl-${templateId}-${tag}.xlsx`,
        checksum: `sha-${templateId}-${tag}`,
        bytes: 512,
        result: validation,
      });
      expect(saved.duplicate).toBe(false);

      const committed = await repo.commit(ctx, saved.record.id);
      expect(committed.ok).toBe(true);

      if (templateId === 'invoice_items') {
        const rows = await admin.unsafe<{ n: number }>(
          `select count(*)::int as n from invoice_items where invoice_id = $1 and line_no = 1`,
          [INVOICE_ID],
        );
        expect(rows[0]?.n).toBe(1);
      } else {
        const key = templateId === 'chart_of_accounts' ? ACCOUNT_ID : (values[`${template.entity.replace(/s$/, '')}_id`] ?? values.id ?? '');
        const rows = await admin.unsafe<{ n: number }>(
          `select count(*)::int as n from ${TABLE[templateId]} where id = $1`,
          [templateId === 'suppliers' ? SUPPLIER_ID : templateId === 'fixed_assets' ? `AST-${tag}` : key],
        );
        expect(`${templateId}:${rows[0]?.n}`).toBe(`${templateId}:1`);
      }

      // No silent overwrite: committing the same upload again is refused.
      const again = await repo.commit(ctx, saved.record.id);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.code).toBe('already_committed');
    }
  });

  dbTest('rejects the same file checksum twice instead of overwriting', async () => {
    const template = templateById('suppliers');
    if (!template) throw new Error('suppliers template missing');
    const duplicate = await repo.saveStaged(ctx, {
      templateId: 'suppliers',
      templateVersion: template.version,
      fileName: `tmpl-suppliers-${tag}.xlsx`,
      checksum: `sha-suppliers-${tag}`,
      bytes: 512,
      result: validateRows(template, [valuesFor('suppliers')], context()),
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.record.fileName).toBe(`tmpl-suppliers-${tag}.xlsx`);
  });

  dbTest('reports broken references and duplicates in both languages', async () => {
    const invoice = templateById('invoices');
    const accounts = templateById('chart_of_accounts');
    if (!invoice || !accounts) throw new Error('templates missing');

    const bad = { ...valuesFor('invoices'), invoice_id: `INV-BAD-${tag}`, invoice_no: `BAD-${tag}`, customer_id: 'CUS-NOPE-9999' };
    const broken = validateRows(invoice, [bad], context());
    const issue = broken.rows[0]?.issues.find((candidate) => candidate.code === 'BROKEN_REFERENCE');
    expect(issue?.messageAr).toContain('مرجع');
    expect(issue?.messageEn).toContain('Referenced');

    const duplicate = validateRows(accounts, [valuesFor('chart_of_accounts')], {
      ...context(),
      existingIds: [`9${tag.slice(-4)}`],
    });
    expect(duplicate.rows[0]?.issues.some((candidate) => candidate.code === 'DUPLICATE_EXISTING')).toBe(true);
  });
});
