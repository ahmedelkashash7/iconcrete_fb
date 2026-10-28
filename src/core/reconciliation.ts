/** Bank reconciliation: deterministic matching of book transactions to a statement. */
import { compare, dec, decToNumber, sub } from './decimal';

export interface BookTransaction {
  id: string;
  txnDate: string;
  direction: 'in' | 'out';
  amount: string | number;
  reference?: string;
}

export interface StatementTransaction {
  id: string;
  txnDate: string;
  direction: 'in' | 'out';
  amount: string | number;
  reference?: string;
}

export type MatchType = 'exact' | 'reference' | 'amount_date' | 'manual' | 'unmatched';

export interface MatchPair {
  bookId: string | null;
  statementId: string | null;
  amount: number;
  matchType: MatchType;
}

export interface ReconciliationResult {
  matched: MatchPair[];
  unmatchedBook: BookTransaction[];
  unmatchedStatement: StatementTransaction[];
  bookTotalIn: number;
  bookTotalOut: number;
  statementTotalIn: number;
  statementTotalOut: number;
  bookBalance: number;
  statementBalance: number;
  variance: number;
  balanced: boolean;
  matchedCount: number;
  unmatchedCount: number;
}

const dayKey = (iso: string): string => iso.slice(0, 10);
const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(`${dayKey(a)}T00:00:00Z`) - Date.parse(`${dayKey(b)}T00:00:00Z`)) / 86_400_000);

/**
 * Matching order:
 *   1. same reference, same amount, same direction (strongest evidence)
 *   2. same amount and direction within ±dateWindowDays
 *   3. manual pairs supplied by the operator
 * Anything left over is reported as unmatched, never silently written off.
 */
export const reconcileBank = (
  book: readonly BookTransaction[],
  statement: readonly StatementTransaction[],
  options: { dateWindowDays?: number; manual?: readonly { bookId: string; statementId: string }[] } = {},
): ReconciliationResult => {
  const window = options.dateWindowDays ?? 3;
  const usedBook = new Set<string>();
  const usedStatement = new Set<string>();
  const matched: MatchPair[] = [];

  const tryMatch = (
    predicate: (bookTxn: BookTransaction, statementTxn: StatementTransaction) => boolean,
    matchType: MatchType,
  ): void => {
    for (const bookTxn of book) {
      if (usedBook.has(bookTxn.id)) continue;
      const candidate = statement.find(
        (statementTxn) =>
          !usedStatement.has(statementTxn.id) &&
          statementTxn.direction === bookTxn.direction &&
          compare(dec(statementTxn.amount, 2), dec(bookTxn.amount, 2)) === 0 &&
          predicate(bookTxn, statementTxn),
      );
      if (!candidate) continue;
      usedBook.add(bookTxn.id);
      usedStatement.add(candidate.id);
      matched.push({
        bookId: bookTxn.id,
        statementId: candidate.id,
        amount: decToNumber(dec(bookTxn.amount, 2)),
        matchType,
      });
    }
  };

  tryMatch(
    (a, b) => Boolean(a.reference) && a.reference === b.reference,
    'reference',
  );
  tryMatch((a, b) => Math.abs(dayDiff(a.txnDate, b.txnDate)) <= window, 'amount_date');

  for (const manual of options.manual ?? []) {
    if (usedBook.has(manual.bookId) || usedStatement.has(manual.statementId)) continue;
    const bookTxn = book.find((item) => item.id === manual.bookId);
    const statementTxn = statement.find((item) => item.id === manual.statementId);
    if (!bookTxn || !statementTxn) continue;
    usedBook.add(bookTxn.id);
    usedStatement.add(statementTxn.id);
    matched.push({
      bookId: bookTxn.id,
      statementId: statementTxn.id,
      amount: decToNumber(dec(bookTxn.amount, 2)),
      matchType: 'manual',
    });
  }

  const unmatchedBook = book.filter((txn) => !usedBook.has(txn.id));
  const unmatchedStatement = statement.filter((txn) => !usedStatement.has(txn.id));

  const total = (rows: readonly { direction: 'in' | 'out'; amount: string | number }[], direction: 'in' | 'out'): number =>
    Number(
      rows
        .filter((row) => row.direction === direction)
        .reduce((sum, row) => sum + decToNumber(dec(row.amount, 2)), 0)
        .toFixed(2),
    );

  const bookIn = total(book, 'in');
  const bookOut = total(book, 'out');
  const statementIn = total(statement, 'in');
  const statementOut = total(statement, 'out');
  const bookBalance = Number(sub(dec(bookIn, 2), dec(bookOut, 2)).units) / 100;
  const statementBalance = Number(sub(dec(statementIn, 2), dec(statementOut, 2)).units) / 100;

  return {
    matched,
    unmatchedBook,
    unmatchedStatement,
    bookTotalIn: bookIn,
    bookTotalOut: bookOut,
    statementTotalIn: statementIn,
    statementTotalOut: statementOut,
    bookBalance,
    statementBalance,
    variance: Number((statementBalance - bookBalance).toFixed(2)),
    balanced: Math.abs(statementBalance - bookBalance) < 0.005,
    matchedCount: matched.length,
    unmatchedCount: unmatchedBook.length + unmatchedStatement.length,
  };
};

/** Session can only be closed when nothing is unmatched and the balances agree. */
export const canCloseReconciliation = (result: ReconciliationResult): { ok: boolean; reason?: string } => {
  if (result.unmatchedCount > 0) return { ok: false, reason: 'unmatched_transactions' };
  if (!result.balanced) return { ok: false, reason: 'variance_not_zero' };
  return { ok: true };
};
