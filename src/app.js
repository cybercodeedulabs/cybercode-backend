// backend/src/app.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import { testConnection } from "./db/db.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import progressRoutes from "./routes/progress.js";
import projectRoutes from "./routes/projects.js";
import goalsRoutes from "./routes/goals.js";
import userDocsRoutes from "./routes/userDocs.js";

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

// startup DB test
testConnection().then(() => {
  console.log("DB test ok");
}).catch((e) => {
  console.warn("DB test failed (continue):", e?.message || e);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Cybercode backend running on port ${PORT}`);
});
