const express = require("express");
const router = express.Router();
const { handleWebhook } = require("../controllers/paymentWebhookController");

// Raw body is required for signature verification; mounted BEFORE the JSON
// parser in index.js.
router.post("/:provider/:schoolCode?", handleWebhook);
router.all("/", (_req, res) => res.json({ success: true, message: "webhooks" }));

module.exports = router;