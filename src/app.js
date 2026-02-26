// backend/src/app.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
//dotenv.config();

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});
console.log("ENV PATH:", path.resolve(__dirname, "../.env"));

import { testConnection } from "./db/db.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import progressRoutes from "./routes/progress.js";
import projectRoutes from "./routes/projects.js";
import goalsRoutes from "./routes/goals.js";
import userDocsRoutes from "./routes/userDocs.js";
import iamRoutes from "./routes/iam.js";
import cloudRoutes from "./cloud/routes/cloud.js";
import http from "http";
import { initTerminalServer } from "./cloud/terminalServer.js";
import adminRoutes from "./routes/admin.js";


const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));

app.use(express.json());

// basic health
app.get("/", (req, res) => res.json({ status: "Cybercode API running" }));

// 🔥 Render Health Check Endpoint
app.get("/healthz", (req, res) => res.send("OK"));

app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/userdocs", userDocsRoutes);
app.use("/progress", progressRoutes);
app.use("/projects", projectRoutes);
app.use("/goals", goalsRoutes);
app.use("/api/iam", iamRoutes);
app.use("/api/cloud", cloudRoutes);
app.use("/api/admin", adminRoutes);

// startup DB test
testConnection().then(() => {
  console.log("DB test ok");
}).catch((e) => {
  console.warn("DB test failed (continue):", e?.message || e);
});

const PORT = process.env.PORT || 4000;

// Create HTTP server
const server = http.createServer(app);

// Attach WebTerminal WebSocket
initTerminalServer(server);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Cybercode backend running on port ${PORT}`);
});