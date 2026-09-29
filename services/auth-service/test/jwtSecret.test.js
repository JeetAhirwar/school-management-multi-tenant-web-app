const { test } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");

// Canonical helper lives in shared (P0-R2); require it by package path so the
// test does not depend on a per-service copy.
const {
  getJwtSecret,
  MIN_JWT_SECRET_LENGTH,
} = require("@school-erp/shared/src/utils/jwtSecret");
const genResolved = require.resolve("../src/utils/generateToken");

const setSecret = (value) => {
  if (value === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = value;
  }
};

test("missing JWT_SECRET -> getJwtSecret throws", () => {
  setSecret(undefined);
  assert.throws(() => getJwtSecret(), /JWT_SECRET must be set/);
});

test("JWT_SECRET shorter than 32 chars -> getJwtSecret throws", () => {
  setSecret("short-secret");
  assert.throws(() => getJwtSecret(), /at least 32 characters/);
});

test("JWT_SECRET of exactly 32 chars -> accepted", () => {
  setSecret("a".repeat(32));
  assert.strictEqual(MIN_JWT_SECRET_LENGTH, 32);
  assert.strictEqual(getJwtSecret(), "a".repeat(32));
});

test("access + refresh signing round-trips with a valid secret", () => {
  setSecret("b".repeat(48));
  const { generateAccessToken, generateRefreshToken } = require(genResolved);
  const user = { _id: "u1", role: "school_admin", schoolId: "s1", refId: null };
  const access = generateAccessToken(user);
  const refresh = generateRefreshToken(user);
  const payload = jwt.verify(access, process.env.JWT_SECRET);
  assert.strictEqual(payload.id, "u1");
  assert.strictEqual(payload.schoolId, "s1");
  const refreshPayload = jwt.verify(refresh, process.env.JWT_SECRET);
  assert.strictEqual(refreshPayload.id, "u1");
});

test("access token carries typ=access; refresh carries typ=refresh", () => {
  setSecret("b".repeat(48));
  const { generateAccessToken, generateRefreshToken } = require(genResolved);
  const user = { _id: "u1", role: "staff", schoolId: "s1" };
  const accessPayload = jwt.verify(generateAccessToken(user), process.env.JWT_SECRET);
  const refreshPayload = jwt.verify(generateRefreshToken(user), process.env.JWT_SECRET);
  assert.strictEqual(accessPayload.typ, "access");
  assert.strictEqual(refreshPayload.typ, "refresh");
});

test("refresh token is rejected by access-token typ check pattern", () => {
  setSecret("b".repeat(48));
  const { generateRefreshToken } = require(genResolved);
  const refreshPayload = jwt.verify(
    generateRefreshToken({ _id: "u1" }),
    process.env.JWT_SECRET,
  );
  // Mirrors every service verifyToken: decoded.typ !== "access" -> reject.
  assert.notStrictEqual(refreshPayload.typ, "access");
});

test("token signed with the old secret CANNOT be verified after rotation", () => {
  setSecret("c".repeat(32));
  const { generateAccessToken } = require(genResolved);
  const token = generateAccessToken({ _id: "u1", role: "staff", schoolId: "s1" });
  setSecret("d".repeat(32)); // simulate rotating the shared secret
  assert.throws(() => jwt.verify(token, process.env.JWT_SECRET), /invalid signature/);
});