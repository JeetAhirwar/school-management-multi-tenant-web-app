const express = require("express");
const crypto = require("node:crypto");
const router = express.Router();
const ctrl = require("../controllers/notificationController");

// [INTERNAL] Service-to-service inbound. Not intended for browser clients.
// Guarded by a shared secret (INTERNAL_NOTIFY_KEY) rather than a user JWT, and
// additionally firewalled out of the public gateway (api-gateway blocks
// /api/notifications/internal/*). The key is compared with a constant-time
// hex comparison, and the whole channel fails closed if the key is unset or
// weaker than 32 characters.
const internalKey = process.env.INTERNAL_NOTIFY_KEY;
const keyUsable = Boolean(internalKey) && internalKey.length >= 32;

router.post("/push-by-refs", (req, res, next) => {
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
}, ctrl.pushByRefIds);

router.post("/push-by-roles", (req, res, next) => {
  if (!keyUsable) {
    return res.status(503).json({ success: false, message: "Internal notification channel is not configured" });
  }
  const presented = req.headers["x-internal-key"];
  if (!presented) {
    return res.status(401).json({ success: false, message: "Invalid internal key" });
  }
  const expectedHex = Buffer.from(String(internalKey), "utf8").toString("hex");
  const presentedHex = Buffer.from(String(presented), "utf8").toString("hex");
  const valid = expectedHex.length === presentedHex.length && crypto.timingSafeEqual(Buffer.from(expectedHex), Buffer.from(presentedHex));
  if (!valid) {
    return res.status(401).json({ success: false, message: "Invalid internal key" });
  }
  next();
}, ctrl.pushByRoles);

module.exports = router;