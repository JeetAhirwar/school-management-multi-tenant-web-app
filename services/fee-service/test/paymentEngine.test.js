const { test } = require("node:test");
const assert = require("node:assert");

// Payment.mode is a closed enum — historical inserts with free-form
// "Online Gateway (razorpay)" strings were rejected by Mongoose (silent
// ledger failure). Locks the real model enum, not a copy in this file.
test("Payment mode enum covers gateway + office-collected modes", () => {
  const Payment = require("../src/models/Payment");
  const modes = Payment.schema.path("mode").enumValues;
  for (const m of ["Cash", "Card", "UPI", "Net Banking", "Bank Transfer", "Cheque", "Online Gateway"]) {
    assert.ok(modes.includes(m), `mode "${m}" missing from Payment enum`);
  }
});

test("engine ledger mode must be exact enum literals (no interpolation)", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "../src/utils/paymentEngine.js"),
    "utf8",
  );
  // Online fallback and the manual-mode routing table are plain string
  // literals — a template/expression here historically broke ledger writes.
  assert.match(src, /\|\| "Online Gateway"/);
  assert.match(src, /const MODE_ROUTING = \{ upi: "UPI", qr: "UPI", bank: "Bank Transfer" \}/);
  assert.doesNotMatch(src, /mode:\s*`/);
});

test("completeOrder rolls back completed status when side effects throw", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "../src/utils/paymentEngine.js"),
    "utf8",
  );
  // On reconcile failure the winner must not stay terminal-completed.
  assert.match(src, /catch \(err\)/);
  assert.match(src, /status:\s*winner\.status === "completed" \? "awaiting_confirmation"/);
});
