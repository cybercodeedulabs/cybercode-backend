// backend/src/cloud/controllers/terminateInstance.js

import { pool } from "../../db/db.js";
import { terminateInstanceOnHost } from "../services/compute/manager.js";

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

    // 🔒 Lock row to prevent race conditions
    const { rows } = await client.query(
      `
      SELECT id, owner_email, status, container_name
      FROM cloud_instances
      WHERE id = $1
      FOR UPDATE
      `,
      [id]
    );

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Instance not found" });
    }

    const inst = rows[0];

    if (inst.owner_email !== ownerEmail && userRole !== "admin") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    if (inst.status === "terminating") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Instance already terminating" });
    }

    if (!inst.container_name) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Missing container name in DB" });
    }

    // Mark as terminating
    await client.query(
      `UPDATE cloud_instances SET status=$1 WHERE id=$2`,
      ["terminating", id]
    );

    // 🔥 Terminate on host using REAL container name
    try {
      await terminateInstanceOnHost(inst.container_name);
    } catch (hostErr) {
      console.error("Host termination failed:", hostErr);

      // Revert status
      await client.query(
        `UPDATE cloud_instances SET status=$1 WHERE id=$2`,
        ["running", id]
      );

      await client.query("ROLLBACK");

      return res.status(500).json({
        error: "Failed to terminate container on host",
      });
    }

    // Delete from DB after successful host removal
    await client.query(
      `DELETE FROM cloud_instances WHERE id=$1`,
      [id]
    );

    // ===== Usage Aggregation =====
    const usageRes = await client.query(`
      SELECT
        COALESCE(SUM(cpu),0) AS cpu_used,
        COALESCE(SUM(disk),0) AS storage_used
      FROM cloud_instances
      WHERE status = 'running'
    `);

    const cpuUsed = Number(usageRes.rows[0].cpu_used || 0);
    const storageUsed = Number(usageRes.rows[0].storage_used || 0);

    await client.query("COMMIT");

    return res.json({
      success: true,
      usage: {
        cpuUsed,
        cpuQuota: 64,
        storageUsed,
        storageQuota: 1024,
      },
    });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("terminateInstanceHandler error:", err);
    return res.status(500).json({ error: "Failed to terminate instance" });
  } finally {
    client.release();
  }
}