// backend/src/routes/iam.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
// import { Pool } from "pg";
import { pool } from "../db/db.js"

const router = express.Router();

// const { DATABASE_URL, JWT_SECRET, NODE_ENV } = process.env;
const { JWT_SECRET, NODE_ENV } = process.env;
// Hard fail if JWT is missing in production
if (!JWT_SECRET && NODE_ENV === "production") {
  throw new Error("FATAL: JWT_SECRET missing in production environment");
}

// PostgreSQL Pool
// const pool = new Pool({
//   connectionString: DATABASE_URL,
//   ssl: NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
// });

// -------- Helper functions --------
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET || "dev_jwt_secret", { expiresIn: "7d" });
}

// Middleware to extract + verify token
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

// -------- Register --------
router.post("/register", async (req, res) => {
  let { email, password, role } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }

  email = email.toLowerCase();

  // prevent client choosing "admin" roles
  const safeRole = role === "admin" ? "developer" : (role || "developer");

  try {
    // Check duplicate
    const checkQ = `SELECT id FROM iam_users WHERE email=$1 LIMIT 1`;
    const { rows: exists } = await pool.query(checkQ, [email]);
    if (exists.length) return res.status(409).json({ error: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);

    const insertQ = `
      INSERT INTO iam_users (email,password_hash,role)
      VALUES ($1,$2,$3)
      RETURNING id,email,role,created_at
    `;
    const { rows } = await pool.query(insertQ, [email, hashed, safeRole]);
    const user = rows[0];

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    return res.json({ user, token });
  } catch (err) {
    console.error("IAM register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// -------- Login --------
router.post("/login", async (req, res) => {
  let { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }

  email = email.toLowerCase();

  try {
    const q = `
      SELECT id,email,password_hash,role
      FROM iam_users
      WHERE email=$1
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [email]);

    if (!rows.length) return res.status(401).json({ error: "Invalid email or password" });

    const user = rows[0];

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    return res.json({
      user: { id: user.id, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    console.error("IAM login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// -------- Me --------
router.get("/me", verifyIAMToken, async (req, res) => {
  try {
    const id = req.iam?.id;
    if (!id) return res.status(400).json({ error: "Invalid token payload" });

    const q = `
      SELECT id,email,role,created_at
      FROM iam_users
      WHERE id=$1
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