// backend/src/routes/projects.js
import express from "express";
import { pool } from "../db/db.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * ---------------------------------------------------------
 * POST /projects/save
 * Body: { title, description, rawJson }
 * Saves AI-generated project for the logged-in user
 * ---------------------------------------------------------
 */
router.post("/save", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  const { title, description, rawJson } = req.body;

  if (!uid) return res.status(400).json({ error: "auth required" });

  try {
    const q = `
      INSERT INTO generated_projects (user_uid, title, description, raw_json, timestamp)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;

    const ts = Date.now();
    const r = await pool.query(q, [
      uid,
      title || null,
      description || null,
      rawJson ? JSON.stringify(rawJson) : null,
      ts
    ]);

    res.json({ success: true, id: r.rows[0].id });
  } catch (err) {
    console.error("projects/save failed", err);
    res.status(500).json({ error: "failed" });
  }
});

/**
 * ---------------------------------------------------------
 * GET /projects/me
 * Returns all AI-generated projects for logged-in user
 * ---------------------------------------------------------
 */
router.get("/me", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;

  try {
    const r = await pool.query(
      `SELECT id, title, description, timestamp, raw_json, created_at 
       FROM generated_projects 
       WHERE user_uid=$1 
       ORDER BY created_at DESC`,
      [uid]
    );

    res.json({ projects: r.rows });
  } catch (err) {
    console.error("projects/me failed", err);
    res.status(500).json({ error: "failed" });
  }
});

/**
 * ---------------------------------------------------------
 * DELETE /projects/:id
 * Deletes a project owned by the logged-in user
 * ---------------------------------------------------------
 */
router.delete("/:id", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  const { id } = req.params;

  if (!uid) return res.status(400).json({ error: "auth required" });

  try {
    // Verify project ownership
    const check = await pool.query(
      `SELECT id FROM generated_projects WHERE id=$1 AND user_uid=$2`,
      [id, uid]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ error: "project not found or unauthorized" });
    }

    // Delete project
    await pool.query(`DELETE FROM generated_projects WHERE id=$1`, [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("projects/delete failed", err);
    res.status(500).json({ error: "failed" });
  }
});

export default router;
