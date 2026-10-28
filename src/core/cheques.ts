/** Cheque lifecycle. Illegal transitions are impossible here, and enforced again in the service. */
import { add, dec, decToNumber, type Dec } from './decimal';

export type ChequeStatus =
  | 'received'
  | 'deposited'
  | 'cleared'
  | 'bounced'
  | 'recovered'
  | 'cancelled'
  | 'closed';

export interface ChequeTransition {
  from: ChequeStatus;
  to: ChequeStatus;
  /** Bounce adds a bank fee to the receivable. */
  addsFee?: boolean;
  requiresAccount?: boolean;
}

export const CHEQUE_TRANSITIONS: readonly ChequeTransition[] = [
  { from: 'received', to: 'deposited', requiresAccount: true },
  { from: 'received', to: 'cancelled' },
  { from: 'deposited', to: 'cleared' },
  { from: 'deposited', to: 'bounced' },
  { from: 'bounced', to: 'recovered', addsFee: true },
  { from: 'bounced', to: 'cancelled' },
  { from: 'recovered', to: 'closed' },
  { from: 'cleared', to: 'closed' },
  { from: 'cancelled', to: 'closed' },
];

const TERMINAL: readonly ChequeStatus[] = ['closed'];

export const canTransition = (from: ChequeStatus, to: ChequeStatus): boolean =>
  CHEQUE_TRANSITIONS.some((transition) => transition.from === from && transition.to === to);

export const allowedTransitions = (from: ChequeStatus): ChequeStatus[] =>
  CHEQUE_TRANSITIONS.filter((transition) => transition.from === from).map((transition) => transition.to);

export interface ChequeTransitionInput {
  chequeId: string;
  from: ChequeStatus;
  to: ChequeStatus;
  direction: 'incoming' | 'outgoing';
  amount: string | number;
  fee?: string | number;
  accountId?: string | null;
  note?: string;
  actor?: string;
}

export type ChequeTransitionResult =
  | {
      ok: true;
      status: ChequeStatus;
      amount: number;
      fee: number;
      /** Extra debit raised when an outgoing cheque bounces (the supplier is still owed). */
      supplierBalanceIncrease: number;
    }
  | { ok: false; reason: 'illegal_transition' | 'missing_account' | 'cheque_closed' };

/** Applies a state change and returns the money consequences the ledger must post. */
export const applyChequeTransition = (input: ChequeTransitionInput): ChequeTransitionResult => {
  if (TERMINAL.includes(input.from)) return { ok: false, reason: 'cheque_closed' };
  if (!canTransition(input.from, input.to)) return { ok: false, reason: 'illegal_transition' };

  const transition = CHEQUE_TRANSITIONS.find((item) => item.from === input.from && item.to === input.to);
  if (transition?.requiresAccount && !input.accountId) return { ok: false, reason: 'missing_account' };

  const amount: Dec = dec(input.amount, 2);
  const fee: Dec = transition?.addsFee ? dec(input.fee ?? 0, 2) : dec(0, 2);

  return {
    ok: true,
    status: input.to,
    amount: decToNumber(amount),
    fee: decToNumber(fee),
    supplierBalanceIncrease:
      transition?.addsFee && input.direction === 'outgoing' ? decToNumber(add(amount, fee)) : 0,
  };
};

export interface ChequeAgingRow {
  chequeId: string;
  chequeNo: string;
  status: ChequeStatus;
  amount: number;
  dueDate: string;
  daysToDue: number;
}

/** Cheques needing action: due soon, overdue or bounced and not yet recovered. */
export const chequesRequiringAction = (
  cheques: readonly { id: string; cheque_no: string; status: ChequeStatus; amount: string | number; due_date: string }[],
  today: string,
  windowDays = 7,
): ChequeAgingRow[] => {
  const todayMs = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return cheques
    .filter((cheque) => ['received', 'deposited', 'bounced'].includes(cheque.status))
    .map((cheque) => {
      const dueMs = Date.parse(`${cheque.due_date.slice(0, 10)}T00:00:00Z`);
      return {
        chequeId: cheque.id,
        chequeNo: cheque.cheque_no,
        status: cheque.status,
        amount: decToNumber(dec(cheque.amount, 2)),
        dueDate: cheque.due_date.slice(0, 10),
        daysToDue: Math.round((dueMs - todayMs) / 86_400_000),
      };
    })
    .filter((row) => row.daysToDue <= windowDays)
    .sort((a, b) => a.daysToDue - b.daysToDue);
};
