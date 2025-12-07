// backend/src/routes/auth.js
import express from "express";
import { pool } from "../db/db.js";
import { signUserToken } from "../middleware/auth.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /auth/login
 * Body: { uid, name, email, photo }
 * Upserts into users table and returns a JWT + user row.
 */
router.post("/login", async (req, res) => {
  const { uid, name, email, photo } = req.body;
  if (!uid || !email) return res.status(400).json({ error: "uid and email required" });

  try {
    const q = `
      INSERT INTO users (uid, name, email, photo)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (uid)
      DO UPDATE SET name = EXCLUDED.name, photo = EXCLUDED.photo
      RETURNING uid, name, email, photo, is_premium, created_at;
    `;

    const result = await pool.query(q, [uid, name || null, email, photo || null]);
    const userRow = result.rows[0];

    const token = signUserToken({
      uid: userRow.uid,
      email: userRow.email,
      name: userRow.name,
      photo: userRow.photo,
    });

    res.json({ user: userRow, token });
  } catch (err) {
    console.error("auth/login failed", err);
    res.status(500).json({ error: "login failed" });
  }
});

/**
 * GET /auth/me
 * Protected. Returns the user row based on token.
 * Useful for client-side hydration when token exists.
 */
router.get("/me", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  if (!uid) return res.status(400).json({ error: "invalid token payload" });

  try {
    const q = `SELECT uid, name, email, photo, is_premium, has_certification_access, has_server_access, created_at FROM users WHERE uid = $1`;
    const r = await pool.query(q, [uid]);
    if (r.rowCount === 0) return res.status(404).json({ error: "user not found" });
    return res.json({ user: r.rows[0] });
  } catch (err) {
    console.error("auth/me failed", err);
    return res.status(500).json({ error: "failed" });
  }
});

export default router;
