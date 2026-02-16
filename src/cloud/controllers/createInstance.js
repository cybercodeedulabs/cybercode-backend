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

  const client = await pool.connect();
  const createdInstances = [];

  try {
    await client.query("BEGIN");

    // Prevent double launch
    const existing = await client.query(
      `
      SELECT id FROM cloud_instances
      WHERE owner_email=$1
      AND status IN ('provisioning','running')
      LIMIT 1
      `,
      [ownerEmail]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "You already have an active or provisioning instance",
      });
    }

    for (let i = 0; i < Number(count); i++) {
      const id = crypto.randomUUID();

      // Insert provisioning row
      await client.query(
        `
        INSERT INTO cloud_instances (
          id, owner_email, image, plan,
          cpu, ram, disk,
          free_tier, status, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
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
        ]
      );

      // 🔥 PROVISION MUST SUCCEED
      const provisionResult = await provisionInstanceOnHost({
        ownerEmail,
        image,
        cpu,
        ram,
        disk,
      });

      // If provision throws → control jumps to outer catch
      // So no broken row will commit

      await client.query(
        `
        UPDATE cloud_instances
        SET status=$1, container_name=$2
        WHERE id=$3
        `,
        ["running", provisionResult.name, id]
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
    }

    const usageRes = await client.query(`
      SELECT
        COALESCE(SUM(cpu),0) AS cpu_used,
        COALESCE(SUM(disk),0) AS storage_used
      FROM cloud_instances
      WHERE status='running'
    `);

    await client.query("COMMIT");

    return res.json({
      instances: createdInstances,
      usage: {
        cpuUsed: Number(usageRes.rows[0].cpu_used || 0),
        cpuQuota: 64,
        storageUsed: Number(usageRes.rows[0].storage_used || 0),
        storageQuota: 1024,
      },
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createInstancesHandler error:", err);

    return res.status(500).json({
      error: "Provisioning failed. No instance created.",
    });
  } finally {
    client.release();
  }
}