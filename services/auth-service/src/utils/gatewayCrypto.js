const crypto = require("node:crypto");

const ALGO = "aes-256-gcm";

// Derive a stable 32-byte AES key from GATEWAY_KEYS_ENC_KEY (SHA-256), so any
// reasonably long secret works without padding/truncation footguns.
const secretBytes = () => {
  const value = process.env.GATEWAY_KEYS_ENC_KEY;
  if (!value || String(value).length < 16) return null;
  return crypto.createHash("sha256").update(String(value)).digest();
};

const encryptionReady = () => Boolean(secretBytes());

// Encrypt a per-school provider secret at rest. Empty/undefined inputs are
// stored as "" (not encrypted) so partial updates can keep placeholder values.
const encryptSecret = (plain) => {
  if (plain === undefined || plain === null || plain === "") return "";
  const key = secretBytes();
  if (!key) {
    throw new Error("GATEWAY_KEYS_ENC_KEY must be set (>=16 chars) to store gateway secrets");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${data.toString("hex")}`;
};

const decryptSecret = (cipher) => {
  if (!cipher) return "";
  const key = secretBytes();
  if (!key) throw new Error("GATEWAY_KEYS_ENC_KEY is not configured");
  const [ivHex, tagHex, dataHex] = String(cipher).split(":");
  if (!ivHex || !tagHex || !dataHex) return "";
  const decipher = crypto.createDecipheriv(ALGO, Buffer.from(key), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
};

module.exports = { encryptionReady, encryptSecret, decryptSecret };