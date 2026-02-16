// backend/src/cloud/controllers/listInstances.js
import { pool } from "../../db/db.js";

/**
 * Lists instances for the authenticated IAM user.
 * GET /api/cloud/instances
 */
export async function listInstancesHandler(req, res) {
  const ownerEmail = req.iam?.email;
  if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

  try {
    const q = `
  SELECT
    id,
    owner_email AS owner,
    image,
    plan,
    cpu,
    ram,
    disk,
    free_tier AS "freeTier",
    status,
    created_at,
    container_name AS name
  FROM cloud_instances
  WHERE owner_email = $1
  ORDER BY created_at DESC
`;

          const { rows } = await pool.query(q, [ownerEmail]);
    return res.json({ instances: rows });
  } catch (err) {
    console.error("listInstancesHandler error:", err);
    return res.status(500).json({ error: "Failed to list instances" });
  }
}