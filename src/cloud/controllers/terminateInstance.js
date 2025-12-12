// backend/src/cloud/controllers/terminateInstance.js
import { pool } from "../../db/db.js";

/**
 * DELETE /api/cloud/instances/:id
 * Only owner or admin can remove.
 */
export async function terminateInstanceHandler(req, res) {
  const ownerEmail = req.iam?.email;
  const userRole = req.iam?.role;
  const id = req.params.id;

  if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });
  if (!id) return res.status(400).json({ error: "Missing id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // fetch instance
    const { rows } = await client.query(`SELECT id, owner_email, free_tier FROM cloud_instances WHERE id = $1 LIMIT 1`, [id]);
    if (!rows || rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Instance not found" });
    }

    const inst = rows[0];
    if (inst.owner_email !== ownerEmail && userRole !== "admin") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    // delete (for MVP) — could mark 'terminated' instead for async
    await client.query(`DELETE FROM cloud_instances WHERE id = $1`, [id]);

    // recompute usage
    const usageQ = `SELECT COALESCE(SUM(cpu),0) AS cpu_used, COALESCE(SUM(disk),0) AS storage_used FROM cloud_instances`;
    const ures = await client.query(usageQ);
    const cpuUsed = Number(ures.rows[0].cpu_used || 0);
    const storageUsed = Number(ures.rows[0].storage_used || 0);
    const cpuQuota = 64;
    const storageQuota = 1024;

    await client.query("COMMIT");

    return res.json({
      success: true,
      usage: { cpuUsed, cpuQuota, storageUsed, storageQuota },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("terminateInstanceHandler error:", err);
    return res.status(500).json({ error: "Failed to terminate instance" });
  } finally {
    client.release();
  }
}
