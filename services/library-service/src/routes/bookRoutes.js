const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/bookController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("library:manage"), ctrl.addBook);
router.get("/", requirePermission("library:read"), ctrl.getBooks);
router.put("/:id", requirePermission("library:manage"), ctrl.updateBook);
router.delete("/:id", requirePermission("library:manage"), ctrl.deleteBook);

module.exports = router;
