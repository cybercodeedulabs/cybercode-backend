// backend/src/db/db.js
import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";
dotenv.config();

export const pool = new Pool({
  user: process.env.PG_USER || "cybercode",
  host: process.env.PG_HOST || "localhost",
  database: process.env.PG_DATABASE || "cybercode_db",
  password: process.env.PG_PASSWORD || "supersecurepassword",
  port: Number(process.env.PG_PORT || 5432),
  max: 10,
});

pool.on("error", (err) => {
  console.error("Unexpected PG error:", err);
});

export async function testConnection() {
  try {
    const r = await pool.query("SELECT 1 as ok");
    return r.rows[0];
  } catch (err) {
    console.error("PG test failed:", err);
    throw err;
  }
}
