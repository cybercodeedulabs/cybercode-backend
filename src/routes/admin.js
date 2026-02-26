// backend/src/routes/admin.js

import express from "express";
import { pool } from "../db/db.js";
import { verifyIAMToken } from "./iam.js";

const router = express.Router();

/**
 * Middleware: Admin only
 */
function requireAdmin(req, res, next) {
  if (req.iam?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/**
 * GET /api/admin/organizations
 * Optional query: ?status=pending
 */
router.get(
  "/organizations",
  verifyIAMToken,
  requireAdmin,
  async (req, res) => {
    const status = req.query.status;

    try {
      let query = `
        SELECT
          id,
          name,
          type,
          status,
          cpu_quota,
          storage_quota,
          instance_quota,
          requested_user_count,
          requested_cpu_quota,
          requested_storage_quota,
          requested_instance_quota,
          requested_subscription_months,
          payment_status,
          created_at
        FROM organizations
      `;

      const values = [];

      if (status) {
        query += ` WHERE status = $1`;
        values.push(status);
      }

      query += ` ORDER BY created_at DESC`;

      const { rows } = await pool.query(query, values);

      return res.json({ organizations: rows });
    } catch (err) {
      console.error("List orgs error:", err);
      return res.status(500).json({ error: "Failed to list organizations" });
    }
  }
);

/**
 * POST /api/admin/organizations/:id/approve
 */
router.post(
  "/organizations/:id/approve",
  verifyIAMToken,
  requireAdmin,
  async (req, res) => {
    const orgId = req.params.id;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `
        SELECT *
        FROM organizations
        WHERE id = $1
        FOR UPDATE
        `,
        [orgId]
      );

      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Organization not found" });
      }

      const org = rows[0];

      if (org.status === "approved") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Organization already approved" });
      }

      const months = org.requested_subscription_months || 1;

      await client.query(
        `
        UPDATE organizations
        SET
          status = 'approved',
          payment_status = 'paid',
          cpu_quota = COALESCE(requested_cpu_quota, 0),
          storage_quota = COALESCE(requested_storage_quota, 0),
          instance_quota = COALESCE(requested_instance_quota, 0),
          subscription_start = NOW(),
          subscription_end = NOW() + ($1 || ' months')::interval
        WHERE id = $2
        `,
        [months.toString(), orgId]
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
        message: "Organization approved successfully",
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Approve org error:", err);
      return res.status(500).json({ error: "Failed to approve organization" });
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/admin/organizations/:id/update
 */
router.post(
  "/organizations/:id/update",
  verifyIAMToken,
  requireAdmin,
  async (req, res) => {
    const orgId = req.params.id;
    const {
      cpu_quota,
      storage_quota,
      instance_quota,
      extend_months,
      payment_status
    } = req.body;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT subscription_end FROM organizations WHERE id = $1 FOR UPDATE`,
        [orgId]
      );

      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Organization not found" });
      }

      // Step 1: Update quotas & payment only
      await client.query(
        `
        UPDATE organizations
        SET
          cpu_quota = COALESCE($1::int, cpu_quota),
          storage_quota = COALESCE($2::int, storage_quota),
          instance_quota = COALESCE($3::int, instance_quota),
          payment_status = COALESCE($4, payment_status)
        WHERE id = $5
        `,
        [
          cpu_quota ?? null,
          storage_quota ?? null,
          instance_quota ?? null,
          payment_status ?? null,
          orgId
        ]
      );

      // Step 2: Extend subscription only if provided
      if (extend_months && Number(extend_months) > 0) {
        await client.query(
          `
          UPDATE organizations
          SET subscription_end = subscription_end + ($1::int * INTERVAL '1 month')
          WHERE id = $2
          `,
          [Number(extend_months), orgId]
        );
      }

      await client.query("COMMIT");

      return res.json({ success: true });

    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Update org error:", err);
      return res.status(500).json({ error: "Failed to update organization" });
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/admin/organizations/:id/suspend
 */
router.post(
  "/organizations/:id/suspend",
  verifyIAMToken,
  requireAdmin,
  async (req, res) => {
    const orgId = req.params.id;

    try {
      await pool.query(
        `UPDATE organizations SET status = 'suspended' WHERE id = $1`,
        [orgId]
      );

      return res.json({ success: true });
    } catch (err) {
      console.error("Suspend org error:", err);
      return res.status(500).json({ error: "Failed to suspend organization" });
    }
  }
);

router.post(
  "/organizations/:id/reactivate",
  verifyIAMToken,
  requireAdmin,
  async (req, res) => {
    const orgId = req.params.id;

    try {
      await pool.query(
        `UPDATE organizations SET status = 'approved' WHERE id = $1`,
        [orgId]
      );

      return res.json({ success: true });
    } catch (err) {
      console.error("Reactivate org error:", err);
      return res.status(500).json({ error: "Failed to reactivate organization" });
    }
  }
);

export default router;