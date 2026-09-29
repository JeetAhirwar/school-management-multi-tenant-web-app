const express = require("express");
const crypto = require("node:crypto");
const router = express.Router();
const ctrl = require("../controllers/attendanceStream");

// [INTERNAL] Service-to-service inbound for attendance events. Not intended
// for browser clients. Guarded by a shared secret (INTERNAL_NOTIFY_KEY) and
// firewalled out of the public gateway.
const internalKey = process.env.INTERNAL_NOTIFY_KEY;
const keyUsable = Boolean(internalKey) && internalKey.length >= 32;

const guard = (req, res, next) => {
  if (!keyUsable) {
    return res.status(503).json({
      success: false,
      message: "Internal notification channel is not configured",
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
};

router.post("/push-attendance", guard, ctrl.pushAttendanceEvent);

module.exports = router;
