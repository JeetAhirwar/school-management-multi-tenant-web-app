const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { getPermissionsFor } = require("@school-erp/shared/src/utils/permissions");
const { getJwtSecret } = require("@school-erp/shared/src/utils/jwtSecret");
const { scopeClassTeacher } = require("@school-erp/shared/src/middleware/teacherScopeAuth");
const { resolveTenant } = require("@school-erp/shared/src/middleware/tenant");
const { requireSchoolActive } = require("@school-erp/shared/src/middleware/requireSchoolActive");
const { requireSubscriptionActive } = require("@school-erp/shared/src/middleware/requireSubscriptionActive");
const JWT_SECRET = getJwtSecret();

// Decodes the JWT and attaches the tenant + role payload to req.user.
// Validates account activity when the User model is registered (auth-service).
const verifyToken = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }
  try {
    const decoded = jwt.verify(header.split(" ")[1], JWT_SECRET);

    // Reject refresh tokens used as access tokens (typ claim).
    if (decoded.typ !== "access") {
      return res.status(401).json({ success: false, message: "Invalid token type" });
    }

    const UserModel = mongoose.models.User;
    const tokenValidationOff = process.env.TOKEN_VALIDATION === "off" && process.env.NODE_ENV !== "production";
    if (!tokenValidationOff && UserModel) {
      const user = await UserModel.findById(decoded.id)
        .select("isActive schoolId")
        .lean();
      if (!user || !user.isActive) {
        return res.status(401).json({ success: false, message: "Account is inactive" });
      }
      if (user.schoolId && String(user.schoolId) !== String(decoded.schoolId || "")) {
        return res.status(401).json({ success: false, message: "Token tenant mismatch" });
      }
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

// Guards that a school-scoped resource actually has a tenant AND the school
// is active (not suspended). Super_admin without X-School-Id cannot hit
// school-scoped domain routes.
const requireTenant = async (req, res, next) => {
  if (!req.tenantId) {
    return res.status(400).json({ success: false, message: "No school context for this request" });
  }
  return requireSchoolActive(req, res, (err) => {
    if (err) return next(err);
    return requireSubscriptionActive(req, res, next);
  });
};

// Role-scoped guard. More granular than authorizeRoles.
const requirePermission = (permission) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }
  const perms = getPermissionsFor(req.user);
  if (!perms.includes("*") && !perms.includes(permission)) {
    return res.status(403).json({ success: false, message: "Access denied for this role" });
  }
  next();
};

// Coarse role guard (kept for existing callers).
const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Access denied for this role" });
  }
  next();
};

// Students see only their own data (single student/parent account).
const scopeStudentQuery = (req, res, next) => {
  if (req.user.role === "student") req.query.studentId = req.user.refId;
  next();
};

// Restrict a student to only their own record(s); parents to their linked
// children; staff/teachers allowed.
const restrictToOwnStudent = (getStudentIdFromReq) => (req, res, next) => {
  if (["school_admin", "teacher", "staff"].includes(req.user.role)) return next();
  const targetId = getStudentIdFromReq(req);
  if (req.user.role === "student" && req.user.refId === targetId) return next();
  if (req.user.role === "parent" && (req.user.linkedStudentIds || []).includes(targetId)) return next();
  return res.status(403).json({ success: false, message: "You can only access your own student record" });
};

// Teacher scoping is ASSIGNMENT-driven: the teacher's authority is resolved
// from active TeacherAssignment records (teaching + class_teacher) for the
// current session and attached to req.teacherScope (see
// @school-erp/shared/src/middleware/teacherScopeAuth).

module.exports = { verifyToken, resolveTenant, requireTenant, requirePermission, authorizeRoles, scopeStudentQuery, restrictToOwnStudent, scopeClassTeacher };