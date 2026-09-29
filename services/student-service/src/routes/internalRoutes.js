// [INTERNAL] Service-to-service recipient-resolution for academic notifications
// (returns admissionNos = the refId that pushByRefIds resolves). Guarded by the
// shared INTERNAL_NOTIFY_KEY exactly like communication-service's internal
// routes, and firewalled out of the public gateway alongside those routes.
const express = require("express");
const crypto = require("node:crypto");
const Student = require("../models/Student");

const router = express.Router();

const internalKey = process.env.INTERNAL_NOTIFY_KEY;
const keyUsable = Boolean(internalKey) && internalKey.length >= 32;

router.get("/by-class", (req, res, next) => {
  if (!keyUsable) {
    return res.status(503).json({
      success: false,
      message: "Internal channel is not configured",
    });
  }
  const presented = req.headers["x-internal-key"];
  if (!presented) {
    return res.status(401).json({ success: false, message: "Invalid internal key" });
  }
  const expectedHex = Buffer.from(String(internalKey), "utf8").toString("hex");
  const presentedHex = Buffer.from(String(presented), "utf8").toString("hex");
  const valid =
    expectedHex.length === presentedHex.length &&
    crypto.timingSafeEqual(Buffer.from(expectedHex), Buffer.from(presentedHex));
  if (!valid) {
    return res.status(401).json({ success: false, message: "Invalid internal key" });
  }
  next();
}, async (req, res) => {
  try {
    const { schoolId, class: cls, section } = req.query;
    if (!schoolId || !cls) {
      return res.status(400).json({ success: false, message: "schoolId and class are required" });
    }
    const filter = { schoolId, class: cls, status: "Active", deletedAt: null };
    if (section) filter.section = section;
    const students = await Student.find(filter).select("admissionNo").lean();
    const refIds = [...new Set(students.map((s) => String(s.admissionNo).trim()).filter(Boolean))];
    res.json({ success: true, count: refIds.length, refIds });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;