import { pool } from "../../db/db.js";
import crypto from "crypto";

/**
 * POST /api/cloud/free-instance
 * Creates exactly one small free instance per IAM user.
 */
export async function freeInstanceHandler(req, res) {
  const ownerEmail = req.iam?.email;
  const ownerId = req.iam?.id;

  if (!ownerEmail || !ownerId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ===========================
    // 1️⃣ Fetch IAM + Org
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
      return res.status(403).json({ error: "Account inactive" });
    }

    if (user.trial_end && new Date(user.trial_end) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Trial expired" });
    }

    const orgQ = `
      SELECT id, status, instance_quota, subscription_end
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
  return res.status(403).json({ error: "Organization not approved" });
}

// 🛑 Subscription Expiry Guard
if (org.subscription_end && new Date(org.subscription_end) < new Date()) {
  await client.query("ROLLBACK");
  return res.status(403).json({ error: "Organization subscription expired" });
}

    // Existing free instance check
    const checkQ = `
      SELECT id FROM cloud_instances
      WHERE owner_email = $1
      AND free_tier = true
      LIMIT 1
    `;
    const chk = await client.query(checkQ, [ownerEmail]);

    if (chk.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Free instance already created" });
    }

    // Org instance limit check
    const countQ = `
      SELECT COUNT(*) AS instance_count
      FROM cloud_instances
      WHERE organization_id = $1
      AND status IN ('provisioning','running')
    `;
    const countRes = await client.query(countQ, [org.id]);
    const instanceCount = Number(countRes.rows[0].instance_count || 0);

    if (instanceCount >= org.instance_quota) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Organization instance quota reached" });
    }

    // Create free instance record
    const id = crypto.randomUUID();

    const insertQ = `
      INSERT INTO cloud_instances (
        id, owner_email, owner_user_id, organization_id,
        image, plan, cpu, ram, disk,
        free_tier, status, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, owner_email AS owner, image, plan, cpu, ram, disk, free_tier AS "freeTier", status, created_at
    `;

    const values = [
      id,
      ownerEmail,
      ownerId,
      org.id,
      "ubuntu-22.04",
      "student",
      1,
      1,
      2,
      true,
      "running",
      new Date(),
    ];

    const { rows } = await client.query(insertQ, values);
    const created = rows[0];

    await client.query("COMMIT");

    return res.json({
      instance: created,
      usage: {
        cpuUsed: 0,
        cpuQuota: 1,
        storageUsed: 0,
        storageQuota: 5,
      },
    });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("freeInstanceHandler error:", err);
    return res.status(500).json({ error: "Failed to create free instance" });
  } finally {
    client.release();
  }
}