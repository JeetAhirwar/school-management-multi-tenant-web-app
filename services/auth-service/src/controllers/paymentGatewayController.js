// School-facing payment gateway configuration. One active gateway config per
// school (mode: platform/razorpay/stripe/phonepe/upi/qr/bank/manual). Secrets
// are encrypted at rest and never returned — the API exposes only masked +
// isConfigured, plus a test endpoint that validates keys without persisting.
const PaymentGateway = require("../models/PaymentGateway");
const { writeAudit } = require("../utils/audit");
const { encryptionReady, encryptSecret } = require("../utils/gatewayCrypto");
const { paymentGateways } = require("@school-erp/shared");

const { MODES, driverFor, mask } = paymentGateways;

const SECRET_FIELDS = {
  razorpay: ["keySecret", "webhookSecret"],
  stripe: ["secretKey", "webhookSecret"],
  phonepe: ["saltKey"],
};

const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

const actorId = (user) =>
  user?.email || user?.name || String(user?.id || user?._id || "");

// Lazily create the default platform-config for a school. Every school always
// has a gateway so nothing in the fleet is ever gateway-less.
const getForSchool = async (schoolId) => {
  let doc = await PaymentGateway.findOne({ schoolId });
  if (!doc) {
    doc = await PaymentGateway.create({ schoolId, mode: "platform", status: "active" });
  }
  return doc;
};

const sanitize = (doc) => {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  const masked = d.maskedKeys || {};
  const providers = d.providers || {};
  return {
    schoolId: d.schoolId,
    mode: d.mode,
    status: d.status,
    statusReason: d.statusReason || null,
    verified: d.verified?.at
      ? { at: d.verified.at, by: d.verified.by || null, note: d.verified.note || null }
      : null,
    testedAt: d.testedAt || null,
    display: d.display || {},
    providers: {
      razorpay: {
        keyId: providers.razorpay?.keyId || null,
        testMode: Boolean(providers.razorpay?.testMode),
        keySecret: masked.razorpay?.keySecret || null,
        webhookSecret: masked.razorpay?.webhookSecret || null,
      },
      stripe: {
        publishableKey: providers.stripe?.publishableKey || null,
        testMode: Boolean(providers.stripe?.testMode),
        secretKey: masked.stripe?.secretKey || null,
        webhookSecret: masked.stripe?.webhookSecret || null,
      },
      phonepe: {
        merchantId: providers.phonepe?.merchantId || null,
        saltIndex: providers.phonepe?.saltIndex || null,
        env: providers.phonepe?.env || "uat",
        saltKey: masked.phonepe?.saltKey || null,
      },
    },
    availableModes: MODES,
    updatedAt: d.updatedAt || null,
  };
};

const validateMode = (mode) => {
  if (!mode) return "mode is required";
  if (!MODES.includes(mode)) return `mode must be one of: ${MODES.join(", ")}`;
  return null;
};

const validateDisplayForMode = (mode, display) => {
  if (mode === "upi" && !display?.upiId) return "UPI ID is required for upi mode";
  if (mode === "qr" && !display?.qrCodeData && !display?.qrCodeUrl) {
    return "QR code data or URL is required for qr mode";
  }
  if (mode === "bank" && (!display?.bankName || !display?.accountNumber)) {
    return "Bank name and account number are required for bank mode";
  }
  return null;
};

const getMyGateway = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(400).json({ success: false, message: "No school attached to this account" });
    }
    const doc = await getForSchool(req.tenantId);
    res.json({ success: true, data: sanitize(doc) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateMyGateway = async (req, res) => {
  try {
    const schoolId = req.tenantId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: "No school attached to this account" });
    }

    const body = req.body || {};
    const modeError = validateMode(body.mode);
    if (modeError) return res.status(400).json({ success: false, message: modeError });
    const mode = body.mode;

    const displayError = validateDisplayForMode(mode, body.display);
    if (displayError) return res.status(400).json({ success: false, message: displayError });

    const doc = await getForSchool(schoolId);
    const wasActive = doc.status === "active";
    let changed = doc.mode !== mode;

    // Online modes need encryption for at-rest secrets.
    const onlineModes = ["razorpay", "stripe", "phonepe"];
    const suppliedSecrets = (provIn) =>
      onlineModes.reduce(
        (acc, m) => acc + SECRET_FIELDS[m].filter((f) => isNonEmpty(provIn?.[m]?.[f])).length,
        0
      );
    if (onlineModes.includes(mode) && suppliedSecrets(body.providers) > 0 && !encryptionReady()) {
      return res.status(503).json({
        success: false,
        message: "GATEWAY_KEYS_ENC_KEY is not configured — set it to store gateway secrets (backend deployment)",
      });
    }

    // ----- Provider fields (only what the caller provides; empty secret = keep) -----
    const prov = doc.providers || {};
    const masked = doc.maskedKeys || {};
    const provIn = body.providers || {};

    if (mode === "razorpay") {
      const p = prov.razorpay || {};
      if (provIn.keyId !== undefined) p.keyId = String(provIn.keyId).trim();
      if (provIn.testMode !== undefined) p.testMode = Boolean(provIn.testMode);
      for (const f of SECRET_FIELDS.razorpay) {
        if (isNonEmpty(provIn[f])) {
          p[f] = encryptSecret(provIn[f]);
          masked.razorpay = masked.razorpay || {};
          masked.razorpay[f] = mask(provIn[f]);
          changed = true;
        }
      }
      prov.razorpay = p;
    }

    if (mode === "stripe") {
      const p = prov.stripe || {};
      if (provIn.publishableKey !== undefined) p.publishableKey = String(provIn.publishableKey).trim();
      if (provIn.testMode !== undefined) p.testMode = Boolean(provIn.testMode);
      for (const f of SECRET_FIELDS.stripe) {
        if (isNonEmpty(provIn[f])) {
          p[f] = encryptSecret(provIn[f]);
          masked.stripe = masked.stripe || {};
          masked.stripe[f] = mask(provIn[f]);
          changed = true;
        }
      }
      prov.stripe = p;
    }

    if (mode === "phonepe") {
      const p = prov.phonepe || {};
      if (provIn.merchantId !== undefined) p.merchantId = String(provIn.merchantId).trim();
      if (provIn.saltIndex !== undefined) p.saltIndex = String(provIn.saltIndex).trim();
      if (provIn.env !== undefined) {
        if (!["prod", "uat"].includes(provIn.env)) {
          return res.status(400).json({ success: false, message: "env must be prod or uat" });
        }
        p.env = provIn.env;
      }
      if (isNonEmpty(provIn.saltKey)) {
        p.saltKey = encryptSecret(provIn.saltKey);
        masked.phonepe = masked.phonepe || {};
        masked.phonepe.saltKey = mask(provIn.saltKey);
        changed = true;
      }
      prov.phonepe = p;
    }

    // ----- Display fields (every supplied key wins; empty clears) -----
    const displayDoc = doc.display || {};
    for (const key of Object.keys(body.display || {})) {
      const v = body.display[key];
      if (v !== undefined) {
        displayDoc[key] = typeof v === "string" ? v.trim() : v;
        changed = true;
      }
    }

    if (changed) {
      doc.mode = mode;
      doc.providers = prov;
      doc.maskedKeys = masked;
      doc.display = displayDoc;
      doc.verified = { at: null, by: undefined, note: "" };

      if (mode === "platform") {
        // The platform gateway is owned/verified by the platform; never flip
        // it to pending. A platform-level disable stays honoured.
        if (doc.status !== "disabled") doc.status = "active";
      } else if (wasActive) {
        doc.status = "pending_verification";
      }

      doc.audit.push({
        action: "config.updated",
        by: actorId(req.user),
        note: `mode -> ${mode}`,
      });
      await doc.save();
      await writeAudit({
        req,
        user: req.user,
        action: "payment_gateway.updated",
        targetType: "school",
        targetId: schoolId,
        message: `Updated payment gateway mode to ${mode}`,
      });
    }

    res.json({ success: true, data: sanitize(doc), changed });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Validate candidate credentials with the provider. Nothing is persisted here —
// a successful test only stamps testedAt for audit visibility.
const testMyGateway = async (req, res) => {
  try {
    const schoolId = req.tenantId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: "No school attached to this account" });
    }

    const body = req.body || {};
    const modeError = validateMode(body.mode);
    if (modeError) return res.status(400).json({ success: false, message: modeError });

    const displayError = validateDisplayForMode(body.mode, body.display);
    if (displayError) return res.status(400).json({ success: false, message: displayError });

    const config = {
      mode: body.mode,
      display: body.display || {},
      ...(body.providers || {}),
    };

    const result = await driverFor(config).driver.test(config);

    if (result.ok) {
      const doc = await getForSchool(schoolId);
      doc.testedAt = new Date();
      doc.audit.push({
        action: "config.tested",
        by: actorId(req.user),
        note: `mode -> ${body.mode}: ${result.message}`,
      });
      await doc.save();
    }

    res.json({ success: true, data: { ok: result.ok, message: result.message } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getMyGateway, updateMyGateway, testMyGateway, sanitize, getForSchool };