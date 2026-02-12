import { pool } from "../../db/db.js";
import crypto from "crypto";
import { provisionInstanceOnHost } from "../services/compute/manager.js";

export async function createInstancesHandler(req, res) {
  const ownerEmail = req.iam?.email;
  if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

  const {
    image = "ubuntu:22.04",
    plan = "student",
    count = 1,
    cpu = 1,
    ram = 1,
    disk = 2,
  } = req.body || {};

  if (!image || !count) {
    return res.status(400).json({ error: "Missing image or count" });
  }

  const createdInstances = [];
  const client = await pool.connect();

  try {
    for (let i = 0; i < Number(count); i++) {
      const id = crypto.randomUUID();

      // Insert as provisioning
      const insertQuery = `
        INSERT INTO cloud_instances (
          id, owner_email, image, plan, cpu, ram, disk, free_tier, status, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `;

      const insertValues = [
        id,
        ownerEmail,
        image,
        plan,
        Number(cpu),
        Number(ram),
        Number(disk),
        false,
        "provisioning",
        new Date(),
      ];

      const { rows } = await client.query(insertQuery, insertValues);
      const dbRow = rows[0];

      try {
        // 🔥 REAL PROVISION CALL
        const provisionResult = await provisionInstanceOnHost({
          ownerEmail,
          image,
          cpu,
          ram,
          disk,
        });

        // Update status to RUNNING
        await client.query(
          `UPDATE cloud_instances SET status=$1 WHERE id=$2`,
          ["running", id]
        );

        createdInstances.push({
          id,
          name: provisionResult.name,
          image,
          plan,
          cpu,
          ram,
          disk,
          status: "running",
          freeTier: false,
          owner: ownerEmail,
        });
      } catch (provisionError) {
        console.error("Provision failed:", provisionError);

        await client.query(
          `UPDATE cloud_instances SET status=$1 WHERE id=$2`,
          ["failed", id]
        );
      }
    }

    // ===== Usage Aggregation =====
    const usageQ = `
      SELECT 
        COALESCE(SUM(cpu),0) AS cpu_used,
        COALESCE(SUM(disk),0) AS storage_used
      FROM cloud_instances
      WHERE status = 'running'
    `;

    const usageRes = await client.query(usageQ);

    const cpuUsed = Number(usageRes.rows[0].cpu_used || 0);
    const storageUsed = Number(usageRes.rows[0].storage_used || 0);

    return res.json({
      instances: createdInstances,
      usage: {
        cpuUsed,
        cpuQuota: 64,
        storageUsed,
        storageQuota: 1024,
      },
    });
  } catch (err) {
    console.error("createInstancesHandler error:", err);
    return res.status(500).json({ error: "Failed to create instances" });
  } finally {
    client.release();
  }
}
