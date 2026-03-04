import sgMail from "@sendgrid/mail";

// Set API Key from environment
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Only test connection (SendGrid doesn't support verify like SMTP)
// So we simulate by checking API key existence
export async function verifySMTP() {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error("SENDGRID_API_KEY not found in environment variables");
    }

    console.log("✅ SendGrid API Key loaded successfully");
  } catch (err) {
    console.error("❌ SendGrid Verification Failed:", err.message);
  }
}

export async function sendMail({ to, subject, html }) {
  try {
    const msg = {
      to,
      from: process.env.MAIL_FROM, // Must be verified sender/domain
      subject,
      html,
    };

    await sgMail.send(msg);

    console.log("✅ Email sent to:", to);
  } catch (err) {
    console.error(
      "❌ Email sending failed:",
      err.response?.body || err.message
    );
  }
}