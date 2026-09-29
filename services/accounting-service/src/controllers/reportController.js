const Account = require("../models/Account");
const JournalEntry = require("../models/JournalEntry");
const { ensureSystemAccounts } = require("../services/coaSeed");
const { computeTrialBalance, computeIncomeExpense, computeBalanceSheet } = require("../utils/ledger");

async function loadBooks(schoolId) {
  await ensureSystemAccounts(schoolId);
  const [accounts, entries] = await Promise.all([
    Account.find({ schoolId }).sort({ code: 1 }).lean(),
    JournalEntry.find({ schoolId }).sort({ date: 1, _id: 1 }).lean(),
  ]);
  return { accounts, entries };
}

const getTrialBalance = async (req, res) => {
  try {
    const { from, to } = req.query;
    const { accounts, entries } = await loadBooks(req.tenantId);
    const report = computeTrialBalance({ entries, accounts, from, to });
    res.json({ success: true, ...report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getIncomeExpense = async (req, res) => {
  try {
    const { from, to } = req.query;
    const { accounts, entries } = await loadBooks(req.tenantId);
    const report = computeIncomeExpense({ entries, accounts, from, to });
    res.json({ success: true, ...report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBalanceSheet = async (req, res) => {
  try {
    const asOf = req.query.asOf || new Date().toISOString();
    const { accounts, entries } = await loadBooks(req.tenantId);
    const report = computeBalanceSheet({ entries, accounts, asOf });
    res.json({ success: true, asOf, ...report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getTrialBalance, getIncomeExpense, getBalanceSheet };
