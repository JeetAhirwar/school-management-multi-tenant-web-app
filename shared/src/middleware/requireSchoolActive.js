const mongoose = require("mongoose");

/**
 * Middleware that blocks API access when the school is suspended or its
 * subscription has lapsed. Must run AFTER resolveTenant (req.tenantId set).
 *
 * Caches the School lookup for the lifetime of the request to avoid duplicate
 * queries when multiple route handlers need school info.
 */
const requireSchoolActive = async (req, res, next) => {
  if (!req.tenantId) {
    if (req.user?.role === "super_admin") return next();
    return res.status(400).json({ success: false, message: "No school context for this request" });
  }

  try {
    const SchoolModel = mongoose.models.School;
    if (!SchoolModel) {
      // School model not registered in this microservice — allow through.
      // Only auth-service registers the School model.
      return next();
    }

    const school = await SchoolModel.findById(req.tenantId)
      .select({ status: 1, plan: 1, onboarding: 1 })
      .lean();

    if (!school) {
      return res.status(404).json({ success: false, message: "School not found" });
    }

    if (school.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Your school account has been suspended. Please contact support.",
        code: "SCHOOL_SUSPENDED",
      });
    }

    // Attach for downstream use
    req.school = school;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireSchoolActive };
