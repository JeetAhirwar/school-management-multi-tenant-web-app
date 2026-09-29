const { getJwtSecret, MIN_JWT_SECRET_LENGTH } = require("./utils/jwtSecret");
const { paginate, pageInfo, MAX_LIMIT, DEFAULT_LIMIT } = require("./utils/pagination");
const {
  ROLE_PERMISSIONS,
  STAFF_PERMISSIONS,
  getPermissionsFor,
  hasPermission,
} = require("./utils/permissions");
const { validateObjectIdParam } = require("./middleware/objectId");
const imagekit = require("./config/imagekit");
const {
  createMasterController,
  httpError,
  clean,
  normalizeKey,
} = require("./master-data/index");
const paymentGateways = require("./payment-gateways");

module.exports = {
  getJwtSecret,
  MIN_JWT_SECRET_LENGTH,
  paginate,
  pageInfo,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  ROLE_PERMISSIONS,
  STAFF_PERMISSIONS,
  getPermissionsFor,
  hasPermission,
  validateObjectIdParam,
  imagekit,
  createMasterController,
  httpError,
  clean,
  normalizeKey,
  paymentGateways,
};