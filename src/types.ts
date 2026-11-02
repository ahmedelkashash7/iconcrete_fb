/** Shared domain types for Phase 1 (AUTH, Dashboard, Reports, Excel Center). */

export type Lang = 'ar' | 'en';
export type RoleLevel = 1 | 2 | 3 | 4 | 5;
export type DataSource = 'demo' | 'import' | 'manual';

export interface Company {
  id: string;
  name_ar: string;
  name_en: string;
  tax_id: string;
  logo_doc_id: string | null;
  created_at: string;
}

export interface Plant {
  id: string;
  company_id: string;
  name_ar: string;
  name_en: string;
  city: string;
  capacity_m3_per_hour: number;
  is_active: boolean;
}

export interface User {
  id: string;
  company_id: string;
  username: string;
  full_name_ar: string;
  full_name_en: string;
  email: string;
  phone: string;
  role_level: RoleLevel;
  assigned_plant_ids: string[];
  is_active: boolean;
  last_login_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  /** Demo-only plain password used to seed the in-memory auth store. Never a real credential. */
  demo_password: string;
}

export interface Project {
  id: string;
  company_id: string;
  plant_id: string;
  customer_id: string;
  customer_name_ar: string;
  customer_name_en: string;
  code: string;
  name_ar: string;
  name_en: string;
  site_location: string;
  status: string;
  start_date: string;
  end_date: string;
  order_count: number;
  created_at: string;
}

export type OrderStatus =
  | 'draft'
  | 'confirmed'
  | 'scheduled'
  | 'in_production'
  | 'delivered'
  | 'invoiced'
  | 'closed';

export interface Order {
  id: string;
  company_id: string;
  plant_id: string;
  customer_id: string;
  customer_name_ar: string;
  customer_name_en: string;
  project_id: string;
  project_code: string;
  order_no: string;
  concrete_grade: string;
  /** Decimal strings: numeric in the database, never parsed into floats (spec §7). */
  quantity_m3: string;
  unit_price: string;
  total_value: string;
  delivery_date: string;
  pour_window_start: string;
  pour_window_end: string;
  status: OrderStatus;
  notes: string;
  created_at: string;
}

export type CustomerStatus = 'active' | 'suspended' | 'archived';
export type PriorityTier = 'A' | 'B' | 'C';

export interface Customer {
  id: string;
  company_id: string;
  plant_id: string;
  name_ar: string;
  name_en: string;
  tax_id: string;
  phone: string;
  email: string;
  address: string;
  priority_tier: PriorityTier;
  credit_limit_egp: number;
  credit_days: number;
  status: CustomerStatus;
  data_source: DataSource;
  created_at: string;
}

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';

export interface Invoice {
  id: string;
  invoice_no: string;
  customer_id: string;
  plant_id: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  vat_percent: number;
  grand_total: number;
  paid_amount: number;
  /** Derived, never stored by hand: grand_total - paid_amount. */
  outstanding_amount: number;
  status: InvoiceStatus;
}

export interface Supplier {
  id: string;
  company_id: string;
  name_ar: string;
  name_en: string;
  phone: string;
  category: 'cement' | 'aggregate' | 'admixture' | 'fuel' | 'spare_parts' | 'services';
  status: 'active' | 'suspended';
  data_source: DataSource;
}

export interface SupplierBill {
  id: string;
  supplier_id: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  total: number;
  paid_amount: number;
  outstanding_amount: number;
  status: 'open' | 'partially_paid' | 'paid' | 'disputed';
}

export interface CashTransaction {
  id: string;
  plant_id: string;
  txn_date: string;
  direction: 'in' | 'out';
  amount: number;
  reference: string;
  description_ar: string;
  description_en: string;
}

export interface BankAccount {
  id: string;
  plant_id: string;
  bank_name_ar: string;
  bank_name_en: string;
  iban_last4: string;
  current_balance: number;
}

export type ChequeStatus = 'received' | 'under_collection' | 'cleared' | 'bounced' | 'cancelled';

export interface Cheque {
  id: string;
  cheque_no: string;
  direction: 'incoming' | 'outgoing';
  party_name_ar: string;
  party_name_en: string;
  amount: number;
  due_date: string;
  status: ChequeStatus;
}

export interface Material {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  unit: 'ton' | 'm3' | 'liter' | 'kg';
  specific_gravity: number;
  reorder_level: number;
  data_source: DataSource;
}

export interface InventoryItem {
  id: string;
  plant_id: string;
  material_id: string;
  quantity: number;
  unit_cost: number;
}

export interface FixedAsset {
  id: string;
  name_ar: string;
  name_en: string;
  category: 'vehicle' | 'plant_equipment' | 'it' | 'building';
  purchase_date: string;
  purchase_cost: number;
  current_book_value: number;
}

export interface Loan {
  id: string;
  bank_name_ar: string;
  bank_name_en: string;
  principal: number;
  outstanding_principal: number;
  next_installment_date: string;
  status: 'active' | 'closed' | 'overdue';
}

export interface SalaryPayment {
  id: string;
  employee_name_ar: string;
  employee_name_en: string;
  period: string;
  net_amount: number;
  status: 'pending' | 'paid';
}

export interface RentalPayment {
  id: string;
  description_ar: string;
  description_en: string;
  amount: number;
  due_date: string;
  status: 'pending' | 'paid';
}

export interface UtilityBill {
  id: string;
  kind: 'electricity' | 'water' | 'gas' | 'internet';
  bill_no: string;
  amount: number;
  due_date: string;
  status: 'pending' | 'paid';
}

export interface MaintenanceOrder {
  id: string;
  asset_name_ar: string;
  asset_name_en: string;
  cost_estimate: number;
  status: 'open' | 'in_progress' | 'done';
  opened_at: string;
}

export interface BatchRecord {
  id: string;
  plant_id: string;
  batch_no: string;
  mix_code: string;
  produced_at: string;
  volume_m3: number;
  reject_m3: number;
}

export interface Truck {
  id: string;
  code: string;
  capacity_m3: number;
  ownership: 'owned' | 'leased' | 'contracted';
  health_score: number;
  status: 'active' | 'maintenance' | 'idle';
}

export interface Trip {
  id: string;
  truck_id: string;
  customer_id: string;
  order_no: string;
  scheduled_at: string;
  delivered_at: string | null;
  on_time: boolean;
  volume_m3: number;
  status: 'scheduled' | 'delivering' | 'completed' | 'rejected';
}

export interface QualityTest {
  id: string;
  batch_no: string;
  mix_code: string;
  tested_at: string;
  slump_mm: number;
  target_slump_mm: number;
  strength_7d_mpa: number;
  fck_mpa: number;
  temperature_c: number;
  result: 'pass' | 'fail';
}

export interface AuditEntry {
  id: string;
  created_at: string;
  user_id: string | null;
  username: string | null;
  company_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  ip_address: string;
  device_info: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface DemoDataset {
  company: Company;
  plants: Plant[];
  users: User[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  supplierBills: SupplierBill[];
  cashTransactions: CashTransaction[];
  bankAccounts: BankAccount[];
  cheques: Cheque[];
  materials: Material[];
  inventory: InventoryItem[];
  fixedAssets: FixedAsset[];
  loans: Loan[];
  salaryPayments: SalaryPayment[];
  rentals: RentalPayment[];
  utilityBills: UtilityBill[];
  maintenanceOrders: MaintenanceOrder[];
  batches: BatchRecord[];
  trucks: Truck[];
  trips: Trip[];
  qualityTests: QualityTest[];
  auditLog: AuditEntry[];
}
