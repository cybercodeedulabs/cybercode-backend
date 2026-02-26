// backend/src/cloud/controllers/usage.js
import { pool } from "../../db/db.js";

/**
 * GET /api/cloud/usage
 * Returns usage metrics for the authenticated user's organization.
 */
export async function getUsageHandler(req, res) {
  const ownerId = req.iam?.id;

  if (!ownerId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const client = await pool.connect();

  try {
    // ===========================
    // 1️⃣ Fetch IAM user + org
    // ===========================
    const userQ = `
      SELECT organization_id
      FROM iam_users
      WHERE id = $1
      LIMIT 1
    `;
    const userRes = await client.query(userQ, [ownerId]);

    if (!userRes.rows.length) {
      return res.status(404).json({ error: "IAM user not found" });
    }

    const orgId = userRes.rows[0].organization_id;

    // ===========================
    // 2️⃣ Fetch Org Quotas
    // ===========================
    const orgQ = `
      SELECT cpu_quota, storage_quota
      FROM organizations
      WHERE id = $1
      LIMIT 1
    `;
    const orgRes = await client.query(orgQ, [orgId]);

    if (!orgRes.rows.length) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const org = orgRes.rows[0];

    // ===========================
    // 3️⃣ Compute Org Usage
    // ===========================
    const usageQ = `
      SELECT
        COALESCE(SUM(cpu),0) AS cpu_used,
        COALESCE(SUM(disk),0) AS storage_used,
        COUNT(DISTINCT owner_user_id) AS active_users
      FROM cloud_instances
      WHERE organization_id = $1
      AND status IN ('provisioning','running')
    `;
    const usageRes = await client.query(usageQ, [orgId]);

    const cpuUsed = Number(usageRes.rows[0].cpu_used || 0);
    const storageUsed = Number(usageRes.rows[0].storage_used || 0);
    const activeUsers = Number(usageRes.rows[0].active_users || 0);

    return res.json({
      cpuUsed,
      cpuQuota: Number(org.cpu_quota),
      storageUsed,
      storageQuota: Number(org.storage_quota),
      activeUsers,
    });

  } catch (err) {
    console.error("getUsageHandler error:", err);
    return res.status(500).json({ error: "Failed to get usage" });
  } finally {
    client.release();
  }
}
