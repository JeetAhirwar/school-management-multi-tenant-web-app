const Account = require("../models/Account");
const JournalEntry = require("../models/JournalEntry");
const { ensureSystemAccounts } = require("../services/coaSeed");
const { validateEntryLines } = require("../utils/ledger");

const getJournal = async (req, res) => {
  try {
    const { from, to, source, refId } = req.query;
    const filter = { schoolId: req.tenantId };
    if (source) filter.source = source;
    if (refId) filter.refId = refId;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }
    const data = await JournalEntry.find(filter).sort({ date: -1, _id: -1 }).limit(1000).lean();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createJournal = async (req, res) => {
  try {
    const { date, memo, lines } = req.body || {};
    await ensureSystemAccounts(req.tenantId);
    const accounts = await Account.find({ schoolId: req.tenantId, active: true }).select("code").lean();
    const validCodes = new Set(accounts.map((a) => a.code));
    const check = validateEntryLines(lines, validCodes);
    if (!check.ok) return res.status(400).json({ success: false, message: check.error });

    const doc = await JournalEntry.create({
      schoolId: req.tenantId,
      date: date ? new Date(date) : new Date(),
      memo: memo ? String(memo).trim().slice(0, 500) : undefined,
      source: "manual",
      lines,
      createdBy: req.user.email || req.user.id,
    });
    res.status(201).json({ success: true, data: doc, totals: { debit: check.debitTotal, credit: check.creditTotal } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteJournal = async (req, res) => {
  try {
    const entry = await JournalEntry.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });
    if (entry.source !== "manual") {
      return res.status(400).json({
        success: false,
        message: "Only manual entries can be deleted — system entries are re-created by the ledger sweeper",
      });
    }
    await entry.deleteOne();
    res.json({ success: true, message: "Entry deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getJournal, createJournal, deleteJournal };
