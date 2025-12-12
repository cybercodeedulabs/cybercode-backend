// backend/src/cloud/controllers/usage.js
import { pool } from "../../db/db.js";

/**
 * GET /api/cloud/usage
 * Returns aggregated usage metrics (global).
 * Could be extended to return per-tenant quotas.
 */
export async function getUsageHandler(req, res) {
  try {
    const usageQ = `SELECT COALESCE(SUM(cpu),0) AS cpu_used, COALESCE(SUM(disk),0) AS storage_used, COUNT(DISTINCT owner_email) AS active_users FROM cloud_instances`;
    const { rows } = await pool.query(usageQ);
    const cpuUsed = Number(rows[0].cpu_used || 0);
    const storageUsed = Number(rows[0].storage_used || 0);
    const activeUsers = Number(rows[0].active_users || 0);

    return res.json({
      cpuUsed,
      cpuQuota: 64,
      storageUsed,
      storageQuota: 1024,
      activeUsers,
    });
  } catch (err) {
    console.error("getUsageHandler error:", err);
    return res.status(500).json({ error: "Failed to get usage" });
  }
}
