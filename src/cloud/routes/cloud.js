// backend/src/cloud/routes/cloud.js
import express from "express";
import { verifyIAMToken } from "../../routes/iam.js"; // reuse IAM token middleware

import {
  createInstancesHandler,
  listInstancesHandler,
  terminateInstanceHandler,
  freeInstanceHandler,
  getUsageHandler,
} from "../controllers/index.js";

const router = express.Router();

/**
 * Cloud API (placeholders)
 * - POST   /api/cloud/instances      -> create instances
 * - GET    /api/cloud/instances      -> list (user)
 * - DELETE /api/cloud/instances/:id  -> terminate
 * - GET    /api/cloud/usage          -> usage
 * - POST   /api/cloud/free-instance  -> free demo instance (one per user)
 *
 * All routes (except maybe public info) should use verifyIAMToken
 * so we have req.iam available (id/email/role).
 */

router.post("/instances", verifyIAMToken, createInstancesHandler);
router.get("/instances", verifyIAMToken, listInstancesHandler);
router.delete("/instances/:id", verifyIAMToken, terminateInstanceHandler);
router.get("/usage", verifyIAMToken, getUsageHandler);
router.post("/free-instance", verifyIAMToken, freeInstanceHandler);

export default router;
