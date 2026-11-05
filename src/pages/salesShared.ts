/** Shared shapes and helpers for the M7 sales and distribution screens. */
import { ApiError } from '../api';
import type { Lang } from '../types';

export interface Customer {
  id: string;
  plant_id: string | null;
  customer_code: string | null;
  name_ar: string;
  name_en: string;
  contact_person: string;
  phone: string;
  email: string;
  billing_address: string;
  shipping_address: string;
  credit_limit: number | null;
  effective_limit: number;
  currency: string;
  status: string;
  blacklisted: boolean;
  blacklist_reason: string | null;
  exposure: number;
  credit_ratio: number | null;
}

export interface Project {
  id: string;
  plant_id: string | null;
  customer_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  site_location: string;
  contact_person: string;
  contact_phone: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

export interface QuotationLine {
  id: string;
  material_id: string | null;
  material_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate: number;
  line_total: number;
}

export interface QuotationVersion {
  id: string;
  version_no: number;
  status: string;
  reason: string;
  created_at: string;
  created_by: string;
  snapshot: unknown;
}

export interface Quotation {
  id: string;
  plant_id: string;
  quotation_no: string;
  customer_id: string;
  customer_name: string;
  project_id: string | null;
  project_code: string | null;
  total_amount: number;
  currency: string;
  valid_until: string;
  status: string;
  quoted_by: string;
  current_version_id: string | null;
  items: QuotationLine[];
  versions: QuotationVersion[];
}

export interface ContractVersion {
  id: string;
  version_no: number;
  status: string;
  reason: string;
  created_at: string;
  created_by: string;
  snapshot: unknown;
}

export interface Contract {
  id: string;
  plant_id: string;
  contract_no: string;
  customer_id: string;
  customer_name: string;
  project_id: string | null;
  quotation_version_id: string;
  start_date: string | null;
  end_date: string | null;
  terms: string;
  status: string;
  signed_at: string | null;
  signed_by: string | null;
  void_reason: string | null;
  versions: ContractVersion[];
}

export interface SalesOrderItem {
  id: string;
  material_id: string | null;
  material_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate: number;
  line_total: number;
  delivered_qty: number;
  invoiced_qty: number;
}

export interface TicketBatch {
  id: string;
  batch_id: string | null;
  batch_no: string;
  volume_m3: number;
  price_per_m3: number;
}

export interface DeliveryTicket {
  id: string;
  plant_id: string;
  ticket_no: string;
  order_id: string;
  order_no: string;
  trip_id: string;
  truck_id: string;
  truck_plate: string;
  driver_id: string | null;
  ticket_date: string;
  ticket_time: string | null;
  loaded_vol: number;
  delivered_vol: number;
  status: string;
  void_reason: string | null;
  batches: TicketBatch[];
}

export interface SalesOrder {
  id: string;
  plant_id: string;
  order_no: string;
  customer_id: string;
  customer_name: string;
  project_id: string | null;
  project_code: string | null;
  quotation_id: string | null;
  contract_id: string | null;
  status: string;
  order_date: string | null;
  delivery_date: string | null;
  total_amount: number;
  credit_status: string | null;
  hold_reason: string | null;
  held_from_status: string | null;
  cancel_reason: string | null;
  items: SalesOrderItem[];
  delivered_qty: number;
  ordered_qty: number;
  delivery_state: 'none' | 'partial' | 'full';
  tickets: DeliveryTicket[];
}

export interface Assignment {
  id: string;
  plant_id: string;
  order_id: string | null;
  truck_id: string;
  truck_plate: string;
  driver_id: string;
  driver_name: string;
  status: string;
  trip_id: string | null;
}

export interface Truck {
  id: string;
  plant_id: string;
  plate_no: string;
  capacity_m3: number;
  status: string;
}

export interface Driver {
  id: string;
  plant_id: string;
  full_name: string;
  phone: string | null;
  status: string;
}

export interface Batch {
  id: string;
  plant_id: string;
  batch_no: string;
  planned_volume: number;
  actual_volume: number | null;
  status: string;
}

export const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.code === 'customer_blacklisted') return 'sales.err.blacklisted';
    if (caught.code === 'duplicate_quotation') return 'sales.err.duplicateQuotation';
    if (caught.code === 'duplicate_order') return 'sales.err.duplicateOrder';
    if (caught.code === 'duplicate_ticket') return 'sales.err.duplicateTicket';
    if (caught.code === 'version_not_approved') return 'sales.err.versionNotApproved';
    if (caught.code === 'plant_scope') return 'inventory.err.plantScope';
    if (caught.code === 'customer_not_found') return 'sales.err.customerMissing';
    if (caught.code === 'invalid_transition') return 'inventory.err.invalidTransition';
    if (caught.code === 'approval_required') return 'sales.err.approvalRequired';
    if (caught.code === 'positive_value') return 'sales.err.positiveValue';
    if (caught.code === 'ticket_references') return 'sales.err.ticketReferences';
    if (caught.code === 'batch_coverage') return 'sales.err.batchCoverage';
    if (caught.code === 'ticket_over_order') return 'sales.err.ticketOverOrder';
    if (caught.code === 'duplicate_price_list') return 'sales.err.duplicatePriceList';
    if (caught.code === 'price_list_overlap') return 'sales.err.priceListOverlap';
    if (caught.code === 'price_list_locked') return 'sales.err.priceListLocked';
    if (caught.code === 'price_list_not_found') return 'sales.err.priceListNotFound';
    if (caught.code === 'season_window') return 'sales.err.seasonWindow';
    if (caught.code === 'feedback_rating') return 'sales.err.feedbackRating';
    if (caught.code === 'complaint_ncr') return 'sales.err.complaintNcr';
    if (caught.code === 'ncr_not_found') return 'sales.err.ncrNotFound';
    if (caught.code === 'duplicate_commitment') return 'sales.err.duplicateCommitment';
    if (caught.code === 'commitment_not_found') return 'sales.err.commitmentNotFound';
    if (caught.code === 'duplicate_activity') return 'sales.err.duplicateActivity';
    if (caught.code === 'duplicate_complaint') return 'sales.err.duplicateComplaint';
    if (caught.code === 'price_missing' || caught.code === 'price_ambiguous') return 'sales.err.approvalRequired';
  }
  return 'errors.network';
};

export const fmtMoney = (value: number, lang: Lang): string =>
  value.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 2 });

export const fmtQty = (value: number, lang: Lang): string =>
  value.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 3 });

export const fmtDate = (value: string | null, lang: Lang): string =>
  value ? new Date(value).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—';

export const today = (): string => new Date().toISOString().slice(0, 10);

export const customerName = (customer: Customer, lang: Lang): string =>
  lang === 'ar' ? customer.name_ar : customer.name_en || customer.name_ar;

export const creditTone = (ratio: number | null): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (ratio === null) return 'neutral';
  if (ratio > 100) return 'danger';
  if (ratio > 80) return 'warning';
  return 'success';
};
