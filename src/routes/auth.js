// backend/src/routes/auth.js
import express from "express";
import { pool } from "../db/db.js";
import { signUserToken } from "../middleware/auth.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";

import fetch from "node-fetch";

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL; // https://cybercodeedulabs-platform.netlify.app
const BACKEND_URL = process.env.BACKEND_URL;   // e.g., https://cybercode-backend.onrender.com

// --------------------------------------
// 1️⃣ GOOGLE REDIRECT LOGIN ENDPOINT
// --------------------------------------
router.get("/google/login", (req, res) => {
  const redirectUri = `${BACKEND_URL}/auth/google/callback`;

  const oauthURL =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=openid%20email%20profile` +
    `&prompt=select_account`;

  return res.redirect(oauthURL);
});

// --------------------------------------
// 2️⃣ GOOGLE OAUTH CALLBACK HANDLER
// --------------------------------------
router.get("/google/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.redirect(`${FRONTEND_URL}/login?error=missing_code`);
  }

  try {
    const redirectUri = `${BACKEND_URL}/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch(`https://oauth2.googleapis.com/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenJson.id_token) {
      console.error("Token exchange failed", tokenJson);
      return res.redirect(`${FRONTEND_URL}/login?error=token_failed`);
    }

    // Decode Google ID token (basic decode)
    const idToken = tokenJson.id_token;
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64").toString()
    );

    const uid = `google-${payload.sub}`;
    const name = payload.name || "";
    const email = payload.email;
    const photo = payload.picture || null;

    // Upsert user in DB
    const q = `
      INSERT INTO users (uid, name, email, photo)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (uid)
      DO UPDATE SET name = EXCLUDED.name, photo = EXCLUDED.photo
      RETURNING uid, name, email, photo, is_premium, created_at;
    `;

    const result = await pool.query(q, [uid, name, email, photo]);
    const userRow = result.rows[0];

    // Create JWT
    const token = signUserToken({
      uid: userRow.uid,
      email: userRow.email,
      name: userRow.name,
      photo: userRow.photo,
    });

    // Redirect user back to frontend with JWT
    return res.redirect(`${FRONTEND_URL}/auth-success?token=${token}`);

  } catch (err) {
    console.error("Google callback error:", err);
    return res.redirect(`${FRONTEND_URL}/login?error=server_error`);
  }
});

// --------------------------------------
// Existing POST /auth/login (kept as-is)
// --------------------------------------
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

// --------------------------------------
// GET /auth/me  (unchanged)
// --------------------------------------
router.get("/me", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;
  if (!uid) return res.status(400).json({ error: "invalid token payload" });

  try {
    const q =
      `SELECT uid, name, email, photo, is_premium, has_certification_access, has_server_access, created_at 
       FROM users WHERE uid = $1`;
    const r = await pool.query(q, [uid]);
    if (r.rowCount === 0) return res.status(404).json({ error: "user not found" });
    return res.json({ user: r.rows[0] });
  } catch (err) {
    console.error("auth/me failed", err);
    return res.status(500).json({ error: "failed" });
  }
});

export default router;
