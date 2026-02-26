// backend/src/cloud/controllers/terminateInstance.js

import { pool } from "../../db/db.js";
import { terminateInstanceOnHost } from "../services/compute/manager.js";

/**
 * DELETE /api/cloud/instances/:id
 * Multi-tenant safe:
 * - developer → only own containers
 * - org_admin → any container in same org
 * - admin → any container
 */
export async function terminateInstanceHandler(req, res) {
  const userId = req.iam?.id;
  const userRole = req.iam?.role;
  const userOrgId = req.iam?.organization_id;
  const id = req.params.id;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!id) return res.status(400).json({ error: "Missing id" });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT id, owner_user_id, organization_id, status, container_name
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

    // 🔒 Multi-tenant enforcement
    const sameOrg = inst.organization_id === userOrgId;
    const isOwner = inst.owner_user_id === userId;
    const isAdmin = userRole === "admin";
    const isOrgAdmin = userRole === "org_admin";

    if (
      !isAdmin &&
      !(
        (isOwner) ||
        (isOrgAdmin && sameOrg)
      )
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    if (inst.status === "terminating") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Instance already terminating" });
    }

    // If provisioning failed or container never created,
// nothing exists on host — safe to delete DB record only
if (!inst.container_name || inst.status === "failed") {

  await client.query(
    `DELETE FROM cloud_instances WHERE id=$1`,
    [id]
  );

  await client.query("COMMIT");

  return res.json({
    success: true,
    usage: {
      cpuUsed: 0,
      storageUsed: 0,
    },
  });
}

    // Mark terminating
    await client.query(
      `UPDATE cloud_instances SET status=$1 WHERE id=$2`,
      ["terminating", id]
    );

    // Remove from host
    try {
      await terminateInstanceOnHost(inst.container_name);
    } catch (hostErr) {
      console.error("Host termination failed:", hostErr);

      await client.query(
        `UPDATE cloud_instances SET status=$1 WHERE id=$2`,
        ["running", id]
      );

      await client.query("ROLLBACK");
      return res.status(500).json({
        error: "Failed to terminate container on host",
      });
    }

    // Delete record
    await client.query(
      `DELETE FROM cloud_instances WHERE id=$1`,
      [id]
    );

    // 🔒 Org-scoped usage aggregation
    const usageRes = await client.query(
      `
      SELECT
        COALESCE(SUM(cpu),0) AS cpu_used,
        COALESCE(SUM(disk),0) AS storage_used
      FROM cloud_instances
      WHERE status='running'
      AND organization_id=$1
      `,
      [userOrgId]
    );

    const cpuUsed = Number(usageRes.rows[0].cpu_used || 0);
    const storageUsed = Number(usageRes.rows[0].storage_used || 0);

    await client.query("COMMIT");

    return res.json({
      success: true,
      usage: {
        cpuUsed,
        storageUsed,
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