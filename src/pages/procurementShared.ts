/** Shared shapes and helpers for the M9 procurement and payables screens. */
import { ApiError } from '../api';
import type { Lang } from '../types';

export interface SupplierRow {
  id: string;
  supplier_code: string | null;
  name_ar: string;
  name_en: string;
  phone: string;
  contact: string;
  category: string;
  status: string;
  plant_id: string | null;
  payment_terms: string;
  overall_grade: string | null;
  evaluated_at: string | null;
  invalid_documents: number;
  document_count: number;
}

export interface SupplierDocument {
  id: string;
  doc_type: string;
  document_ref: string;
  valid_from: string;
  valid_until: string | null;
  verified_by: string | null;
  verified_at: string | null;
  status: string;
  reject_reason: string;
}

export interface SupplierEvaluation {
  id: string;
  evaluation_no: string;
  period_start: string;
  period_end: string;
  quality_score: number;
  delivery_score: number;
  price_score: number;
  responsiveness_score: number;
  overall_grade: string | null;
  evaluator_id: string;
  evaluated_at: string;
  notes: string;
  status: string;
}

export interface SupplierContract {
  id: string;
  contract_no: string;
  start_date: string;
  end_date: string | null;
  payment_terms: string;
  price_adjustment_clause: string;
  status: string;
  signed_at: string | null;
  signed_by: string | null;
  void_reason: string;
}

export interface SupplierDetail extends SupplierRow {
  documents: SupplierDocument[];
  evaluations: SupplierEvaluation[];
  contracts: SupplierContract[];
}

export interface PurchaseInvoiceItem {
  id: string;
  line_no: number;
  material_id: string;
  material_code: string;
  name_ar: string;
  name_en: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface PurchaseInvoice {
  id: string;
  invoice_no: string;
  supplier_id: string;
  supplier_name_ar: string;
  supplier_name_en: string;
  supplier_code: string | null;
  po_id: string | null;
  po_no: string | null;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  status: string;
  match_status: string;
  match_details: {
    poId?: string | null;
    reasons?: string[];
    override?: boolean;
    lines?: Array<{
      materialId: string;
      ordered: number;
      received: number;
      invoiced: number;
      poPrice: number | null;
      invoicePrice: number;
      qtyVariancePct: number | null;
      priceVariancePct: number | null;
    }>;
  };
  verified_at: string | null;
  approved_at: string | null;
  void_reason: string;
  notes: string;
  plant_id: string;
  items?: PurchaseInvoiceItem[];
}

export interface PaymentVoucher {
  id: string;
  voucher_no: string;
  supplier_id: string | null;
  supplier_name_ar: string | null;
  supplier_name_en: string | null;
  customer_id: string | null;
  customer_name_ar: string | null;
  customer_name_en: string | null;
  purchase_invoice_id: string | null;
  invoice_no: string | null;
  payment_type: string;
  amount: number;
  currency: string;
  method: string;
  cheque_no: string | null;
  cheque_due_date: string | null;
  paid_at: string | null;
  recorded_by: string;
  status: string;
  exception_status: string;
  exception_reason: string;
  plant_id: string;
}

export interface AgingRow {
  supplierId: string;
  supplier_name_ar: string;
  supplier_name_en: string;
  supplier_code: string;
  bucket0To30: number;
  bucket31To60: number;
  bucket61To90: number;
  bucket90Plus: number;
  totalDue: number;
}

export const supplierName = (supplier: SupplierRow, lang: Lang): string =>
  lang === 'ar' ? supplier.name_ar : supplier.name_en || supplier.name_ar;

export const docTone = (status: string, validUntil: string | null): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (status === 'rejected') return 'danger';
  if (status === 'expired') return 'warning';
  if (status === 'pending') return 'warning';
  if (validUntil && validUntil < new Date().toISOString().slice(0, 10)) return 'danger';
  return status === 'verified' ? 'success' : 'neutral';
};

export const statusTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'purple' => {
  if (['active', 'approved', 'paid', 'matched', 'published', 'verified', 'signed'].includes(status)) return 'success';
  if (['draft', 'received', 'pending', 'open'].includes(status)) return 'neutral';
  if (['disputed', 'expired', 'cancelled', 'voided', 'rejected', 'superseded', 'void'].includes(status)) return 'danger';
  if (['verified', 'partially_received'].includes(status)) return 'warning';
  return 'neutral';
};

export const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.code === 'approval_required') return 'procurement.err.approvalRequired';
    if (caught.code === 'duplicate_invoice') return 'procurement.err.duplicateInvoice';
    if (caught.code === 'invoice_arithmetic') return 'procurement.err.invoiceArithmetic';
    if (caught.code === 'payment_invoice_not_approved') return 'procurement.err.paymentInvoice';
    if (caught.code === 'payment_exceeds_outstanding') return 'procurement.err.overpayment';
    if (caught.code === 'supplier_suspended') return 'procurement.err.supplierSuspended';
    if (caught.code === 'evaluation_score_range') return 'procurement.err.scoreRange';
    if (caught.code === 'document_expired') return 'procurement.err.documentExpired';
    if (caught.code === 'invalid_transition') return 'inventory.err.invalidTransition';
    if (caught.code === 'plant_scope') return 'inventory.err.plantScope';
    if (caught.code === 'supplier_not_found') return 'procurement.err.supplierMissing';
    if (caught.code === 'invoice_not_found') return 'procurement.err.invoiceMissing';
  }
  return 'errors.network';
};
