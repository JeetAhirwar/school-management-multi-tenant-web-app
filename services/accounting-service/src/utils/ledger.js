// Pure journal + reporting math. No mongoose, no I/O — unit-testable.
// Double-entry rule: every entry balances (total debits === total credits),
// has >= 2 lines, and each line posts to exactly one side.
const {
  FEE_INCOME_ACCOUNT,
  SALARY_EXPENSE_ACCOUNT,
  BANK_ACCOUNT,
  feeAccountFor,
  isDebitNormal,
} = require("./accounts");

const TOLERANCE = 0.005;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function isBalanced(a, b) {
  return Math.abs(round2(a) - round2(b)) <= TOLERANCE;
}

// ── Validation ─────────────────────────────────────────────────────────────
// validCodes: optional Set of account codes; when supplied every line must
// reference an existing account.
function validateEntryLines(lines, validCodes) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { ok: false, error: "An entry needs at least two lines", debitTotal: 0, creditTotal: 0 };
  }
  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of lines) {
    const code = line && line.accountCode;
    const debit = Number(line && line.debit) || 0;
    const credit = Number(line && line.credit) || 0;
    if (typeof code !== "string" || !code.trim()) {
      return { ok: false, error: "Every line needs an account code", debitTotal, creditTotal };
    }
    if (debit < 0 || credit < 0) {
      return { ok: false, error: "Amounts cannot be negative", debitTotal, creditTotal };
    }
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      return { ok: false, error: "Every line must post a debit OR a credit, not both/neither", debitTotal, creditTotal };
    }
    if (validCodes && !validCodes.has(code)) {
      return { ok: false, error: `Unknown account: ${code}`, debitTotal, creditTotal };
    }
    debitTotal += debit;
    creditTotal += credit;
  }
  if (!isBalanced(debitTotal, creditTotal)) {
    return { ok: false, error: "Debits and credits must be equal", debitTotal: round2(debitTotal), creditTotal: round2(creditTotal) };
  }
  return { ok: true, error: null, debitTotal: round2(debitTotal), creditTotal: round2(creditTotal) };
}

// ── Entry builders (used by the ledger sweeper) ───────────────────────────
function feeReceiptLines(mode, amount) {
  const amt = round2(amount);
  if (!(amt > 0)) return null;
  return [
    { accountCode: feeAccountFor(mode), debit: amt, credit: 0 },
    { accountCode: FEE_INCOME_ACCOUNT, debit: 0, credit: amt },
  ];
}

// Cheque bounced: mirror of the original receipt (fee income reverses,
// the cash/bank account gives it back).
function feeReversalLines(mode, amount) {
  const amt = round2(amount);
  if (!(amt > 0)) return null;
  return [
    { accountCode: FEE_INCOME_ACCOUNT, debit: amt, credit: 0 },
    { accountCode: feeAccountFor(mode), debit: 0, credit: amt },
  ];
}

// Payroll marked Paid: salary expense up, bank down (cash basis at markPaid).
function payrollLines(amount) {
  const amt = round2(amount);
  if (!(amt > 0)) return null;
  return [
    { accountCode: SALARY_EXPENSE_ACCOUNT, debit: amt, credit: 0 },
    { accountCode: BANK_ACCOUNT, debit: 0, credit: amt },
  ];
}

// ── Aggregation helpers ────────────────────────────────────────────────────
function sumByAccount(entries) {
  const byCode = new Map();
  for (const entry of entries) {
    for (const line of entry.lines || []) {
      const bucket = byCode.get(line.accountCode) || { debit: 0, credit: 0 };
      bucket.debit += Number(line.debit) || 0;
      bucket.credit += Number(line.credit) || 0;
      byCode.set(line.accountCode, bucket);
    }
  }
  return byCode;
}

function filterByPeriod(entries, from, to) {
  const start = from ? new Date(from).getTime() : null;
  const end = to ? new Date(to).getTime() : null;
  if (start === null && end === null) return entries;
  return entries.filter((entry) => {
    const t = new Date(entry.date).getTime();
    if (Number.isNaN(t)) return false;
    if (start !== null && t < start) return false;
    if (end !== null && t > end) return false;
    return true;
  });
}

// Balance expressed on the account's normal side (positive numbers).
function normalBalance(type, debit, credit) {
  const net = round2(debit - credit);
  return isDebitNormal(type) ? net : round2(credit - debit);
}

// ── Reports ────────────────────────────────────────────────────────────────
function computeTrialBalance({ entries, accounts, from, to }) {
  const period = filterByPeriod(entries, from, to);
  const sums = sumByAccount(period);
  const rows = accounts
    .map((account) => {
      const bucket = sums.get(account.code) || { debit: 0, credit: 0 };
      const net = round2(bucket.debit - bucket.credit);
      // Standard trial balance: net debit balance → debit column, net credit
      // balance → credit column, regardless of the account's type.
      const magnitude = Math.abs(net);
      return {
        code: account.code,
        name: account.name,
        type: account.type,
        debit: net > 0 ? magnitude : 0,
        credit: net < 0 ? magnitude : 0,
      };
    })
    .filter((row) => row.debit !== 0 || row.credit !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, totalDebit, totalCredit, balanced: isBalanced(totalDebit, totalCredit) };
}

function computeIncomeExpense({ entries, accounts, from, to }) {
  const period = filterByPeriod(entries, from, to);
  const sums = sumByAccount(period);
  const rows = accounts
    .filter((account) => account.type === "Income" || account.type === "Expense")
    .map((account) => {
      const bucket = sums.get(account.code) || { debit: 0, credit: 0 };
      return {
        code: account.code,
        name: account.name,
        type: account.type,
        amount: normalBalance(account.type, bucket.debit, bucket.credit),
      };
    })
    .filter((row) => row.amount !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const totalIncome = round2(rows.filter((r) => r.type === "Income").reduce((s, r) => s + r.amount, 0));
  const totalExpense = round2(rows.filter((r) => r.type === "Expense").reduce((s, r) => s + r.amount, 0));
  return { rows, totalIncome, totalExpense, net: round2(totalIncome - totalExpense) };
}

function computeBalanceSheet({ entries, accounts, asOf }) {
  const period = filterByPeriod(entries, undefined, asOf);
  const sums = sumByAccount(period);
  const mapRows = (types) =>
    accounts
      .filter((account) => types.includes(account.type))
      .map((account) => {
        const bucket = sums.get(account.code) || { debit: 0, credit: 0 };
        return { code: account.code, name: account.name, type: account.type, amount: normalBalance(account.type, bucket.debit, bucket.credit) };
      })
      .filter((row) => row.amount !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  const assets = mapRows(["Asset"]);
  const liabilities = mapRows(["Liability"]);
  const equity = mapRows(["Equity"]);
  const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0));
  // Retained earnings = cumulative income − expense (lifetime up to asOf).
  const retainedEarnings = computeIncomeExpense({ entries, accounts, to: asOf }).net;
  const totalLiabilitiesEquity = round2(totalLiabilities + totalEquity + retainedEarnings);
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    retainedEarnings,
    totalLiabilitiesEquity,
    balanced: isBalanced(totalAssets, totalLiabilitiesEquity),
  };
}

module.exports = {
  TOLERANCE,
  round2,
  isBalanced,
  validateEntryLines,
  feeReceiptLines,
  feeReversalLines,
  payrollLines,
  sumByAccount,
  filterByPeriod,
  normalBalance,
  computeTrialBalance,
  computeIncomeExpense,
  computeBalanceSheet,
};
