// backend/src/cloud/controllers/createInstance.js
import { pool } from "../../db/db.js";
import crypto from "crypto";

/**
 * Create 1..N instances for the authenticated user.
 * Body:
 * { image, plan, count, cpu, ram, disk }
 *
 * Response: { instances: [...], usage: { cpuUsed, cpuQuota, storageUsed, storageQuota } }
 */
export async function createInstancesHandler(req, res) {
  const ownerEmail = req.iam?.email;
  if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

  const { image, plan = "student", count = 1, cpu = 1, ram = 1, disk = 2 } = req.body || {};

  if (!image || !count) {
    return res.status(400).json({ error: "Missing image or count" });
  }

  const created = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (let i = 0; i < Number(count); i += 1) {
      const id = crypto.randomUUID();
      const suffix = id.slice(-4);
      const name = `${image.replace(/[^a-z0-9]/gi, "-")}-${suffix}`.toLowerCase();
      const insertQ = `
        INSERT INTO cloud_instances (
          id, owner_email, image, plan, cpu, ram, disk, free_tier, status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id, owner_email AS owner, image, plan, cpu, ram, disk, free_tier AS "freeTier", status, created_at
      `;
      const values = [id, ownerEmail, image, plan, Number(cpu), Number(ram), Number(disk), false, "running", new Date()];
      const { rows } = await client.query(insertQ, values);
      created.push(rows[0]);
    }

    // compute usage (aggregate across all instances)
    const usageQ = `SELECT COALESCE(SUM(cpu),0) AS cpu_used, COALESCE(SUM(disk),0) AS storage_used FROM cloud_instances`;
    const ures = await client.query(usageQ);
    const cpuUsed = Number(ures.rows[0].cpu_used || 0);
    const storageUsed = Number(ures.rows[0].storage_used || 0);

    // default quotas (MVP)
    const cpuQuota = 64;
    const storageQuota = 1024;

    await client.query("COMMIT");

    return res.json({
      instances: created,
      usage: {
        cpuUsed,
        cpuQuota,
        storageUsed,
        storageQuota,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("createInstancesHandler error:", err);
    return res.status(500).json({ error: "Failed to create instances" });
  } finally {
    client.release();
  }
}
