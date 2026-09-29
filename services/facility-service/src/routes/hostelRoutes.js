const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/hostelController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("hostel:manage"), ctrl.createRoom);
router.get("/", requirePermission("hostel:read"), ctrl.getRooms);
router.patch("/:id/allot", requirePermission("hostel:manage"), ctrl.allotRoom);
router.patch("/:id/vacate", requirePermission("hostel:manage"), ctrl.vacateRoom);
router.delete("/:id", requirePermission("hostel:manage"), ctrl.deleteRoom);

module.exports = router;
