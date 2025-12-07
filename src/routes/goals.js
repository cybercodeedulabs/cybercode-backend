// backend/src/routes/goals.js
import express from "express";
import { pool } from "../db/db.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /goals/save 
 * Accepts FULL goal object:
 * {
 *  currentStatus,
 *  motivation,
 *  targetRole,
 *  salaryExpectation,
 *  hoursPerWeek,
 *  deadlineMonths,
 *  learningStyle,
 *  skills: { programming, cloud, networking, cybersecurity, softSkills }
 * }
 */
router.post("/save", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  if (!uid) return res.status(400).json({ error: "auth required" });

  const {
    currentStatus = "",
    motivation = "",
    targetRole = "",
    salaryExpectation = "",
    hoursPerWeek = 6,
    deadlineMonths = 6,
    learningStyle = "",
    skills = {}
  } = req.body;

  try {
    await pool.query(
      `
      INSERT INTO user_goals 
      (user_uid, current_status, motivation, target_role, salary_expectation,
       hours_per_week, deadline_months, learning_style, skills_json,
       updated_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
      ON CONFLICT (user_uid) DO UPDATE SET
        current_status = EXCLUDED.current_status,
        motivation = EXCLUDED.motivation,
        target_role = EXCLUDED.target_role,
        salary_expectation = EXCLUDED.salary_expectation,
        hours_per_week = EXCLUDED.hours_per_week,
        deadline_months = EXCLUDED.deadline_months,
        learning_style = EXCLUDED.learning_style,
        skills_json = EXCLUDED.skills_json,
        updated_at = NOW()
      `,
      [
        uid,
        currentStatus,
        motivation,
        targetRole,
        salaryExpectation,
        Number(hoursPerWeek),
        Number(deadlineMonths),
        learningStyle,
        skills ? JSON.stringify(skills) : "{}",
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("goals/save failed", err);
    res.status(500).json({ error: "failed" });
  }
});

/**
 * GET /goals/me
 * Returns full structured goal object
 */
router.get("/me", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;

  try {
    const r = await pool.query(
      `
      SELECT 
        current_status AS "currentStatus",
        motivation,
        target_role AS "targetRole",
        salary_expectation AS "salaryExpectation",
        hours_per_week AS "hoursPerWeek",
        deadline_months AS "deadlineMonths",
        learning_style AS "learningStyle",
        skills_json AS "skills",
        updated_at,
        created_at
      FROM user_goals
      WHERE user_uid = $1
      `,
      [uid]
    );

    const row = r.rows[0] || null;

    // row.skills may already be an object (JSONB) or a string.
    if (row && row.skills) {
      if (typeof row.skills === "string") {
        try {
          row.skills = JSON.parse(row.skills);
        } catch {
          row.skills = {};
        }
      } else if (typeof row.skills === "object") {
        // already OK
      } else {
        row.skills = {};
      }
    }

    res.json({ goals: row });
  } catch (err) {
    console.error("goals/me failed", err);
    res.status(500).json({ error: "failed" });
  }
});

export default router;
