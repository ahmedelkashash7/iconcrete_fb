/**
 * M9 — procurement three-way match, supplier evaluation, payables.
 *
 * The pure block pins the match tolerances, invoice arithmetic, payment and aging rules. The
 * database block exercises the real repositories: one invoice inside tolerance and one beyond,
 * duplicate/arithmetic refusals, payment without approval and overpayment, expired documents
 * blocking PO confirmation with a level-4 recovery, grade D suspending a supplier, and tenant /
 * plant isolation on every new table.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { ProcurementService } from '../../server/services/procurement';
import { InventoryService } from '../../server/services/inventory';
import type { B1Context } from '../../server/services/projects';
import {
  apAging,
  canPaymentVoucherTransition,
  canPurchaseInvoiceTransition,
  canSupplierContractTransition,
  canSupplierDocumentTransition,
  canSupplierEvaluationTransition,
  checkEvaluationScores,
  checkInvoiceArithmetic,
  checkPayment,
  chequeEarlyWarning,
  evaluationGrade,
  threeWayMatch,
} from '../../src/core/procurement';
import type { RuleDefinition } from '../../src/core/rules';

const ctx = (companyId: string, roleLevel = 5, plantIds: string[] = []): B1Context => ({
  tenant: { companyId, plantIds, userId: 'USR-M9', requestId: 'm9-test' },
  actor: {
    userId: 'USR-M9',
    username: 'm9-tester',
    roleLevel: roleLevel as B1Context['actor']['roleLevel'],
    ip: '127.0.0.1',
    requestId: 'm9-test',
  },
});

const rule = (code: string, value: number | null): RuleDefinition => ({
  code,
  module: 'procurement',
  classification: 'approval_required',
  value,
  unit: '%',
  sourceNote: 'M9 test',
  status: 'active',
});

const scores = { quality: 90, delivery: 85, price: 80, responsiveness: 88 };

describe('procurement core', () => {
  test('the lifecycles only allow the documented moves', () => {
    expect(canSupplierEvaluationTransition('draft', 'published')).toBe(true);
    expect(canSupplierEvaluationTransition('published', 'superseded')).toBe(true);
    expect(canSupplierDocumentTransition('pending', 'verified')).toBe(true);
    expect(canSupplierDocumentTransition('verified', 'expired')).toBe(true);
    expect(canSupplierContractTransition('signed', 'active')).toBe(true);
    expect(canPurchaseInvoiceTransition('received', 'verified')).toBe(true);
    expect(canPurchaseInvoiceTransition('approved', 'paid')).toBe(true);
    expect(canPurchaseInvoiceTransition('paid', 'approved')).toBe(false);
    expect(canPaymentVoucherTransition('draft', 'approved')).toBe(true);
    expect(canPaymentVoucherTransition('cancelled', 'paid')).toBe(false);
  });

  test('evaluation scores are 0–100 and the grade is deterministic', () => {
    expect(checkEvaluationScores(scores).outcome).toBe('pass');
    expect(checkEvaluationScores({ ...scores, quality: -1 }).outcome).toBe('failure');
    expect(checkEvaluationScores({ ...scores, quality: 101 }).outcome).toBe('failure');
    expect(evaluationGrade(scores, 60, true).grade).toBe('B');
    expect(evaluationGrade({ ...scores, quality: 59 }, 60, true).grade).toBe('D');
    expect(evaluationGrade(scores, 60, false).grade).toBe('D');
    expect(evaluationGrade({ quality: 100, delivery: 100, price: 100, responsiveness: 70 }, 60, true).grade).toBe('A');
  });

  test('an unconfigured tolerance never matches; configured tolerances do', () => {
    const input = {
      poId: 'PO-1',
      poLines: [{ materialId: 'MAT-1', quantity: 10, unitPrice: 100 }],
      receiptLines: [{ materialId: 'MAT-1', quantity: 10, unitPrice: 100 }],
      invoiceLines: [{ materialId: 'MAT-1', quantity: 10, unitPrice: 100 }],
    };
    expect(threeWayMatch({ ...input, qtyRule: rule('q', null), priceRule: rule('p', null) }).outcome).toBe(
      'approval_required',
    );
    expect(threeWayMatch({ ...input, qtyRule: rule('q', 0), priceRule: rule('p', 0) }).outcome).toBe('pass');
    expect(
      threeWayMatch({
        ...input,
        invoiceLines: [{ materialId: 'MAT-1', quantity: 11, unitPrice: 100 }],
        qtyRule: rule('q', 0),
        priceRule: rule('p', 0),
      }).outcome,
    ).toBe('approval_required');
    expect(
      threeWayMatch({
        ...input,
        invoiceLines: [{ materialId: 'MAT-1', quantity: 10, unitPrice: 105 }],
        qtyRule: rule('q', 0),
        priceRule: rule('p', 0),
      }).outcome,
    ).toBe('approval_required');
  });

  test('invoice arithmetic must agree with its lines and tax', () => {
    expect(
      checkInvoiceArithmetic(100, 14, 114, [{ quantity: 10, unitPrice: 10, total: 100 }]).outcome,
    ).toBe('pass');
    expect(
      checkInvoiceArithmetic(120, 14, 134, [{ quantity: 10, unitPrice: 10, total: 100 }]).outcome,
    ).toBe('failure');
    expect(
      checkInvoiceArithmetic(100, 14, 114, [{ quantity: 10, unitPrice: 10, total: 101 }]).outcome,
    ).toBe('failure');
  });

  test('payment needs an approved invoice and may not exceed the outstanding', () => {
    const approved = {
      paymentType: 'supplier_payment' as const,
      amount: 40,
      invoiceStatus: 'approved' as const,
      invoiceTotal: 100,
      invoicePaid: 10,
    };
    expect(checkPayment(approved).every((check) => check.outcome === 'pass')).toBe(true);
    expect(checkPayment({ ...approved, invoiceStatus: 'received' })[0]?.outcome).toBe('failure');
    expect(checkPayment({ ...approved, amount: 91 })[1]?.outcome).toBe('failure');
    expect(checkPayment({ ...approved, paymentType: 'customer_receipt' })[0]?.outcome).toBe('pass');
    expect(chequeEarlyWarning('cheque', '2026-01-01', '2026-02-01').outcome).toBe('warning');
    expect(chequeEarlyWarning('cheque', '2026-02-01', '2026-02-01').outcome).toBe('pass');
  });

  test('AP aging buckets a synthetic ledger', () => {
    const rows = apAging(
      [
        { supplierId: 'S1', dueDate: '2026-10-20', invoiceDate: '2026-10-01', total: 100, paid: 0 },
        { supplierId: 'S1', dueDate: '2026-09-10', invoiceDate: '2026-09-01', total: 200, paid: 50 },
        { supplierId: 'S1', dueDate: '2026-08-10', invoiceDate: '2026-07-20', total: 300, paid: 0 },
        { supplierId: 'S1', dueDate: '2026-06-01', invoiceDate: '2026-05-20', total: 400, paid: 0 },
        { supplierId: 'S1', dueDate: '2026-10-01', invoiceDate: '2026-09-20', total: 100, paid: 100 },
      ],
      '2026-11-05',
    );
    expect(rows[0]).toEqual({
      supplierId: 'S1',
      bucket0To30: 100,
      bucket31To60: 150,
      bucket61To90: 300,
      bucket90Plus: 400,
      totalDue: 950,
    });
  });
});

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run M9 tests.';
if (SKIP_REASON) console.warn(`[M9 procurement tests skipped] ${SKIP_REASON}`);
const describeDb = SKIP_REASON ? describe.skip : describe;

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PLANT_A = 'PLT-0001';
const PLANT_B = 'PLT-0002';
const COMPANY_A = 'CMP-0001';
const COMPANY_B = 'CMP-0002';
const AS_OF = '2026-11-05';

const expectM1 = async (run: () => Promise<unknown>, code: string, status?: number): Promise<M1Error> => {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(M1Error);
  const error = caught as M1Error;
  expect(error.code).toBe(code);
  if (status !== undefined) expect(error.status).toBe(status);
  return error;
};

describeDb('procurement repository', () => {
  let admin: Db;
  let app: Db;
  let procurement: ProcurementService;
  let inventory: InventoryService;
  let materialId = '';
  let counter = 0;

  const suffix = () => `${tag}-${++counter}`;

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    procurement = new ProcurementService(app);
    inventory = new InventoryService(app);
    const material = await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe<{ id: string }>(
        `select id from materials where company_id = $1 and deleted_at is null limit 1`,
        [COMPANY_A],
      ),
    );
    materialId = material[0]?.id ?? '';
  });

  afterAll(async () => {
    await app?.close();
    await admin?.close();
  });

  const makeSupplier = async (prefix: string): Promise<string> => {
    const id = `SUP-M9-${prefix}-${suffix()}`;
    await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe(
        `insert into suppliers (id, company_id, plant_id, name_ar, name_en, phone, category, status)
         values ($1,$2,$3,$4,$4,'+201000000000','cement','active')`,
        [id, COMPANY_A, PLANT_A, id],
      ),
    );
    return id;
  };

  const addDocument = async (
    supplierId: string,
    status: 'pending' | 'verified' | 'expired' | 'rejected',
    validUntil: string,
  ): Promise<void> => {
    await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe(
        `insert into supplier_documents (id, company_id, plant_id, supplier_id, doc_type,
            document_ref, valid_from, valid_until, status, verified_by, verified_at)
         values ($1,$2,$3,$4,'registration',$1,'2020-01-01',$5,$6,'m9',$7)`,
        [
          `DOC-M9-${suffix()}`,
          COMPANY_A,
          PLANT_A,
          supplierId,
          validUntil,
          status,
          status === 'verified' || status === 'expired' ? new Date().toISOString() : null,
        ],
      ),
    );
  };

  const setTolerances = async (qty: number | null, price: number | null): Promise<void> => {
    await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe(
        `update rule_definitions set value = $2, source_note = 'M9 test configured'
          where company_id = $1 and code = 'procurement.match_qty_tolerance_pct'`,
        [COMPANY_A, qty],
      ),
    );
    await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe(
        `update rule_definitions set value = $2, source_note = 'M9 test configured'
          where company_id = $1 and code = 'procurement.match_price_tolerance_pct'`,
        [COMPANY_A, price],
      ),
    );
  };

  const makePoAndReceipt = async (
    supplierId: string,
    quantity = 10,
    price = 100,
  ): Promise<{ poId: string; materialId: string }> => {
    const ref = suffix();
    const poId = `PO-M9-${ref}`;
    const poItemId = `POI-M9-${ref}`;
    const receiptId = `GRN-M9-${ref}`;
    await app.withTenant(ctx(COMPANY_A).tenant, async (tx) => {
      await tx.unsafe(
        `insert into purchase_orders (id, company_id, plant_id, po_no, supplier_id, order_date,
            subtotal, tax_amount, total, status)
         values ($1,$2,$3,$4,$5,'2026-10-01',$6,0,$6,'confirmed')`,
        [poId, COMPANY_A, PLANT_A, poId, supplierId, quantity * price],
      );
      await tx.unsafe(
        `insert into po_items (id, company_id, plant_id, po_id, material_id, unit_price, quantity_ordered)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [poItemId, COMPANY_A, PLANT_A, poId, materialId, price, quantity],
      );
      await tx.unsafe(
        `insert into goods_receipts (id, company_id, plant_id, receipt_no, purchase_order_id,
            received_on, status, confirmed_at, confirmed_by)
         values ($1,$2,$3,$4,$5,'2026-10-02','confirmed',now(),'m9')`,
        [receiptId, COMPANY_A, PLANT_A, receiptId, poId],
      );
      await tx.unsafe(
        `insert into receipt_items (id, company_id, plant_id, receipt_id, po_item_id,
            quantity_received, unit_cost)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [`RI-M9-${ref}`, COMPANY_A, PLANT_A, receiptId, poItemId, quantity, price],
      );
    });
    return { poId, materialId };
  };

  const createInvoice = async (
    supplierId: string,
    poId: string | null,
    quantity = 10,
    price = 100,
    options: { invoiceNo?: string; subtotal?: number; total?: number; reason?: string; role?: number } = {},
  ) => {
    const context = ctx(COMPANY_A, options.role ?? 5);
    return procurement.createInvoice(context, {
      plantId: PLANT_A,
      supplierId,
      poId,
      invoiceNo: options.invoiceNo,
      invoiceDate: '2026-10-03',
      dueDate: '2026-11-02',
      taxAmount: 0,
      subtotal: options.subtotal,
      totalAmount: options.total,
      reason: options.reason,
      items: [{ materialId, quantity, unitPrice: price }],
    });
  };

  const approveInvoice = async (supplierId: string): Promise<{ id: string; total: number }> => {
    await setTolerances(0, 0);
    const { poId } = await makePoAndReceipt(supplierId);
    const invoice = await createInvoice(supplierId, poId);
    const id = String(invoice.id);
    await procurement.transitionInvoice(ctx(COMPANY_A, 3), id, 'verified');
    await procurement.transitionInvoice(ctx(COMPANY_A, 4), id, 'approved');
    return { id, total: Number(invoice.total_amount) };
  };

  test('a match inside tolerance passes; a variance beyond it needs approval', async () => {
    const supplierId = await makeSupplier('MATCH');
    await setTolerances(0, 0);
    const { poId } = await makePoAndReceipt(supplierId);
    const passed = await createInvoice(supplierId, poId);
    expect(passed.match_status).toBe('matched');
    expect(Number(passed.total_amount)).toBe(1000);

    await expectM1(
      () => createInvoice(supplierId, poId, 11, 100, { invoiceNo: `OVER-${suffix()}` }),
      'approval_required',
      403,
    );
    const overridden = await createInvoice(supplierId, poId, 11, 100, {
      invoiceNo: `OVR-${suffix()}`,
      reason: 'level four accepts the over receipt',
    });
    expect(overridden.match_status).toBe('matched');
    expect((overridden.match_details as Record<string, unknown>).override).toBe(true);
  });

  test('invoice arithmetic mismatch and duplicate supplier invoice are refused', async () => {
    const supplierId = await makeSupplier('ARITH');
    await expectM1(
      () =>
        createInvoice(supplierId, null, 10, 100, {
          invoiceNo: `BAD-${suffix()}`,
          subtotal: 1000,
          total: 1200,
          role: 4,
        }),
      'invoice_arithmetic',
      422,
    );
    await setTolerances(0, 0);
    const { poId } = await makePoAndReceipt(supplierId);
    const invoiceNo = `DUP-${suffix()}`;
    await createInvoice(supplierId, poId, 10, 100, { invoiceNo });
    await expectM1(
      () => createInvoice(supplierId, poId, 10, 100, { invoiceNo }),
      'duplicate_invoice',
      422,
    );
  });

  test('payment without an approved invoice and overpayment are refused', async () => {
    const supplierId = await makeSupplier('PAY');
    await setTolerances(0, 0);
    const { poId } = await makePoAndReceipt(supplierId);
    const invoice = await createInvoice(supplierId, poId);
    const invoiceId = String(invoice.id);
    const base = {
      plantId: PLANT_A,
      supplierId,
      customerId: null,
      purchaseInvoiceId: invoiceId,
      paymentType: 'supplier_payment' as const,
      currency: 'EGP',
      method: 'bank_transfer' as const,
    };
    await expectM1(
      () => procurement.createVoucher(ctx(COMPANY_A, 3), { ...base, amount: 100 }),
      'payment_invoice_not_approved',
      422,
    );
    await procurement.transitionInvoice(ctx(COMPANY_A, 3), invoiceId, 'verified');
    await procurement.transitionInvoice(ctx(COMPANY_A, 4), invoiceId, 'approved');
    await expectM1(
      () => procurement.createVoucher(ctx(COMPANY_A, 3), { ...base, amount: 1001 }),
      'payment_exceeds_outstanding',
      422,
    );
    const voucher = await procurement.createVoucher(ctx(COMPANY_A, 3), { ...base, amount: 600 });
    const voucherId = String(voucher.id);
    await procurement.transitionVoucher(ctx(COMPANY_A, 4), voucherId, 'approved');
    await procurement.transitionVoucher(ctx(COMPANY_A, 3), voucherId, 'paid');
    const after = await procurement.getInvoice(ctx(COMPANY_A), invoiceId);
    expect(Number(after.paid_amount)).toBe(600);
    expect(after.status).toBe('approved');
  });

  test('an expired mandatory document blocks PO confirmation; level 4 recovers it', async () => {
    const supplierId = await makeSupplier('DOC');
    const created = await inventory.createPurchaseOrder(ctx(COMPANY_A, 4), {
      plantId: PLANT_A,
      supplierId,
      prId: null,
      expectedDeliveryAt: null,
      items: [{ materialId, quantityOrdered: 1, unitPrice: 10, taxRate: 0, discountPct: 0 }],
    });
    await addDocument(supplierId, 'verified', '2020-01-01');
    const poId = String(created.id);
    await expectM1(() => inventory.confirmPurchaseOrder(ctx(COMPANY_A, 4), poId), 'approval_required', 403);
    const confirmed = await inventory.confirmPurchaseOrder(
      ctx(COMPANY_A, 4),
      poId,
      'document renewal is in progress and accepted',
    );
    expect(confirmed.status).toBe('confirmed');
  });

  test('a grade D evaluation suspends the supplier and blocks a new PO', async () => {
    const supplierId = await makeSupplier('GRADE');
    const evaluation = await procurement.createEvaluation(ctx(COMPANY_A, 3), {
      plantId: PLANT_A,
      supplierId,
      periodStart: '2026-01-01',
      periodEnd: '2026-06-30',
      quality: 40,
      delivery: 80,
      price: 80,
      responsiveness: 80,
    });
    await procurement.publishEvaluation(ctx(COMPANY_A, 4), String(evaluation.id));
    const supplier = await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe<{ status: string; overall_grade: string }>(
        `select s.status, e.overall_grade from suppliers s
           join supplier_evaluations e on e.company_id = s.company_id and e.supplier_id = s.id
          where s.company_id = $1 and s.id = $2 and e.status = 'published'`,
        [COMPANY_A, supplierId],
      ),
    );
    expect(supplier[0]?.status).toBe('suspended');
    expect(supplier[0]?.overall_grade).toBe('D');
    await expectM1(
      () =>
        inventory.createPurchaseOrder(ctx(COMPANY_A, 4), {
          plantId: PLANT_A,
          supplierId,
          prId: null,
          expectedDeliveryAt: null,
          items: [{ materialId, quantityOrdered: 1, unitPrice: 10, taxRate: 0, discountPct: 0 }],
        }),
      'supplier_suspended',
      422,
    );
  });

  test('AP aging reads the approved outstanding ledger', async () => {
    const supplierId = await makeSupplier('AGING');
    const { id } = await approveInvoice(supplierId);
    const rows = await procurement.apAging(ctx(COMPANY_A), AS_OF);
    const row = rows.find((entry) => String(entry.supplierId) === supplierId);
    expect(row).toBeDefined();
    expect(Number(row?.totalDue)).toBeGreaterThanOrEqual(1000);
    const invoice = await procurement.getInvoice(ctx(COMPANY_A), id);
    expect(invoice.status).toBe('approved');
  });

  test('all new tables stay inside their tenant and plant', async () => {
    const supplierId = await makeSupplier('ISO');
    const ref = suffix();
    await app.withTenant(ctx(COMPANY_A).tenant, async (tx) => {
      await tx.unsafe(
        `insert into supplier_documents (id, company_id, plant_id, supplier_id, doc_type,
            document_ref, valid_from, status)
         values ($1,$2,$3,$4,'licence',$1,'2026-01-01','pending')`,
        [`DOC-ISO-${ref}`, COMPANY_A, PLANT_A, supplierId],
      );
      await tx.unsafe(
        `insert into supplier_evaluations (id, company_id, plant_id, evaluation_no, supplier_id,
            period_start, period_end, quality_score_0_to_100, delivery_score_0_to_100,
            price_score_0_to_100, responsiveness_score_0_to_100, evaluator_id, status)
         values ($1,$2,$3,$4,$5,'2026-01-01','2026-06-30',80,80,80,80,'m9','draft')`,
        [`SEV-ISO-${ref}`, COMPANY_A, PLANT_A, `SEV-ISO-${ref}`, supplierId],
      );
      await tx.unsafe(
        `insert into supplier_contracts (id, company_id, plant_id, contract_no, supplier_id,
            start_date, status)
         values ($1,$2,$3,$4,$5,'2026-01-01','draft')`,
        [`SCN-ISO-${ref}`, COMPANY_A, PLANT_A, `SCN-ISO-${ref}`, supplierId],
      );
      await tx.unsafe(
        `insert into purchase_invoices (id, company_id, plant_id, invoice_no, supplier_id,
            invoice_date, subtotal, total_amount, status)
         values ($1,$2,$3,$4,$5,'2026-10-01',10,10,'received')`,
        [`PIV-ISO-${ref}`, COMPANY_A, PLANT_A, `PIV-ISO-${ref}`, supplierId],
      );
      await tx.unsafe(
        `insert into purchase_invoice_items (id, company_id, plant_id, invoice_id, line_no,
            material_id, quantity, unit_price, total)
         values ($1,$2,$3,$4,1,$5,1,10,10)`,
        [`PIVL-ISO-${ref}`, COMPANY_A, PLANT_A, `PIV-ISO-${ref}`, materialId],
      );
      await tx.unsafe(
        `insert into payments_vouchers (id, company_id, plant_id, voucher_no, supplier_id,
            payment_type, amount, method, recorded_by, status)
         values ($1,$2,$3,$4,$5,'supplier_payment',10,'cash','m9','draft')`,
        [`PV-ISO-${ref}`, COMPANY_A, PLANT_A, `PV-ISO-${ref}`, supplierId],
      );
      await tx.unsafe(
        `insert into ap_aging_snapshot (id, company_id, plant_id, supplier_id, snapshot_date,
            bucket_0_30, total_due)
         values ($1,$2,$3,$4,'2026-11-05',10,10)`,
        [`AP-ISO-${ref}`, COMPANY_A, PLANT_A, supplierId],
      );
    });

    const tables = [
      'supplier_evaluations',
      'supplier_documents',
      'supplier_contracts',
      'purchase_invoices',
      'purchase_invoice_items',
      'payments_vouchers',
      'ap_aging_snapshot',
    ];
    for (const table of tables) {
      const otherTenant = await app.withTenant(ctx(COMPANY_B).tenant, (tx) =>
        tx.unsafe<{ count: string }>(`select count(*)::text as count from ${table}`),
      );
      expect(Number(otherTenant[0]?.count ?? 0)).toBe(0);
      const foreignPlant = await app.withTenant(ctx(COMPANY_A, 5, [PLANT_B]).tenant, (tx) =>
        tx.unsafe<{ count: string }>(`select count(*)::text as count from ${table}`),
      );
      expect(Number(foreignPlant[0]?.count ?? 0)).toBe(0);
    }
  });
});
