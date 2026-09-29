const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { getPermissionsFor } = require("@school-erp/shared/src/utils/permissions");
const { getJwtSecret } = require("@school-erp/shared/src/utils/jwtSecret");
const { resolveTenant } = require("@school-erp/shared/src/middleware/tenant");
const { requireSchoolActive } = require("@school-erp/shared/src/middleware/requireSchoolActive");
const { requireSubscriptionActive } = require("@school-erp/shared/src/middleware/requireSubscriptionActive");
const JWT_SECRET = getJwtSecret();

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
      const user = await UserModel.findById(decoded.id).select("isActive schoolId").lean();
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

const requireTenant = (req, res, next) => {
  if (!req.tenantId && req.user?.role !== "super_admin") {
    return res.status(400).json({ success: false, message: "No school context for this request" });
  }
  return requireSchoolActive(req, res, (err) => {
    if (err) return next(err);
    return requireSubscriptionActive(req, res, next);
  });
};

const requirePermission = (permission) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated" });
  const perms = getPermissionsFor(req.user);
  if (!perms.includes("*") && !perms.includes(permission)) {
    return res.status(403).json({ success: false, message: "Access denied for this role" });
  }
  next();
};

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Access denied for this role" });
  }
  next();
};

const scopeStudentQuery = (req, res, next) => {
  if (req.user.role === "student") req.query.studentId = req.user.refId;
  next();
};

module.exports = { verifyToken, resolveTenant, requireTenant, requirePermission, authorizeRoles, scopeStudentQuery };
