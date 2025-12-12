// backend/src/db/db.js
import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";
dotenv.config();

/**
 * ==============================================================
 * CYBERCODE DATABASE CONNECTION (FINAL VERSION)
 * --------------------------------------------------------------
 * PRIORITY:
 *   1) Use DATABASE_URL (Render / production)
 *   2) Else fallback to local PG_* vars (optional for dev)
 *
 * This ensures:
 *   - No breaking changes to existing routes (auth, enroll, goals…)
 *   - Cloud APIs work correctly
 *   - Local dev does NOT crash if PostgreSQL is not running
 * ============================================================== 
 */

let pool;

if (process.env.DATABASE_URL) {
  // ---- PRODUCTION / RENDER MODE ----
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 10,
  });

  console.log("📡 DB: Using Render DATABASE_URL");
} else {
  // ---- LOCAL DEVELOPMENT MODE ----
  pool = new Pool({
    user: process.env.PG_USER || "cybercode",
    host: process.env.PG_HOST || "localhost",
    database: process.env.PG_DATABASE || "cybercode_db",
    password: process.env.PG_PASSWORD || "supersecurepassword",
    port: Number(process.env.PG_PORT || 5432),
    max: 10,
  });

  console.log("💻 DB: Using Local PostgreSQL Configuration");
}

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

/**
 * Simple test query run at server startup.
 * Used in /src/app.js to confirm DB connectivity.
 */
export async function testConnection() {
  try {
    const r = await pool.query("SELECT NOW() as now");
    return r.rows[0];
  } catch (err) {
    console.error("🔴 PG test failed:", err);
    throw err;
  }
}

export { pool };
