// backend/src/routes/user.js
import express from "express";
import { pool } from "../db/db.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";

const router = express.Router();

// GET /user/:uid  — public (but typically called with token)
router.get("/:uid", async (req, res) => {
  const { uid } = req.params;
  if (!uid) return res.status(400).json({ error: "uid required" });

  try {
    const u = await pool.query("SELECT uid, name, email, photo, is_premium, has_certification_access, has_server_access, created_at FROM users WHERE uid=$1", [uid]);
    if (u.rowCount === 0) return res.status(404).json({ error: "user not found" });

    // fetch enrolled courses
    const enrolled = await pool.query("SELECT course_slug FROM enrolled_courses WHERE user_uid=$1", [uid]);
    const courses = enrolled.rows.map(r => r.course_slug);

    // projects — INCLUDE raw_json so frontend can hydrate full blueprint
    const proj = await pool.query("SELECT id, title, description, timestamp, raw_json, created_at FROM generated_projects WHERE user_uid=$1 ORDER BY created_at DESC", [uid]);

    res.json({
      user: u.rows[0],
      enrolledCourses: courses,
      projects: proj.rows,
    });
  } catch (err) {
    console.error("user/:uid failed", err);
    res.status(500).json({ error: "failed" });
  }
});

// POST /user/enroll
// Body: { courseSlug }
// Must be authenticated
router.post("/enroll", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  const { courseSlug } = req.body;
  if (!uid || !courseSlug) return res.status(400).json({ error: "missing fields" });

  try {
    await pool.query(
      `INSERT INTO enrolled_courses (user_uid, course_slug) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [uid, courseSlug]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("user/enroll failed", err);
    res.status(500).json({ error: "enroll failed" });
  }
});

export default router;
