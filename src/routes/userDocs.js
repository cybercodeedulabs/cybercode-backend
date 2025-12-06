// backend/src/routes/userDocs.js
import express from "express";
import { pool } from "../db/db.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * Persona endpoints
 * GET  /persona/:uid           -> returns { scores }
 * POST /persona                -> body { uid, scores } upserts
 */
router.get("/persona/:uid", verifyTokenMiddleware, async (req, res) => {
  const { uid } = req.params;
  if (!uid) return res.status(400).json({ error: "uid required" });

  try {
    const r = await pool.query(
      `SELECT scores, updated_at FROM user_persona_scores WHERE user_uid=$1`,
      [uid]
    );
    return res.json({ scores: r.rows[0]?.scores || {}, updatedAt: r.rows[0]?.updated_at || null });
  } catch (err) {
    console.error("userDocs GET persona failed", err);
    return res.status(500).json({ error: "failed" });
  }
});

router.post("/persona", verifyTokenMiddleware, async (req, res) => {
  const { uid, scores } = req.body;
  if (!uid || typeof scores === "undefined") return res.status(400).json({ error: "missing fields" });

  try {
    await pool.query(
      `INSERT INTO user_persona_scores (user_uid, scores, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_uid) DO UPDATE SET scores = $2, updated_at = NOW()`,
      [uid, scores]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("userDocs POST persona failed", err);
    return res.status(500).json({ error: "failed" });
  }
});

/**
 * User documents endpoints
 * GET  /docs/:uid/:key        -> returns { doc }
 * POST /docs                  -> body { uid, key, doc } upserts
 */
router.get("/docs/:uid/:key", verifyTokenMiddleware, async (req, res) => {
  const { uid, key } = req.params;
  if (!uid || !key) return res.status(400).json({ error: "missing fields" });

  try {
    const r = await pool.query(
      `SELECT doc, created_at, updated_at FROM user_documents WHERE user_uid=$1 AND doc_key=$2`,
      [uid, key]
    );
    return res.json({ doc: r.rows[0]?.doc || {}, createdAt: r.rows[0]?.created_at || null, updatedAt: r.rows[0]?.updated_at || null });
  } catch (err) {
    console.error("userDocs GET docs failed", err);
    return res.status(500).json({ error: "failed" });
  }
});

router.post("/docs", verifyTokenMiddleware, async (req, res) => {
  const { uid, key, doc } = req.body;
  if (!uid || !key || typeof doc === "undefined") return res.status(400).json({ error: "missing fields" });

  try {
    await pool.query(
      `INSERT INTO user_documents (user_uid, doc_key, doc, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (user_uid, doc_key) DO UPDATE SET doc = $3, updated_at = NOW()`,
      [uid, key, doc]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("userDocs POST docs failed", err);
    return res.status(500).json({ error: "failed" });
  }
});

/**
 * Activity logging (light)
 * POST /activity -> body { uid, eventType, meta }
 */
router.post("/activity", verifyTokenMiddleware, async (req, res) => {
  const { uid, eventType, meta } = req.body;
  if (!uid || !eventType) return res.status(400).json({ error: "missing fields" });

  try {
    await pool.query(
      `INSERT INTO user_activity (user_uid, event_type, meta, created_at) VALUES ($1, $2, $3, NOW())`,
      [uid, eventType, meta || {}]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("userDocs POST activity failed", err);
    return res.status(500).json({ error: "failed" });
  }
});

export default router;
