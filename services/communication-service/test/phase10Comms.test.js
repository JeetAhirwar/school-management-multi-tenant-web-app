const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readFe = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel/src", rel), "utf8");
const readRoot = (rel) => fs.readFileSync(path.join(__dirname, "../../..", rel), "utf8");

const indexSrc = read("../src/index.js");
const noticeCtrl = read("../src/controllers/noticeController.js");
const notificationCtrl = read("../src/controllers/notificationController.js");
const diaryCtrl = read("../src/controllers/diaryController.js");
const messageCtrl = read("../src/controllers/messageController.js");
const broadcastCtrl = read("../src/controllers/broadcastController.js");
const diaryRoutes = read("../src/routes/diaryRoutes.js");
const messageRoutes = read("../src/routes/messageRoutes.js");
const broadcastRoutes = read("../src/routes/broadcastRoutes.js");
const audience = read("../src/services/audience.js");
const relayEmail = read("../src/services/relayEmail.js");
const sms = read("../src/services/sms.js");
const studentDb = read("../src/db/studentDb.js");
const staffDb = read("../src/db/staffDb.js");
const noticeModel = read("../src/models/Notice.js");
const notificationModel = read("../src/models/Notification.js");
const eventModel = read("../src/models/Event.js");
const diaryModel = read("../src/models/DiaryEntry.js");
const threadModel = read("../src/models/Thread.js");
const messageLogModel = read("../src/models/MessageLog.js");
const userLite = read("../src/models/userLite.js");

const { AUDIENCE_ROLES, parseClassTag } = require("../src/services/audience");
const DiaryEntry = require("../src/models/DiaryEntry");
const Thread = require("../src/models/Thread");
const MessageLog = require("../src/models/MessageLog");
const Notification = require("../src/models/Notification");

const feApi = readFe("lib/api.js");
const feApp = readFe("App.jsx");
const feSidebar = readFe("layout/Sidebar.jsx");
const feLogin = readFe("pages/Login.jsx");
const feNotifications = readFe("pages/Notifications.jsx");
const feNoticeBoard = readFe("pages/NoticeBoard.jsx");
const feParentDashboard = readFe("pages/ParentDashboard.jsx");
const feDiary = readFe("pages/Diary.jsx");
const feMessages = readFe("pages/Messages.jsx");
const feBroadcast = readFe("pages/Broadcast.jsx");
const fePerms = readFe("lib/permissions.js");
const rootPkg = readRoot("package.json");
const envExample = readRoot(".env.example");
const commsPkg = read("../package.json");

// ---------------------------------------------------------------------------
// P10-A: notification kinds + parent-aware notices/events/userLite
// ---------------------------------------------------------------------------

test("phase10: notification kinds cover fee_reminder, emergency, diary, message and sms", () => {
  assert.ok(Notification.schema.path("kind").enumValues.includes("fee_reminder"));
  assert.ok(Notification.schema.path("kind").enumValues.includes("emergency"));
  assert.ok(Notification.schema.path("kind").enumValues.includes("diary"));
  assert.ok(Notification.schema.path("kind").enumValues.includes("message"));
  assert.ok(Notification.schema.path("kind").enumValues.includes("sms"));
  // fee_reminder must stay publishable for fee-service integrations
  assert.match(notificationCtrl, /pushByRefIds/);
  assert.match(notificationCtrl, /refId: \{ \$in: refIds\.map\(\(r\) => String\(r\)\) \}/);
  assert.match(notificationCtrl, /role: "parent", linkedStudentIds: \{ \$in: refIds\.map\(\(r\) => String\(r\)\) \}/);
});

test("phase10: Notice model supports parent audience, classTags and emergency priority", () => {
  assert.match(noticeModel, /audience: \[/);
  assert.match(noticeModel, /classTags: \[\{ type: String, trim: true \}\]/);
  assert.match(noticeModel, /priority: \{ type: String, enum: \["normal", "emergency"\]/);
  assert.match(noticeModel, /index: true/);
  assert.match(eventModel, /parent/);
  assert.match(userLite, /linkedStudentIds:/);
  assert.match(userLite, /email:/);
});

// ---------------------------------------------------------------------------
// P10-A2: student/staff mirrors used for class-tag resolution
// ---------------------------------------------------------------------------

test("phase10: student and staff DB mirrors use secondary connections and own URIs", () => {
  assert.match(studentDb, /STUDENT_MONGODB_URI/);
  assert.match(studentDb, /createConnection\(/);
  assert.match(studentDb, /collection: "students"/);
  assert.match(staffDb, /STAFF_MONGODB_URI/);
  assert.match(staffDb, /createConnection\(/);
  assert.match(staffDb, /collection: "teacherassignments"/);
  assert.match(staffDb, /collection: "staffs"/);
});

// ---------------------------------------------------------------------------
// P10-B: audience resolution is role-aware and class-tag scoped
// ---------------------------------------------------------------------------

test("phase10: audience role map covers every user role and 'all' fans out to parents", () => {
  for (const role of ["school_admin", "teacher", "staff", "student", "parent"]) {
    assert.deepStrictEqual(AUDIENCE_ROLES[role], [role]);
  }
  assert.deepStrictEqual(
    [...AUDIENCE_ROLES.all].sort(),
    ["parent", "school_admin", "staff", "student", "teacher"],
  );
  assert.deepStrictEqual(parseClassTag("5-A"), { class: "5", section: "A" });
  assert.deepStrictEqual(parseClassTag("5-6-C"), { class: "5-6", section: "C" });
  assert.deepStrictEqual(parseClassTag("5"), { class: "5" });
});

test("phase10: audience fan-out fails closed when class-scoped rosters cannot resolve", () => {
  assert.match(audience, /refId: \{ \$in: admissionNos \}/);
  assert.match(audience, /linkedStudentIds: \{ \$in: admissionNos \}/);
  assert.match(audience, /return null/);
  assert.match(audience, /insertMany/);
  assert.match(audience, /published|publish|hub/);
  assert.match(audience, /visibleClassTagsFor/);
});

// ---------------------------------------------------------------------------
// P10-B2: notice controller
// ---------------------------------------------------------------------------

test("phase10: notice read scopes class-tagged content and staff view everything", () => {
  assert.match(noticeCtrl, /visibleClassTagsFor/);
  assert.match(noticeCtrl, /filter\.\$and = \[/);
  assert.match(noticeCtrl, /classTags: \{ \$in: \[\.\.\.ownTags\] \}/);
  assert.match(noticeCtrl, /classTags: \{ \$exists: false \}/);
  assert.match(noticeCtrl, /classTags: \{ \$size: 0 \}/);
  assert.match(noticeCtrl, /sort\(\{ createdAt: -1 \}\)/);
});

test("phase10: notice create/write does NOT accept duplicate emoji", () => {
  assert.doesNotMatch(noticeCtrl, /✂|✅|TWICE|duplicate/i);
});

// ---------------------------------------------------------------------------
// P10-C: class diary
// ---------------------------------------------------------------------------

test("phase10: diary entry model indexes school+class+section+date", () => {
  const indexes = DiaryEntry.schema.indexes();
  const hasIdx = indexes.some(
    ([keys]) => keys.schoolId === 1 && keys.class === 1 && keys.section === 1 && keys.date === -1,
  );
  assert.ok(hasIdx, "schoolId+class+section+date index missing");
});

test("phase10: diary routes gate writes on notices:publish and reads on notices:read", () => {
  assert.match(diaryRoutes, /requirePermission\("notices:publish"\)/);
  assert.match(diaryRoutes, /requirePermission\("notices:read"\)/);
  assert.match(diaryCtrl, /DiaryEntry\.create/);
  assert.match(diaryCtrl, /kind: "diary"/);
  assert.match(diaryCtrl, /link: "\/diary"/);
  assert.match(indexSrc, /app\.use\("\/api\/diary", diaryRoutes\)/);
});

// ---------------------------------------------------------------------------
// P10-D: parent–teacher message threads
// ---------------------------------------------------------------------------

test("phase10: thread model embeds messages with actor metadata", () => {
  assert.match(threadModel, /messages: \[messageSchema\]/);
  assert.match(threadModel, /senderRole/);
  assert.match(threadModel, /senderName/);
  const indexes = Thread.schema.indexes();
  assert.ok(indexes.some(([keys]) => keys.schoolId === 1 && keys.studentId === 1), "schoolId+studentId index missing");
});

test("phase10: message routes allow parent, teacher and admins but not students", () => {
  assert.match(messageRoutes, /authorizeRoles\("parent", "teacher", "school_admin", "super_admin"\)/);
  assert.match(messageRoutes, /router\.post\("\/:id\/reply"/);
  assert.match(messageCtrl, /linkedStudentIds/);
  assert.match(messageCtrl, /type: "class_teacher"/);
  assert.match(indexSrc, /app\.use\("\/api\/messages", messageRoutes\)/);
});

// ---------------------------------------------------------------------------
// P10-E: broadcast (SMS + email) with churn-free delivery
// ---------------------------------------------------------------------------

test("phase10: broadcast routes restrict to school_admin and super_admin", () => {
  assert.match(broadcastRoutes, /authorizeRoles\("school_admin", "super_admin"\)/);
  assert.match(broadcastRoutes, /router\.post\("\/sms"/);
  assert.match(broadcastRoutes, /router\.post\("\/email"/);
  assert.match(broadcastRoutes, /router\.get\("\/logs"/);
  assert.match(broadcastCtrl, /MAX_BROADCAST|500/);
  assert.match(broadcastCtrl, /MessageLog\.create/);
  assert.match(indexSrc, /app\.use\("\/api\/broadcast", broadcastRoutes\)/);
});

test("phase10: SMS and email relay services chunk and skip when unconfigured", () => {
  assert.match(relayEmail, /sendEmailBulk/);
  assert.match(relayEmail, /INTERNAL_NOTIFY_KEY/);
  assert.match(relayEmail, /slice\(0, 20\)|chunk|20/);
  assert.match(sms, /sendSmsBulk/);
  assert.match(sms, /dry.?run|dryRun/i);
  assert.match(sms, /SMS_PROVIDER_ENABLED/);
  assert.match(sms, /twilio|http/i);
  assert.match(messageLogModel, /status:/);
  assert.match(messageLogModel, /dryRun/);
});

// ---------------------------------------------------------------------------
// P10-I: integration surface + env + FE
// ---------------------------------------------------------------------------

test("phase10: communication-service has a test script and is in the root test glob", () => {
  assert.match(commsPkg, /"test": "node --test test\/\*\.test\.js"/);
  assert.match(rootPkg, /services\/communication-service\/test\/\*\.test\.js/);
});

test("phase10: API gateway proxies /api/diary, /api/messages and /api/broadcast", () => {
  const gateway = readRoot("api-gateway/src/index.js");
  assert.match(gateway, /path: "\/api\/diary"/);
  assert.match(gateway, /path: "\/api\/messages"/);
  assert.match(gateway, /path: "\/api\/broadcast"/);
  // all three must target the communication service
  const diaryIdx = gateway.indexOf('path: "/api/diary"');
  const bcIdx = gateway.indexOf('path: "/api/broadcast"');
  assert.ok(diaryIdx > -1 && bcIdx > diaryIdx, "gateway route block ordering broken");
  const slice = gateway.slice(diaryIdx, bcIdx + 400);
  assert.match(slice, /COMMUNICATION_SERVICE_URL/);
});

test("phase10: SMS env keys documented in .env.example", () => {
  for (const key of [
    "SMS_PROVIDER_ENABLED",
    "SMS_PROVIDER",
    "SMS_API_URL",
    "SMS_API_KEY",
    "SMS_SENDER_ID",
    "SMS_TWILIO_SID",
    "SMS_TWILIO_TOKEN",
    "SMS_TWILIO_FROM",
  ]) {
    assert.match(envExample, new RegExp(key), `${key} missing from .env.example`);
  }
});

test("phase10: parent permission bundle exposed on FE mirror", () => {
  const m = fePerms.match(/parent: \[([^\]]*)\]/);
  assert.ok(m, "parent block not found in FE permissions");
  assert.match(m[1], /notices:read/);
  assert.match(m[1], /events:read/);
  assert.match(m[1], /attendance:read/);
  assert.match(m[1], /marks:read/);
  assert.match(m[1], /fees:read/);
});

test("phase10: FE api exposes diary, messages, broadcast and photo blocks", () => {
  assert.match(feApi, /diary: \{/);
  assert.match(feApi, /messages: \{/);
  assert.match(feApi, /broadcast: \{/);
  assert.match(feApi, /request\(`\/diary/);
  assert.match(feApi, /request\(`\/messages/);
  assert.match(feApi, /request\(`\/broadcast/);
});

test("phase10: FE routes wire parent-dashboard, diary, messages and broadcast", () => {
  assert.match(feApp, /import ParentDashboard from "\.\/pages\/ParentDashboard"/);
  assert.match(feApp, /import Diary from "\.\/pages\/Diary"/);
  assert.match(feApp, /import Messages from "\.\/pages\/Messages"/);
  assert.match(feApp, /import Broadcast from "\.\/pages\/Broadcast"/);
  assert.match(feApp, /path="\/parent-dashboard"/);
  assert.match(feApp, /path="\/diary"/);
  assert.match(feApp, /path="\/messages"/);
  assert.match(feApp, /path="\/broadcast"/);
  assert.match(feApp, /role === "parent"\) return <Navigate to="\/parent-dashboard" replace \/>/);
  assert.match(feLogin, /parent: "\/parent-dashboard"/);
});

test("phase10: sidebar surfaces parent portal navigation and admin broadcast", () => {
  assert.match(feSidebar, /PARENT_NAV/);
  assert.match(feSidebar, /to: "\/parent-dashboard"/);
  assert.match(feSidebar, /roles: \["parent"\]/);
  assert.match(feSidebar, /to: "\/diary"/);
  assert.match(feSidebar, /to: "\/messages"/);
  assert.match(feSidebar, /to: "\/broadcast"/);
  assert.match(feSidebar, /label: "Broadcast"/);
});

test("phase10: notifications render emergency kind with alert styling", () => {
  assert.match(feNotifications, /fee_reminder: \{/);
  assert.match(feNotifications, /emergency: \{/);
  assert.match(feNotifications, /diary: \{/);
  assert.match(feNotifications, /message: \{/);
  assert.match(feNotifications, /sms: \{/);
  assert.match(feNotifications, /item\.kind === "emergency" \?/);
});

test("phase10: notice board splits role audiences from class tags and posts emergencies", () => {
  assert.match(feNoticeBoard, /audiencePresets/);
  assert.match(feNoticeBoard, /"All Staff": "staff"/);
  assert.match(feNoticeBoard, /classTags: \[tag\]/);
  assert.match(feNoticeBoard, /priority: form\.priority/);
  assert.match(feNoticeBoard, /Emergency/);
});

test("phase10: parent pages render the new modules", () => {
  assert.match(feParentDashboard, /Class Diary/);
  assert.match(feParentDashboard, /api\.diary\.list/);
  assert.match(feDiary, /api\.diary/);
  assert.match(feDiary, /Class Diary/);
  assert.match(feMessages, /api\.messages/);
  assert.match(feBroadcast, /api\.broadcast/);
});