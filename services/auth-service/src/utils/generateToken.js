const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("@school-erp/shared/src/utils/jwtSecret");

// JWT v2 payload carries tenant + role data so every downstream service can
// enforce scoping without a DB round trip. Access tokens are short-lived on
// purpose so role/isActive/school-status changes take effect quickly.
// `typ` separates access vs refresh so a refresh token can never be used as
// an access token (and vice versa) at any verifyToken.
const generateAccessToken = (user) =>
  jwt.sign(
    {
      typ: "access",
      id: user._id,
      name: user.name || null,
      email: user.email || null,
      role: user.role,
      schoolId: user.schoolId || null,
      refId: user.refId || null,
      designation: user.designation || null,
      class: user.class || null,
      section: user.section || null,
      linkedStudentIds: user.linkedStudentIds || [],
    },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "30m" }
  );

const generateRefreshToken = (user) =>
  jwt.sign({ typ: "refresh", id: user._id }, getJwtSecret(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  });

module.exports = { generateAccessToken, generateRefreshToken };