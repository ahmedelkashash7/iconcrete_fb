/** Deterministic M1 seed: two demo companies (for isolation tests), chart of accounts, ledger. */
import { BRAND } from '../../src/brand';
import { computeInvoiceTotals } from '../../src/core/invoicing';
import { straightLineSchedule } from '../../src/core/assets';
import { annuitySchedule } from '../../src/core/loans';
import { matchThreeWay } from '../../src/core/threeway';
import { createDemoDataset } from '../../src/seed/demo';
import type { Db } from './client';

export interface SeedResult {
  companies: string[];
  plants: number;
  users: number;
  accounts: number;
  customers: number;
  invoices: number;
  payments: number;
  journalEntries: number;
  cheques: number;
  assets: number;
  loans: number;
  purchaseOrders: number;
}

const DEMO_PASSWORD = 'Demo@2026';
const SECOND_COMPANY = {
  id: 'CMP-0002',
  nameAr: 'شركة العزل التجريبية',
  nameEn: 'IConcrete Isolation Demo Company',
  taxId: 'DEMO-TAX-9002',
  plantId: 'PLT-9001',
  plantAr: 'محطة العزل التجريبية - الإسكندرية',
  plantEn: 'IConcrete Isolation Demo Plant - Alexandria',
};

const CHART: ReadonlyArray<[string, string, string, string, 'debit' | 'credit', string]> = [
  ['1000', 'النقدية', 'Cash', 'asset', 'debit', 'asset'],
  ['1010', 'البنك', 'Bank', 'asset', 'debit', 'asset'],
  ['1100', 'العملاء', 'Accounts receivable', 'asset', 'debit', 'asset'],
  ['1150', 'محتجزات لدى العملاء', 'Retention receivable', 'asset', 'debit', 'asset'],
  ['1200', 'المخزون', 'Inventory', 'asset', 'debit', 'asset'],
  ['1500', 'الأصول الثابتة', 'Fixed assets', 'asset', 'debit', 'asset'],
  ['1550', 'مجمع الإهلاك', 'Accumulated depreciation', 'asset', 'credit', 'asset'],
  ['2000', 'الموردون', 'Accounts payable', 'liability', 'credit', 'liability'],
  ['2100', 'ضريبة القيمة المضافة', 'VAT payable', 'liability', 'credit', 'liability'],
  ['2200', 'تأمينات العملاء', 'Customer deposits', 'liability', 'credit', 'liability'],
  ['2300', 'قروض بنكية', 'Bank loans', 'liability', 'credit', 'liability'],
  ['3000', 'رأس المال', 'Share capital', 'equity', 'credit', 'equity'],
  ['3100', 'أرباح محتجزة', 'Retained earnings', 'equity', 'credit', 'equity'],
  ['4000', 'إيرادات المبيعات', 'Sales revenue', 'revenue', 'credit', 'revenue'],
  ['4100', 'إيرادات أخرى', 'Other income', 'revenue', 'credit', 'revenue'],
  ['5000', 'تكلفة المبيعات', 'Cost of sales', 'expense', 'debit', 'expense'],
  ['5100', 'الرواتب', 'Salaries', 'expense', 'debit', 'expense'],
  ['5200', 'الإيجارات', 'Rent', 'expense', 'debit', 'expense'],
  ['5300', 'المرافق', 'Utilities', 'expense', 'debit', 'expense'],
  ['5400', 'الصيانة', 'Maintenance', 'expense', 'debit', 'expense'],
  ['5500', 'مصروف الإهلاك', 'Depreciation expense', 'expense', 'debit', 'expense'],
  ['5600', 'مصاريف بنكية', 'Bank charges', 'expense', 'debit', 'expense'],
  ['5700', 'وقود وطاقة', 'Fuel and power', 'expense', 'debit', 'expense'],
];

const PERMISSIONS: ReadonlyArray<[string, string, string, string]> = [
  ['dashboard.view', 'عرض لوحة التحكم', 'View dashboard', 'dashboard'],
  ['reports.view', 'عرض التقارير', 'View reports', 'reports'],
  ['reports.export', 'تصدير التقارير', 'Export reports', 'reports'],
  ['customers.view', 'عرض العملاء', 'View customers', 'customers'],
  ['customers.manage', 'إدارة العملاء', 'Manage customers', 'customers'],
  ['accounting.post', 'ترحيل القيود', 'Post journals', 'accounting'],
  ['accounting.reverse', 'عكس القيود', 'Reverse journals', 'accounting'],
  ['treasury.manage', 'إدارة الخزينة', 'Manage treasury', 'treasury'],
  ['procurement.approve', 'اعتماد المشتريات', 'Approve procurement', 'procurement'],
  ['excel.import', 'استيراد Excel', 'Import Excel', 'excel'],
  ['admin.users', 'إدارة المستخدمين', 'Manage users', 'admin'],
  ['admin.audit', 'سجل التدقيق', 'Audit log', 'admin'],
];

const ROLES: ReadonlyArray<[number, string, string, string]> = [
  [5, 'owner', 'المالك', 'Owner'],
  [4, 'manager', 'مدير المحطة', 'Plant manager'],
  [3, 'dispatcher', 'مسؤول التوزيع', 'Dispatcher'],
  [2, 'operator', 'مشغل المحطة', 'Batching operator'],
  [1, 'viewer', 'مراجع', 'Viewer'],
];

const accountId = (companyId: string, code: string): string => `${companyId}-ACC-${code}`;

const insertEntry = async (
  tx: { unsafe: <T>(text: string, values?: unknown[]) => Promise<T[]> },
  input: {
    companyId: string;
    entryNo: string;
    entryDate: string;
    memoAr: string;
    memoEn: string;
    sourceType: string;
    sourceId?: string | null;
    plantId?: string | null;
    lines: { accountCode: string; debit?: number; credit?: number; plantId?: string | null }[];
  },
): Promise<number> => {
  // Inserted as a draft so lines can be added; the posted state is applied after the
  // lines exist, exactly like the real posting service. The deferred trigger then
  // validates the balance at COMMIT.
  const rows = await tx.unsafe<{ id: string }>(
    `insert into journal_entries (company_id, plant_id, entry_no, entry_date, memo_ar, memo_en,
       source_type, source_id, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'draft','seed') returning id`,
    [
      input.companyId,
      input.plantId ?? null,
      input.entryNo,
      input.entryDate,
      input.memoAr,
      input.memoEn,
      input.sourceType,
      input.sourceId ?? null,
    ],
  );
  const entryId = Number(rows[0]?.id);

  for (const [index, line] of input.lines.entries()) {
    await tx.unsafe(
      `insert into journal_entry_lines (company_id, entry_id, account_id, line_no, description_ar,
         description_en, debit, credit, plant_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.companyId,
        entryId,
        accountId(input.companyId, line.accountCode),
        index + 1,
        input.memoAr,
        input.memoEn,
        (line.debit ?? 0).toFixed(2),
        (line.credit ?? 0).toFixed(2),
        line.plantId ?? input.plantId ?? null,
      ],
    );
  }

  await tx.unsafe(
    `update journal_entries set status = 'posted', posted_at = now(), posted_by = 'seed' where id = $1`,
    [entryId],
  );

  return entryId;
};

/** Idempotent: re-running the seed resets the demo data for the two demo companies. */
export const seedDemo = async (db: Db): Promise<SeedResult> => {
  const dataset = createDemoDataset();
  const adminPassword = process.env.ICONCRETE_DEMO_ADMIN_PASSWORD ?? DEMO_PASSWORD;

  const companyIds = [dataset.company.id, SECOND_COMPANY.id];
  await db.transaction(async (tx) => {
    for (const companyId of companyIds) {
      await tx.unsafe(`delete from payment_allocations where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from payments where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from journal_entry_lines where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from journal_entries where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from invoice_items where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from invoices where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from customer_credit_limits where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from cheque_movements where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from cheques where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from depreciation_schedules where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from fixed_assets where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from loan_installments where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from loans where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from three_way_match_results where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from supplier_bill_lines where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from supplier_bills where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from goods_receipt_lines where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from goods_receipts where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from purchase_order_lines where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from purchase_orders where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from expenses where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from budgets where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from cash_transactions where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from cash_closings where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from cash_accounts where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from bank_reconciliation_items where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from bank_reconciliations where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from bank_transactions where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from bank_accounts where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from deposits where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from retentions where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from import_records where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from staged_imports where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from audit_log where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from sessions where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from user_roles where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from customers where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from suppliers where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from gl_accounts where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from users where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from plants where company_id = $1`, [companyId]);
      await tx.unsafe(`delete from companies where id = $1`, [companyId]);
    }
  });

  // ------------------------------------------------------------- companies
  await db.transaction(async (tx) => {
    for (const company of [
      {
        id: dataset.company.id,
        nameAr: BRAND.demoCompany.ar,
        nameEn: BRAND.demoCompany.en,
        taxId: dataset.company.tax_id,
      },
      { id: SECOND_COMPANY.id, nameAr: SECOND_COMPANY.nameAr, nameEn: SECOND_COMPANY.nameEn, taxId: SECOND_COMPANY.taxId },
    ]) {
      await tx.unsafe(
        `insert into companies (id, name_ar, name_en, tax_id, currency, timezone)
         values ($1,$2,$3,$4,'EGP','Africa/Cairo')`,
        [company.id, company.nameAr, company.nameEn, company.taxId],
      );
    }

    await tx.unsafe(
      `insert into plants (id, company_id, name_ar, name_en, city) values
        ('PLT-0001',$1,$2,$3,'Cairo'),
        ('PLT-0002',$1,'محطة آي كونكريت التجريبية - الجيزة','IConcrete Demo Plant - Giza','Giza'),
        ($4,$5,$6,$7,'Alexandria')`,
      [
        dataset.company.id,
        BRAND.demoPlant.ar,
        BRAND.demoPlant.en,
        SECOND_COMPANY.plantId,
        SECOND_COMPANY.id,
        SECOND_COMPANY.plantAr,
        SECOND_COMPANY.plantEn,
      ],
    );

    for (const permission of PERMISSIONS) {
      await tx.unsafe(
        `insert into permissions (id, code, name_ar, name_en, module) values ($1,$2,$3,$4,$5)
         on conflict (code) do nothing`,
        [`PERM-${permission[0]}`, permission[0], permission[1], permission[2], permission[3]],
      );
    }

    for (const companyId of companyIds) {
      for (const [level, code, nameAr, nameEn] of ROLES) {
        await tx.unsafe(
          `insert into roles (id, company_id, code, name_ar, name_en, role_level) values ($1,$2,$3,$4,$5,$6)`,
          [`${companyId}-ROLE-${code}`, companyId, code, nameAr, nameEn, level],
        );
      }
      for (const [code, nameAr, nameEn, accountType, normalSide] of CHART) {
        await tx.unsafe(
          `insert into gl_accounts (id, company_id, code, name_ar, name_en, account_type, normal_side)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [accountId(companyId, code), companyId, code, nameAr, nameEn, accountType, normalSide],
        );
      }
    }

    const insertUser = async (
      companyId: string,
      user: { id: string; username: string; nameAr: string; nameEn: string; email: string; phone: string; level: number; plants: string[] },
      password: string,
    ): Promise<void> => {
      const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });
      await tx.unsafe(
        `insert into users (id, company_id, username, password_hash, full_name_ar, full_name_en,
           email, phone, role_level, assigned_plant_ids)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[])`,
        [
          user.id,
          companyId,
          user.username,
          hash,
          user.nameAr,
          user.nameEn,
          user.email,
          user.phone,
          user.level,
          `{${user.plants.map((plant) => `"${plant}"`).join(',')}}`,
        ],
      );
      const roleCode = ROLES.find(([level]) => level === user.level)?.[1] ?? 'viewer';
      await tx.unsafe(`insert into user_roles (user_id, role_id, company_id) values ($1,$2,$3)`, [
        user.id,
        `${companyId}-ROLE-${roleCode}`,
        companyId,
      ]);
    };

    for (const user of dataset.users) {
      await insertUser(
        dataset.company.id,
        {
          id: user.id,
          username: user.username,
          nameAr: user.full_name_ar,
          nameEn: user.full_name_en,
          email: user.email,
          phone: user.phone,
          level: user.role_level,
          plants: user.assigned_plant_ids,
        },
        user.username === 'admin' ? adminPassword : DEMO_PASSWORD,
      );
    }

    await insertUser(
      SECOND_COMPANY.id,
      {
        id: 'USR-9001',
        username: 'admin2',
        nameAr: 'سامي عبد الله - مدير الشركة الثانية',
        nameEn: 'Samy Abdallah - Second company admin',
        email: 'admin2@demo.iconcrete.local',
        phone: '+201000009002',
        level: 5,
        plants: [SECOND_COMPANY.plantId],
      },
      DEMO_PASSWORD,
    );

    // ------------------------------------------------------- customers
    for (const customer of dataset.customers) {
      await tx.unsafe(
        `insert into customers (id, company_id, plant_id, name_ar, name_en, tax_id, phone, email,
           address, priority_tier, credit_days, status, data_source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'demo')`,
        [
          customer.id,
          dataset.company.id,
          customer.plant_id,
          customer.name_ar,
          customer.name_en,
          customer.tax_id,
          customer.phone,
          customer.email,
          customer.address,
          customer.priority_tier,
          customer.credit_days,
          customer.status,
        ],
      );
      await tx.unsafe(
        `insert into customer_credit_limits (id, company_id, customer_id, credit_limit)
         values ($1,$2,$3,$4)`,
        [`${customer.id}-CL-1`, dataset.company.id, customer.id, customer.credit_limit_egp.toFixed(2)],
      );
    }

    for (const [index, name] of [
      ['شركة الإسكندرية البحرية', 'Alexandria Marine Co.'],
      ['مقاولات الدلتا الشمالية', 'North Delta Contracting'],
    ].entries()) {
      const id = `ISO-CUS-${String(index + 1).padStart(4, '0')}`;
      await tx.unsafe(
        `insert into customers (id, company_id, plant_id, name_ar, name_en, tax_id, credit_days, status, data_source)
         values ($1,$2,$3,$4,$5,$6,30,'active','demo')`,
        [id, SECOND_COMPANY.id, SECOND_COMPANY.plantId, name[0], name[1], `ISO-TAX-${index + 1}`],
      );
      await tx.unsafe(`insert into customer_credit_limits (id, company_id, customer_id, credit_limit) values ($1,$2,$3,'250000.00')`, [
        `${id}-CL-1`,
        SECOND_COMPANY.id,
        id,
      ]);
    }

    // ------------------------------------------------------- suppliers
    for (const supplier of dataset.suppliers) {
      await tx.unsafe(
        `insert into suppliers (id, company_id, name_ar, name_en, phone, category, status, data_source)
         values ($1,$2,$3,$4,$5,$6,$7,'demo')`,
        [
          supplier.id,
          dataset.company.id,
          supplier.name_ar,
          supplier.name_en,
          supplier.phone,
          supplier.category,
          supplier.status,
        ],
      );
    }
    await tx.unsafe(
      `insert into suppliers (id, company_id, name_ar, name_en, phone, category, status, data_source)
       values ('ISO-SUP-001',$1,'مورد الإسكندرية','Alexandria Supplier','+2033000001','cement','active','demo')`,
      [SECOND_COMPANY.id],
    );

    // ------------------------------------------------- cash and bank accounts
    await tx.unsafe(
      `insert into cash_accounts (id, company_id, plant_id, code, name_ar, name_en, gl_account_id)
       values ('CASH-0001',$1,'PLT-0001','CSH-01','خزينة المحطة الرئيسية','Main plant cash',$2),
              ('CASH-0002',$1,'PLT-0002','CSH-02','خزينة محطة الجيزة','Giza plant cash',$2)`,
      [dataset.company.id, accountId(dataset.company.id, '1000')],
    );

    for (const account of dataset.bankAccounts) {
      await tx.unsafe(
        `insert into bank_accounts (id, company_id, plant_id, code, bank_name_ar, bank_name_en, iban_last4, opening_balance, gl_account_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          account.id,
          dataset.company.id,
          account.plant_id,
          account.id.replace('BNK', 'BNK-C'),
          account.bank_name_ar,
          account.bank_name_en,
          account.iban_last4,
          account.current_balance.toFixed(2),
          accountId(dataset.company.id, '1010'),
        ],
      );
    }
    await tx.unsafe(
      `insert into bank_accounts (id, company_id, plant_id, code, bank_name_ar, bank_name_en, iban_last4, opening_balance, gl_account_id)
       values ('ISO-BNK-001',$1,$2,'ISO-BNK','بنك الإسكندرية','Alexandria Bank','7711','500000.00',$3)`,
      [SECOND_COMPANY.id, SECOND_COMPANY.plantId, accountId(SECOND_COMPANY.id, '1010')],
    );

    // ------------------------------------------------------------- invoices
    let entrySerial = 0;
    const nextEntryNo = (): string => `JE-${String((entrySerial += 1)).padStart(6, '0')}`;

    const postedInvoices: { id: string; grandTotal: string; paid: string; status: string; dueDate: string; invoiceNo: string; customerId: string }[] = [];

    for (const invoice of dataset.invoices) {
      const totals = computeInvoiceTotals({
        items: [{ quantity: 1, unitPrice: invoice.subtotal }],
        taxPercent: invoice.vat_percent,
      });

      await tx.unsafe(
        `insert into invoices (id, company_id, plant_id, customer_id, invoice_no, issue_date, due_date,
           subtotal, tax_percent, tax_amount, grand_total, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          invoice.id,
          dataset.company.id,
          invoice.plant_id,
          invoice.customer_id,
          invoice.invoice_no,
          invoice.issue_date.slice(0, 10),
          invoice.due_date.slice(0, 10),
          totals.subtotal.toFixed(2),
          totals.taxPercent.toFixed(3),
          totals.taxAmount.toFixed(2),
          totals.grandTotal.toFixed(2),
          invoice.status === 'draft' || invoice.status === 'void' ? invoice.status : 'issued',
        ],
      );
      await tx.unsafe(
        `insert into invoice_items (company_id, invoice_id, line_no, description_ar, description_en, quantity, unit_price, line_total)
         values ($1,$2,1,'توريد خرسانة جاهزة','Ready-mix concrete supply',1,$3,$4)`,
        [dataset.company.id, invoice.id, totals.subtotal.toFixed(2), totals.subtotal.toFixed(2)],
      );

      if (invoice.status !== 'draft' && invoice.status !== 'void') {
        const entryId = await insertEntry(tx, {
          companyId: dataset.company.id,
          entryNo: nextEntryNo(),
          entryDate: invoice.issue_date.slice(0, 10),
          memoAr: `فاتورة ${invoice.invoice_no}`,
          memoEn: `Invoice ${invoice.invoice_no}`,
          sourceType: 'invoice',
          sourceId: invoice.id,
          plantId: invoice.plant_id,
          lines: [
            { accountCode: '1100', debit: totals.grandTotal, plantId: invoice.plant_id },
            { accountCode: '4000', credit: totals.netSubtotal, plantId: invoice.plant_id },
            { accountCode: '2100', credit: totals.taxAmount, plantId: invoice.plant_id },
          ],
        });
        await tx.unsafe(`update invoices set journal_entry_id = $1, status = $2 where id = $3`, [
          entryId,
          invoice.status === 'paid' ? 'paid' : invoice.paid_amount > 0 ? 'partially_paid' : invoice.status,
          invoice.id,
        ]);
        postedInvoices.push({
          id: invoice.id,
          grandTotal: totals.grandTotal.toFixed(2),
          paid: invoice.paid_amount.toFixed(2),
          status: invoice.status,
          dueDate: invoice.due_date.slice(0, 10),
          invoiceNo: invoice.invoice_no,
          customerId: invoice.customer_id,
        });
      }
    }

    // ------------------------------------------------------------- payments
    let paymentSerial = 0;
    for (const invoice of postedInvoices) {
      if (Number(invoice.paid) <= 0) continue;
      paymentSerial += 1;
      const paymentId = `PMT-${String(paymentSerial).padStart(5, '0')}`;
      const entryId = await insertEntry(tx, {
        companyId: dataset.company.id,
        entryNo: nextEntryNo(),
        entryDate: invoice.dueDate,
        memoAr: `تحصيل فاتورة ${invoice.invoiceNo}`,
        memoEn: `Receipt for invoice ${invoice.invoiceNo}`,
        sourceType: 'payment',
        sourceId: paymentId,
        lines: [
          { accountCode: '1010', debit: Number(invoice.paid) },
          { accountCode: '1100', credit: Number(invoice.paid) },
        ],
      });

      await tx.unsafe(
        `insert into payments (id, company_id, payment_no, customer_id, direction, method, amount,
           unapplied_amount, payment_date, reference, status, journal_entry_id)
         values ($1,$2,$3,$4,'receipt','bank',$5,0,$6,$7,'posted',$8)`,
        [paymentId, dataset.company.id, `RC-${String(paymentSerial).padStart(5, '0')}`, invoice.customerId, invoice.paid, invoice.dueDate, invoice.invoiceNo, entryId],
      );
      await tx.unsafe(
        `insert into payment_allocations (company_id, payment_id, invoice_id, amount, sequence)
         values ($1,$2,$3,$4,1)`,
        [dataset.company.id, paymentId, invoice.id, invoice.paid],
      );
    }

    // ------------------------------------------------- opening balance entry
    const cashTotal = dataset.cashTransactions.reduce((sum, txn) => sum + (txn.direction === 'in' ? txn.amount : -txn.amount), 0);
    const bankTotal = dataset.bankAccounts.reduce((sum, account) => sum + account.current_balance, 0);
    const inventoryTotal = dataset.inventory.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
    const assetsTotal = dataset.fixedAssets.reduce((sum, asset) => sum + asset.current_book_value, 0);
    const loansTotal = dataset.loans.reduce((sum, loan) => sum + loan.outstanding_principal, 0);
    const payableTotal = dataset.supplierBills.reduce((sum, bill) => sum + bill.outstanding_amount, 0);

    const openingDebit = Math.round((cashTotal + bankTotal + inventoryTotal + assetsTotal) * 100) / 100;
    const openingCredit = Math.round((loansTotal + payableTotal) * 100) / 100;
    const equity = Math.round((openingDebit - openingCredit) * 100) / 100;

    await insertEntry(tx, {
      companyId: dataset.company.id,
      entryNo: nextEntryNo(),
      entryDate: dataset.company.created_at.slice(0, 10),
      memoAr: 'الأرصدة الافتتاحية التجريبية',
      memoEn: 'Demo opening balances',
      sourceType: 'opening',
      lines: [
        { accountCode: '1000', debit: Math.max(0, Math.round(cashTotal * 100) / 100) },
        { accountCode: '1010', debit: Math.round(bankTotal * 100) / 100 },
        { accountCode: '1200', debit: Math.round(inventoryTotal * 100) / 100 },
        { accountCode: '1500', debit: Math.round(assetsTotal * 100) / 100 },
        { accountCode: '2300', credit: Math.round(loansTotal * 100) / 100 },
        { accountCode: '2000', credit: Math.round(payableTotal * 100) / 100 },
        { accountCode: cashTotal < 0 ? '3100' : '3000', credit: Math.max(0, equity) },
      ].filter((line) => (line.debit ?? line.credit ?? 0) > 0) as { accountCode: string; debit?: number; credit?: number }[],
    });

    // ------------------------------------------------------ second company ledger
    const isoCustomerId = 'ISO-CUS-0001';
    const isoInvoiceId = 'ISO-INV-0001';
    await tx.unsafe(
      `insert into invoices (id, company_id, plant_id, customer_id, invoice_no, issue_date, due_date,
         subtotal, tax_percent, tax_amount, grand_total, status)
       values ($1,$2,$3,$4,'ISO-INV-2026-0001', current_date - 40, current_date - 10,
               '100000.00', 14, '14000.00', '114000.00', 'issued')`,
      [isoInvoiceId, SECOND_COMPANY.id, SECOND_COMPANY.plantId, isoCustomerId],
    );
    await tx.unsafe(
      `insert into invoice_items (company_id, invoice_id, line_no, description_ar, description_en, quantity, unit_price, line_total)
       values ($1,$2,1,'توريد خرسانة','Concrete supply',1,'100000.00','100000.00')`,
      [SECOND_COMPANY.id, isoInvoiceId],
    );
    await insertEntry(tx, {
      companyId: SECOND_COMPANY.id,
      entryNo: 'JE-000001',
      entryDate: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10),
      memoAr: 'فاتورة شركة العزل',
      memoEn: 'Isolation company invoice',
      sourceType: 'invoice',
      sourceId: isoInvoiceId,
      plantId: SECOND_COMPANY.plantId,
      lines: [
        { accountCode: '1100', debit: 114000 },
        { accountCode: '4000', credit: 100000 },
        { accountCode: '2100', credit: 14000 },
      ],
    });

    // ------------------------------------------------------ cash transactions
    for (const txn of dataset.cashTransactions) {
      const plant = txn.plant_id === 'PLT-0002' ? 'CASH-0002' : 'CASH-0001';
      await tx.unsafe(
        `insert into cash_transactions (id, company_id, plant_id, account_id, txn_date, direction, amount,
           reference, description_ar, description_en)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          txn.id,
          dataset.company.id,
          txn.plant_id,
          plant,
          txn.txn_date.slice(0, 10),
          txn.direction,
          txn.amount.toFixed(2),
          txn.reference,
          txn.description_ar,
          txn.description_en,
        ],
      );
    }

    for (const account of dataset.bankAccounts) {
      for (let index = 0; index < 6; index += 1) {
        const isIn = (index + account.iban_last4.length) % 2 === 0;
        await tx.unsafe(
          `insert into bank_transactions (id, company_id, plant_id, account_id, txn_date, direction, amount, reference, description_ar, description_en)
           values ($1,$2,$3,$4, current_date - $5::int, $6, $7, $8, $9, $10)`,
          [
            `${account.id}-TXN-${index + 1}`,
            dataset.company.id,
            account.plant_id,
            account.id,
            index * 4 + 1,
            isIn ? 'in' : 'out',
            (15000 + index * 7500).toFixed(2),
            `STMT-${account.iban_last4}-${1000 + index}`,
            isIn ? 'تحصيل بنكي' : 'مدفوعات بنكية',
            isIn ? 'Bank collection' : 'Bank payment',
          ],
        );
      }
    }

    // -------------------------------------------------------------- cheques
    for (const cheque of dataset.cheques) {
      const status = cheque.status === 'under_collection' ? 'deposited' : cheque.status === 'received' ? 'received' : cheque.status === 'cleared' ? 'cleared' : cheque.status === 'bounced' ? 'bounced' : 'cancelled';
      await tx.unsafe(
        `insert into cheques (id, company_id, plant_id, cheque_no, direction, party_name_ar, party_name_en,
           amount, issue_date, due_date, status)
         values ($1,$2,'PLT-0001',$3,$4,$5,$6,$7, current_date - 20, $8, $9)`,
        [
          cheque.id,
          dataset.company.id,
          cheque.cheque_no,
          cheque.direction,
          cheque.party_name_ar,
          cheque.party_name_en,
          cheque.amount.toFixed(2),
          cheque.due_date.slice(0, 10),
          status,
        ],
      );
      await tx.unsafe(
        `insert into cheque_movements (company_id, cheque_id, from_status, to_status, amount, note, actor)
         values ($1,$2,null,$3,$4,'seed','seed')`,
        [dataset.company.id, cheque.id, status, cheque.amount.toFixed(2)],
      );
    }

    // ---------------------------------------------------------- fixed assets
    for (const asset of dataset.fixedAssets) {
      const months = asset.category === 'building' ? 240 : asset.category === 'it' ? 36 : 120;
      const residual = Math.round(asset.purchase_cost * 0.1 * 100) / 100;
      await tx.unsafe(
        `insert into fixed_assets (id, company_id, plant_id, code, name_ar, name_en, category, purchase_date,
           purchase_cost, residual_value, useful_life_months, status)
         values ($1,$2,'PLT-0001',$3,$4,$5,$6,$7,$8,$9,$10,'active')`,
        [
          asset.id,
          dataset.company.id,
          asset.id.replace('AST', 'FA'),
          asset.name_ar,
          asset.name_en,
          asset.category,
          asset.purchase_date.slice(0, 10),
          asset.purchase_cost.toFixed(2),
          residual.toFixed(2),
          months,
        ],
      );
      const schedule = straightLineSchedule({
        assetId: asset.id,
        purchaseDate: asset.purchase_date,
        purchaseCost: asset.purchase_cost,
        residualValue: residual,
        usefulLifeMonths: months,
      }).slice(0, 12);
      for (const period of schedule) {
        await tx.unsafe(
          `insert into depreciation_schedules (company_id, asset_id, period, amount, accumulated, book_value)
           values ($1,$2,$3,$4,$5,$6)`,
          [dataset.company.id, asset.id, period.period, period.amount.toFixed(2), period.accumulated.toFixed(2), period.bookValue.toFixed(2)],
        );
      }
    }

    // ------------------------------------------------------------------ loans
    for (const loan of dataset.loans) {
      await tx.unsafe(
        `insert into loans (id, company_id, bank_name_ar, bank_name_en, principal, annual_rate, term_months, start_date, status)
         values ($1,$2,$3,$4,$5,0.125,36, current_date - 200, $6)`,
        [loan.id, dataset.company.id, loan.bank_name_ar, loan.bank_name_en, loan.principal.toFixed(2), loan.status],
      );
      const schedule = annuitySchedule({
        loanId: loan.id,
        principal: loan.principal,
        annualRate: 12.5,
        termMonths: 36,
        startDate: new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10),
      });
      for (const installment of schedule.installments) {
        await tx.unsafe(
          `insert into loan_installments (company_id, loan_id, installment_no, due_date, payment, principal_part, interest_part, remaining)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            dataset.company.id,
            loan.id,
            installment.installmentNo,
            installment.dueDate,
            installment.payment.toFixed(2),
            installment.principalPart.toFixed(2),
            installment.interestPart.toFixed(2),
            installment.remaining.toFixed(2),
          ],
        );
      }
    }

    // ------------------------------------------------- expenses and budgets
    const expenseRows = [
      ['EXP-0001', '2026-10-02', 'operations', 'وقود اللودر', 'Loader fuel', 18400],
      ['EXP-0002', '2026-10-05', 'utilities', 'فاتورة كهرباء', 'Electricity bill', 128400],
      ['EXP-0003', '2026-10-08', 'maintenance', 'صيانة الخلاطة', 'Mixer maintenance', 42000],
      ['EXP-0004', '2026-10-10', 'salaries', 'رواتب أكتوبر', 'October salaries', 118000],
    ] as const;
    for (const [id, date, category, nameAr, nameEn, amount] of expenseRows) {
      await tx.unsafe(
        `insert into expenses (id, company_id, plant_id, expense_date, category, description_ar, description_en, amount, gl_account_id)
         values ($1,$2,'PLT-0001',$3,$4,$5,$6,$7,$8)`,
        [id, dataset.company.id, date, category, nameAr, nameEn, amount.toFixed(2), accountId(dataset.company.id, '5700')],
      );
    }
    for (const [index, category] of ['operations', 'salaries', 'utilities', 'maintenance'].entries()) {
      await tx.unsafe(
        `insert into budgets (id, company_id, plant_id, fiscal_year, period_month, category, planned_amount)
         values ($1,$2,'PLT-0001',2026,10,$3,$4)`,
        [`BUD-${String(index + 1).padStart(3, '0')}`, dataset.company.id, category, (200000 + index * 50000).toFixed(2)],
      );
    }

    // ------------------------------------------------------------ procurement
    const poId = 'PO-0001';
    await tx.unsafe(
      `insert into purchase_orders (id, company_id, plant_id, po_no, supplier_id, order_date, expected_date, subtotal, tax_amount, total, status)
       values ($1,$2,'PLT-0001','PO-2026-0001','SUP-001', current_date - 12, current_date - 6, 500000, 70000, 570000, 'received')`,
      [poId, dataset.company.id],
    );
    await tx.unsafe(
      `insert into purchase_order_lines (company_id, purchase_order_id, line_no, description_ar, description_en, material_code, quantity, unit_price, line_total, received_quantity)
       values ($1,$2,1,'أسمنت OPC','OPC cement','CEM-OPC',200,2500,500000,200)`,
      [dataset.company.id, poId],
    );
    const grnId = 'GRN-0001';
    await tx.unsafe(
      `insert into goods_receipts (id, company_id, plant_id, receipt_no, purchase_order_id, received_on, total_value)
       values ($1,$2,'PLT-0001','GRN-2026-0001',$3, current_date - 7, 500000)`,
      [grnId, dataset.company.id, poId],
    );
    const poLine = await tx.unsafe<{ id: string }>(`select id from purchase_order_lines where purchase_order_id = $1 and line_no = 1`, [poId]);
    await tx.unsafe(
      `insert into goods_receipt_lines (company_id, goods_receipt_id, purchase_order_line_id, line_no, quantity, unit_price, line_total)
       values ($1,$2,$3,1,200,2500,500000)`,
      [dataset.company.id, grnId, poLine[0]?.id ?? null],
    );

    const billId = 'BILL-0001';
    await tx.unsafe(
      `insert into supplier_bills (id, company_id, plant_id, supplier_id, purchase_order_id, bill_no, bill_date, due_date, subtotal, tax_amount, total, status)
       values ($1,$2,'PLT-0001','SUP-001',$3,'SB-2026-0001', current_date - 5, current_date + 25, 500000, 70000, 570000, 'pending_match')`,
      [billId, dataset.company.id, poId],
    );
    await tx.unsafe(
      `insert into supplier_bill_lines (company_id, supplier_bill_id, purchase_order_line_id, line_no, description_ar, description_en, quantity, unit_price, line_total)
       values ($1,$2,$3,1,'أسمنت OPC','OPC cement',200,2500,500000)`,
      [dataset.company.id, billId, poLine[0]?.id ?? null],
    );

    const match = matchThreeWay({
      orderLines: [{ lineNo: 1, quantity: 200, unitPrice: 2500 }],
      receiptLines: [{ lineNo: 1, quantity: 200 }],
      billLines: [{ lineNo: 1, quantity: 200, unitPrice: 2500 }],
    });
    await tx.unsafe(
      `insert into three_way_match_results (id, company_id, plant_id, purchase_order_id, goods_receipt_id,
         supplier_bill_id, status, over_receipt_qty, over_billed_qty, price_variance, amount_variance,
         details, requires_approval)
       values ($1,$2,'PLT-0001',$3,$4,$5,$6,$7,$8,$9,$10,$11,false)`,
      [
        'TWM-0001',
        dataset.company.id,
        poId,
        grnId,
        billId,
        match.status,
        match.overReceiptQty.toFixed(3),
        match.overBilledQty.toFixed(3),
        match.priceVariance.toFixed(2),
        match.amountVariance.toFixed(2),
        JSON.stringify(match),
      ],
    );
    await tx.unsafe(`update supplier_bills set status = 'matched' where id = $1`, [billId]);
  });

  const counts = await db.unsafe<Record<string, string>>(`
    select
      (select count(*) from companies) as companies,
      (select count(*) from plants) as plants,
      (select count(*) from users) as users,
      (select count(*) from gl_accounts) as accounts,
      (select count(*) from customers) as customers,
      (select count(*) from invoices) as invoices,
      (select count(*) from payments) as payments,
      (select count(*) from journal_entries) as journal_entries,
      (select count(*) from cheques) as cheques,
      (select count(*) from fixed_assets) as assets,
      (select count(*) from loans) as loans,
      (select count(*) from purchase_orders) as purchase_orders
  `);

  const row = counts[0] ?? {};
  return {
    companies: companyIds,
    plants: Number(row.plants ?? 0),
    users: Number(row.users ?? 0),
    accounts: Number(row.accounts ?? 0),
    customers: Number(row.customers ?? 0),
    invoices: Number(row.invoices ?? 0),
    payments: Number(row.payments ?? 0),
    journalEntries: Number(row.journal_entries ?? 0),
    cheques: Number(row.cheques ?? 0),
    assets: Number(row.assets ?? 0),
    loans: Number(row.loans ?? 0),
    purchaseOrders: Number(row.purchase_orders ?? 0),
  };
};
