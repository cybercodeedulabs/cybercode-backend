import { pool } from "../../db/db.js";
import crypto from "crypto";
import { provisionInstanceOnHost } from "../services/compute/manager.js";

export async function createInstancesHandler(req, res) {
  const ownerEmail = req.iam?.email;
  const ownerId = req.iam?.id;

  if (!ownerEmail || !ownerId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    image = "ubuntu-22.04",
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

    // ===========================
    // 1️⃣ Fetch IAM + Org Details
    // ===========================
    const userQ = `
      SELECT id, organization_id, trial_end, is_active
      FROM iam_users
      WHERE id = $1
      LIMIT 1
    `;
    const userRes = await client.query(userQ, [ownerId]);

    if (!userRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "IAM user not found" });
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Account is inactive" });
    }

    // Trial check (individuals)
    if (user.trial_end && new Date(user.trial_end) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Trial expired. Upgrade required." });
    }

    const orgQ = `
      SELECT id, status, cpu_quota, storage_quota, instance_quota, subscription_end
      FROM organizations
      WHERE id = $1
      LIMIT 1
    `;
    const orgRes = await client.query(orgQ, [user.organization_id]);

    if (!orgRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Organization not found" });
    }

    const org = orgRes.rows[0];

    // 🛑 Suspension Guard
    if (org.status === "suspended") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Organization is suspended" });
    }

    // 🛑 Approval Guard
    if (org.status !== "approved") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Organization not approved yet" });
    }

    // 🛑 Subscription Expiry Guard
    if (org.subscription_end && new Date(org.subscription_end) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Organization subscription expired" });
    }

    // ===========================
    // 2️⃣ Org Quota Check
    // ===========================
    const usageQ = `
      SELECT
        COALESCE(SUM(cpu),0) AS cpu_used,
        COALESCE(SUM(disk),0) AS storage_used,
        COUNT(*) AS instance_count
      FROM cloud_instances
      WHERE organization_id = $1
      AND status IN ('provisioning','running')
    `;
    const usageRes = await client.query(usageQ, [org.id]);

    const cpuUsed = Number(usageRes.rows[0].cpu_used || 0);
    const storageUsed = Number(usageRes.rows[0].storage_used || 0);
    const instanceCount = Number(usageRes.rows[0].instance_count || 0);

    if (instanceCount >= org.instance_quota) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Organization instance quota reached" });
    }

    if (cpuUsed + Number(cpu) > org.cpu_quota) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "CPU quota exceeded" });
    }

    if (storageUsed + Number(disk) > org.storage_quota) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Storage quota exceeded" });
    }

    // ===========================
    // 3️⃣ Prevent User Double Launch
    // ===========================
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

    // ===========================
    // 4️⃣ Insert Provisioning Record
    // ===========================
    for (let i = 0; i < Number(count); i++) {
      const id = crypto.randomUUID();

      await client.query(
        `
        INSERT INTO cloud_instances (
          id, owner_email, owner_user_id, organization_id,
          image, plan, cpu, ram, disk,
          free_tier, status, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          id,
          ownerEmail,
          ownerId,
          org.id,
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

      provisionInstanceOnHost({
        ownerEmail,
        organizationId: org.id,
        image,
        cpu,
        ram,
        disk,
      })
        .then(async (provisionResult) => {
          await pool.query(
            `
            UPDATE cloud_instances
            SET status=$1, container_name=$2
            WHERE id=$3
            `,
            ["running", provisionResult.name, id]
          );
        })
        .catch(async (err) => {
          console.error("Provision async error:", err);

          await pool.query(
            `
            UPDATE cloud_instances
            SET status=$1
            WHERE id=$2
            `,
            ["failed", id]
          );
        });

      createdInstances.push({
        id,
        image,
        plan,
        cpu,
        ram,
        disk,
        status: "provisioning",
        freeTier: false,
        owner: ownerEmail,
      });
    }

    await client.query("COMMIT");

    return res.json({
      instances: createdInstances,
      usage: {
        cpuUsed,
        cpuQuota: org.cpu_quota,
        storageUsed,
        storageQuota: org.storage_quota,
      },
    });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => { });
    console.error("createInstancesHandler error:", err);

    return res.status(500).json({
      error: "Provisioning failed to start.",
    });
  } finally {
    client.release();
  }
}