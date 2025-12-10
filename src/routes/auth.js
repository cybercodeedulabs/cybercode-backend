// backend/src/routes/auth.js
import express from "express";
import { pool } from "../db/db.js";
import { signUserToken } from "../middleware/auth.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";
// import fetch from "node-fetch"; // needed for Google token exchange

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

/* -------------------------------------------------------------
   GOOGLE REDIRECT LOGIN (MOBILE FRIENDLY)
--------------------------------------------------------------*/

/**
 * GET /auth/google/callback
 * Google redirects here with: ?code=...&state=...
 */
router.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;

    if (!code) {
      return res.status(400).send("Missing Google OAuth code.");
    }

    // Decode state (optional)
    let redirectAfterLogin = null;
    try {
      if (state) {
        const parsed = JSON.parse(Buffer.from(state, "base64").toString());
        redirectAfterLogin = parsed.redirect || null;
      }
    } catch {}

    // Exchange code → tokens from Google
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${process.env.FRONTEND_URL}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenJson.id_token) {
      console.error("Google token exchange failed:", tokenJson);
      return res.status(400).send("Google login failed.");
    }

    // Decode the ID token (contains name, email, picture)
    const idToken = tokenJson.id_token;
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64").toString()
    );

    const googleUid = `google-${payload.sub}`;
    const userEmail = payload.email;
    const userName = payload.name;
    const userPhoto = payload.picture;

    // Store or update user
    const q = `
      INSERT INTO users (uid, name, email, photo)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (uid)
      DO UPDATE SET name = EXCLUDED.name, photo = EXCLUDED.photo
      RETURNING uid, name, email, photo, is_premium, created_at;
    `;

    const result = await pool.query(q, [
      googleUid,
      userName || null,
      userEmail,
      userPhoto || null,
    ]);

    const userRow = result.rows[0];

    // Sign JWT
    const token = signUserToken({
      uid: userRow.uid,
      email: userRow.email,
      name: userRow.name,
      photo: userRow.photo,
    });

    // Redirect back to frontend
    const target =
      redirectAfterLogin ||
      "/dashboard";

    const redirectUrl = `${process.env.FRONTEND_URL}/auth/success?token=${encodeURIComponent(
      token
    )}&uid=${encodeURIComponent(userRow.uid)}&redirect=${encodeURIComponent(
      target
    )}`;

    return res.redirect(redirectUrl);
  } catch (err) {
    console.error("Google callback error:", err);
    return res.status(500).send("Google authentication failed.");
  }
});

export default router;
