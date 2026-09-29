const { Types } = require("mongoose");

// router.param callback: rejects malformed MongoDB ObjectId path params with a
// 400 before the route handler runs, so an invalid id can never reach a query
// and surface as a CastError 500 (which wastes a request and leaks internals).
// Runs only for routes that declare the param. Canonical copy in
// @school-erp/shared; previously duplicated per service.
const validateObjectIdParam = (req, res, next, value) => {
  if (!Types.ObjectId.isValid(String(value))) {
    return res.status(400).json({ success: false, message: "Invalid id format" });
  }
  next();
};

module.exports = { validateObjectIdParam };