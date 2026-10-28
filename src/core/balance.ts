import type {
  BankAccount,
  CashTransaction,
  Cheque,
  FixedAsset,
  Invoice,
  InventoryItem,
  Loan,
  MaintenanceOrder,
  RentalPayment,
  SalaryPayment,
  SupplierBill,
  UtilityBill,
} from '../types';
import { round2, sumBy } from './money';

export interface BalanceLine {
  key: string;
  labelKey: string;
  amount: number;
  count: number;
  source: string;
}

export interface GeneralBalance {
  debit: BalanceLine[];
  credit: BalanceLine[];
  debitTotal: number;
  creditTotal: number;
  net: number;
  isProfit: boolean;
}

export interface BalanceInput {
  cashTransactions: readonly CashTransaction[];
  bankAccounts: readonly BankAccount[];
  cheques: readonly Cheque[];
  invoices: readonly Invoice[];
  inventory: readonly InventoryItem[];
  fixedAssets: readonly FixedAsset[];
  loans: readonly Loan[];
  supplierBills: readonly SupplierBill[];
  salaryPayments: readonly SalaryPayment[];
  rentals: readonly RentalPayment[];
  utilityBills: readonly UtilityBill[];
  maintenanceOrders: readonly MaintenanceOrder[];
  asOf: string;
}

const dayKey = (iso: string): string => iso.slice(0, 10);

/**
 * General balance — every figure is derived from source tables. No manual entry.
 * Mirrors PART 3.2 of the master specification.
 */
export const computeGeneralBalance = (input: BalanceInput): GeneralBalance => {
  const asOfDay = dayKey(input.asOf);

  const cashRows = input.cashTransactions.filter((txn) => dayKey(txn.txn_date) <= asOfDay);
  const cash = sumBy(cashRows, (txn) => (txn.direction === 'in' ? txn.amount : -txn.amount));

  const bank = sumBy(input.bankAccounts, (account) => account.current_balance);

  const chequesIn = input.cheques.filter((cheque) => cheque.status === 'under_collection');
  const chequesTotal = sumBy(chequesIn, (cheque) => cheque.amount);

  const openInvoices = input.invoices.filter(
    (invoice) => invoice.status !== 'void' && invoice.status !== 'draft' && dayKey(invoice.issue_date) <= asOfDay,
  );
  const receivables = sumBy(openInvoices, (invoice) => invoice.outstanding_amount);

  const inventoryValue = sumBy(input.inventory, (item) => item.quantity * item.unit_cost);
  const assets = sumBy(input.fixedAssets, (asset) => asset.current_book_value);

  const debit: BalanceLine[] = [
    { key: 'cash', labelKey: 'balance.cash', amount: round2(cash), count: cashRows.length, source: 'cash_transactions' },
    { key: 'bank', labelKey: 'balance.bank', amount: round2(bank), count: input.bankAccounts.length, source: 'bank_accounts' },
    { key: 'cheques', labelKey: 'balance.cheques', amount: round2(chequesTotal), count: chequesIn.length, source: 'cheques' },
    { key: 'receivables', labelKey: 'balance.receivables', amount: round2(receivables), count: openInvoices.length, source: 'invoices' },
    { key: 'inventory', labelKey: 'balance.inventory', amount: round2(inventoryValue), count: input.inventory.length, source: 'inventory' },
    { key: 'assets', labelKey: 'balance.assets', amount: round2(assets), count: input.fixedAssets.length, source: 'fixed_assets' },
  ];

  const activeLoans = input.loans.filter((loan) => loan.status !== 'closed');
  const loansTotal = sumBy(activeLoans, (loan) => loan.outstanding_principal);

  const unpaidBills = input.supplierBills.filter((bill) => bill.status !== 'paid');
  const payables = sumBy(unpaidBills, (bill) => bill.outstanding_amount);

  const pendingSalaries = input.salaryPayments.filter((payment) => payment.status === 'pending');
  const salaries = sumBy(pendingSalaries, (payment) => payment.net_amount);

  const unpaidRentals = input.rentals.filter(
    (rental) => rental.status === 'pending' && dayKey(rental.due_date) <= asOfDay,
  );
  const rentalsTotal = sumBy(unpaidRentals, (rental) => rental.amount);

  const unpaidUtilities = input.utilityBills.filter((bill) => bill.status === 'pending');
  const utilities = sumBy(unpaidUtilities, (bill) => bill.amount);

  const pendingMaintenance = input.maintenanceOrders.filter((order) => order.status !== 'done');
  const maintenance = sumBy(pendingMaintenance, (order) => order.cost_estimate);

  const credit: BalanceLine[] = [
    { key: 'loans', labelKey: 'balance.loans', amount: round2(loansTotal), count: activeLoans.length, source: 'loans' },
    { key: 'suppliers', labelKey: 'balance.suppliers', amount: round2(payables), count: unpaidBills.length, source: 'supplier_bills' },
    { key: 'salaries', labelKey: 'balance.salaries', amount: round2(salaries), count: pendingSalaries.length, source: 'salary_payments' },
    { key: 'rentals', labelKey: 'balance.rentals', amount: round2(rentalsTotal), count: unpaidRentals.length, source: 'rental_payments' },
    { key: 'utilities', labelKey: 'balance.utilities', amount: round2(utilities), count: unpaidUtilities.length, source: 'utility_bills' },
    { key: 'maintenance', labelKey: 'balance.maintenance', amount: round2(maintenance), count: pendingMaintenance.length, source: 'maintenance_work_orders' },
  ];

  const debitTotal = round2(debit.reduce((total, line) => total + line.amount, 0));
  const creditTotal = round2(credit.reduce((total, line) => total + line.amount, 0));
  const net = round2(debitTotal - creditTotal);

  return {
    debit: debit.map((line) => ({ ...line, amount: round2(line.amount) })),
    credit: credit.map((line) => ({ ...line, amount: round2(line.amount) })),
    debitTotal,
    creditTotal,
    net,
    isProfit: net >= 0,
  };
};
