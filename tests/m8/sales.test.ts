/**
 * M8 — sales pricing, volume commitments, CRM and complaints.
 *
 * The pure block pins the precedence order, ambiguity, commitment bands, rating and season
 * checks. The database block proves the parts that need PostgreSQL: a real order resolves the
 * highest-precedence source, the copied unit price survives a later catalogue change, ambiguity
 * and a missing price block instead of guessing, overlapping active lists are refused, the
 * commitment warning/approval bands fire through order creation, a quality complaint needs its
 * NCR, and tenants and plants stay apart.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '../../server/db/client';
import { migrate } from '../../server/db/migrate';
import { M1Error } from '../../server/services/m1';
import { SalesService } from '../../server/services/sales';
import type { B1Context } from '../../server/services/projects';
import {
  canActivityTransition,
  canCommitmentTransition,
  canComplaintTransition,
  canPriceListTransition,
  checkComplaintNcr,
  checkFeedbackRating,
  checkPriceDecision,
  checkPriceListOverlap,
  checkSeasonWindow,
  choosePrice,
  commitmentDecision,
  missingCommitmentRule,
} from '../../src/core/crm';

const ctx = (companyId: string, roleLevel = 5, plantIds: string[] = []): B1Context => ({
  tenant: { companyId, plantIds, userId: 'USR-M8', requestId: 'm8-test' },
  actor: {
    userId: 'USR-M8',
    username: 'm8-tester',
    roleLevel: roleLevel as B1Context['actor']['roleLevel'],
    ip: '127.0.0.1',
    requestId: 'm8-test',
  },
});

const configured = (code: string, value: number, classification: 'warning' | 'approval_required') => ({
  code,
  module: 'sales' as const,
  classification,
  value,
  unit: '%',
  sourceNote: 'M8 execution specification',
  status: 'active' as const,
});

describe('sales pricing and CRM core', () => {
  test('the lifecycles only allow the documented moves', () => {
    expect(canPriceListTransition('draft', 'active')).toBe(true);
    expect(canPriceListTransition('active', 'superseded')).toBe(true);
    expect(canPriceListTransition('expired', 'active')).toBe(false);
    expect(canCommitmentTransition('draft', 'active')).toBe(true);
    expect(canCommitmentTransition('active', 'breached')).toBe(true);
    expect(canCommitmentTransition('cancelled', 'active')).toBe(false);
    expect(canActivityTransition('open', 'done')).toBe(true);
    expect(canActivityTransition('done', 'open')).toBe(false);
    expect(canComplaintTransition('open', 'investigating')).toBe(true);
    expect(canComplaintTransition('resolved', 'closed')).toBe(true);
    expect(canComplaintTransition('closed', 'investigating')).toBe(false);
  });

  test('the precedence is contract, commitment, seasonal, price list', () => {
    const sources = [
      { sourceType: 'price_list' as const, sourceId: 'PL-1', price: 100 },
      { sourceType: 'seasonal' as const, sourceId: 'SEA-1', price: 120 },
      { sourceType: 'volume_commitment' as const, sourceId: 'VCM-1', price: 140 },
      { sourceType: 'contract' as const, sourceId: 'CTR-1', price: 160 },
    ];
    const winner = choosePrice(sources);
    expect(winner.outcome).toBe('resolved');
    if (winner.outcome === 'resolved') {
      expect(winner.candidate.sourceType).toBe('contract');
      expect(winner.candidate.price).toBe(160);
    }
    expect(choosePrice([sources[0]!]).outcome).toBe('resolved');
    expect(choosePrice([]).outcome).toBe('none');
  });

  test('two sources at the winning rank are ambiguous, never a silent pick', () => {
    const decision = choosePrice([
      { sourceType: 'seasonal', sourceId: 'SEA-1', price: 120 },
      { sourceType: 'seasonal', sourceId: 'SEA-2', price: 110 },
      { sourceType: 'price_list', sourceId: 'PL-1', price: 100 },
    ]);
    expect(decision.outcome).toBe('ambiguous');
    expect(checkPriceDecision(decision).outcome).toBe('approval_required');
    expect(checkPriceDecision({ outcome: 'none' }).reasonKey).toBe('sales.price_missing');
  });

  test('overlapping active lists are a mandatory failure', () => {
    expect(
      checkPriceListOverlap({ from: '2026-01-01', to: '2026-12-31' }, [
        { from: '2026-06-01', to: '2027-06-01' },
      ]).outcome,
    ).toBe('failure');
    expect(
      checkPriceListOverlap({ from: '2027-01-01', to: '2027-12-31' }, [
        { from: '2026-06-01', to: '2026-12-31' },
      ]).outcome,
    ).toBe('pass');
  });

  test('commitment warns above 95% and needs approval beyond 100%', () => {
    const warn = configured('sales.commitment_warn_pct', 95, 'warning');
    const approval = configured('sales.commitment_approval_pct', 100, 'approval_required');
    expect(commitmentDecision(100, 90, 4, warn, approval).outcome).toBe('pass');
    expect(commitmentDecision(100, 90, 6, warn, approval).outcome).toBe('warning');
    expect(commitmentDecision(100, 90, 11, warn, approval).outcome).toBe('approval_required');
    const missing = commitmentDecision(
      100,
      101,
      0,
      missingCommitmentRule('warn'),
      missingCommitmentRule('approval'),
    );
    expect(missing.outcome).toBe('approval_required');
  });

  test('rating, season and quality complaint checks are mandatory failures', () => {
    expect(checkFeedbackRating(3).outcome).toBe('pass');
    expect(checkFeedbackRating(0).outcome).toBe('failure');
    expect(checkFeedbackRating(6).outcome).toBe('failure');
    expect(checkSeasonWindow('2026-06-01', '2026-05-01').outcome).toBe('failure');
    expect(checkSeasonWindow('2026-06-01', '2026-09-01').outcome).toBe('pass');
    expect(checkComplaintNcr(true, null).outcome).toBe('failure');
    expect(checkComplaintNcr(true, 'NCR-1').outcome).toBe('pass');
    expect(checkComplaintNcr(false, null).outcome).toBe('pass');
  });
});

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const RLS_URL = process.env.ICONCRETE_RLS_URL ?? ADMIN_URL;
const SKIP_REASON = ADMIN_URL
  ? null
  : 'PostgreSQL not configured: set DATABASE_URL (and ICONCRETE_RLS_URL) to run M8 tests.';

if (SKIP_REASON) console.warn(`[M8 sales tests skipped] ${SKIP_REASON}`);

const describeDb = SKIP_REASON ? describe.skip : describe;
const dbTest = SKIP_REASON ? test.skip : test;

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PLANT_A = 'PLT-0001';
const PLANT_B = 'PLT-0002';
const COMPANY_A = 'CMP-0001';
const COMPANY_B = 'CMP-0002';
const ORDER_DATE = '2026-11-05';

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

describeDb('sales pricing and CRM repository', () => {
  let admin: Db;
  let app: Db;
  let sales: SalesService;
  let materialId = '';
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
      materialId = `MAT-M8-${tag}`;
      await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
        tx.unsafe(
          `insert into materials (id, company_id, plant_id, material_code, name_ar, name_en,
             category, unit_of_measure, is_bulk, valuation_method)
           values ($1,$2,$3,$4,'خرسانة جاهزة','Ready-mix','other','m3',true,'weighted_average')`,
          [materialId, COMPANY_A, PLANT_A, materialId],
        ),
      );
    }
  });

  afterAll(async () => {
    await app?.close();
    await admin?.close();
  });

  const makeMaterial = async (prefix: string): Promise<string> => {
    const id = `MAT-M8-${prefix}-${suffix()}`;
    await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe(
        `insert into materials (id, company_id, plant_id, material_code, name_ar, name_en,
           category, unit_of_measure, is_bulk, valuation_method)
         values ($1,$2,$3,$4,'خرسانة جاهزة','Ready-mix','other','m3',true,'weighted_average')`,
        [id, COMPANY_A, PLANT_A, id],
      ),
    );
    return id;
  };

  const makeCustomer = async (overrides: { companyId?: string; creditLimit?: number } = {}) =>
    sales.createCustomer(ctx(overrides.companyId ?? COMPANY_A), {
      plantId: PLANT_A,
      customerCode: `CUS-M8-${suffix()}`,
      nameAr: `عميل ${tag}`,
      nameEn: `Customer ${tag}`,
      creditLimit: overrides.creditLimit ?? 1_000_000,
    });

  const makePriceList = async (code: string, price: number, from = '2026-01-01', to: string | null = '2027-12-31') => {
    const list = await sales.createPriceList(ctx(COMPANY_A), {
      plantId: PLANT_A,
      listCode: code,
      name: `List ${code}`,
      validFrom: from,
      validUntil: to,
    });
    await sales.addPriceListItem(ctx(COMPANY_A), String(list.id), {
      materialId,
      unitPrice: price,
      minQuantity: 0,
    });
    return list;
  };

  const activate = async (code: string, price: number, from?: string, to?: string | null) => {
    const list = await makePriceList(code, price, from, to);
    return sales.activatePriceList(ctx(COMPANY_A), String(list.id));
  };

  const makeOrder = async (
    customerId: string,
    quantity: number,
    extra: {
      level?: number;
      reason?: string;
      contractId?: string | null;
      unitPrice?: number;
      orderDate?: string;
    } = {},
  ) =>
    sales.createSalesOrder(ctx(COMPANY_A, extra.level ?? 5), {
      plantId: PLANT_A,
      orderNo: `SO-M8-${suffix()}`,
      customerId,
      contractId: extra.contractId ?? null,
      orderDate: extra.orderDate ?? ORDER_DATE,
      items: [
        {
          materialId,
          description: 'C30',
          quantity,
          ...(extra.unitPrice === undefined ? {} : { unitPrice: extra.unitPrice }),
        },
      ],
      reason: extra.reason,
    });

  const makeQuotation = async (customerId: string, quantity: number, unitPrice: number) => {
    const quotation = await sales.createQuotation(ctx(COMPANY_A), {
      plantId: PLANT_A,
      quotationNo: `QTN-M8-${suffix()}`,
      customerId,
      validUntil: '2099-12-31',
      items: [{ materialId, description: 'C30', quantity, unitPrice }],
    });
    await sales.submitQuotation(ctx(COMPANY_A), quotation.id);
    return sales.approveQuotation(ctx(COMPANY_A), quotation.id, 'M8 price source');
  };

  dbTest('an order resolves contract > commitment > seasonal > price list and copies the price', async () => {
    materialId = await makeMaterial('PREC');
    const customer = await makeCustomer();
    const listCode = `PL-${suffix()}`;
    await activate(listCode, 200);

    const listOrder = await makeOrder(customer.id, 10);
    expect(listOrder.items[0]?.unit_price).toBe(200);

    await sales.createSeasonalPrice(ctx(COMPANY_A), {
      plantId: PLANT_A,
      customerId: customer.id,
      materialId,
      seasonStart: '2026-06-01',
      seasonEnd: '2026-12-31',
      unitPrice: 220,
    });
    const seasonalOrder = await makeOrder(customer.id, 10);
    expect(seasonalOrder.items[0]?.unit_price).toBe(220);

    const commitment = await sales.createVolumeCommitment(ctx(COMPANY_A), {
      plantId: PLANT_A,
      commitmentNo: `VCM-${suffix()}`,
      customerId: customer.id,
      materialId,
      committedQuantityM3: 1000,
      periodStart: '2026-01-01',
      periodEnd: '2027-12-31',
      specialPrice: 250,
    });
    await sales.activateCommitment(ctx(COMPANY_A), String(commitment.id));
    const commitmentOrder = await makeOrder(customer.id, 10);
    expect(commitmentOrder.items[0]?.unit_price).toBe(250);

    const quotation = await makeQuotation(customer.id, 100, 300);
    const contract = await sales.createContract(ctx(COMPANY_A), {
      plantId: PLANT_A,
      contractNo: `CTR-M8-${suffix()}`,
      quotationVersionId: quotation.versions[0]!.id,
      startDate: '2026-01-01',
      endDate: '2027-12-31',
      terms: 'M8 precedence',
    });
    await sales.signContract(ctx(COMPANY_A), contract.id);
    const contractOrder = await makeOrder(customer.id, 10);
    expect(contractOrder.items[0]?.unit_price).toBe(300);

    const resolutions = await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe<{ source_type: string; source_id: string }>(
        `select source_type, source_id from price_resolutions
          where company_id = $1 and order_id = $2 and deleted_at is null`,
        [COMPANY_A, contractOrder.id],
      ),
    );
    expect(resolutions[0]?.source_type).toBe('contract');
    expect(resolutions[0]?.source_id).toBe(contract.id);

    const committedAfter = await sales.listVolumeCommitments(ctx(COMPANY_A), {
      customerId: customer.id,
    });
    expect(committedAfter[0]?.fulfilled_quantity_m3).toBe(10);
  });

  dbTest('a price stored on the order survives a later price-list change', async () => {
    materialId = await makeMaterial('LOCK');
    const customer = await makeCustomer();
    const code = `PL-LOCK-${suffix()}`;
    await activate(code, 175);
    const order = await makeOrder(customer.id, 4);
    expect(order.items[0]?.unit_price).toBe(175);

    await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe(
        `update price_list_items set unit_price = 999
          where company_id = $1 and price_list_id = (select id from price_lists
             where company_id = $1 and list_code = $2)`,
        [COMPANY_A, code],
      ),
    );
    const after = await sales.getOrder(ctx(COMPANY_A), order.id);
    expect(after.items[0]?.unit_price).toBe(175);
    expect(after.total_amount).toBe(700);
  });

  dbTest('two sources at one rank block, and no applicable price blocks rather than guessing', async () => {
    materialId = await makeMaterial('AMB');
    const customer = await makeCustomer();
    await sales.createSeasonalPrice(ctx(COMPANY_A), {
      plantId: PLANT_A,
      materialId,
      seasonStart: '2026-06-01',
      seasonEnd: '2026-12-31',
      unitPrice: 210,
    });
    await sales.createSeasonalPrice(ctx(COMPANY_A), {
      plantId: PLANT_A,
      customerId: customer.id,
      materialId,
      seasonStart: '2026-06-01',
      seasonEnd: '2026-12-31',
      unitPrice: 205,
    });
    await expectM1(() => makeOrder(customer.id, 1), 'approval_required', 403);

    materialId = await makeMaterial('NOPRICE');
    const noPrice = await makeCustomer();
    await expectM1(() => makeOrder(noPrice.id, 1), 'approval_required', 403);
  });

  dbTest('an out-of-season price is refused at creation and never used to price an order', async () => {
    materialId = await makeMaterial('SEASON');
    await expectM1(
      () =>
        sales.createSeasonalPrice(ctx(COMPANY_A), {
          plantId: PLANT_A,
          materialId,
          seasonStart: '2026-12-31',
          seasonEnd: '2026-01-01',
          unitPrice: 100,
        }),
      'season_window',
      422,
    );

    const customer = await makeCustomer();
    await sales.createSeasonalPrice(ctx(COMPANY_A), {
      plantId: PLANT_A,
      customerId: customer.id,
      materialId,
      seasonStart: '2025-01-01',
      seasonEnd: '2025-12-31',
      unitPrice: 90,
    });
    await expectM1(() => makeOrder(customer.id, 1), 'approval_required', 403);
  });

  dbTest('overlapping active price lists are refused', async () => {
    materialId = await makeMaterial('OVR');
    const code = `PL-OVR-${suffix()}`;
    await activate(code, 200, '2026-01-01', '2026-12-31');
    const second = await makePriceList(`PL-OVR2-${suffix()}`, 210, '2026-06-01', '2027-06-01');
    await expectM1(
      () => sales.activatePriceList(ctx(COMPANY_A), String(second.id)),
      'price_list_overlap',
      422,
    );
  });

  dbTest('a commitment warns at 96% and needs level-4 approval beyond 100%', async () => {
    materialId = await makeMaterial('BAND');
    const customer = await makeCustomer();
    const commitment = await sales.createVolumeCommitment(ctx(COMPANY_A), {
      plantId: PLANT_A,
      commitmentNo: `VCM-BAND-${suffix()}`,
      customerId: customer.id,
      materialId,
      committedQuantityM3: 100,
      periodStart: '2026-01-01',
      periodEnd: '2027-12-31',
      specialPrice: 240,
    });
    await sales.activateCommitment(ctx(COMPANY_A), String(commitment.id));
    await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe(`update volume_commitments set fulfilled_quantity_m3 = 90 where id = $1`, [
        commitment.id,
      ]),
    );

    const warning = await makeOrder(customer.id, 6, { level: 3 });
    expect(warning.items[0]?.unit_price).toBe(240);
    const afterWarning = await sales.listVolumeCommitments(ctx(COMPANY_A), {
      customerId: customer.id,
    });
    expect(afterWarning[0]?.fulfilled_quantity_m3).toBe(96);

    await expectM1(() => makeOrder(customer.id, 6, { level: 3 }), 'approval_required', 403);
    const approved = await makeOrder(customer.id, 6, {
      level: 4,
      reason: 'customer confirmed the extra volume in writing',
    });
    expect(approved.items[0]?.unit_price).toBe(240);
    const afterApproval = await sales.listVolumeCommitments(ctx(COMPANY_A), {
      customerId: customer.id,
    });
    expect(afterApproval[0]?.fulfilled_quantity_m3).toBe(102);
  });

  dbTest('a quality complaint needs its NCR; ratings stay inside 1–5', async () => {
    materialId = await makeMaterial('CRM');
    const customer = await makeCustomer();
    await expectM1(
      () =>
        sales.createFeedback(ctx(COMPANY_A, 2), {
          plantId: PLANT_A,
          customerId: customer.id,
          source: 'phone',
          rating: 6,
        }),
      'feedback_rating',
      422,
    );
    const feedback = await sales.createFeedback(ctx(COMPANY_A, 2), {
      plantId: PLANT_A,
      customerId: customer.id,
      source: 'phone',
      rating: 4,
      category: 'delivery',
      comment: 'late load',
    });
    expect(feedback.rating_1_to_5).toBe(4);
    const handled = await sales.handleFeedback(ctx(COMPANY_A, 2), String(feedback.id), {
      resolution: 'called back',
    });
    expect(handled.status).toBe('handled');

    await expectM1(
      () =>
        sales.createComplaint(ctx(COMPANY_A, 2), {
          plantId: PLANT_A,
          customerId: customer.id,
          qualityRelated: true,
          description: 'cube results failed at 28 days',
        }),
      'complaint_ncr',
      422,
    );

    const ncrId = `NCR-M8-${tag}`;
    await app.withTenant(ctx(COMPANY_A).tenant, (tx) =>
      tx.unsafe(
        `insert into ncr (id, company_id, plant_id, severity, description, opened_by)
         values ($1,$2,$3,'major','M8 complaint test failure','m8-tester')`,
        [ncrId, COMPANY_A, PLANT_A],
      ),
    );
    const complaint = await sales.createComplaint(ctx(COMPANY_A, 2), {
      plantId: PLANT_A,
      complaintNo: `CMP-${suffix()}`,
      customerId: customer.id,
      feedbackId: String(feedback.id),
      qualityRelated: true,
      ncrId,
      severity: 'high',
      description: 'cube results failed at 28 days',
    });
    expect(complaint.ncr_id).toBe(ncrId);
    const investigating = await sales.transitionComplaint(ctx(COMPANY_A, 3), String(complaint.id), 'investigating');
    expect(investigating.status).toBe('investigating');
    const resolved = await sales.transitionComplaint(ctx(COMPANY_A, 4), String(complaint.id), 'resolved', {
      rootCause: 'cement batch variation',
    });
    expect(resolved.status).toBe('resolved');
    const closed = await sales.transitionComplaint(ctx(COMPANY_A, 4), String(complaint.id), 'closed');
    expect(closed.status).toBe('closed');
  });

  dbTest('activity lifecycle and tenant/plant isolation hold on every new table', async () => {
    materialId = await makeMaterial('TEN');
    const customer = await makeCustomer();
    const activity = await sales.createActivity(ctx(COMPANY_A, 2), {
      plantId: PLANT_A,
      activityNo: `ACT-${suffix()}`,
      customerId: customer.id,
      activityType: 'visit',
      subject: 'site visit',
    });
    const done = await sales.closeActivity(ctx(COMPANY_A, 2), String(activity.id), 'done', 'met the buyer');
    expect(done.status).toBe('done');

    const code = `PL-TEN-${suffix()}`;
    const list = await activate(code, 150);
    const otherCompany = await sales.listPriceLists(ctx(COMPANY_B, 5));
    expect(otherCompany.some((row) => row.id === list.id)).toBe(false);
    const wrongPlant = await sales.listPriceLists(ctx(COMPANY_A, 5, [PLANT_B]));
    expect(wrongPlant.some((row) => row.id === list.id)).toBe(false);
    expect((await sales.listActivities(ctx(COMPANY_B, 5))).some((row) => row.id === activity.id)).toBe(false);

    const tables = [
      'price_lists',
      'price_list_items',
      'volume_commitments',
      'seasonal_prices',
      'customer_activities',
      'customer_feedback',
      'complaints',
      'price_resolutions',
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
