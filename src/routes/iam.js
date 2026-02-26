import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/db.js";

const router = express.Router();

const { JWT_SECRET, NODE_ENV } = process.env;

if (!JWT_SECRET && NODE_ENV === "production") {
  throw new Error("FATAL: JWT_SECRET missing in production environment");
}

// -------- Helper functions --------
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET || "dev_jwt_secret", { expiresIn: "7d" });
}

// -------- Professional Email Validation --------
function isProfessionalEmail(email) {
  const freeDomains = [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com"
  ];
  const domain = email.split("@")[1];
  return domain && !freeDomains.includes(domain.toLowerCase());
}

// -------- Middleware --------
export async function verifyIAMToken(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET || "dev_jwt_secret");
    req.iam = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ============================================================
// ======================= REGISTER ============================
// ============================================================
router.post("/register", async (req, res) => {
  let {
    email,
    password,
    phone,
    registrationType,
    organizationName,
    organizationType,
    orgEmail,
    city,
    state,
    country,
    pincode,
    requested_user_count,
    requested_cpu_quota,
    requested_storage_quota,
    requested_instance_quota,
    requested_subscription_months   // ✅ NEW FIELD
  } = req.body || {};

  if (!email || !password || !phone) {
    return res.status(400).json({ error: "email, password and phone are required" });
  }

  email = email.toLowerCase();
  phone = phone.trim();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Check duplicate email
    const emailCheck = await client.query(
      `SELECT id FROM iam_users WHERE email=$1 LIMIT 1`,
      [email]
    );

    if (emailCheck.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Account with this email already exists" });
    }

    // 🔒 Check duplicate phone
    const phoneCheck = await client.query(
      `SELECT id FROM iam_users WHERE phone=$1 LIMIT 1`,
      [phone]
    );

    if (phoneCheck.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Account with this phone number already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    let organizationId;
    let role = "individual";

    // =====================================================
    // 1️⃣ ORGANIZATION REGISTRATION
    // =====================================================
    if (registrationType === "organization") {

      if (!organizationName || !organizationType || !orgEmail) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Organization details missing" });
      }

      if (!isProfessionalEmail(orgEmail)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Professional email required for organization" });
      }

      const orgInsertQ = `
        INSERT INTO organizations (
          name,
          type,
          status,
          cpu_quota,
          storage_quota,
          instance_quota,
          org_email,
          phone,
          city,
          state,
          country,
          pincode,
          requested_user_count,
          requested_cpu_quota,
          requested_storage_quota,
          requested_instance_quota,
          requested_subscription_months,   -- ✅ NEW COLUMN
          created_at
        )
        VALUES (
          $1,$2,'pending',
          0,0,0,
          $3,$4,$5,$6,$7,$8,
          $9,$10,$11,$12,
          $13,
          NOW()
        )
        RETURNING id
      `;

      const { rows: orgRows } = await client.query(orgInsertQ, [
        organizationName,
        organizationType,
        orgEmail,
        phone,
        city || null,
        state || null,
        country || null,
        pincode || null,
        requested_user_count || null,
        requested_cpu_quota || null,
        requested_storage_quota || null,
        requested_instance_quota || null,
        requested_subscription_months || null  // ✅ SAVE VALUE
      ]);

      organizationId = orgRows[0].id;
      role = "org_admin";

      const insertQ = `
        INSERT INTO iam_users (
          email,
          password_hash,
          role,
          organization_id,
          trial_start,
          trial_end,
          is_active,
          phone
        )
        VALUES ($1,$2,$3,$4,NULL,NULL,true,$5)
        RETURNING id,email,role,organization_id,created_at
      `;

      const { rows } = await client.query(insertQ, [
        email,
        hashed,
        role,
        organizationId,
        phone
      ]);

      await client.query("COMMIT");

      const user = rows[0];

      const token = signToken({
        id: user.id,
        email: user.email,
        role: user.role,
        organization_id: user.organization_id,
      });

      return res.json({
        message: "Organization registration submitted. Await admin approval.",
        user,
        token
      });
    }

    // =====================================================
    // 2️⃣ INDIVIDUAL REGISTRATION
    // =====================================================

    const orgInsertQ = `
      INSERT INTO organizations (
        name,
        type,
        status,
        cpu_quota,
        storage_quota,
        instance_quota,
        org_email,
        subscription_start,
        subscription_end
      )
      VALUES (
        $1,
        'individual',
        'approved',
        1,5,1,
        $2,
        NOW(),
        NOW() + INTERVAL '30 days'
      )
      RETURNING id
    `;

    const { rows: orgRows } = await client.query(orgInsertQ, [
      `Individual Account - ${email}`,
      email
    ]);

    organizationId = orgRows[0].id;

    const insertQ = `
      INSERT INTO iam_users (
        email,
        password_hash,
        role,
        organization_id,
        trial_start,
        trial_end,
        is_active,
        phone
      )
      VALUES (
        $1,$2,'individual',$3,
        NOW(),
        NOW() + INTERVAL '30 days',
        true,
        $4
      )
      RETURNING id,email,role,organization_id,created_at
    `;

    const { rows } = await client.query(insertQ, [
      email,
      hashed,
      organizationId,
      phone
    ]);

    await client.query("COMMIT");

    const user = rows[0];

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      organization_id: user.organization_id,
    });

    return res.json({ user, token });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("IAM register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// ============================================================
// ======================== LOGIN =============================
// ============================================================
router.post("/login", async (req, res) => {
  let { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }

  email = email.toLowerCase();

  try {
    const q = `
      SELECT id,email,password_hash,role,organization_id
      FROM iam_users
      WHERE email=$1
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [email]);

    if (!rows.length) return res.status(401).json({ error: "Invalid email or password" });

    const user = rows[0];

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      organization_id: user.organization_id,
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organization_id: user.organization_id,
      },
      token,
    });
  } catch (err) {
    console.error("IAM login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// ========================== ME ===============================
// ============================================================
router.get("/me", verifyIAMToken, async (req, res) => {
  try {
    const id = req.iam?.id;
    if (!id) return res.status(400).json({ error: "Invalid token payload" });

    const q = `
      SELECT
        u.id,
        u.email,
        u.role,
        u.organization_id,
        u.created_at,
        o.name AS organization_name,
        o.status AS organization_status
      FROM iam_users u
      JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = $1
      LIMIT 1
    `;

    const { rows } = await pool.query(q, [id]);

    if (!rows.length) return res.status(404).json({ error: "User not found" });

    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("IAM me error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;