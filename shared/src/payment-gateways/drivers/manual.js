// Manual / display-only drivers. upi / qr / bank / manual modes have no online
// order creation: the payer is shown static instructions and payment is
// confirmed later by school staff (verification queue, P3).
const { notImplemented } = require("./base");

const MODE = "manual";
const DISPLAY_MODES = ["upi", "qr", "bank", "manual"];

const getCheckoutConfig = (config) => {
  const mode = config?.mode || MODE;
  const display = config?.display || {};
  return {
    mode,
    provider: mode,
    supportsOnline: false,
    display: {
      upiId: display.upiId || null,
      qrCodeUrl: display.qrCodeUrl || null,
      qrCodeData: display.qrCodeData || null,
      bankName: display.bankName || null,
      accountHolder: display.accountHolder || null,
      accountNumber: display.accountNumber || null,
      ifsc: display.ifsc || null,
      accountType: display.accountType || null,
      instructions: display.instructions || null,
    },
  };
};

// Manual modes just need their display payload to be present.
const test = async (config) => {
  const display = config?.display || {};
  const missing = [];
  if (config?.mode === "upi" && !display.upiId) missing.push("UPI ID");
  if (config?.mode === "qr" && !display.qrCodeData && !display.qrCodeUrl) missing.push("QR code");
  if (config?.mode === "bank" && (!display.bankName || !display.accountNumber)) {
    missing.push("bank name / account number");
  }
  if (missing.length) {
    return { ok: false, message: `Required for this mode: ${missing.join(", ")}.` };
  }
  return { ok: true, message: "Display instructions are ready. Receipts are confirmed by school staff." };
};

module.exports = {
  mode: MODE,
  displayModes: DISPLAY_MODES,
  supportsOnline: false,
  getCheckoutConfig,
  test,
  createOrder: notImplemented(MODE, "order creation"),
  verifyPaymentSignature: async () => false,
  verifyWebhook: async () => ({ verified: false, captured: false }),
};