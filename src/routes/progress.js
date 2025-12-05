// backend/src/routes/progress.js
import express from "express";
import { pool } from "../db/db.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";

const router = express.Router();

// POST /progress/complete-lesson
// Body: { courseSlug, lessonSlug }
router.post("/complete-lesson", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  const { courseSlug, lessonSlug } = req.body;
  if (!uid || !courseSlug || !lessonSlug) return res.status(400).json({ error: "missing fields" });

  try {
    await pool.query(
      `INSERT INTO course_progress (user_uid, course_slug, lesson_slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [uid, courseSlug, lessonSlug]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("progress/complete-lesson failed", err);
    res.status(500).json({ error: "failed" });
  }
});

// POST /progress/study-session
// Body: { courseSlug, lessonSlug, minutes }
router.post("/study-session", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  const { courseSlug, lessonSlug, minutes } = req.body;
  if (!uid || !courseSlug || !lessonSlug || !Number.isFinite(Number(minutes))) return res.status(400).json({ error: "missing fields" });

  try {
    await pool.query(
      `INSERT INTO study_sessions (user_uid, course_slug, lesson_slug, minutes) VALUES ($1, $2, $3, $4)`,
      [uid, courseSlug, lessonSlug, Number(minutes)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("progress/study-session failed", err);
    res.status(500).json({ error: "failed" });
  }
});

export default router;
