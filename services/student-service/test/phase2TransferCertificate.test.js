const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

test("TransferCertificate model snapshots student data with per-school unique numbers", () => {
  const src = read("../src/models/TransferCertificate.js");
  assert.match(src, /tcNumber: \{ type: String, required: true/);
  assert.match(src, /studentId: \{ type: String, required: true, index: true \}/);
  assert.match(src, /snapshot: \{/);
  assert.match(src, /name: \{ type: String, default: "" \}/);
  assert.match(src, /admissionNo: \{ type: String, default: "" \}/);
  assert.match(src, /index\(\{ schoolId: 1, tcNumber: 1 \}, \{ unique: true \}\)/);
  assert.match(src, /index\(\{ schoolId: 1, studentId: 1 \}, \{ unique: true \}\)/);
  assert.match(src, /TcCounter/);
  assert.match(src, /index\(\{ schoolId: 1, year: 1 \}, \{ unique: true \}\)/);
  assert.match(src, /seq: \{ type: Number, default: 0 \}/);
});

test("issueTc allocates counters atomically and blocks duplicate certificates", () => {
  const src = read("../src/controllers/tcController.js");
  assert.match(src, /findOneAndUpdate\(\s*\{ schoolId, year \},\s*\{ \$inc: \{ seq: 1 \} \},\s*\{ upsert: true, new: true \}/);
  assert.match(src, /TC-\$\{year\}-/);
  assert.match(src, /err\.code !== 11000/);
  assert.match(src, /\.status\(409\)/);
  assert.match(src, /already issued for this student/);
  assert.match(src, /deletedAt: null/);
  // Phase 2 decision: issuing a TC never flips student status.
  assert.doesNotMatch(src, /status: "Transferred"/);
  assert.doesNotMatch(src, /student\.status =/);
});

test("TC routes are declared before /:id with transfer permissions", () => {
  const src = read("../src/routes/studentRoutes.js");
  const tcFirst = src.indexOf('"/transfer-certificates"');
  const idFirst = src.indexOf('"/:id"');
  assert.ok(tcFirst > -1 && idFirst > -1, "both route groups exist");
  assert.ok(tcFirst < idFirst, "TC routes must precede /:id");
  assert.match(src, /requirePermission\("transfer:write"\)/);
  assert.match(src, /requirePermission\("transfer:read"\)/);
  assert.match(src, /tcCtrl\.issueTc/);
  assert.match(src, /tcCtrl\.downloadTcPdf/);
});

test("tcPdf renders an A4 certificate buffer and header school details", () => {
  const src = read("../src/utils/tcPdf.js");
  assert.match(src, /TRANSFER CERTIFICATE/);
  assert.match(src, /require\("pdfkit"\)/);
  assert.match(src, /resolve\(Buffer\.concat\(chunks\)\)/);
  assert.match(src, /tcNumber/);
  assert.match(src, /Father's Name/);
  assert.match(src, /Reason for leaving/);
  const pkg = JSON.parse(read("../package.json"));
  assert.strictEqual(pkg.dependencies.pdfkit, "^0.20.2");
});

test("downloadTcPdf serves a filename-coded attachment with a school fallback", () => {
  const src = read("../src/controllers/tcController.js");
  assert.match(src, /Content-Disposition.*transfer-certificate-\$\{tc\.tcNumber\}\.pdf/s);
  assert.match(src, /require\("\.\.\/models\/School"\)/);
  assert.match(src, /never block the download/);
});

test("frontend exposes the TC API and issue/download UI", () => {
  const api = fs.readFileSync(
    path.join(__dirname, "../../../../Admin-panel/src/lib/api.js"),
    "utf8",
  );
  assert.match(api, /transfer-certificates\$\{params/);
  assert.match(api, /transfer-certificates", json\("POST", item\)/);
  assert.match(api, /students\/transfer-certificates\/\$\{id\}\/pdf/);
  const page = fs.readFileSync(
    path.join(__dirname, "../../../../Admin-panel/src/pages/Transfers.jsx"),
    "utf8",
  );
  assert.match(page, /Issue Certificate/);
  assert.match(page, /transfer:write/);
  assert.match(page, /tcs\.downloadPdf\(tc\._id\)/);
  assert.match(page, /already has TC/);
});
