// backend/src/routes/workshop.js

import express from "express";
import { pool } from "../db/db.js";
import { sendMail } from "../services/mailer.js";

const router = express.Router();

/**
 * POST /api/workshop/register
 * Public endpoint (no auth required)
 */
router.post("/register", async (req, res) => {
  const {
    name,
    email,
    countryCode,
    phone,
    college,
    department,
    year,
  } = req.body;

  // 🔎 Basic Validation (trim-safe validation)
  if (
    !name?.trim() ||
    !email?.trim() ||
    !countryCode?.trim() ||
    !phone?.trim() ||
    !college?.trim() ||
    !department?.trim() ||
    !year?.trim()
  ) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // 🔐 Insert into DB
    await pool.query(
      `
      INSERT INTO workshop_registrations
      (name, email, country_code, phone, college, department, year)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        name.trim(),
        email.trim().toLowerCase(),
        countryCode.trim(),
        phone.trim(),
        college.trim(),
        department.trim(),
        year.trim(),
      ]
    );

    // 📧 Send Confirmation Email (Non-blocking, does not affect registration)
    sendMail({
      to: email.trim().toLowerCase(),
      subject: "Workshop Registration Confirmed - Cybercode Space Research Labs",
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:Arial,Helvetica,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 0;">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:12px;overflow:hidden;box-shadow:0 0 40px rgba(0,0,0,0.6);">

          <!-- Banner -->
<tr>
  <td style="background:#0b1220;padding:25px;text-align:center;">
    <img src="https://cybercodeedulabs.com/images/c3-space-research-logo.png"
         alt="Cybercode Space Research"
         style="max-width:180px;display:block;margin:0 auto 15px auto;" />
    <h1 style="color:#ffffff;margin:0;font-size:22px;letter-spacing:1px;">
      CYBERCODE SPACE RESEARCH LABS
    </h1>
  </td>
</tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;color:#e5e7eb;">

              <h2 style="color:#6366f1;margin-top:0;">
                Registration Confirmed
              </h2>

              <p>
                Dear <strong>${name.trim()}</strong>,
              </p>

              <p>
                Your registration has been successfully confirmed for the following workshop:
              </p>

              <div style="background:#1f2937;padding:20px;border-radius:8px;margin:25px 0;">
                <h3 style="margin:0;color:#facc15;">
                  3-Day Flagship Workshop
                </h3>
                <p style="margin:8px 0 0 0;font-weight:bold;">
                  From Code to Cosmos – Build Secure & Intelligent Systems
                </p>
                <p style="margin:10px 0 0 0;">
                  <strong>Date:</strong> April 06–08, 2026
                </p>
              </div>

              <p>
                Further details regarding schedule and session access will be shared prior to the workshop.
              </p>

              <p style="margin-top:30px;">
                Regards,<br/>
                Cybercode EduLabs Team
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0b1220;padding:20px;text-align:center;color:#64748b;font-size:12px;">
              © 2026 Cybercode EduLabs. All rights reserved.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`
    }).catch((mailError) => {
      console.error(
        "Email sending failed but registration saved:",
        mailError.message
      );
    });

    return res.status(201).json({
      success: true,
      message: "Workshop registration successful",
    });

  } catch (err) {
    console.error("Workshop registration failed:", err);

    // 🔥 Handle Duplicate Email (Postgres UNIQUE violation)
    if (err.code === "23505") {
      return res.status(409).json({
        error: "This email is already registered",
      });
    }

    return res.status(500).json({
      error: "Server error",
    });
  }
});

export default router;