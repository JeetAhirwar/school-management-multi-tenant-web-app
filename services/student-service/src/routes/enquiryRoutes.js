const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/enquiryController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("enquiries:write"), ctrl.createEnquiry);
router.get("/", requirePermission("enquiries:read"), ctrl.getEnquiries);
router.put("/:id", requirePermission("enquiries:write"), ctrl.updateEnquiry);
router.delete("/:id", requirePermission("enquiries:write"), ctrl.deleteEnquiry);

module.exports = router;
