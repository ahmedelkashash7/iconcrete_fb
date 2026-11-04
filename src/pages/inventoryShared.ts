/** Shared shapes and helpers for the M6 inventory screens. */
import { ApiError } from '../api';
import type { Lang } from '../types';

export interface Material {
  id: string;
  plant_id: string;
  material_code: string;
  name_ar: string;
  name_en: string;
  category: string;
  unit_of_measure: string;
  is_bulk: boolean;
  valuation_method: 'weighted_average' | 'fifo' | null;
  min_stock_level: number | null;
  max_stock_level: number | null;
  reorder_point: number | null;
  status: string;
  balance: number;
  average_cost: number;
}

export interface Supplier {
  id: string;
  plant_id: string | null;
  supplier_code: string | null;
  name_ar: string;
  name_en: string;
  contact: string;
  payment_terms: string;
  credit_days: number | null;
  rating: number | null;
  status: string;
}

export interface PurchaseRequest {
  id: string;
  plant_id: string;
  pr_no: string;
  material_id: string;
  material_code: string;
  material_name: string;
  quantity_requested: number;
  unit_of_measure: string;
  reason: string;
  requested_by: string;
  requested_at: string;
  status: string;
}

export interface PurchaseOrderItem {
  id: string;
  material_id: string;
  material_code: string;
  material_name: string;
  unit_of_measure: string;
  unit_price: number;
  quantity_ordered: number;
  quantity_received: number;
  tax_rate: number;
  discount_pct: number;
}

export interface PurchaseOrder {
  id: string;
  plant_id: string;
  po_no: string;
  supplier_id: string;
  supplier_name: string;
  pr_id: string | null;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  status: string;
  ordered_at: string | null;
  expected_delivery_at: string | null;
  items: PurchaseOrderItem[];
}

export interface GoodsReceiptItem {
  id: string;
  po_item_id: string;
  material_id: string;
  material_code: string;
  quantity_received: number;
  unit_cost: number;
  lot_no: string;
  expiry_date: string | null;
  weight_in_kg: number | null;
}

export interface GoodsReceipt {
  id: string;
  plant_id: string;
  receipt_no: string;
  po_id: string;
  po_no: string;
  received_at: string;
  received_by: string;
  status: string;
  void_reason: string | null;
  items: GoodsReceiptItem[];
}

export interface Movement {
  movement_id: string;
  plant_id: string;
  material_id: string;
  material_code: string;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  total_cost: number | null;
  movement_type: string;
  reference_type: string;
  reference_id: string | null;
  lot_no: string;
  reason: string;
  occurred_at: string;
  created_by: string;
}

export interface InventoryException {
  exception_id: string;
  plant_id: string;
  material_id: string;
  material_code: string;
  quantity: number;
  available_quantity: number;
  reason: string;
  severity: string;
  status: string;
  suggested_source_type: string;
  suggested_source_id: string | null;
  suggestion_note: string;
  opened_by: string;
  opened_at: string;
  decision: string | null;
}

export const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.code === 'approval_required') return 'inventory.err.approvalRequired';
    if (caught.code === 'negative_stock') return 'inventory.err.negativeStock';
    if (caught.code === 'plant_scope') return 'inventory.err.plantScope';
    if (caught.code === 'unit_mismatch') return 'inventory.err.unitMismatch';
    if (caught.code === 'duplicate_receipt') return 'inventory.err.duplicateReceipt';
    if (caught.code === 'duplicate_po') return 'inventory.err.duplicatePo';
    if (caught.code === 'invalid_transition') return 'inventory.err.invalidTransition';
    if (caught.code === 'fifo_on_bulk' || caught.code === 'mandatory_failure') return 'inventory.err.rule';
  }
  return 'errors.network';
};

export const fmtQty = (value: number, lang: Lang): string =>
  value.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 3 });

export const fmtMoney = (value: number, lang: Lang): string =>
  value.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 2 });

export const fmtDate = (value: string | null, lang: Lang): string =>
  value ? new Date(value).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—';

export const plantsIn = (rows: Array<{ plant_id: string }>): string[] =>
  [...new Set(rows.map((row) => row.plant_id))].filter(Boolean).sort();

export const today = (): string => new Date().toISOString().slice(0, 10);
