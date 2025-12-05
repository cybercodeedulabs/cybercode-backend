// backend/src/routes/goals.js
import express from "express";
import { pool } from "../db/db.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";

const router = express.Router();

// POST /goals/save  { hoursPerWeek }
router.post("/save", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  const { hoursPerWeek } = req.body;
  if (!uid) return res.status(400).json({ error: "auth required" });

  try {
    await pool.query(
      `INSERT INTO user_goals (user_uid, hours_per_week, updated_at, created_at)
       VALUES ($1,$2,NOW(),NOW())
       ON CONFLICT (user_uid) DO UPDATE SET hours_per_week = EXCLUDED.hours_per_week, updated_at = NOW()`,
      [uid, Number(hoursPerWeek) || 2]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("goals/save failed", err);
    res.status(500).json({ error: "failed" });
  }
});

// GET /goals/me
router.get("/me", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  try {
    const r = await pool.query(`SELECT hours_per_week, updated_at, created_at FROM user_goals WHERE user_uid=$1`, [uid]);
    res.json({ goals: r.rows[0] || null });
  } catch (err) {
    console.error("goals/me failed", err);
    res.status(500).json({ error: "failed" });
  }
});

export default router;
