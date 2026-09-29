const mongoose = require("mongoose");

// Matches a strictly 24-char hex ObjectId. Mongoose's ObjectId.isValid also
// accepts 12-byte strings, which would let a junk header through; caller
// identity for X-School-Id must be a real ObjectId.
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

// Resolves the effective tenant for a request. Normal users inherit it from
// the token; platform (super_admin) can impersonate a school via the
// X-School-Id header, but only when the header is a valid ObjectId — and,
// wherever the School model is registered (auth-service), the school must
// actually exist. Guards against:
//  - arbitrary strings leaking into tenant-scoped queries,
//  - malformed ObjectIds producing CastError 500s,
//  - impersonating a school id that does not exist.
const resolveTenant = async (req, res, next) => {
  try {
    let schoolId = req.user.schoolId || null;
    const rawHeader = req.header("X-School-Id");
    if (req.user.role === "super_admin" && rawHeader) {
      const candidate = String(rawHeader).trim();
      if (!OBJECT_ID_REGEX.test(candidate)) {
        return res.status(400).json({ success: false, message: "X-School-Id must be a valid ObjectId" });
      }
      const SchoolModel = mongoose.models.School;
      if (SchoolModel) {
        const school = await SchoolModel.findById(candidate).select({ _id: 1 }).lean();
        if (!school) {
          return res.status(400).json({ success: false, message: "School not found for X-School-Id" });
        }
      }
      schoolId = candidate;
    }
    req.tenantId = schoolId;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { resolveTenant };