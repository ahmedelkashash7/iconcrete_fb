/**
 * Order lifecycle (spec §22).
 *
 * Draft → Confirmed → Scheduled → In Production → Delivered → Invoiced → Closed
 *
 * The transitions are declared once here and enforced on the server; the UI only
 * offers what this table allows, and an invalid transition is rejected rather than
 * coerced into a nearby state.
 */

export const ORDER_STATUSES = [
  'draft',
  'confirmed',
  'scheduled',
  'in_production',
  'delivered',
  'invoiced',
  'closed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Forward path only. Cancellation is a separate, authorized action in a later phase. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['confirmed'],
  confirmed: ['scheduled'],
  scheduled: ['in_production'],
  in_production: ['delivered'],
  delivered: ['invoiced'],
  invoiced: ['closed'],
  closed: [],
};

export const isOrderStatus = (value: string): value is OrderStatus =>
  (ORDER_STATUSES as readonly string[]).includes(value);

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean =>
  ORDER_TRANSITIONS[from].includes(to);

/** The next state a valid transition may move to, or null at the end of the chain. */
export const nextOrderStatus = (from: OrderStatus): OrderStatus | null =>
  ORDER_TRANSITIONS[from][0] ?? null;

export interface TransitionRejection {
  code: 'invalid_transition';
  from: OrderStatus;
  to: string;
  allowed: OrderStatus[];
}

/**
 * Returns null when the move is legal, otherwise the rejection payload that the API
 * serialises. Never silently coerces: `scheduled → delivered` is refused, not mapped.
 */
export const validateOrderTransition = (
  from: OrderStatus,
  to: string,
): TransitionRejection | null => {
  if (isOrderStatus(to) && canTransitionOrder(from, to)) return null;
  return { code: 'invalid_transition', from, to, allowed: ORDER_TRANSITIONS[from] };
};

export const orderStatusLabelKey = (status: OrderStatus): string => `orders.status.${status}`;
