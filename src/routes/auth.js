// backend/src/routes/auth.js
import express from "express";
import { pool } from "../db/db.js";
import { signUserToken } from "../middleware/auth.js";

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

export default router;
