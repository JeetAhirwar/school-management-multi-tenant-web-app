const Account = require("../models/Account");
const JournalEntry = require("../models/JournalEntry");
const { ensureSystemAccounts } = require("../services/coaSeed");
const { ACCOUNT_TYPES } = require("../utils/accounts");

const getAccounts = async (req, res) => {
  try {
    await ensureSystemAccounts(req.tenantId);
    const filter = { schoolId: req.tenantId };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.active === "true") filter.active = true;
    const data = await Account.find(filter).sort({ code: 1 }).lean();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const validateAccountBody = (body, { partial = false } = {}) => {
  const { code, name, type } = body || {};
  if (!partial) {
    if (!code || !String(code).trim()) return "code is required";
    if (!name || !String(name).trim()) return "name is required";
    if (!ACCOUNT_TYPES.includes(type)) return `type must be one of: ${ACCOUNT_TYPES.join(", ")}`;
  }
  if (code !== undefined && !String(code).trim()) return "code cannot be blank";
  if (name !== undefined && (!name || !String(name).trim())) return "name cannot be blank";
  if (type !== undefined && !ACCOUNT_TYPES.includes(type)) return `type must be one of: ${ACCOUNT_TYPES.join(", ")}`;
  return null;
};

const createAccount = async (req, res) => {
  try {
    const error = validateAccountBody(req.body);
    if (error) return res.status(400).json({ success: false, message: error });
    const { code, name, type } = req.body;
    const doc = await Account.create({
      schoolId: req.tenantId,
      code: String(code).trim().toUpperCase(),
      name: String(name).trim(),
      type,
      isSystem: false,
      active: true,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: `Account code ${req.body.code} already exists` });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateAccount = async (req, res) => {
  try {
    const error = validateAccountBody(req.body, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });
    const account = await Account.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!account) return res.status(404).json({ success: false, message: "Account not found" });
    if (account.isSystem) {
      return res.status(400).json({ success: false, message: "System accounts cannot be modified" });
    }
    if (req.body.code !== undefined) account.code = String(req.body.code).trim().toUpperCase();
    if (req.body.name !== undefined) account.name = String(req.body.name).trim();
    if (req.body.type !== undefined) account.type = req.body.type;
    if (req.body.active !== undefined) account.active = Boolean(req.body.active);
    await account.save();
    res.json({ success: true, data: account });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: `Account code ${req.body.code} already exists` });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!account) return res.status(404).json({ success: false, message: "Account not found" });
    if (account.isSystem) {
      return res.status(400).json({ success: false, message: "System accounts cannot be deleted" });
    }
    const inUse = await JournalEntry.exists({
      schoolId: req.tenantId,
      "lines.accountCode": account.code,
    });
    if (inUse) {
      return res.status(409).json({ success: false, message: "Account has journal entries and cannot be deleted" });
    }
    await account.deleteOne();
    res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAccounts, createAccount, updateAccount, deleteAccount };
