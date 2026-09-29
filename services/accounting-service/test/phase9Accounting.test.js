const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readFe = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel/src", rel), "utf8");
const readRoot = (rel) => fs.readFileSync(path.join(__dirname, "../../..", rel), "utf8");

const indexSrc = read("../src/index.js");
const accountRoutes = read("../src/routes/accountRoutes.js");
const journalRoutes = read("../src/routes/journalRoutes.js");
const reportRoutes = read("../src/routes/reportRoutes.js");
const accountCtrl = read("../src/controllers/accountController.js");
const journalCtrl = read("../src/controllers/journalController.js");
const reportCtrl = read("../src/controllers/reportController.js");
const sweeper = read("../src/services/ledgerSweeper.js");
const coaSeed = read("../src/services/coaSeed.js");
const ledger = read("../src/utils/ledger.js");
const accountsUtil = read("../src/utils/accounts.js");
const monolith = readRoot("monolith.js");
const devAll = readRoot("scripts/dev-all.js");
const cleanDb = readRoot("scripts/clean-db.js");
const healthCheck = readRoot("scripts/health-check.js");
const rootPkg = readRoot("package.json");
const envExample = readRoot(".env.example");
const compose = readRoot("docker-compose.yml");
const renderYaml = readRoot("render.yaml");
const gateway = readRoot("api-gateway/src/index.js");
const feApi = readFe("lib/api.js");
const fePerms = readFe("lib/permissions.js");
const feSidebar = readFe("layout/Sidebar.jsx");
const feApp = readFe("App.jsx");
const feAccounting = readFe("pages/Accounting.jsx");

const {
  validateEntryLines,
  feeReceiptLines,
  feeReversalLines,
  payrollLines,
  computeTrialBalance,
  computeIncomeExpense,
  computeBalanceSheet,
} = require("../src/utils/ledger");
const { SYSTEM_ACCOUNTS, MODE_ACCOUNT_MAP, feeAccountFor } = require("../src/utils/accounts");
const Account = require("../src/models/Account");
const JournalEntry = require("../src/models/JournalEntry");

// ---------------------------------------------------------------------------
// P9-A: service skeleton + registration (10 files)
// ---------------------------------------------------------------------------

test("phase9: accounting-service wires port 5009, DB fallback and route mounts", () => {
  assert.match(indexSrc, /ACCOUNTING_SERVICE_PORT \|\| process\.env\.PORT \|\| 5009/);
  assert.match(indexSrc, /ACCOUNTING_MONGODB_URI \|\| process\.env\.FEE_MONGODB_URI/);
  assert.match(indexSrc, /dbName: "erp_accounting"/);
  assert.match(indexSrc, /app\.use\("\/api\/accounting\/accounts", accountRoutes\)/);
  assert.match(indexSrc, /app\.use\("\/api\/accounting\/journal", journalRoutes\)/);
  assert.match(indexSrc, /app\.use\("\/api\/accounting\/reports", reportRoutes\)/);
  assert.match(indexSrc, /startLedgerSweeper\(\)/);
  assert.match(indexSrc, /liveness\("accounting-service"\)/);
  assert.match(indexSrc, /readiness\("accounting-service",\s*mongoose\)/);
});

test("phase9: accounting service is registered across every launcher/config surface", () => {
  // monolith.js
  assert.match(monolith, /\["accounting",\s*"services\/accounting-service",\s*5009/);
  // dev-all.js
  assert.match(devAll, /\["accounting", "services\/accounting-service", 5009\]/);
  // gateway route map
  assert.match(gateway, /path: "\/api\/accounting"/);
  assert.match(gateway, /ACCOUNTING_SERVICE_URL \|\| "http:\/\/localhost:5009"/);
  // docker-compose: gateway link, depends_on, service block, own DB
  assert.match(compose, /ACCOUNTING_SERVICE_URL=http:\/\/accounting-service:5009/);
  assert.match(compose, /- accounting-service/);
  assert.match(compose, /dockerfile: services\/accounting-service\/Dockerfile/);
  assert.match(compose, /ACCOUNTING_MONGODB_URI=mongodb:\/\/mongo:27017\/erp_accounting/);
  // render.yaml: runs in the monolith + env key declared
  assert.match(renderYaml, /MONOLITH_SERVICES\s*\n\s*value: auth,student,staff,academic,fee,accounting,gateway/);
  assert.match(renderYaml, /- key: ACCOUNTING_MONGODB_URI/);
  // .env.example (port, URL, DB)
  assert.match(envExample, /ACCOUNTING_SERVICE_PORT=5009/);
  assert.match(envExample, /ACCOUNTING_SERVICE_URL=http:\/\/localhost:5009/);
  assert.match(envExample, /ACCOUNTING_MONGODB_URI=/);
  // root package.json: install:all + test glob
  assert.match(rootPkg, /install --prefix services\/accounting-service/);
  assert.match(rootPkg, /services\/accounting-service\/test\/\*\.test\.js/);
  // health-check + clean-db
  assert.match(healthCheck, /\{ name: "accounting-service", url: "\/api\/accounting\/accounts" \}/);
  assert.match(cleanDb, /\["ACCOUNTING_MONGODB_URI", "erp_accounting", "FEE_MONGODB_URI"\]/);
});

// ---------------------------------------------------------------------------
// P9-B: models + CoA seed + pure utils
// ---------------------------------------------------------------------------

test("phase9: Account model is tenant-unique on code and carries system/active flags", () => {
  const indexes = Account.schema.indexes();
  const codeIdx = indexes.find(([keys]) => keys.schoolId === 1 && keys.code === 1);
  assert.ok(codeIdx && codeIdx[1] && codeIdx[1].unique, "unique {schoolId,code} index missing");
  assert.deepEqual(Account.schema.path("type").enumValues, ["Asset", "Liability", "Equity", "Income", "Expense"]);
  assert.strictEqual(Account.schema.path("isSystem").defaultValue, false);
  assert.strictEqual(Account.schema.path("active").defaultValue, true);
});

test("phase9: JournalEntry enforces balanced lines and unique idempotency key per tenant", () => {
  const indexes = JournalEntry.schema.indexes();
  const idemIdx = indexes.find(([keys]) => keys.schoolId === 1 && keys.idemKey === 1);
  assert.ok(idemIdx && idemIdx[1] && idemIdx[1].unique, "unique {schoolId,idemKey} index missing");
  assert.ok(
    idemIdx[1].partialFilterExpression && idemIdx[1].partialFilterExpression.idemKey,
    "idemKey index must stay partial (manual entries have no key)",
  );
  assert.deepEqual(
    JournalEntry.schema.path("source").enumValues,
    ["manual", "fee", "payroll", "system"],
  );
  assert.deepEqual(JournalEntry.schema.path("status").enumValues, ["Posted", "Void"]);
  const lineValidators = JournalEntry.schema.path("lines").validators;
  assert.ok(
    lineValidators.some((v) => typeof v.validator === "function"),
    "schema-level balance validator missing",
  );
});

test("phase9: SYSTEM_ACCOUNTS seeds the 7 system accounts and mode map routes cash vs bank", () => {
  assert.strictEqual(SYSTEM_ACCOUNTS.length, 7);
  const byCode = Object.fromEntries(SYSTEM_ACCOUNTS.map((a) => [a.code, a]));
  assert.deepStrictEqual(
    { code: byCode["1000"].name, type: byCode["1000"].type },
    { code: "Cash in Hand", type: "Asset" },
  );
  assert.strictEqual(byCode["4000"].type, "Income");
  assert.strictEqual(byCode["5000"].type, "Expense");
  assert.strictEqual(MODE_ACCOUNT_MAP.Cash, "1000");
  for (const mode of ["Card", "UPI", "Net Banking", "Bank Transfer", "Cheque", "Online Gateway"]) {
    assert.strictEqual(MODE_ACCOUNT_MAP[mode], "1010", `${mode} must post to the bank account`);
  }
  assert.strictEqual(feeAccountFor("Unknown Mode"), "1010", "unknown modes fall back to bank");
  assert.match(accountsUtil, /isDebitNormal/);
});

test("phase9: CoA seed is idempotent per school via bulkWrite $setOnInsert (duplicate race tolerated)", () => {
  assert.match(coaSeed, /bulkWrite/);
  assert.match(coaSeed, /\$setOnInsert/);
  assert.match(coaSeed, /upsert: true/);
  assert.match(coaSeed, /err\.code !== 11000/);
  assert.match(coaSeed, /isSystem: true/);
});

test("phase9: validateEntryLines rejects malformed entries and accepts balanced ones", () => {
  assert.strictEqual(validateEntryLines([]).ok, false);
  assert.strictEqual(validateEntryLines([{ accountCode: "1000", debit: 10, credit: 0 }]).ok, false);
  assert.strictEqual(
    validateEntryLines([
      { accountCode: "1000", debit: 10, credit: 0 },
      { accountCode: "4000", debit: 5, credit: 0 },
    ]).error,
    "Debits and credits must be equal",
  );
  assert.strictEqual(
    validateEntryLines([
      { accountCode: "1000", debit: 10, credit: 10 },
      { accountCode: "4000", debit: 0, credit: 10 },
    ]).ok,
    false,
    "a line posting both sides must be rejected",
  );
  assert.strictEqual(
    validateEntryLines([
      { accountCode: "1000", debit: -5, credit: 0 },
      { accountCode: "4000", debit: 0, credit: -5 },
    ]).ok,
    false,
    "negative amounts must be rejected",
  );
  assert.strictEqual(
    validateEntryLines(
      [{ accountCode: "9999", debit: 1, credit: 0 }, { accountCode: "4000", debit: 0, credit: 1 }],
      new Set(["1000", "4000"]),
    ).ok,
    false,
    "unknown accounts must be rejected",
  );
  const ok = validateEntryLines(feeReceiptLines("Cash", 10));
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.debitTotal, 10);
  assert.strictEqual(ok.creditTotal, 10);
  const three = validateEntryLines([
    { accountCode: "1000", debit: 7, credit: 0 },
    { accountCode: "1010", debit: 3, credit: 0 },
    { accountCode: "4000", debit: 0, credit: 10 },
  ]);
  assert.strictEqual(three.ok, true, "multi-line balanced entries must pass");
});

test("phase9: entry builders post fee/cash, fee/bank, reversal and payroll correctly", () => {
  assert.deepStrictEqual(feeReceiptLines("Cash", 100), [
    { accountCode: "1000", debit: 100, credit: 0 },
    { accountCode: "4000", debit: 0, credit: 100 },
  ]);
  assert.deepStrictEqual(feeReceiptLines("UPI", 100), [
    { accountCode: "1010", debit: 100, credit: 0 },
    { accountCode: "4000", debit: 0, credit: 100 },
  ]);
  assert.strictEqual(feeReceiptLines("Cash", 0), null, "zero amount must not journal");
  assert.strictEqual(feeReceiptLines("Cash", -5), null, "negative amount must not journal");
  // bounce reversal mirrors the receipt
  assert.deepStrictEqual(feeReversalLines("Cheque", 250), [
    { accountCode: "4000", debit: 250, credit: 0 },
    { accountCode: "1010", debit: 0, credit: 250 },
  ]);
  // payroll: Dr salary expense / Cr bank
  assert.deepStrictEqual(payrollLines(500), [
    { accountCode: "5000", debit: 500, credit: 0 },
    { accountCode: "1010", debit: 0, credit: 500 },
  ]);
  assert.strictEqual(payrollLines(0), null);
  for (const lines of [feeReceiptLines("Cash", 10), feeReversalLines("Cheque", 10), payrollLines(10)]) {
    assert.strictEqual(validateEntryLines(lines).ok, true, "every builder output must balance");
  }
});

// ---------------------------------------------------------------------------
// P9-D: reports (pure math)
// ---------------------------------------------------------------------------

const accounts = SYSTEM_ACCOUNTS.map((a) => ({ ...a }));
const entries = [
  { date: "2026-04-10T00:00:00Z", lines: feeReceiptLines("Cash", 100) },
  { date: "2026-05-01T00:00:00Z", lines: payrollLines(60) },
  { date: "2026-05-05T00:00:00Z", lines: feeReceiptLines("UPI", 40) },
  { date: "2026-05-12T00:00:00Z", lines: feeReversalLines("Cheque", 10) },
];

test("phase9: trial balance balances, filters by period and flips abnormal balances", () => {
  const tb = computeTrialBalance({ entries, accounts });
  assert.strictEqual(tb.balanced, true);
  assert.strictEqual(tb.totalDebit, tb.totalCredit);

  const may = computeTrialBalance({ entries, accounts, from: "2026-05-01", to: "2026-05-31" });
  assert.strictEqual(may.balanced, true);
  assert.strictEqual(may.totalDebit, 60, "April cash receipt must fall outside the May window");
  const aprilOnly = computeTrialBalance({ entries, accounts, from: "2026-04-01", to: "2026-04-30" });
  assert.strictEqual(aprilOnly.totalDebit, 100, "April holds only the cash receipt");

  // Bank overdraft (credit-normal on an asset) must land in the credit column.
  const overdraft = computeTrialBalance({
    entries: [{ date: "2026-06-01T00:00:00Z", lines: payrollLines(500) }],
    accounts,
  });
  const bank = overdraft.rows.find((r) => r.code === "1010");
  assert.strictEqual(bank.credit, 500, "overdrawn bank must show as a credit balance");
  assert.strictEqual(overdraft.balanced, true);
});

test("phase9: income & expense reports period totals (CLIENT-REQ-049/050)", () => {
  const ie = computeIncomeExpense({ entries, accounts, from: "2026-05-01", to: "2026-05-31" });
  assert.strictEqual(ie.totalIncome, 30); // 40 UPI receipt − 10 bounced cheque
  assert.strictEqual(ie.totalExpense, 60);
  assert.strictEqual(ie.net, -30);
  const life = computeIncomeExpense({ entries, accounts });
  assert.strictEqual(life.totalIncome, 130);
  assert.strictEqual(life.totalExpense, 60);
  assert.strictEqual(life.net, 70);
});

test("phase9: balance sheet satisfies the accounting equation (CLIENT-REQ-051)", () => {
  const bs = computeBalanceSheet({ entries, accounts, asOf: "2026-12-31" });
  assert.strictEqual(bs.totalAssets, 70); // 100 + 40 − 60 − 10
  assert.strictEqual(bs.retainedEarnings, 70); // 130 income − 60 expense
  assert.strictEqual(bs.balanced, true);
  assert.strictEqual(
    Math.round((bs.totalAssets - bs.totalLiabilitiesEquity) * 100) / 100,
    0,
    "assets must equal liabilities + equity + retained earnings",
  );
  // No activity yet → empty books still balance.
  const empty = computeBalanceSheet({ entries: [], accounts, asOf: "2026-12-31" });
  assert.strictEqual(empty.balanced, true);
  assert.strictEqual(empty.totalAssets, 0);
});

test("phase9: float noise rounds to paisa without breaking the balance", () => {
  const floaty = [
    { date: "2026-05-01T00:00:00Z", lines: feeReceiptLines("Cash", 0.1 + 0.2) },
  ];
  const tb = computeTrialBalance({ entries: floaty, accounts });
  assert.strictEqual(tb.balanced, true);
  const bs = computeBalanceSheet({ entries: floaty, accounts, asOf: "2026-12-31" });
  assert.strictEqual(bs.balanced, true);
  assert.strictEqual(bs.totalAssets, 0.3);
});

// ---------------------------------------------------------------------------
// P9-E: ledger sweeper (idempotency, grace, orphan cleanup)
// ---------------------------------------------------------------------------

test("phase9: sweeper upserts by idempotency key and can never double-post", () => {
  assert.match(sweeper, /updateOne\(/);
  assert.match(sweeper, /\$setOnInsert/);
  assert.match(sweeper, /err\.code === 11000/);
  assert.match(sweeper, /`fee:\$\{payment\._id\}:primary`/);
  assert.match(sweeper, /`fee:\$\{payment\._id\}:reversal`/);
  assert.match(sweeper, /`payroll:\$\{payroll\._id\}:paid`/);
  assert.match(sweeper, /clearanceStatus === "Bounced"/);
  assert.match(sweeper, /status: "Paid"/);
  assert.match(sweeper, /5 \* 60 \* 1000/, "5-minute cadence");
  assert.match(sweeper, /60 \* 1000/, "60s grace before orphan cleanup");
  assert.match(sweeper, /createdBy: "system:sweeper"/);
});

test("phase9: sweeper removes orphans left by voided payments / reverted payroll", () => {
  assert.match(sweeper, /cleanupOrphans/);
  assert.match(sweeper, /source: "fee", createdAt: \{ \$lt: cutoff \}/);
  assert.match(sweeper, /source: "payroll", createdAt: \{ \$lt: cutoff \}/);
  assert.match(sweeper, /deleteMany/);
  assert.match(sweeper, /payrollStatus\.get\(String\(e\.refId\)\) !== "Paid"/);
});

test("phase9: source mirrors are lazy, read-only secondary connections", () => {
  const feeDb = read("../src/db/feeDb.js");
  const staffDb = read("../src/db/staffDb.js");
  for (const [name, src, uri, collection] of [
    ["feeDb", feeDb, "FEE_MONGODB_URI", "payments"],
    ["staffDb", staffDb, "STAFF_MONGODB_URI", "payrolls"],
  ]) {
    assert.match(src, new RegExp(`process\\.env\\.${uri}`), `${name} must read its own URI`);
    assert.match(src, /createConnection\(/, `${name} must use a secondary connection`);
    assert.match(src, new RegExp(`collection: "${collection}"`), `${name} must target the source collection`);
    assert.match(src, /if \(paymentModel\)|if \(payrollModel\)/, `${name} must cache the model`);
  }
});

// ---------------------------------------------------------------------------
// P9-C: controllers + routes (permissions, validation, guards)
// ---------------------------------------------------------------------------

test("phase9: routes gate reads on accounting:read and mutations on accounting:journal", () => {
  assert.match(accountRoutes, /router\.get\("\/", requirePermission\("accounting:read"\)/);
  assert.match(accountRoutes, /router\.post\("\/", requirePermission\("accounting:journal"\)/);
  assert.match(accountRoutes, /router\.patch\("\/:id", requirePermission\("accounting:journal"\)/);
  assert.match(accountRoutes, /router\.delete\("\/:id", requirePermission\("accounting:journal"\)/);
  assert.match(journalRoutes, /router\.get\("\/", requirePermission\("accounting:read"\)/);
  assert.match(journalRoutes, /router\.post\("\/", requirePermission\("accounting:journal"\)/);
  assert.match(journalRoutes, /router\.delete\("\/:id", requirePermission\("accounting:journal"\)/);
  for (const file of [accountRoutes, journalRoutes, reportRoutes]) {
    assert.match(file, /verifyToken, resolveTenant, requireTenant/);
  }
  assert.match(reportRoutes, /trial-balance", requirePermission\("accounting:read"\)/);
  assert.match(reportRoutes, /income-expense", requirePermission\("accounting:read"\)/);
  assert.match(reportRoutes, /balance-sheet", requirePermission\("accounting:read"\)/);
});

test("phase9: accounts controller protects system accounts and referenced accounts", () => {
  assert.match(accountCtrl, /System accounts cannot be modified/);
  assert.match(accountCtrl, /System accounts cannot be deleted/);
  assert.match(accountCtrl, /JournalEntry\.exists\(/);
  assert.match(accountCtrl, /has journal entries and cannot be deleted/);
  assert.match(accountCtrl, /err\.code === 11000/);
  assert.match(accountCtrl, /ensureSystemAccounts\(req\.tenantId\)/);
  assert.match(accountCtrl, /schoolId: req\.tenantId/);
});

test("phase9: journal controller validates against the CoA and only manual entries are deletable", () => {
  assert.match(journalCtrl, /validateEntryLines\(lines, validCodes\)/);
  assert.match(journalCtrl, /new Set\(accounts\.map\(\(a\) => a\.code\)\)/);
  assert.match(journalCtrl, /source: "manual"/);
  assert.match(journalCtrl, /entry\.source !== "manual"/);
  assert.match(journalCtrl, /re-created by the ledger sweeper/);
  assert.match(journalCtrl, /createdBy: req\.user\.email \|\| req\.user\.id/);
});

test("phase9: report controller serves all three statements from one books load", () => {
  assert.match(reportCtrl, /computeTrialBalance/);
  assert.match(reportCtrl, /computeIncomeExpense/);
  assert.match(reportCtrl, /computeBalanceSheet/);
  assert.match(reportCtrl, /ensureSystemAccounts\(schoolId\)/);
  assert.match(reportCtrl, /req\.query\.asOf/);
  assert.match(reportCtrl, /JournalEntry\.find\(\{ schoolId \}\)/);
  assert.match(ledger, /function computeTrialBalance/);
  assert.match(ledger, /function computeIncomeExpense/);
  assert.match(ledger, /function computeBalanceSheet/);
});

// ---------------------------------------------------------------------------
// P9-F: permissions + frontend
// ---------------------------------------------------------------------------

test("phase9: accounting permissions exist for school_admin and accountant only", () => {
  const { getPermissionsFor } = require("../../../shared/src/utils/permissions");
  const admin = getPermissionsFor({ role: "school_admin" });
  assert.ok(admin.includes("accounting:read"));
  assert.ok(admin.includes("accounting:journal"));
  const accountant = getPermissionsFor({ role: "staff", designation: "accountant" });
  assert.ok(accountant.includes("accounting:read"));
  assert.ok(accountant.includes("accounting:journal"));
  for (const user of [{ role: "teacher" }, { role: "student" }, { role: "parent" }]) {
    const perms = getPermissionsFor(user);
    assert.ok(!perms.includes("*") && !perms.includes("accounting:read"), `${user.role} must not see accounting`);
  }
  // FE mirror stays in sync
  assert.match(fePerms, /"accounting:read", "accounting:journal"/);
  const feAccountant = fePerms.slice(fePerms.indexOf("accountant"), fePerms.indexOf("librarian"));
  assert.match(feAccountant, /accounting:read/);
});

test("phase9: FE api block exposes accounts, journal and the three reports", () => {
  assert.match(feApi, /accounting: \{/);
  assert.match(feApi, /list: \(params = ""\) => request\(`\/accounting\/accounts/);
  assert.match(feApi, /request\("\/accounting\/journal"/);
  assert.match(feApi, /request\(`\/accounting\/journal\/\$\{id\}`/);
  assert.match(feApi, /\/accounting\/reports\/trial-balance/);
  assert.match(feApi, /\/accounting\/reports\/income-expense/);
  assert.match(feApi, /\/accounting\/reports\/balance-sheet/);
});

test("phase9: sidebar + router expose the Accounting page behind accounting:read", () => {
  assert.match(feSidebar, /to: "\/accounting"/);
  assert.match(feSidebar, /label: "Accounting"/);
  assert.match(feSidebar, /perm: "accounting:read"/);
  assert.match(feApp, /import Accounting from "\.\/pages\/Accounting"/);
  assert.match(feApp, /path="\/accounting"/);
  assert.match(feApp, /RequirePermission permission="accounting:read"/);
});

test("phase9: Accounting page renders journal, accounts and all three statements", () => {
  assert.match(feAccounting, /Journal/);
  assert.match(feAccounting, /Chart of Accounts/);
  assert.match(feAccounting, /Trial Balance/);
  assert.match(feAccounting, /Income & Expense/);
  assert.match(feAccounting, /Balance Sheet/);
  assert.match(feAccounting, /api\.accounting\.journal\.create/);
  assert.match(feAccounting, /api\.accounting\.accounts\.create/);
  assert.match(feAccounting, /PermissionGate permission="accounting:journal"/);
  assert.match(feAccounting, /totals\.balanced/);
  assert.match(feAccounting, /reports\.trialBalance\.balanced/);
  assert.match(feAccounting, /reports\.balanceSheet\.balanced/);
  assert.match(feAccounting, /Retained Earnings/);
});
