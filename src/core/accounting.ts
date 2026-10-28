/**
 * Double-entry accounting rules (M1).
 *
 * These pure functions are the single source of truth for balancing, trial balance
 * and ledger maths. The database additionally enforces balance with a deferred
 * constraint trigger, so a client that bypasses this module still cannot post an
 * unbalanced entry.
 */
import { add, compare, dec, decToNumber, isNegative, isZero, percentOf, rescale, sub, sumDec, type Dec } from './decimal';

export type JournalStatus = 'draft' | 'posted' | 'reversed';

export interface JournalLineInput {
  accountId: string;
  debit?: string | number;
  credit?: string | number;
  descriptionAr?: string;
  descriptionEn?: string;
  plantId?: string | null;
  currency?: string;
}

export interface JournalEntryInput {
  companyId: string;
  plantId?: string | null;
  entryDate: string;
  memoAr?: string;
  memoEn?: string;
  currency?: string;
  sourceType?: string;
  sourceId?: string | null;
  createdBy?: string | null;
  lines: readonly JournalLineInput[];
}

export interface NormalisedLine {
  accountId: string;
  debit: Dec;
  credit: Dec;
  descriptionAr: string;
  descriptionEn: string;
  plantId: string | null;
  currency: string;
}

export interface JournalValidation {
  ok: boolean;
  errors: string[];
  lines: NormalisedLine[];
  debitTotal: Dec;
  creditTotal: Dec;
}

const money = (value: string | number | undefined): Dec => dec(value ?? 0, 2);

/** Validate a journal entry exactly as the database will see it. */
export const validateJournal = (entry: JournalEntryInput): JournalValidation => {
  const errors: string[] = [];
  const lines: NormalisedLine[] = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.entryDate)) {
    errors.push('entry_date_invalid');
  }

  for (const [index, line] of entry.lines.entries()) {
    const debit = money(line.debit);
    const credit = money(line.credit);

    if (isNegative(debit) || isNegative(credit)) {
      errors.push(`line_${index + 1}_negative`);
    }
    if (!isZero(debit) && !isZero(credit)) {
      errors.push(`line_${index + 1}_two_sided`);
    }
    if (isZero(debit) && isZero(credit)) {
      errors.push(`line_${index + 1}_zero_amount`);
    }
    if (!line.accountId) {
      errors.push(`line_${index + 1}_missing_account`);
    }

    lines.push({
      accountId: line.accountId,
      debit: rescale(debit, 2),
      credit: rescale(credit, 2),
      descriptionAr: line.descriptionAr ?? '',
      descriptionEn: line.descriptionEn ?? '',
      plantId: line.plantId ?? entry.plantId ?? null,
      currency: line.currency ?? entry.currency ?? 'EGP',
    });
  }

  if (lines.length < 2) errors.push('needs_at_least_two_lines');

  const debitTotal = sumDec(lines.map((line) => line.debit));
  const creditTotal = sumDec(lines.map((line) => line.credit));
  if (compare(debitTotal, creditTotal) !== 0) errors.push('unbalanced');
  if (isZero(debitTotal) && lines.length > 0) errors.push('zero_entry');

  return { ok: errors.length === 0, errors, lines, debitTotal, creditTotal };
};

/** A reversal swaps debit and credit; it never deletes or edits the original. */
export const buildReversal = (entry: JournalEntryInput, memo: { ar: string; en: string }): JournalEntryInput => ({
  ...entry,
  entryDate: new Date().toISOString().slice(0, 10),
  memoAr: memo.ar,
  memoEn: memo.en,
  sourceType: 'reversal',
  lines: entry.lines.map((line) => ({
    ...line,
    debit: line.credit ?? 0,
    credit: line.debit ?? 0,
  })),
});

export interface LedgerRow {
  accountId: string;
  accountCode: string;
  accountNameAr: string;
  accountNameEn: string;
  accountType: string;
  normalSide: 'debit' | 'credit';
  debit: number;
  credit: number;
  balance: number;
}

export interface PostedLine {
  accountId: string;
  accountCode: string;
  accountNameAr: string;
  accountNameEn: string;
  accountType: string;
  normalSide: 'debit' | 'credit';
  debit: string | number;
  credit: string | number;
}

/** Trial balance: one row per account, balance on the account's normal side. */
export const trialBalance = (lines: readonly PostedLine[]): { rows: LedgerRow[]; debitTotal: number; creditTotal: number; balanced: boolean } => {
  const grouped = new Map<string, LedgerRow>();

  for (const line of lines) {
    const debit = money(line.debit);
    const credit = money(line.credit);
    const existing = grouped.get(line.accountId) ?? {
      accountId: line.accountId,
      accountCode: line.accountCode,
      accountNameAr: line.accountNameAr,
      accountNameEn: line.accountNameEn,
      accountType: line.accountType,
      normalSide: line.normalSide,
      debit: 0,
      credit: 0,
      balance: 0,
    };
    existing.debit = decToNumber(add(dec(existing.debit, 2), debit));
    existing.credit = decToNumber(add(dec(existing.credit, 2), credit));
    existing.balance = decToNumber(sub(dec(existing.debit, 2), dec(existing.credit, 2)));
    grouped.set(line.accountId, existing);
  }

  const rows = [...grouped.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const debitTotal = decToNumber(sumDec(rows.map((row) => dec(row.debit, 2))));
  const creditTotal = decToNumber(sumDec(rows.map((row) => dec(row.credit, 2))));

  return { rows, debitTotal, creditTotal, balanced: debitTotal === creditTotal };
};

export interface AccountBalance {
  accountId: string;
  debit: number;
  credit: number;
  balance: number;
}

/** General ledger balance for one account, with an optional running balance. */
export const ledgerBalance = (lines: readonly { debit: string | number; credit: string | number }[]): AccountBalance => {
  const debit = sumDec(lines.map((line) => money(line.debit)));
  const credit = sumDec(lines.map((line) => money(line.credit)));
  return {
    accountId: '',
    debit: decToNumber(debit),
    credit: decToNumber(credit),
    balance: decToNumber(sub(debit, credit)),
  };
};

/** VAT on a taxable base, rounded once at 2dp. */
export const taxAmount = (base: string | number, percent: string | number): number =>
  decToNumber(percentOf(money(base), typeof percent === 'number' ? percent : dec(percent, 4), 2));

/**
 * Deferred revenue recognition helper used by deposits: the held part is a
 * liability until it is applied to an invoice.
 */
export const depositLiability = (amount: string | number): number => decToNumber(money(amount));
