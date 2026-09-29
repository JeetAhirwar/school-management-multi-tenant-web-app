// CoA (chart of accounts) primitives — pure, no DB access.
// System accounts are seeded per school and are undeletable (isSystem).

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];

// The seven system accounts every school starts with.
const SYSTEM_ACCOUNTS = [
  { code: "1000", name: "Cash in Hand", type: "Asset" },
  { code: "1010", name: "Bank Account", type: "Asset" },
  { code: "4000", name: "Fee Income", type: "Income" },
  { code: "4100", name: "Other Income", type: "Income" },
  { code: "5000", name: "Salary Expense", type: "Expense" },
  { code: "5100", name: "Utilities & Supplies", type: "Expense" },
  { code: "5900", name: "Miscellaneous Expense", type: "Expense" },
];

// Where a fee receipt lands by payment mode: cash to the cash drawer,
// everything else (card/UPI/netbanking/cheque/gateway) to the bank account.
const MODE_ACCOUNT_MAP = {
  Cash: "1000",
  Card: "1010",
  "UPI": "1010",
  "Net Banking": "1010",
  "Bank Transfer": "1010",
  Cheque: "1010",
  "Online Gateway": "1010",
};

const FEE_INCOME_ACCOUNT = "4000";
const SALARY_EXPENSE_ACCOUNT = "5000";
const BANK_ACCOUNT = "1010";

function feeAccountFor(mode) {
  return MODE_ACCOUNT_MAP[mode] || BANK_ACCOUNT;
}

// Asset/Expense are debit-normal; Liability/Equity/Income are credit-normal.
function isDebitNormal(type) {
  return type === "Asset" || type === "Expense";
}

module.exports = {
  ACCOUNT_TYPES,
  SYSTEM_ACCOUNTS,
  MODE_ACCOUNT_MAP,
  FEE_INCOME_ACCOUNT,
  SALARY_EXPENSE_ACCOUNT,
  BANK_ACCOUNT,
  feeAccountFor,
  isDebitNormal,
};
