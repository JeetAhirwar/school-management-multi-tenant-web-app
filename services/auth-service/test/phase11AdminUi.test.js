const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readPanel = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel", rel), "utf8");
const panelExists = (rel) =>
  fs.existsSync(path.join(__dirname, "../../../../Admin-panel", rel));

test("change-password UI is wired to the real backend endpoint", () => {
  const api = readPanel("src/lib/api.js");
  assert.match(api, /changePassword:\s*\(payload\)\s*=>\s*\n?\s*request\("\/auth\/change-password", json\("POST", payload\)\)/);

  const account = readPanel("src/pages/Account.jsx");
  assert.match(account, /\{ id: "security", label: "Security"/);
  assert.match(account, /function SecurityTab\(\)/);
  assert.match(account, /activeTab === "security" && <SecurityTab \/>/);
  assert.match(account, /api\.changePassword\(\{/);
  assert.match(account, /oldPassword: form\.oldPassword/);
  assert.match(account, /newPassword: form\.newPassword/);

  const routes = read("../src/routes/authRoutes.js");
  assert.match(routes, /router\.post\("\/change-password", verifyToken, ctrl\.changePassword\)/);
  const ctrl = read("../src/controllers/authController.js");
  const changePassword = ctrl.match(/const changePassword = async[\s\S]*?\n\};/);
  assert.ok(changePassword, "changePassword controller exists");
  assert.match(changePassword[0], /validatePassword\(newPassword\)/);
});

test("frontend password checks mirror the backend policy", () => {
  const policy = read("../src/utils/password.js");
  assert.match(policy, /password\.length < 8/);
  assert.match(policy, /\/\[a-zA-Z\]\/\.test\(password\) \|\| !\/\[0-9\]\/\.test\(password\)/);

  const account = readPanel("src/pages/Account.jsx");
  assert.match(account, /form\.newPassword\.length < 8/);
  assert.match(account, /!\/\[a-zA-Z\]\/\.test\(form\.newPassword\) \|\| !\/\[0-9\]\/\.test\(form\.newPassword\)/);
  assert.match(account, /form\.newPassword === form\.oldPassword/);
});

test("payment gateway settings page is backed by permission-guarded routes", () => {
  const api = readPanel("src/lib/api.js");
  assert.match(api, /paymentGateway:\s*\{/);
  assert.match(api, /get:\s*\(\)\s*=>\s*request\("\/auth\/school\/me\/payment-gateway"\)/);
  assert.match(api, /request\("\/auth\/school\/me\/payment-gateway", json\("PATCH", payload\)\)/);
  assert.match(api, /request\("\/auth\/school\/me\/payment-gateway\/test", json\("POST", payload\)\)/);

  const app = readPanel("src/App.jsx");
  assert.match(app, /path="\/payment-gateway"/);
  assert.match(app, /permission="payments:settings"[\s\S]{0,240}<PaymentGateway \/>/);

  const sidebar = readPanel("src/layout/Sidebar.jsx");
  assert.match(sidebar, /to: "\/payment-gateway"[\s\S]{0,160}perm: "payments:settings"/);

  const page = readPanel("src/pages/PaymentGateway.jsx");
  assert.match(page, /api\.school\.paymentGateway\.get\(/);
  assert.match(page, /api\.school\.paymentGateway\.update\(/);
  assert.match(page, /api\.school\.paymentGateway\.test\(/);

  const routes = read("../src/routes/authRoutes.js");
  const gatewayRoutes = routes
    .split("\n")
    .filter((line) => line.includes('"/school/me/payment-gateway'));
  assert.ok(gatewayRoutes.length >= 3, "gateway list/update/test routes exist");
  gatewayRoutes.forEach((line) => {
    assert.match(
      line,
      /requirePermission\("payments:settings"\)/,
      "gateway route must require payments:settings: " + line.trim(),
    );
  });
});

test("study materials and syllabus admin pages exist and are routed with homework:read", () => {
  assert.ok(panelExists("src/pages/StudyMaterials.jsx"), "StudyMaterials page exists");
  assert.ok(panelExists("src/pages/SyllabusManage.jsx"), "SyllabusManage page exists");

  const materials = readPanel("src/pages/StudyMaterials.jsx");
  assert.match(materials, /export default function StudyMaterials/);
  assert.match(materials, /api\.studyMaterials\.list\(/);
  assert.match(materials, /api\.studyMaterials\.create\(/);
  assert.match(materials, /api\.studyMaterials\.remove\(/);
  assert.match(materials, /usePermission\("homework:write"\)/);
  for (const state of ["LoadingBlock", "EmptyBlock", "ErrorBlock"]) {
    assert.ok(materials.includes(state), "StudyMaterials renders " + state);
  }

  const syllabus = readPanel("src/pages/SyllabusManage.jsx");
  assert.match(syllabus, /export default function SyllabusManage/);
  assert.match(syllabus, /api\.syllabus\.list\(/);
  assert.match(syllabus, /api\.syllabus\.create\(/);
  assert.match(syllabus, /api\.syllabus\.update\(/);
  assert.match(syllabus, /api\.syllabus\.remove\(/);
  assert.match(syllabus, /usePermission\("homework:write"\)/);
  for (const state of ["LoadingBlock", "EmptyBlock", "ErrorBlock"]) {
    assert.ok(syllabus.includes(state), "SyllabusManage renders " + state);
  }

  const app = readPanel("src/App.jsx");
  assert.match(app, /path="\/study-materials"[\s\S]{0,200}permission="homework:read"/);
  assert.match(app, /path="\/syllabus"[\s\S]{0,200}permission="homework:read"/);
  assert.match(app, /import StudyMaterials from "\.\/pages\/StudyMaterials"/);
  assert.match(app, /import SyllabusManage from "\.\/pages\/SyllabusManage"/);

  const sidebar = readPanel("src/layout/Sidebar.jsx");
  assert.match(sidebar, /to: "\/study-materials"[\s\S]{0,160}perm: "homework:read"/);
  assert.match(sidebar, /to: "\/syllabus"[\s\S]{0,160}perm: "homework:read"/);
});

test("frontend and backend agree on the RBAC keys the new pages use", () => {
  const fe = readPanel("src/lib/permissions.js");
  const be = read("../../../shared/src/utils/permissions.js");
  for (const key of ["homework:read", "homework:write", "payments:settings", "transport:read"]) {
    assert.ok(fe.includes(key), "FE permission map has " + key);
    assert.ok(be.includes(key), "BE permission map has " + key);
  }
});

test("bus tracking shows only real transport data", () => {
  const src = readPanel("src/pages/BusTracking.jsx");
  assert.doesNotMatch(src, /Math\.random/, "no fabricated speed/ETA jitter");
  assert.doesNotMatch(src, /useLivePositions/, "no waypoint interpolation simulation");
  assert.doesNotMatch(src, /cctvCount/, "no invented camera count");
  assert.doesNotMatch(src, /LiveFeed/, "no simulated CCTV feed");
  assert.doesNotMatch(src, /GPS refresh 150ms/);
  assert.doesNotMatch(src, /Bhopal/, "no hard-coded city branding");
  assert.doesNotMatch(src, /conductor:\s*"Not assigned"/, "no fabricated crew data");

  assert.match(src, /currentLocation/, "renders the backend-reported GPS fix");
  assert.match(src, /updatedAt/, "shows when the position was last reported");
  assert.match(src, /api\.transport\.list\(\)/);
  assert.match(src, /driverName/);
  for (const state of ["LoadingBlock", "EmptyBlock", "ErrorBlock"]) {
    assert.ok(src.includes(state), "BusTracking renders " + state);
  }
});

test("syllabus update is field-allowlisted (no mass assignment)", () => {
  const ctrl = read(
    "../../academic-service/src/controllers/syllabusController.js",
  );
  assert.match(ctrl, /const SYLLABUS_FIELDS = \["class", "subject", "term", "topics", "totalHours"\]/);
  assert.match(ctrl, /pick\(req\.body, SYLLABUS_FIELDS\)/);
  assert.doesNotMatch(
    ctrl,
    /findOneAndUpdate\(\s*\{ _id: req\.params\.id, schoolId: req\.tenantId \},\s*req\.body/,
    "raw request body must never reach findOneAndUpdate",
  );
  assert.doesNotMatch(ctrl, /schoolId:\s*req\.body/, "tenant cannot be supplied by the client");
});
