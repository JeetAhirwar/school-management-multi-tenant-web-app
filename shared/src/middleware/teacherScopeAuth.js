const { resolveTeacherScope } = require("../utils/teacherScope");

// ---------------------------------------------------------------------------
// Assignment-driven teacher authorization middleware.
//
// scopeClassTeacher resolves the authenticated teacher's active assignments
// (teaching + class_teacher) for the current session and attaches
// req.teacherScope. GET requests are constrained to an explicitly-requested,
// validated scope; when the teacher has exactly one scope it is applied
// implicitly so existing single-class requesters keep working.
//
// guardClassBody validates write bodies (whole body or an array field) against
// req.teacherScope.allScopes.
// ---------------------------------------------------------------------------

const NO_ASSIGNMENT_MESSAGE = "No class assigned to this account. Contact your school admin.";
const NOT_IN_SCOPE_MESSAGE = "You can only access your assigned classes and sections";

const scopeClassTeacher = async (req, res, next) => {
  try {
    // Only teaching logins are assignment-scoped; admins/staff pass through.
    if (req.user && req.user.role !== "teacher") return next();

    const scope = await resolveTeacherScope({ tenantId: req.tenantId, user: req.user });
    if (!scope || scope.allScopes.length === 0) {
      return res.status(403).json({ success: false, message: NO_ASSIGNMENT_MESSAGE });
    }
    req.teacherScope = scope;
    // The addressable single class/section for the request (used by
    // single-class consumers). Defaults to null; GET resolves it below.
    scope.class = null;
    scope.section = null;

    if (req.method === "GET") {
      const rawClass = req.query.class;
      const rawSection = req.query.section;
      const hasClass = rawClass != null && String(rawClass).trim() !== "";
      const hasSection = rawSection != null && String(rawSection).trim() !== "";

      if (hasClass) {
        const cls = String(rawClass).trim();
        const sec = hasSection ? String(rawSection).trim() : null;
        if (!scope.has(cls, sec)) {
          return res.status(403).json({ success: false, message: NOT_IN_SCOPE_MESSAGE });
        }
        scope.class = cls;
        scope.section = sec;
      } else if (scope.allScopes.length === 1) {
        scope.class = scope.allScopes[0].class;
        scope.section = scope.allScopes[0].section;
        req.query.class = scope.class;
        if (scope.section) req.query.section = scope.section;
        else delete req.query.section;
      } else {
        return res.status(400).json({
          success: false,
          message: "You are assigned to multiple classes — specify ?class= and ?section= for this request",
        });
      }
    }
    next();
  } catch (err) {
    console.error("[teacherScope] resolution failed:", err && err.message);
    return res.status(503).json({ success: false, message: "Teacher scope resolution is temporarily unavailable" });
  }
};

// For teacher writes: validates that class/section fields carried in the
// request body match the teacher's assignment union. `arrayField` points to an
// array of records (e.g. attendance records); otherwise the body itself is
// checked against req.teacherScope.allScopes.
const guardClassBody = (arrayField) => (req, res, next) => {
  const scope = req.teacherScope;
  if (!scope) return next();
  const items = arrayField ? req.body[arrayField] : req.body;
  const list = Array.isArray(items) ? items : [items];
  const mismatch = list.some((r) => !r || !scope.has(r.class, r.section));
  if (mismatch) {
    return res.status(403).json({
      success: false,
      message: "Teachers can only manage their assigned classes and sections",
    });
  }
  next();
};

module.exports = { scopeClassTeacher, guardClassBody, NO_ASSIGNMENT_MESSAGE, NOT_IN_SCOPE_MESSAGE };