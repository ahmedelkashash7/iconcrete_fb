/**
 * M7 — orders and distribution.
 *
 * The pure block pins the quotation/contract/order lifecycles, the credit bands, the blacklist
 * block and the delivery-volume checks. The database block proves what only PostgreSQL and the
 * repository can: versions are append-only, a signed contract keeps its pinned quotation version
 * when a later version is approved, credit and discount gates require a level-4 reason, duplicate
 * documents are refused, a ticket links a trip and a truck and can carry several batches, partial
 * delivery is derived from tickets, and RLS plus the service keep tenants and plants apart.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { SalesService } from '../../server/services/sales';
import type { B1Context } from '../../server/services/projects';
import {
  buildContractSnapshot,
  canContractTransition,
  canQuotationTransition,
  canSalesOrderTransition,
  canTicketTransition,
  checkBatchCoverage,
  checkBlacklist,
  checkTicketReferences,
  checkVolumeVariance,
  creditDecision,
  deliveredVolume,
  lineTotal,
  missingSalesRule,
  SALES_RULE_CODES,
} from '../../src/core/sales';
import { evaluateRule } from '../../src/core/rules';

const ctx = (companyId: string, roleLevel = 5, plantIds: string[] = []): B1Context => ({
  tenant: { companyId, plantIds, userId: 'USR-M7', requestId: 'm7-test' },
  actor: {
    userId: 'USR-M7',
    username: 'm7-tester',
    roleLevel: roleLevel as B1Context['actor']['roleLevel'],
    ip: '127.0.0.1',
    requestId: 'm7-test',
  },
});

describe('sales core', () => {
  test('the lifecycles only allow the documented moves', () => {
    expect(canQuotationTransition('draft', 'submitted')).toBe(true);
    expect(canQuotationTransition('submitted', 'approved')).toBe(true);
    expect(canQuotationTransition('approved', 'superseded')).toBe(true);
    expect(canQuotationTransition('approved', 'draft')).toBe(false);
    expect(canContractTransition('draft', 'signed')).toBe(true);
    expect(canContractTransition('signed', 'active')).toBe(true);
    expect(canContractTransition('void', 'active')).toBe(false);
    expect(canSalesOrderTransition('draft', 'confirmed')).toBe(true);
    expect(canSalesOrderTransition('confirmed', 'on_hold')).toBe(true);
    expect(canSalesOrderTransition('in_production', 'cancelled')).toBe(false);
    expect(canSalesOrderTransition('on_hold', 'in_production')).toBe(true);
    expect(canTicketTransition('draft', 'confirmed')).toBe(true);
    expect(canTicketTransition('delivered', 'voided')).toBe(false);
  });

  test('a blacklisted customer and a ticket without trip/truck are hard failures', () => {
    expect(checkBlacklist(true).outcome).toBe('failure');
    expect(checkBlacklist(true).reasonKey).toBe('sales.customer_blacklisted');
    expect(checkBlacklist(false).outcome).toBe('pass');
    expect(checkTicketReferences('', 'TRK-1').outcome).toBe('failure');
    expect(checkTicketReferences('TRP-1', '').outcome).toBe('failure');
    expect(checkTicketReferences('TRP-1', 'TRK-1').outcome).toBe('pass');
  });

  test('volume variance and batch coverage keep ticket evidence honest', () => {
    expect(checkVolumeVariance(8, 8).outcome).toBe('pass');
    expect(checkVolumeVariance(8, 8.5).outcome).toBe('approval_required');
    expect(checkBatchCoverage([4, 4], 8).outcome).toBe('pass');
    expect(checkBatchCoverage([4, 3], 8).outcome).toBe('failure');
    expect(checkBatchCoverage([], 8).outcome).toBe('pass');
  });

  test('credit warns above 100% and needs approval above 110%', () => {
    expect(creditDecision(900, 1000).band).toBe('pass');
    expect(creditDecision(1050, 1000).band).toBe('warn');
    expect(creditDecision(1050, 1000).check.reasonKey).toBe('sales.credit_warn');
    expect(creditDecision(1150, 1000).band).toBe('approval_required');
    expect(creditDecision(1150, 1000).check.outcome).toBe('approval_required');
    const unlimited = creditDecision(5000, null);
    expect(unlimited.band).toBe('pass');
    expect(unlimited.ratio).toBeNull();
  });

  test('a discount without a configured threshold never passes', () => {
    const rule = missingSalesRule('discountApproval');
    expect(rule.code).toBe(SALES_RULE_CODES.discountApproval);
    const evaluation = evaluateRule(rule, { actual: 5, comparator: 'lte' });
    expect(evaluation.outcome).toBe('approval_required');
    expect(evaluation.reasonKey).toBe('rule.value_missing');
  });

  test('only confirmed and delivered tickets count towards delivery progress', () => {
    expect(
      deliveredVolume([
        { status: 'draft', deliveredVol: 99 },
        { status: 'confirmed', deliveredVol: 4 },
        { status: 'delivered', deliveredVol: 3 },
        { status: 'voided', deliveredVol: 10 },
      ]),
    ).toBe(7);
    expect(lineTotal({ quantity: 2, unitPrice: 100, discountPct: 10, taxRate: 14 })).toBe(205.2);
  });

  test('a version snapshot is a copy, not a reference to live rows', () => {
    const snapshot = buildContractSnapshot({
      contractId: 'CTR-1',
      customerId: 'CUS-1',
      quotationVersionId: 'QTV-1',
      startDate: null,
      endDate: null,
      terms: 'terms',
      status: 'signed',
      capturedAt: '2026-11-04T00:00:00Z',
    });
    expect(snapshot.quotationVersionId).toBe('QTV-1');
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run M7 tests.';

if (SKIP_REASON) console.warn(`[M7 orders tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PLANT_A = 'PLT-0001';
const PLANT_B = 'PLT-0002';
const COMPANY_A = 'CMP-0001';
const COMPANY_B = 'CMP-0002';

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

describeDb('sales repository', () => {
  let admin: Db;
  let app: Db;
  let sales: SalesService;
  let materialId = '';
  let truckId = '';
  let driverId = '';
  let tripId = '';
  let counter = 0;

  const suffix = () => `${tag}-${++counter}`;

  beforeAll(async () => {
    admin = (await createDb({ mode: 'postgres', databaseUrl: ADMIN_URL })) as Db;
    app = (await createDb({ mode: 'postgres', databaseUrl: RLS_URL })) as Db;
    await migrate(admin);
    sales = new SalesService(app);

    const materials = await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe<{ id: string }>(
        `select id from materials where company_id = $1 and deleted_at is null limit 1`,
        [COMPANY_A],
      ),
    );
    if (materials[0]) {
      materialId = materials[0].id;
    } else {
      materialId = `MAT-M7-${tag}`;
      await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
        tx.unsafe(
          `insert into materials (id, company_id, plant_id, material_code, name_ar, name_en,
             category, unit_of_measure, is_bulk, valuation_method)
           values ($1,$2,$3,$4,'خرسانة جاهزة','Ready-mix','other','m3',true,'weighted_average')`,
          [materialId, COMPANY_A, PLANT_A, materialId],
        ),
      );
    }

    truckId = `TRK-M7-${tag}`;
    driverId = `DRV-M7-${tag}`;
    tripId = `TRP-M7-${tag}`;
    const assignmentId = `ASG-M7-${tag}`;
    await app.withTenant(ctx(COMPANY_A).tenant, async (tx) => {
      await tx.unsafe(
        `insert into trucks (id, company_id, plant_id, plate_no, capacity_m3)
         values ($1,$2,$3,$4,10)`,
        [truckId, COMPANY_A, PLANT_A, `M7-${tag}`],
      );
      await tx.unsafe(
        `insert into drivers (id, company_id, plant_id, full_name, licence_no)
         values ($1,$2,$3,'M7 Driver',$4)`,
        [driverId, COMPANY_A, PLANT_A, `LIC-M7-${tag}`],
      );
      await tx.unsafe(
        `insert into dispatch_assignments (id, company_id, plant_id, truck_id, driver_id, status)
         values ($1,$2,$3,$4,$5,'confirmed')`,
        [assignmentId, COMPANY_A, PLANT_A, truckId, driverId],
      );
      await tx.unsafe(
        `insert into trips (id, company_id, plant_id, assignment_id, truck_id, status)
         values ($1,$2,$3,$4,$5,'planned')`,
        [tripId, COMPANY_A, PLANT_A, assignmentId, truckId],
      );
    });
  });

  afterAll(async () => {
    await app?.close();
    await admin?.close();
  });

  const makeCustomer = async (
    overrides: { creditLimit?: number | null; blacklisted?: boolean; companyId?: string; level?: number } = {},
  ) =>
    sales.createCustomer(ctx(overrides.companyId ?? COMPANY_A, overrides.level ?? 5), {
      plantId: PLANT_A,
      customerCode: `CUS-${suffix()}`,
      nameAr: `عميل ${tag}`,
      nameEn: `Customer ${tag}`,
      contactPerson: 'Site engineer',
      phone: '01000000000',
      creditLimit: overrides.creditLimit === undefined ? 100000 : overrides.creditLimit,
      blacklisted: overrides.blacklisted === true,
      blacklistReason: overrides.blacklisted ? 'unpaid balance' : undefined,
    });

  const makeQuotation = async (
    customerId: string,
    quantity = 10,
    unitPrice = 100,
    level = 5,
    validUntil = '2099-12-31',
  ) => {
    const quotation = await sales.createQuotation(ctx(COMPANY_A, level), {
      plantId: PLANT_A,
      quotationNo: `QTN-${suffix()}`,
      customerId,
      validUntil,
      items: [{ materialId, description: 'C30', quantity, unitPrice }],
    });
    return quotation;
  };

  const approvedQuotation = async (
    customerId: string,
    quantity = 10,
    unitPrice = 100,
  ) => {
    const quotation = await makeQuotation(customerId, quantity, unitPrice);
    await sales.submitQuotation(ctx(COMPANY_A), quotation.id);
    return sales.approveQuotation(ctx(COMPANY_A), quotation.id, 'priced');
  };

  const makeOrder = async (
    customerId: string,
    quantity: number,
    unitPrice: number,
    extra: { quotationId?: string | null; contractId?: string | null; level?: number; reason?: string; orderNo?: string } = {},
  ) => {
    const quotationId =
      extra.quotationId !== undefined
        ? extra.quotationId
        : extra.contractId
          ? null
          : (await approvedQuotation(customerId, quantity, unitPrice)).id;
    return sales.createSalesOrder(ctx(COMPANY_A, extra.level ?? 5), {
      plantId: PLANT_A,
      orderNo: extra.orderNo ?? `SO-${suffix()}`,
      customerId,
      quotationId,
      contractId: extra.contractId ?? null,
      deliveryDate: '2026-12-01',
      items: [{ materialId, description: 'C30', quantity, unitPrice }],
      reason: extra.reason,
    });
  };

  dbTest('quotation versions are immutable and a revision appends version 2', async () => {
    const customer = await makeCustomer();
    const quotation = await approvedQuotation(customer.id, 10, 100);
    expect(quotation.versions.length).toBe(1);
    const first = quotation.versions[0]!;
    expect(first.version_no).toBe(1);

    let appendOnly = false;
    try {
      await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
        tx.unsafe(`update quotation_versions set reason = 'edited' where id = $1`, [first.id]),
      );
    } catch (error) {
      appendOnly =
        error instanceof Error && /append-only|restrict|permission denied/i.test(error.message);
    }
    expect(appendOnly).toBe(true);

    await sales.reviseQuotation(ctx(COMPANY_A), quotation.id, 'customer changed the quantity');
    const revised = await sales.getQuotation(ctx(COMPANY_A), quotation.id);
    expect(revised.status).toBe('draft');
    await sales.submitQuotation(ctx(COMPANY_A), quotation.id);
    const second = await sales.approveQuotation(ctx(COMPANY_A), quotation.id, 'revision approved');
    expect(second.versions.length).toBe(2);
    expect(second.versions.map((version) => version.version_no).sort()).toEqual([1, 2]);
    const stillFirst = second.versions.find((version) => version.id === first.id);
    expect(stillFirst?.version_no).toBe(1);
    expect(stillFirst?.reason).toBe('priced');
  });

  dbTest('a signed contract pins its quotation version and a new version cannot move it', async () => {
    const customer = await makeCustomer();
    const quotation = await approvedQuotation(customer.id, 10, 100);
    const versionOne = quotation.versions[0]!;
    const contract = await sales.createContract(ctx(COMPANY_A), {
      plantId: PLANT_A,
      contractNo: `CTR-${suffix()}`,
      quotationVersionId: versionOne.id,
      startDate: '2026-11-01',
      endDate: '2027-11-01',
      terms: 'monthly settlement',
    });
    expect(contract.quotation_version_id).toBe(versionOne.id);
    const signed = await sales.signContract(ctx(COMPANY_A), contract.id);
    expect(signed.status).toBe('signed');
    expect(signed.versions.length).toBe(1);

    await sales.reviseQuotation(ctx(COMPANY_A), quotation.id, 'new price');
    await sales.submitQuotation(ctx(COMPANY_A), quotation.id);
    await sales.approveQuotation(ctx(COMPANY_A), quotation.id, 'new price approved');

    const after = await sales.getContract(ctx(COMPANY_A), contract.id);
    expect(after.quotation_version_id).toBe(versionOne.id);
    expect(after.status).toBe('signed');

    const quoteNow = await sales.getQuotation(ctx(COMPANY_A), quotation.id);
    expect(quoteNow.versions.length).toBe(2);
  });

  dbTest('credit warns above 100% and needs a level-4 reason above 110%', async () => {
    const warnCustomer = await makeCustomer({ creditLimit: 1000 });
    const warn = await makeOrder(warnCustomer.id, 10, 105, { level: 3 });
    expect(warn.credit_status).toBe('warn');

    const approvalCustomer = await makeCustomer({ creditLimit: 1000 });
    const first = await makeOrder(approvalCustomer.id, 5, 100, { level: 3 });
    expect(first.credit_status).toBe('pass');
    await expectM1(
      () => makeOrder(approvalCustomer.id, 7, 100, { level: 3 }),
      'approval_required',
      403,
    );
    const allowed = await makeOrder(approvalCustomer.id, 7, 100, {
      level: 4,
      reason: 'purchase order signed by the customer',
    });
    expect(allowed.credit_status).toBe('approval_required');
  });

  dbTest('a blacklisted customer is blocked at every level', async () => {
    const customer = await makeCustomer({ blacklisted: true });
    const quotation = await approvedQuotation(customer.id, 1, 100);
    await expectM1(
      () =>
        sales.createSalesOrder(ctx(COMPANY_A, 5), {
          plantId: PLANT_A,
          orderNo: `SO-BL-${suffix()}`,
          customerId: customer.id,
          quotationId: quotation.id,
          items: [{ materialId, description: 'C30', quantity: 1, unitPrice: 100 }],
          reason: 'owner override',
        }),
      'customer_blacklisted',
      422,
    );
  });

  dbTest('duplicate quotation, order and ticket numbers are refused', async () => {
    const customer = await makeCustomer();
    const number = `QTN-DUP-${suffix()}`;
    await sales.createQuotation(ctx(COMPANY_A), {
      plantId: PLANT_A,
      quotationNo: number,
      customerId: customer.id,
      validUntil: '2099-12-31',
      items: [{ materialId, quantity: 1, unitPrice: 100 }],
    });
    await expectM1(
      () =>
        sales.createQuotation(ctx(COMPANY_A), {
          plantId: PLANT_A,
          quotationNo: number,
          customerId: customer.id,
          validUntil: '2099-12-31',
          items: [{ materialId, quantity: 1, unitPrice: 100 }],
        }),
      'duplicate_quotation',
      422,
    );

    const orderNo = `SO-DUP-${suffix()}`;
    await makeOrder(customer.id, 1, 100, { orderNo });
    await expectM1(() => makeOrder(customer.id, 1, 100, { orderNo }), 'duplicate_order', 422);

    const order = await makeOrder(customer.id, 2, 100);
    await sales.confirmOrder(ctx(COMPANY_A), order.id);
    const ticketNo = `DT-DUP-${suffix()}`;
    const ticket = await sales.createDeliveryTicket(ctx(COMPANY_A), {
      ticketNo,
      orderId: order.id,
      tripId,
      truckId,
      driverId,
      loadedVol: 2,
    });
    expect(ticket.status).toBe('draft');
    await expectM1(
      () =>
        sales.createDeliveryTicket(ctx(COMPANY_A), {
          ticketNo,
          orderId: order.id,
          tripId,
          truckId,
          driverId,
          loadedVol: 1,
        }),
      'duplicate_ticket',
      422,
    );
  });

  dbTest('a ticket links its trip and truck, carries several batches, and partial delivery is derived', async () => {
    const customer = await makeCustomer();
    const order = await makeOrder(customer.id, 10, 100);
    await sales.confirmOrder(ctx(COMPANY_A), order.id);

    await expectM1(
      () =>
        sales.createDeliveryTicket(ctx(COMPANY_A), {
          orderId: order.id,
          tripId: '',
          truckId,
          loadedVol: 4,
        }),
      'ticket_references',
      422,
    );

    const first = await sales.createDeliveryTicket(ctx(COMPANY_A), {
      ticketNo: `DT-${suffix()}`,
      orderId: order.id,
      tripId,
      truckId,
      driverId,
      loadedVol: 6,
      deliveredVol: 6,
      batches: [
        { volumeM3: 4, pricePerM3: 100 },
        { volumeM3: 2, pricePerM3: 100 },
      ],
    });
    expect(first.batches.length).toBe(2);
    expect(first.trip_id).toBe(tripId);
    expect(first.truck_id).toBe(truckId);
    await sales.confirmDeliveryTicket(ctx(COMPANY_A), first.id);
    await sales.deliverDeliveryTicket(ctx(COMPANY_A), first.id);

    const afterFirst = await sales.getOrder(ctx(COMPANY_A), order.id);
    expect(afterFirst.delivery_state).toBe('partial');
    expect(afterFirst.delivered_qty).toBe(6);

    const second = await sales.createDeliveryTicket(ctx(COMPANY_A), {
      ticketNo: `DT-${suffix()}`,
      orderId: order.id,
      tripId,
      truckId,
      driverId,
      loadedVol: 4,
    });
    await sales.confirmDeliveryTicket(ctx(COMPANY_A), second.id);
    await sales.deliverDeliveryTicket(ctx(COMPANY_A), second.id);
    const full = await sales.getOrder(ctx(COMPANY_A), order.id);
    expect(full.delivered_qty).toBe(10);
    expect(full.delivery_state).toBe('full');
  });

  dbTest('a contract quantity limit and an order without any reference need approval', async () => {
    const customer = await makeCustomer();
    const quotation = await approvedQuotation(customer.id, 10, 100);
    const contract = await sales.createContract(ctx(COMPANY_A), {
      plantId: PLANT_A,
      contractNo: `CTR-${suffix()}`,
      quotationVersionId: quotation.versions[0]!.id,
    });
    await sales.signContract(ctx(COMPANY_A), contract.id);

    const first = await makeOrder(customer.id, 8, 100, { contractId: contract.id });
    expect(first.contract_id).toBe(contract.id);
    await expectM1(
      () => makeOrder(customer.id, 3, 100, { contractId: contract.id, level: 3 }),
      'approval_required',
      403,
    );

    const noReference = await expectM1(
      () =>
        sales.createSalesOrder(ctx(COMPANY_A, 3), {
          plantId: PLANT_A,
          customerId: customer.id,
          items: [{ materialId, description: 'C30', quantity: 1, unitPrice: 100 }],
        }),
      'approval_required',
      403,
    );
    expect(noReference.details?.check).toBe('salesReference');
  });

  dbTest('cross-plant writes are refused and RLS hides the other plant and tenant', async () => {
    const customer = await makeCustomer();
    const quotation = await approvedQuotation(customer.id, 1, 100);

    await expectM1(
      () =>
        sales.createSalesOrder(ctx(COMPANY_A, 5, [PLANT_A]), {
          plantId: PLANT_B,
          customerId: customer.id,
          quotationId: quotation.id,
          items: [{ materialId, description: 'C30', quantity: 1, unitPrice: 100 }],
        }),
      'plant_scope',
      403,
    );

    const order = await makeOrder(customer.id, 1, 100);
    const hidden = await sales.listOrders(ctx(COMPANY_A, 5, [PLANT_B]));
    expect(hidden.some((row) => row.id === order.id)).toBe(false);

    const otherTenant = await sales.listOrders(ctx(COMPANY_B, 5));
    expect(otherTenant.some((row) => row.id === order.id)).toBe(false);
    const otherContracts = await sales.listContracts(ctx(COMPANY_B, 5));
    expect(otherContracts.some((row) => row.customer_id === customer.id)).toBe(false);
  });
});
