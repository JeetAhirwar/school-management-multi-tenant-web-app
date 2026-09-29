const express = require("express");
const router = express.Router();
const { guard, createSubscriptionOrder } = require("../controllers/internalPaymentController");

router.use(guard);
router.post("/orders", createSubscriptionOrder);

module.exports = router;