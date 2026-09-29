const Notification = require("../models/Notification");
const { getUserModel } = require("../models/userLite");
const { getStudentModel } = require("../db/studentDb");
const { publish } = require("../realtime/hub");

// Audience -> concrete User roles for fan-out. "class_teacher" entries here map
// to "teacher" (Class Teacher is now a TeacherAssignment responsibility loaded
// on a teacher account) and only exist to resolve documents published before
// the role collapse; new documents use the "teacher" audience.
const AUDIENCE_ROLES = {
  school_admin: ["school_admin"],
  class_teacher: ["teacher"],
  teacher: ["teacher"],
  staff: ["staff"],
  student: ["student"],
  parent: ["parent"],
  all: ["school_admin", "teacher", "staff", "student", "parent"],
};

// "5-A" -> { class: "5", section: "A" }; bare "5" -> { class: "5" } (all
// sections). Splits on the LAST dash so class names containing dashes still
// resolve.
const parseClassTag = (tag) => {
  const t = String(tag).trim();
  const i = t.lastIndexOf("-");
  if (i <= 0) return { class: t };
  return { class: t.slice(0, i), section: t.slice(i + 1) };
};

const classTagFilters = (classTags) =>
  classTags
    .map((tag) => {
      const parsed = parseClassTag(tag);
      if (!parsed.class) return null;
      const f = { class: parsed.class };
      if (parsed.section) f.section = parsed.section;
      return f;
    })
    .filter(Boolean);

// AdmissionNos of every ACTIVE student in the tagged classes. Returns null when
// the student DB cannot be reached so callers can FAIL CLOSED (skip the
// class-scoped recipients) instead of falling back to a school-wide blast.
const rosterAdmissionNos = async (schoolId, classTags) => {
  try {
    const filters = classTagFilters(classTags);
    if (filters.length === 0) return [];
    const Student = await getStudentModel();
    const roster = await Student.find({ schoolId, status: "Active", $or: filters })
      .select("admissionNo")
      .lean();
    return [...new Set(roster.map((s) => String(s.admissionNo || "").trim()).filter(Boolean))];
  } catch (err) {
    console.error("[class-tag roster skipped]", err.message);
    return null;
  }
};

// Resolve concrete auth user ids for an audience (role tags and/or classTags).
// classTags narrows the student/parent recipients to those enrolled in the
// tagged classes; role-only audiences are never class-scoped. Fails CLOSED for
// scoped student/parent recipients when the student DB is unreachable.
const resolveAudienceUserIds = async ({ schoolId, audience = [], classTags = [] }) => {
  const roles = [...new Set(audience.flatMap((a) => AUDIENCE_ROLES[a] || []))];
  if (roles.length === 0) return [];
  const User = getUserModel();
  const userIds = new Set();
  const addUsers = async (query) => {
    const users = await User.find(query, { _id: 1 }).lean();
    users.forEach((u) => userIds.add(String(u._id)));
  };

  const rolePass = roles.filter((r) => r !== "student" && r !== "parent");
  if (rolePass.length > 0) {
    await addUsers({ schoolId, isActive: true, role: { $in: rolePass } });
  }

  const wantStudents = roles.includes("student");
  const wantParents = roles.includes("parent");
  if (wantStudents || wantParents) {
    const scoped = classTags.map((t) => String(t).trim()).filter(Boolean);
    if (scoped.length === 0) {
      if (wantStudents) await addUsers({ schoolId, isActive: true, role: "student" });
      if (wantParents) await addUsers({ schoolId, isActive: true, role: "parent" });
    } else {
      const admissionNos = await rosterAdmissionNos(schoolId, scoped);
      if (admissionNos !== null && admissionNos.length > 0) {
        if (wantStudents) {
          await addUsers({ schoolId, isActive: true, role: "student", refId: { $in: admissionNos } });
        }
        if (wantParents) {
          await addUsers({ schoolId, isActive: true, role: "parent", linkedStudentIds: { $in: admissionNos } });
        }
      }
    }
  }
  return [...userIds];
};

// Insert inbox notifications for the resolved users and push them over the
// realtime hub. Returns the number inserted.
const insertFanout = async (schoolId, userIds, { title, message = null, kind = "system", link = null }) => {
  if (userIds.length === 0) return 0;
  const inserted = await Notification.insertMany(
    userIds.map((userId) => ({
      schoolId,
      userId,
      title: String(title).slice(0, 200),
      message: message ? String(message).slice(0, 500) : null,
      kind,
      link,
    }))
  );
  inserted.forEach((n) => publish(schoolId, n.userId, n));
  return inserted.length;
};

// Class-section tags the CALLER is entitled to see class-tagged content for.
// Returns null = unscoped (staff/teacher/admin roles see everything), or a Set
// of tags (possibly empty, fail-closed when enrollment cannot be resolved).
// Students resolve their own class via refId (admissionNo); parents resolve
// their children's classes via linkedStudentIds.
const visibleClassTagsFor = async ({ tenantId, user }) => {
  try {
    if (user.role === "student") {
      const Student = await getStudentModel();
      const doc = await Student.findOne({
        schoolId: tenantId,
        admissionNo: String(user.refId || ""),
      })
        .select("class section")
        .lean();
      if (!doc || !doc.class) return new Set();
      return new Set([doc.section ? `${doc.class}-${doc.section}` : String(doc.class)]);
    }
    if (user.role === "parent") {
      const User = getUserModel();
      const me = await User.findById(user.id).select("linkedStudentIds").lean();
      const ids = [...new Set((me?.linkedStudentIds || []).map(String).filter(Boolean))];
      if (ids.length === 0) return new Set();
      const Student = await getStudentModel();
      const kids = await Student.find({ schoolId: tenantId, admissionNo: { $in: ids } })
        .select("class section")
        .lean();
      return new Set(
        kids.map((k) => (k.class ? (k.section ? `${k.class}-${k.section}` : String(k.class)) : null)).filter(Boolean)
      );
    }
  } catch (err) {
    console.error("[class scope skipped]", err.message);
    return new Set();
  }
  return null;
};

module.exports = {
  AUDIENCE_ROLES,
  parseClassTag,
  classTagFilters,
  rosterAdmissionNos,
  resolveAudienceUserIds,
  insertFanout,
  visibleClassTagsFor,
};
