// Fixed RBAC permission map. Single source of truth in @school-erp/shared
// (previously copied per service; reconciled into this canonical version).
// facility-service historical swap of student transport:read -> hostel:read is
// intentionally resolved to transport:read.
//
// Permission format: "module:action"
// "*" = full access (super_admin / platform owner)

// Teachers share one canonical permission bundle (TEACHING_PERMISSIONS).
// Class Teacher is a *responsibility* layered on a teacher account (homeroom
// ownership via TeacherAssignment-type="class_teacher") — not a distinct
// permission surface and NOT a User role. Assignment data decides WHERE a
// teacher can act; the bundle decides WHAT a teacher can do.
const TEACHING_PERMISSIONS = [
  "dashboard:view", "staff:read", "students:read", "attendance:read",
  "attendance:mark",
  "timetable:read", "timetable:write", "homework:read", "homework:write",
  "exams:read", "marks:read", "notices:read", "notices:publish",
  "leaves:apply", "payroll:view",
  "promotion:read", "transfer:read", "rollover:read",
  "health:read", "health:write", "conduct:read", "conduct:write",
  "achievements:read", "achievements:write",
];

const STAFF_PERMISSIONS = {
  admission_counsellor: [
    "dashboard:view", "staff:read", "students:read", "students:write",
    "admissions:read", "admissions:write", "enquiries:read", "enquiries:write",
    "notices:read", "notices:publish", "attendance:read", "attendance:mark",
    "leaves:apply", "payroll:view",
  ],
  accountant: [
    "dashboard:view", "staff:read", "students:read", "fees:read", "fees:collect",
    "fees:structure", "fees:reports", "reports:view", "attendance:read",
    "accounting:read", "accounting:journal",
    "notices:read", "notices:publish",
    "leaves:apply", "payroll:view",
  ],
  librarian: [
    "dashboard:view", "staff:read", "students:read", "library:read",
    "library:manage", "library:notify",
    "notices:read", "notices:publish",
    "leaves:apply", "payroll:view",
  ],
  receptionist: [
    "dashboard:view", "staff:read", "students:read", "admissions:read",
    "admissions:write", "enquiries:read", "enquiries:write",
    "notices:read", "notices:publish",
    "leaves:apply", "payroll:view",
  ],
  transport: [
    "dashboard:view", "staff:read", "students:read", "transport:read",
    "transport:update",
    "notices:read", "notices:publish",
    "leaves:apply", "payroll:view",
  ],
};

const ROLE_PERMISSIONS = {
  super_admin: ["*"],
  school_admin: [
    "dashboard:view", "students:read", "students:write", "staff:read",
    "staff:write", "admissions:read", "admissions:write", "enquiries:read",
    "enquiries:write", "attendance:read", "attendance:mark", "attendance:export", "timetable:read",
    "timetable:write", "homework:read", "homework:write", "exams:read",
    "exams:write", "marks:read", "marks:write", "fees:read", "fees:collect",
    "fees:structure", "fees:reports", "reports:view", "library:read", "library:manage",
    "accounting:read", "accounting:journal",
    "library:notify", "notices:read", "notices:publish", "events:read", "events:publish",
    "transport:read", "transport:update", "inventory:read", "inventory:write",
    "payroll:view", "payroll:admin", "leaves:apply", "leaves:approve",
    "hostel:read", "hostel:manage", "users:manage", "school:settings",
    "payments:settings", "sessions:read", "sessions:write",
    "promotion:read", "promotion:write", "transfer:read", "transfer:write",
    "rollover:read", "rollover:write",
    "health:read", "health:write", "conduct:read", "conduct:write",
    "achievements:read", "achievements:write",
  ],
  // Legacy "class_teacher" tokens (issued pre-collapse, within their JWT
  // lifetime) intentionally resolve to NO permissions: Class Teacher is not a
  // User role in the final architecture and users must re-login to obtain a
  // teacher token.
  teacher: [...TEACHING_PERMISSIONS],
  staff: [
    "staff:read", "attendance:read", "attendance:mark",
    "notices:read", "notices:publish",
    "leaves:apply", "payroll:view",
  ],
  student: [
    "dashboard:view", "attendance:read", "homework:read", "exams:read",
    "marks:read", "fees:read", "library:read", "notices:read", "events:read",
    "transport:read", "hostel:read", "timetable:read",
    "profile:read", "profile:update",
    // Student-portal read surfaces (own records only — routes scope by
    // refId): hostel room, conduct/behavior history, achievements.
    "conduct:read", "achievements:read",
    "leaves:apply",
  ],
  // Parent portal account: read-only view over the linked children's data.
  // Deliberately NO profile:*, health:* or students:* — parents are scoped to
  // their own linkedStudentIds by getStudents' parent branch.
  parent: [
    "dashboard:view", "attendance:read", "homework:read", "exams:read",
    "marks:read", "fees:read", "library:read", "notices:read", "events:read",
    "transport:read", "timetable:read",
  ],
};

function hasPermission(user, permission) {
  if (!user) return false;
  const perms = getPermissionsFor(user);
  return perms.includes("*") || perms.includes(permission);
}

// Resolve the concrete permission list for a user token payload.
function getPermissionsFor(user) {
  if (!user || !user.role) return [];
  if (user.role === "staff") return STAFF_PERMISSIONS[user.designation] || ROLE_PERMISSIONS["staff"];
  return ROLE_PERMISSIONS[user.role] || [];
}

module.exports = { ROLE_PERMISSIONS, STAFF_PERMISSIONS, getPermissionsFor, hasPermission };