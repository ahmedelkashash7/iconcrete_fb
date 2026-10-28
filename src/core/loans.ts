/** Loan annuity schedules with exact final-installment reconciliation. */
import { dec, decToNumber, decToString, rescale, sub, type Dec } from './decimal';

export interface LoanInput {
  loanId: string;
  principal: string | number;
  annualRate: string | number;
  termMonths: number;
  frequency?: 'monthly' | 'quarterly';
  startDate: string;
}

export interface LoanInstallment {
  installmentNo: number;
  dueDate: string;
  payment: number;
  principalPart: number;
  interestPart: number;
  remaining: number;
}

export interface LoanSchedule {
  installments: LoanInstallment[];
  totalPayment: number;
  totalInterest: number;
  periodicRate: number;
}

const addMonths = (iso: string, months: number): string => {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};

const roundHalfUp = (value: Dec): Dec => rescale(value, 2);

/**
 * Annuity schedule.
 * r = annualRate / 100 / periodsPerYear, payment = P*r/(1-(1+r)^-n) rounded once.
 * The final installment is recomputed so remaining hits exactly zero.
 */
export const annuitySchedule = (loan: LoanInput): LoanSchedule => {
  const principal = rescale(dec(loan.principal, 2), 2);
  if (loan.termMonths <= 0) throw new Error('term_invalid');

  const periodsPerYear = loan.frequency === 'quarterly' ? 4 : 12;
  const monthsPerPeriod = 12 / periodsPerYear;
  const n = Math.round(loan.termMonths / monthsPerPeriod);
  if (n <= 0) throw new Error('term_invalid');

  const annual = Number(loan.annualRate) / 100;
  const rate = annual / periodsPerYear;

  const paymentNumber =
    rate === 0 ? Number(principal.units) / 100 / n : (Number(principal.units) / 100) * (rate / (1 - Math.pow(1 + rate, -n)));

  const basePayment = roundHalfUp(dec(paymentNumber.toFixed(6), 2));

  const installments: LoanInstallment[] = [];
  let remaining: Dec = principal;

  for (let index = 1; index <= n; index += 1) {
    const interest = roundHalfUp(dec(((Number(remaining.units) / 100) * rate).toFixed(6), 2));
    let payment = basePayment;
    let principalPart = sub(payment, interest);

    if (index === n) {
      principalPart = remaining;
      payment = { units: principalPart.units + interest.units, scale: 2 };
    }

    const nextRemaining = sub(remaining, principalPart);
    installments.push({
      installmentNo: index,
      dueDate: addMonths(loan.startDate, index * monthsPerPeriod),
      payment: decToNumber(payment),
      principalPart: decToNumber(principalPart),
      interestPart: decToNumber(interest),
      remaining: decToNumber(nextRemaining),
    });
    remaining = nextRemaining;
  }

  const totalPayment = installments.reduce((sum, item) => sum + item.payment, 0);
  const totalInterest = installments.reduce((sum, item) => sum + item.interestPart, 0);

  return { installments, totalPayment: Number(totalPayment.toFixed(2)), totalInterest: Number(totalInterest.toFixed(2)), periodicRate: rate };
};

/** Outstanding principal after k paid installments. */
export const outstandingPrincipal = (loan: LoanInput, paidInstallments: number): number => {
  const schedule = annuitySchedule(loan);
  if (paidInstallments <= 0) return decToNumber(rescale(dec(loan.principal, 2), 2));
  if (paidInstallments >= schedule.installments.length) return 0;
  return schedule.installments[paidInstallments - 1]?.remaining ?? 0;
};

/** Early settlement: remaining principal plus accrued interest for the current period. */
export const earlySettlementAmount = (loan: LoanInput, paidInstallments: number): { principal: number; interest: number; total: number } => {
  const schedule = annuitySchedule(loan);
  const next = schedule.installments[paidInstallments];
  const principal = outstandingPrincipal(loan, paidInstallments);
  const interest = next?.interestPart ?? 0;
  return {
    principal,
    interest,
    total: Number(decToString(rescale(dec(principal, 2), 2)) ? (principal + interest).toFixed(2) : '0'),
  };
};
