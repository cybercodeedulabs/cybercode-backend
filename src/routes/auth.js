import express from "express";
import { pool } from "../db/db.js";
import { signUserToken } from "../middleware/auth.js";
import { verifyTokenMiddleware } from "../middleware/auth.js";
import fetch from "node-fetch"; // REQUIRED on Render

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL; 
const BACKEND_URL = process.env.BACKEND_URL;

// -------------------------------------------------------
// 1️⃣ LOGIN → Redirect user to Google
// -------------------------------------------------------
router.get("/google/login", (req, res) => {
  const redirectUri = `${BACKEND_URL}/auth/google/callback`;

  const oauthURL =
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&scope=openid%20email%20profile&prompt=select_account`;

  console.log("Redirecting to Google:", oauthURL);

  res.redirect(oauthURL);
});

// -------------------------------------------------------
// 2️⃣ GOOGLE CALLBACK → exchange code → issue JWT → redirect to frontend
// -------------------------------------------------------
router.get("/google/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    console.error("Missing ?code param");
    return res.redirect(`${FRONTEND_URL}/register?error=missing_code`);
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
      console.error("Google token exchange FAILED", tokenJson);
      return res.redirect(`${FRONTEND_URL}/register?error=token_failed`);
    }

    // Decode ID token
    const payload = JSON.parse(
      Buffer.from(tokenJson.id_token.split(".")[1], "base64").toString()
    );

    const uid = `google-${payload.sub}`;
    const name = payload.name || "";
    const email = payload.email;
    const photo = payload.picture || null;

    // UPSERT user
    const q = `
      INSERT INTO users (uid, name, email, photo)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (uid)
      DO UPDATE SET name = EXCLUDED.name, photo = EXCLUDED.photo
      RETURNING uid, name, email, photo, is_premium, created_at;
    `;
    const r = await pool.query(q, [uid, name, email, photo]);
    const userRow = r.rows[0];

    // Issue JWT
    const token = signUserToken({
      uid: userRow.uid,
      email: userRow.email,
      name: userRow.name,
      photo: userRow.photo,
    });

    console.log("Login SUCCESS → redirecting to frontend");

    return res.redirect(`${FRONTEND_URL}/auth-success?token=${token}`);

  } catch (err) {
    console.error("Google callback ERROR:", err);
    return res.redirect(`${FRONTEND_URL}/register?error=server_error`);
  }
});

// -------------------------------------------------------
// /auth/login (legacy fallback)
// -------------------------------------------------------
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
    const r = await pool.query(q, [uid, name || null, email, photo || null]);
    const userRow = r.rows[0];

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

// -------------------------------------------------------
router.get("/me", verifyTokenMiddleware, async (req, res) => {
  const uid = req.userToken?.uid;

  try {
    const q = `SELECT uid, name, email, photo, is_premium, created_at FROM users WHERE uid=$1`;
    const r = await pool.query(q, [uid]);

    if (r.rowCount === 0) return res.status(404).json({ error: "user not found" });

    res.json({ user: r.rows[0] });
  } catch (err) {
    console.error("/auth/me failed", err);
    res.status(500).json({ error: "failed" });
  }
});

export default router;
