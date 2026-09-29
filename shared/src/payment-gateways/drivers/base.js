const { Buffer } = require("node:buffer");
const crypto = require("node:crypto");

// Constant-time compared hex strings (HMAC outputs / signature proofs). Both
// sides are hex-decoded first so length differences and content never leak
// through early-exit string comparison.
const constantTimeEqual = (a, b) => {
  const ab = Buffer.from(String(a || ""), "hex");
  const bb = Buffer.from(String(b || ""), "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

const sha256Hex = (data, secret) =>
  crypto.createHmac("sha256", String(secret || "")).update(String(data)).digest("hex");

// Plain SHA-256 (used by PhonePe checksums, which are not HMACs).
const sha256PlainHex = (data) => crypto.createHash("sha256").update(String(data)).digest("hex");

// Small HTTP helper for the online gateway drivers. Plain fetch keeps the
// shared package dependency-free; every driver request has a 10s ceiling.
const httpJson = async (url, { method = "GET", headers = {}, body } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    return { ok: false, status: 0, json: null, text: null, error: err };
  } finally {
    clearTimeout(timer);
  }
};

const basicAuth = (keyId, keySecret) =>
  `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

// Mask a credential for UI display: first 4 + last 4, middle redacted.
const mask = (value) => {
  if (!value) return "";
  const s = String(value);
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
};

// A credential field that needs to be editable. Never returned with secrets.
const credentialField = (value) => ({
  isConfigured: Boolean(value),
  masked: value ? mask(value) : null,
});

const notImplemented = (mode, op) => () => {
  throw new Error(`${mode} ${op} is not available yet (scheduled for the next payment phase)`);
};

const parseJsonBody = (raw) => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw || null;
};

module.exports = {
  httpJson,
  basicAuth,
  mask,
  credentialField,
  notImplemented,
  constantTimeEqual,
  sha256Hex,
  sha256PlainHex,
  parseJsonBody,
};