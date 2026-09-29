// Payment gateway factory. Consumes a school PaymentGateway config (secrets
// already decrypted by the caller) and returns the matching driver.
//
// Online modes (platform / razorpay / stripe / phonepe) create orders and are
// confirmed via signed webhooks. Display modes (upi / qr / bank / manual) have
// no online checkout and are confirmed by school staff.

const platform = require("./drivers/platform");
const razorpay = require("./drivers/razorpay");
const stripe = require("./drivers/stripe");
const phonepe = require("./drivers/phonepe");
const manual = require("./drivers/manual");

const ONLINE = { platform, razorpay, stripe, phonepe };
const MODES = ["platform", "razorpay", "stripe", "phonepe", "upi", "qr", "bank", "manual"];

const driverFor = (config) => {
  const mode = config?.mode || "platform";
  if (!MODES.includes(mode)) {
    throw new Error(`Unknown gateway mode: ${mode}`);
  }
  const driver = ONLINE[mode] || manual;
  return { mode, driver, supportsOnline: driver.supportsOnline };
};

module.exports = {
  MODES,
  ONLINE,
  driverFor,
  isDisplayMode: (mode) => manual.displayModes.includes(mode),
  // Re-exported for reuse by services that need the same guarantees.
  mask: require("./drivers/base").mask,
};