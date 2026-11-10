import { BRAND } from '../brand';
import { round2 } from '../core/money';
import type {
  BankAccount,
  BatchRecord,
  CashTransaction,
  Cheque,
  Company,
  Customer,
  DemoDataset,
  FixedAsset,
  InventoryItem,
  Invoice,
  Loan,
  MaintenanceOrder,
  Material,
  Plant,
  QualityTest,
  RentalPayment,
  SalaryPayment,
  Supplier,
  SupplierBill,
  Trip,
  Truck,
  User,
  UtilityBill,
} from '../types';

/**
 * Deterministic demo dataset for a realistic Ready-Mix plant.
 * Everything here is DEMO ONLY — no real company, person or credential.
 */

const DAY_MS = 86_400_000;

const multiply = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Rng = () => number;

const pick = <T>(rng: Rng, values: readonly T[]): T => {
  const index = Math.floor(rng() * values.length);
  return (values[index] ?? values[0]) as T;
};

const between = (rng: Rng, min: number, max: number): number => min + rng() * (max - min);
const intBetween = (rng: Rng, min: number, max: number): number =>
  Math.floor(between(rng, min, max + 0.999999));

const startOfTodayUtc = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
};

const isoDaysAgo = (days: number, hour = 9, minute = 0): string => {
  const date = startOfTodayUtc();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
};

const isoDaysAhead = (days: number, hour = 9): string => isoDaysAgo(-days, hour);

export const todayIso = (): string => isoDaysAgo(0, 12);

const CUSTOMER_NAMES: ReadonlyArray<{ ar: string; en: string }> = [
  { ar: 'شركة النيل للإنشاءات', en: 'Nile Construction Co.' },
  { ar: 'مقاولات الدلتا', en: 'Delta Contracting' },
  { ar: 'شركة الأهرام للتعمير', en: 'Pyramids Development' },
  { ar: 'مجموعة الجيزة العقارية', en: 'Giza Real Estate Group' },
  { ar: 'شركة المستقبل للمشاريع', en: 'Future Projects Co.' },
  { ar: 'إنشاءات الإسكندرية', en: 'Alexandria Builders' },
  { ar: 'شركة السلام للتطوير', en: 'Al Salam Development' },
  { ar: 'مؤسسة الصعيد للمقاولات', en: 'Saeed Contracting Est.' },
  { ar: 'شركة رؤية للاستثمار العقاري', en: 'Roeya Real Estate' },
  { ar: 'تحالف القاهرة للبناء', en: 'Cairo Build Alliance' },
  { ar: 'شركة المنصورة للتشييد', en: 'Mansoura Construction' },
  { ar: 'مجموعة طنطا الهندسية', en: 'Tanta Engineering Group' },
];

const SUPPLIER_NAMES: ReadonlyArray<{ ar: string; en: string; category: Supplier['category'] }> = [
  { ar: 'أسمنت السويس', en: 'Suez Cement', category: 'cement' },
  { ar: 'محاجر عتاقة', en: 'Ataka Quarries', category: 'aggregate' },
  { ar: 'شركة الرمل الذهبي', en: 'Golden Sand Co.', category: 'aggregate' },
  { ar: 'إضافات البناء الحديثة', en: 'Modern Build Admixtures', category: 'admixture' },
  { ar: 'مؤسسة وقود المحطة', en: 'Plant Fuel Supply', category: 'fuel' },
  { ar: 'قطع غيار الخرسانة', en: 'Concrete Spare Parts', category: 'spare_parts' },
];

const buildCompany = (): Company => ({
  id: 'CMP-0001',
  name_ar: BRAND.demoCompany.ar,
  name_en: BRAND.demoCompany.en,
  tax_id: 'DEMO-TAX-0001',
  logo_doc_id: null,
  created_at: isoDaysAgo(420, 8),
});

const buildPlants = (): Plant[] => [
  {
    id: 'PLT-0001',
    company_id: 'CMP-0001',
    name_ar: BRAND.demoPlant.ar,
    name_en: BRAND.demoPlant.en,
    city: 'Cairo',
    capacity_m3_per_hour: 120,
    is_active: true,
  },
  {
    id: 'PLT-0002',
    company_id: 'CMP-0001',
    name_ar: 'محطة آي كونكريت التجريبية - الجيزة',
    name_en: 'IConcrete Demo Plant - Giza',
    city: 'Giza',
    capacity_m3_per_hour: 90,
    is_active: true,
  },
];

// Never ship a demo login secret in source. Server-side seeding and local demos read
// the password from the environment; the browser bundle intentionally gets a blank hint.
const readEnvPassword = (name: string): string =>
  typeof process === 'undefined' ? '' : (process.env[name] ?? '').trim();

const DEMO_PASSWORD =
  readEnvPassword('DEMO_ADMIN_PASSWORD') || readEnvPassword('ICONCRETE_DEMO_ADMIN_PASSWORD');

const buildUsers = (): User[] => {
  const base = {
    company_id: 'CMP-0001',
    is_active: true,
    last_login_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    demo_password: DEMO_PASSWORD,
  };
  return [
    {
      ...base,
      id: 'USR-0001',
      username: 'admin',
      full_name_ar: 'أحمد محمود - مدير النظام',
      full_name_en: 'Ahmed Mahmoud - Administrator',
      email: 'admin@demo.iconcrete.local',
      phone: '+201000000001',
      role_level: 5,
      assigned_plant_ids: ['PLT-0001', 'PLT-0002'],
      last_login_at: isoDaysAgo(1, 8),
    },
    {
      ...base,
      id: 'USR-0002',
      username: 'manager',
      full_name_ar: 'منى عبد الرحمن - مديرة المحطة',
      full_name_en: 'Mona Abdelrahman - Plant Manager',
      email: 'manager@demo.iconcrete.local',
      phone: '+201000000002',
      role_level: 4,
      assigned_plant_ids: ['PLT-0001'],
      last_login_at: isoDaysAgo(2, 9),
    },
    {
      ...base,
      id: 'USR-0003',
      username: 'dispatcher',
      full_name_ar: 'خالد سمير - مسؤول التوزيع',
      full_name_en: 'Khaled Samir - Dispatcher',
      email: 'dispatcher@demo.iconcrete.local',
      phone: '+201000000003',
      role_level: 3,
      assigned_plant_ids: ['PLT-0001'],
      last_login_at: isoDaysAgo(1, 14),
    },
    {
      ...base,
      id: 'USR-0004',
      username: 'operator',
      full_name_ar: 'سيد إبراهيم - مشغل المحطة',
      full_name_en: 'Sayed Ibrahim - Batching Operator',
      email: 'operator@demo.iconcrete.local',
      phone: '+201000000004',
      role_level: 2,
      assigned_plant_ids: ['PLT-0001'],
      last_login_at: isoDaysAgo(3, 7),
    },
    {
      ...base,
      id: 'USR-0005',
      username: 'viewer',
      full_name_ar: 'هالة فؤاد - مراجع',
      full_name_en: 'Hala Fouad - Viewer',
      email: 'viewer@demo.iconcrete.local',
      phone: '+201000000005',
      role_level: 1,
      assigned_plant_ids: ['PLT-0001'],
      last_login_at: null,
    },
  ];
};

const buildCustomers = (rng: Rng): Customer[] =>
  CUSTOMER_NAMES.flatMap((name, index) =>
    [0, 1].map((branch) => {
      const serial = index * 2 + branch + 1;
      const region = branch === 0 ? '' : ' - فرع';
      const regionEn = branch === 0 ? '' : ' - Branch';
      const tiers = ['A', 'B', 'C'] as const;
      const statuses = ['active', 'active', 'active', 'active', 'suspended', 'archived'] as const;
      const creditLimits = [500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000];
      return {
        id: `CUS-${String(serial).padStart(4, '0')}`,
        company_id: 'CMP-0001',
        plant_id: serial % 3 === 0 ? 'PLT-0002' : 'PLT-0001',
        name_ar: `${name.ar}${region}`,
        name_en: `${name.en}${regionEn}`,
        tax_id: `DEMO-TAX-${String(1000 + serial)}`,
        phone: `+2010${String(10000000 + serial * 137).slice(0, 8)}`,
        email: `customer${serial}@demo.iconcrete.local`,
        address: serial % 2 === 0 ? 'القاهرة الجديدة - التجمع الخامس' : 'الجيزة - 6 أكتوبر',
        priority_tier: pick(rng, tiers),
        credit_limit_egp: pick(rng, creditLimits),
        credit_days: pick(rng, [0, 15, 30, 45, 60]),
        status: serial === 24 ? 'archived' : pick(rng, statuses),
        data_source: 'demo' as const,
        created_at: isoDaysAgo(intBetween(rng, 90, 380), 10),
      } satisfies Customer;
    }),
  );

const MIX_CODES = ['C25', 'C30', 'C35', 'C40', 'C45'] as const;

const buildInvoices = (rng: Rng, customers: Customer[]): Invoice[] => {
  const invoices: Invoice[] = [];
  let counter = 0;
  for (const customer of customers) {
    const count = intBetween(rng, 1, 4);
    for (let i = 0; i < count; i += 1) {
      counter += 1;
      const issueDaysAgo = intBetween(rng, 1, 85);
      const issueDate = isoDaysAgo(issueDaysAgo, 10);
      const dueDate = isoDaysAgo(issueDaysAgo - customer.credit_days, 10);
      const volume = round2(between(rng, 28, 240));
      const unitPrice = round2(between(rng, 1450, 1980));
      const subtotal = round2(volume * unitPrice);
      const vatPercent = 14;
      const grandTotal = round2(subtotal * (1 + vatPercent / 100));
      const paidRatio = pick(rng, [0, 0, 0.3, 0.5, 1, 1]);
      const paidAmount = round2(grandTotal * paidRatio);
      const outstanding = round2(grandTotal - paidAmount);
      const overdue = outstanding > 0.01 && new Date(dueDate).getTime() < Date.now();
      const status: Invoice['status'] =
        outstanding <= 0.01
          ? 'paid'
          : overdue
            ? 'overdue'
            : paidAmount > 0
              ? 'partially_paid'
              : 'issued';
      invoices.push({
        id: `INV-${String(counter).padStart(5, '0')}`,
        invoice_no: `INV-2026-${String(counter).padStart(4, '0')}`,
        customer_id: customer.id,
        plant_id: customer.plant_id,
        issue_date: issueDate,
        due_date: dueDate,
        subtotal,
        vat_percent: vatPercent,
        grand_total: grandTotal,
        paid_amount: paidAmount,
        outstanding_amount: outstanding,
        status,
      });
    }
  }
  return invoices;
};

const buildSuppliers = (): Supplier[] =>
  SUPPLIER_NAMES.map((supplier, index) => ({
    id: `SUP-${String(index + 1).padStart(3, '0')}`,
    company_id: 'CMP-0001',
    name_ar: supplier.ar,
    name_en: supplier.en,
    phone: `+2022${String(4000000 + index * 913).slice(0, 7)}`,
    category: supplier.category,
    status: index === 5 ? 'suspended' : 'active',
    data_source: 'demo',
  }));

const buildSupplierBills = (rng: Rng, suppliers: Supplier[]): SupplierBill[] => {
  const bills: SupplierBill[] = [];
  for (let i = 1; i <= 18; i += 1) {
    const supplier = pick(rng, suppliers);
    const total = round2(between(rng, 120_000, 890_000));
    const paidRatio = pick(rng, [0, 0.25, 0.5, 1, 1]);
    const paid = round2(total * paidRatio);
    const outstanding = round2(total - paid);
    const billDaysAgo = intBetween(rng, 2, 70);
    bills.push({
      id: `BILL-${String(i).padStart(4, '0')}`,
      supplier_id: supplier.id,
      bill_no: `SB-2026-${String(i).padStart(4, '0')}`,
      bill_date: isoDaysAgo(billDaysAgo, 11),
      due_date: isoDaysAgo(billDaysAgo - 30, 11),
      total,
      paid_amount: paid,
      outstanding_amount: outstanding,
      status: outstanding <= 0.01 ? 'paid' : paid > 0 ? 'partially_paid' : i === 7 ? 'disputed' : 'open',
    });
  }
  return bills;
};

const buildCashTransactions = (rng: Rng): CashTransaction[] => {
  const rows: CashTransaction[] = [];
  for (let i = 1; i <= 64; i += 1) {
    const direction = pick(rng, ['in', 'out'] as const);
    rows.push({
      id: `CASH-${String(i).padStart(4, '0')}`,
      plant_id: i % 5 === 0 ? 'PLT-0002' : 'PLT-0001',
      txn_date: isoDaysAgo(intBetween(rng, 0, 45), 12, 30),
      direction,
      amount: round2(between(rng, 18_000, 165_000)),
      reference: direction === 'in' ? `تحصيل نقدي ${i}` : `مصروف تشغيلي ${i}`,
      description_ar: direction === 'in' ? 'تحصيل من عميل' : 'مصروف تشغيل المحطة',
      description_en: direction === 'in' ? 'Customer collection' : 'Plant operating expense',
    });
  }
  return rows;
};

const buildBankAccounts = (): BankAccount[] => [
  {
    id: 'BNK-001',
    plant_id: 'PLT-0001',
    bank_name_ar: 'البنك التجاري الدولي',
    bank_name_en: 'CIB',
    iban_last4: '4417',
    current_balance: 2_450_000,
  },
  {
    id: 'BNK-002',
    plant_id: 'PLT-0001',
    bank_name_ar: 'بنك مصر',
    bank_name_en: 'Banque Misr',
    iban_last4: '9081',
    current_balance: 1_180_000,
  },
  {
    id: 'BNK-003',
    plant_id: 'PLT-0002',
    bank_name_ar: 'البنك الأهلي المصري',
    bank_name_en: 'NBE',
    iban_last4: '3320',
    current_balance: 760_000,
  },
];

const buildCheques = (rng: Rng, customers: Customer[]): Cheque[] =>
  Array.from({ length: 14 }, (_, index) => {
    const serial = index + 1;
    const customer = pick(rng, customers);
    const statuses: Cheque['status'][] = [
      'under_collection',
      'under_collection',
      'under_collection',
      'received',
      'received',
      'cleared',
      'cleared',
      'bounced',
      'cancelled',
    ];
    const status = pick(rng, statuses);
    return {
      id: `CHQ-${String(serial).padStart(4, '0')}`,
      cheque_no: `CHQ-2026-${String(serial).padStart(4, '0')}`,
      direction: index % 5 === 0 ? 'outgoing' : 'incoming',
      party_name_ar: customer.name_ar,
      party_name_en: customer.name_en,
      amount: round2(between(rng, 45_000, 420_000)),
      due_date: isoDaysAhead(intBetween(rng, -4, 20), 10),
      status: index % 5 === 0 ? 'received' : status,
    } satisfies Cheque;
  });

const buildMaterials = (): Material[] => [
  { id: 'MAT-001', code: 'CEM-OPC', name_ar: 'أسمنت OPC', name_en: 'OPC Cement', unit: 'ton', specific_gravity: 3.15, reorder_level: 25, data_source: 'demo' },
  { id: 'MAT-002', code: 'SAND-01', name_ar: 'رمل', name_en: 'Sand', unit: 'ton', specific_gravity: 2.65, reorder_level: 60, data_source: 'demo' },
  { id: 'MAT-003', code: 'GRV-01', name_ar: 'زلط ١', name_en: 'Gravel 1', unit: 'ton', specific_gravity: 2.68, reorder_level: 80, data_source: 'demo' },
  { id: 'MAT-004', code: 'GRV-02', name_ar: 'زلط ٢', name_en: 'Gravel 2', unit: 'ton', specific_gravity: 2.7, reorder_level: 50, data_source: 'demo' },
  { id: 'MAT-005', code: 'ADM-01', name_ar: 'إضافات خرسانة', name_en: 'Concrete Admixture', unit: 'liter', specific_gravity: 1.05, reorder_level: 400, data_source: 'demo' },
  { id: 'MAT-006', code: 'WTR-01', name_ar: 'مياه خلط', name_en: 'Mixing Water', unit: 'm3', specific_gravity: 1, reorder_level: 50, data_source: 'demo' },
];

const buildInventory = (rng: Rng, materials: Material[]): InventoryItem[] => {
  const plantIds = ['PLT-0001', 'PLT-0002'];
  const rows: InventoryItem[] = [];
  for (const plantId of plantIds) {
    for (const material of materials) {
      const baseQty =
        material.unit === 'ton'
          ? between(rng, 40, 380)
          : material.unit === 'liter'
            ? between(rng, 200, 2_400)
            : between(rng, 30, 140);
      const quantity = round2(baseQty);
      const unitCost =
        material.code === 'CEM-OPC'
          ? 2_450
          : material.unit === 'liter'
            ? 62
            : material.code === 'WTR-01'
              ? 18
              : 320;
      rows.push({
        id: `INV-${plantId}-${material.id}`,
        plant_id: plantId,
        material_id: material.id,
        quantity,
        unit_cost: unitCost,
      });
    }
  }
  // One clearly low-stock row so the dashboard alert has real data.
  const lowStock = rows.find((row) => row.plant_id === 'PLT-0002' && row.material_id === 'MAT-001');
  if (lowStock) lowStock.quantity = 12.5;
  return rows;
};

const buildFixedAssets = (): FixedAsset[] => [
  { id: 'AST-001', name_ar: 'محطة خلط مركزية ١٢٠ م³/ساعة', name_en: 'Central Batching Plant 120 m3/h', category: 'plant_equipment', purchase_date: isoDaysAgo(1200), purchase_cost: 8_500_000, current_book_value: 6_800_000 },
  { id: 'AST-002', name_ar: 'شاحنة خلاطة ١٢ م³', name_en: 'Mixer Truck 12 m3', category: 'vehicle', purchase_date: isoDaysAgo(900), purchase_cost: 3_200_000, current_book_value: 2_400_000 },
  { id: 'AST-003', name_ar: 'شاحنة خلاطة ١٠ م³', name_en: 'Mixer Truck 10 m3', category: 'vehicle', purchase_date: isoDaysAgo(760), purchase_cost: 2_900_000, current_book_value: 2_050_000 },
  { id: 'AST-004', name_ar: 'لودر ٩٦٦', name_en: 'Wheel Loader 966', category: 'plant_equipment', purchase_date: isoDaysAgo(1400), purchase_cost: 4_100_000, current_book_value: 2_600_000 },
  { id: 'AST-005', name_ar: 'مضخة ذراع ٣٦ متر', name_en: 'Boom Pump 36m', category: 'plant_equipment', purchase_date: isoDaysAgo(650), purchase_cost: 5_400_000, current_book_value: 4_300_000 },
  { id: 'AST-006', name_ar: 'ميزان شاحنات ٦٠ طن', name_en: 'Weighbridge 60 ton', category: 'plant_equipment', purchase_date: isoDaysAgo(1100), purchase_cost: 950_000, current_book_value: 620_000 },
  { id: 'AST-007', name_ar: 'معمل اختبارات', name_en: 'Testing Laboratory', category: 'plant_equipment', purchase_date: isoDaysAgo(820), purchase_cost: 700_000, current_book_value: 480_000 },
  { id: 'AST-008', name_ar: 'سيارة إدارة', name_en: 'Management Car', category: 'vehicle', purchase_date: isoDaysAgo(500), purchase_cost: 1_250_000, current_book_value: 900_000 },
  { id: 'AST-009', name_ar: 'أجهزة حاسب ومكتب', name_en: 'Computers & Office', category: 'it', purchase_date: isoDaysAgo(400), purchase_cost: 320_000, current_book_value: 180_000 },
  { id: 'AST-010', name_ar: 'مبنى إداري', name_en: 'Administration Building', category: 'building', purchase_date: isoDaysAgo(2000), purchase_cost: 3_600_000, current_book_value: 2_900_000 },
];

const buildLoans = (): Loan[] => [
  { id: 'LON-001', bank_name_ar: 'البنك التجاري الدولي', bank_name_en: 'CIB', principal: 3_000_000, outstanding_principal: 1_850_000, next_installment_date: isoDaysAhead(9), status: 'active' },
  { id: 'LON-002', bank_name_ar: 'بنك مصر', bank_name_en: 'Banque Misr', principal: 1_200_000, outstanding_principal: 610_000, next_installment_date: isoDaysAhead(-3), status: 'overdue' },
  { id: 'LON-003', bank_name_ar: 'البنك الأهلي المصري', bank_name_en: 'NBE', principal: 500_000, outstanding_principal: 0, next_installment_date: isoDaysAgo(60), status: 'closed' },
];

const buildSalaryPayments = (): SalaryPayment[] => {
  const people = [
    ['أحمد محمود', 'Ahmed Mahmoud', 22_000],
    ['منى عبد الرحمن', 'Mona Abdelrahman', 18_500],
    ['خالد سمير', 'Khaled Samir', 12_000],
    ['سيد إبراهيم', 'Sayed Ibrahim', 9_800],
    ['محمد فتحي', 'Mohamed Fathy', 8_400],
    ['عمرو حسن', 'Amr Hassan', 8_100],
    ['إسلام رجب', 'Islam Ragab', 7_900],
    ['مصطفى كامل', 'Mostafa Kamel', 7_600],
    ['نادية علي', 'Nadia Ali', 11_200],
    ['وليد صابر', 'Walid Saber', 9_100],
    ['هالة فؤاد', 'Hala Fouad', 10_500],
    ['طارق يوسف', 'Tarek Youssef', 13_400],
  ] as const;
  return people.map(([ar, en, net], index) => ({
    id: `SAL-${String(index + 1).padStart(3, '0')}`,
    employee_name_ar: ar,
    employee_name_en: en,
    period: '2026-10',
    net_amount: net,
    status: index < 10 ? 'pending' : 'paid',
  }));
};

const buildRentals = (): RentalPayment[] => [
  { id: 'RNT-001', description_ar: 'إيجار أرض المحطة - القاهرة', description_en: 'Cairo plant land rent', amount: 45_000, due_date: isoDaysAgo(2, 10), status: 'pending' },
  { id: 'RNT-002', description_ar: 'إيجار أرض المحطة - الجيزة', description_en: 'Giza plant land rent', amount: 32_000, due_date: isoDaysAhead(12), status: 'pending' },
  { id: 'RNT-003', description_ar: 'إيجار مكتب إداري', description_en: 'Office rent', amount: 18_000, due_date: isoDaysAgo(5, 10), status: 'paid' },
  { id: 'RNT-004', description_ar: 'إيجار مضخة خارجية', description_en: 'External pump rental', amount: 60_000, due_date: isoDaysAhead(6), status: 'pending' },
  { id: 'RNT-005', description_ar: 'إيجار شاحنة مقاول', description_en: 'Contracted truck rent', amount: 25_000, due_date: isoDaysAhead(18), status: 'pending' },
  { id: 'RNT-006', description_ar: 'إيجار مستودع قطع غيار', description_en: 'Spare parts store rent', amount: 12_000, due_date: isoDaysAgo(20, 10), status: 'paid' },
];

const buildUtilityBills = (): UtilityBill[] => [
  { id: 'UTL-001', kind: 'electricity', bill_no: 'ELC-10-26', amount: 128_400, due_date: isoDaysAhead(8), status: 'pending' },
  { id: 'UTL-002', kind: 'water', bill_no: 'WTR-10-26', amount: 9_600, due_date: isoDaysAhead(8), status: 'pending' },
  { id: 'UTL-003', kind: 'gas', bill_no: 'GAS-10-26', amount: 5_200, due_date: isoDaysAgo(3, 10), status: 'pending' },
  { id: 'UTL-004', kind: 'internet', bill_no: 'NET-10-26', amount: 2_400, due_date: isoDaysAgo(10, 10), status: 'paid' },
  { id: 'UTL-005', kind: 'electricity', bill_no: 'ELC-09-26', amount: 119_800, due_date: isoDaysAgo(20, 10), status: 'paid' },
  { id: 'UTL-006', kind: 'water', bill_no: 'WTR-09-26', amount: 8_900, due_date: isoDaysAgo(20, 10), status: 'paid' },
  { id: 'UTL-007', kind: 'gas', bill_no: 'GAS-09-26', amount: 4_800, due_date: isoDaysAgo(25, 10), status: 'paid' },
  { id: 'UTL-008', kind: 'electricity', bill_no: 'ELC-08-26', amount: 110_300, due_date: isoDaysAgo(50, 10), status: 'paid' },
];

const buildMaintenanceOrders = (): MaintenanceOrder[] => [
  { id: 'MWO-001', asset_name_ar: 'خلاطة المحطة ١', asset_name_en: 'Plant Mixer 1', cost_estimate: 42_000, status: 'in_progress', opened_at: isoDaysAgo(4) },
  { id: 'MWO-002', asset_name_ar: 'شاحنة TRK-03', asset_name_en: 'Truck TRK-03', cost_estimate: 18_500, status: 'open', opened_at: isoDaysAgo(2) },
  { id: 'MWO-003', asset_name_ar: 'لودر ٩٦٦', asset_name_en: 'Wheel Loader 966', cost_estimate: 61_000, status: 'open', opened_at: isoDaysAgo(6) },
  { id: 'MWO-004', asset_name_ar: 'مضخة الذراع', asset_name_en: 'Boom Pump', cost_estimate: 55_000, status: 'open', opened_at: isoDaysAgo(1) },
  { id: 'MWO-005', asset_name_ar: 'كمبروسر الهواء', asset_name_en: 'Air Compressor', cost_estimate: 7_500, status: 'done', opened_at: isoDaysAgo(12) },
  { id: 'MWO-006', asset_name_ar: 'ميزان الشاحنات', asset_name_en: 'Weighbridge', cost_estimate: 9_800, status: 'done', opened_at: isoDaysAgo(20) },
  { id: 'MWO-007', asset_name_ar: 'مولد كهرباء احتياطي', asset_name_en: 'Backup Generator', cost_estimate: 26_000, status: 'open', opened_at: isoDaysAgo(3) },
];

const buildBatches = (rng: Rng): BatchRecord[] => {
  const rows: BatchRecord[] = [];
  let serial = 0;
  for (let day = 13; day >= 0; day -= 1) {
    const count = day === 0 ? 6 : intBetween(rng, 4, 7);
    for (let i = 0; i < count; i += 1) {
      serial += 1;
      const volume = round2(between(rng, 6, 9));
      const reject = rng() > 0.93 ? round2(between(rng, 0.5, 1.5)) : 0;
      rows.push({
        id: `BAT-${String(serial).padStart(5, '0')}`,
        plant_id: i % 4 === 0 ? 'PLT-0002' : 'PLT-0001',
        batch_no: `B-2026-${String(serial).padStart(5, '0')}`,
        mix_code: pick(rng, MIX_CODES),
        produced_at: isoDaysAgo(day, 8 + i, 15),
        volume_m3: volume,
        reject_m3: Math.min(reject, volume),
      });
    }
  }
  return rows;
};

const buildTrucks = (): Truck[] =>
  Array.from({ length: 12 }, (_, index) => {
    const serial = index + 1;
    return {
      id: `TRK-${String(serial).padStart(3, '0')}`,
      code: `TRK-${String(serial).padStart(2, '0')}`,
      capacity_m3: serial % 3 === 0 ? 10 : 12,
      ownership: serial <= 8 ? 'owned' : serial <= 10 ? 'leased' : 'contracted',
      health_score: 62 + ((serial * 7) % 36),
      status: serial === 5 ? 'maintenance' : serial === 9 ? 'idle' : 'active',
    } satisfies Truck;
  });

const buildTrips = (rng: Rng, customers: Customer[], trucks: Truck[]): Trip[] => {
  const activeTrucks = trucks.filter((truck) => truck.status !== 'maintenance');
  const rows: Trip[] = [];
  for (let i = 1; i <= 42; i += 1) {
    const day = i <= 14 ? 0 : i <= 28 ? 1 : 2;
    const scheduledAt = isoDaysAgo(day, 7 + (i % 10), (i * 13) % 60);
    const onTime = rng() > 0.14;
    const status: Trip['status'] = day === 0 && i > 8 ? 'delivering' : rng() > 0.96 ? 'rejected' : 'completed';
    rows.push({
      id: `TRP-${String(i).padStart(4, '0')}`,
      truck_id: pick(rng, activeTrucks).id,
      customer_id: pick(rng, customers).id,
      order_no: `ORD-2026-${String(1000 + i)}`,
      scheduled_at: scheduledAt,
      delivered_at:
        status === 'completed'
          ? new Date(new Date(scheduledAt).getTime() + intBetween(rng, 35, 115) * 60_000).toISOString()
          : null,
      on_time: onTime,
      volume_m3: round2(between(rng, 6, 10)),
      status,
    });
  }
  return rows;
};

const buildQualityTests = (rng: Rng): QualityTest[] => {
  const rows: QualityTest[] = [];
  for (let i = 1; i <= 30; i += 1) {
    const fck = pick(rng, [25, 30, 35, 40]);
    const targetSlump = 120;
    const slump = targetSlump + intBetween(rng, -40, 40);
    const strength7 = round2(fck * between(rng, 0.58, 0.82));
    const temperature = round2(between(rng, 24, 34));
    const slumpOk = Math.abs(slump - targetSlump) <= 25;
    const strengthOk = strength7 >= fck * 0.65;
    const tempOk = temperature <= 32;
    rows.push({
      id: `QCT-${String(i).padStart(4, '0')}`,
      batch_no: `B-2026-${String(200 + i).padStart(5, '0')}`,
      mix_code: `C${fck}`,
      tested_at: isoDaysAgo(intBetween(rng, 0, 6), 10, i % 60),
      slump_mm: slump,
      target_slump_mm: targetSlump,
      strength_7d_mpa: strength7,
      fck_mpa: fck,
      temperature_c: temperature,
      result: slumpOk && strengthOk && tempOk ? 'pass' : 'fail',
    });
  }
  return rows;
};

export const createDemoDataset = (): DemoDataset => {
  const rng = multiply(20260101);
  const plants = buildPlants();
  const customers = buildCustomers(rng);
  const materials = buildMaterials();
  const trucks = buildTrucks();
  void DAY_MS;
  return {
    company: buildCompany(),
    plants,
    users: buildUsers(),
    customers,
    suppliers: buildSuppliers(),
    invoices: buildInvoices(rng, customers),
    supplierBills: buildSupplierBills(rng, buildSuppliers()),
    cashTransactions: buildCashTransactions(rng),
    bankAccounts: buildBankAccounts(),
    cheques: buildCheques(rng, customers),
    materials,
    inventory: buildInventory(rng, materials),
    fixedAssets: buildFixedAssets(),
    loans: buildLoans(),
    salaryPayments: buildSalaryPayments(),
    rentals: buildRentals(),
    utilityBills: buildUtilityBills(),
    maintenanceOrders: buildMaintenanceOrders(),
    batches: buildBatches(rng),
    trucks,
    trips: buildTrips(rng, customers, trucks),
    qualityTests: buildQualityTests(rng),
    auditLog: [],
  };
};

export const DEMO_CREDENTIALS = {
  company: BRAND.demoCompany.en,
  companyAr: BRAND.demoCompany.ar,
  password: DEMO_PASSWORD,
  users: [
    { username: 'admin', roleLevel: 5 as const, labelKey: 'role.owner' },
    { username: 'manager', roleLevel: 4 as const, labelKey: 'role.manager' },
    { username: 'dispatcher', roleLevel: 3 as const, labelKey: 'role.dispatcher' },
    { username: 'operator', roleLevel: 2 as const, labelKey: 'role.operator' },
    { username: 'viewer', roleLevel: 1 as const, labelKey: 'role.viewer' },
  ],
} as const;
