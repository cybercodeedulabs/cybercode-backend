// backend/src/middleware/auth.js

import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

/* -------------------------------------------------------
   JWT CONFIG
-------------------------------------------------------- */
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change";
const TOKEN_EXPIRY = "7d"; // 🔐 Fixed expiry
const JWT_ISSUER = "cybercode";
const JWT_AUDIENCE = "cybercode-users";

/* -------------------------------------------------------
   SIGN JWT
-------------------------------------------------------- */
export function signUserToken(payload) {
  // payload should contain at least { uid, email, name }
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

/* -------------------------------------------------------
   VERIFY JWT MIDDLEWARE
-------------------------------------------------------- */
export function verifyTokenMiddleware(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = auth.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    req.userToken = decoded;
    return next();
  } catch (err) {
    console.error("JWT verification failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
