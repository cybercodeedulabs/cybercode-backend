// backend/src/cloud/controllers/freeInstance.js
import { pool } from "../../db/db.js";
import crypto from "crypto";

/**
 * POST /api/cloud/free-instance
 * Creates exactly one small free instance per IAM user.
 */
export async function freeInstanceHandler(req, res) {
  const ownerEmail = req.iam?.email;
  if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // check existing free instance for user
    const checkQ = `SELECT id FROM cloud_instances WHERE owner_email = $1 AND free_tier = true LIMIT 1`;
    const chk = await client.query(checkQ, [ownerEmail]);
    if (chk.rows && chk.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Free instance already created" });
    }

    // create small free instance (1 vCPU, 1GB, 2GB disk)
    const id = crypto.randomUUID();
    const name = `free-${id.slice(-4)}`;
    const insertQ = `
      INSERT INTO cloud_instances (id, owner_email, image, plan, cpu, ram, disk, free_tier, status, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, owner_email AS owner, image, plan, cpu, ram, disk, free_tier AS "freeTier", status, created_at
    `;
    const values = [id, ownerEmail, "ubuntu-22.04", "student", 1, 1, 2, true, "running", new Date()];
    const { rows } = await client.query(insertQ, values);
    const created = rows[0];

    // recompute usage
    const usageQ = `SELECT COALESCE(SUM(cpu),0) AS cpu_used, COALESCE(SUM(disk),0) AS storage_used FROM cloud_instances`;
    const ures = await client.query(usageQ);
    const cpuUsed = Number(ures.rows[0].cpu_used || 0);
    const storageUsed = Number(ures.rows[0].storage_used || 0);

    await client.query("COMMIT");

    return res.json({
      instance: created,
      usage: { cpuUsed, cpuQuota: 64, storageUsed, storageQuota: 1024 },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("freeInstanceHandler error:", err);
    return res.status(500).json({ error: "Failed to create free instance" });
  } finally {
    client.release();
  }
}
