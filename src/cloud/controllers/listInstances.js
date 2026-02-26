// backend/src/cloud/controllers/listInstances.js
import { pool } from "../../db/db.js";

/**
 * GET /api/cloud/instances
 * Role-aware listing
 */
export async function listInstancesHandler(req, res) {
  const userId = req.iam?.id;
  const userRole = req.iam?.role;
  const userOrgId = req.iam?.organization_id;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    let query;
    let values;

    if (userRole === "admin") {
      // Platform admin sees everything
      query = `
        SELECT id, owner_email AS owner, image, plan, cpu, ram, disk,
               free_tier AS "freeTier", status, created_at,
               container_name AS name
        FROM cloud_instances
        ORDER BY created_at DESC
      `;
      values = [];
    } else if (userRole === "org_admin") {
      // Org admin sees entire org
      query = `
        SELECT id, owner_email AS owner, image, plan, cpu, ram, disk,
               free_tier AS "freeTier", status, created_at,
               container_name AS name
        FROM cloud_instances
        WHERE organization_id = $1
        ORDER BY created_at DESC
      `;
      values = [userOrgId];
    } else {
      // Developer sees only their own
      query = `
        SELECT id, owner_email AS owner, image, plan, cpu, ram, disk,
               free_tier AS "freeTier", status, created_at,
               container_name AS name
        FROM cloud_instances
        WHERE owner_user_id = $1
        ORDER BY created_at DESC
      `;
      values = [userId];
    }

    const { rows } = await pool.query(query, values);

    return res.json({ instances: rows });
  } catch (err) {
    console.error("listInstancesHandler error:", err);
    return res.status(500).json({ error: "Failed to list instances" });
  }
}