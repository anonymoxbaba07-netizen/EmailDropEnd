// formBackend - Node/Express for Render
// Emails are sent over HTTPS (Resend API) because Render's free tier blocks SMTP ports.

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const { RESEND_API_KEY, NOTIFY_EMAIL, SENDER_EMAIL = "onboarding@resend.dev" } = process.env;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function validateFormData({ name, email, message }) {
  const errors = [];
  if (!name || name.trim().length < 2) errors.push("Name must be at least 2 characters.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("A valid email address is required.");
  if (!message || message.trim().length < 10) errors.push("Message must be at least 10 characters.");
  return errors;
}

async function sendEmail({ name, email, message }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Form Bot <${SENDER_EMAIL}>`,
      to: [NOTIFY_EMAIL],
      reply_to: email,
      subject: `New Form Submission from ${name}`,
      html: `
        <h2>New Submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Message:</strong> ${escapeHtml(message)}</p>
        <p><em>Submitted at ${new Date().toISOString()}</em></p>`,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}

app.get("/", (_req, res) => res.send("form-backend is running"));

app.post("/formBackend", async (req, res) => {
  const { name, email, message } = req.body || {};
  const errors = validateFormData({ name, email, message });
  if (errors.length) return res.status(400).json({ success: false, errors });

  try {
    await sendEmail({ name, email, message });
    res.status(201).json({ success: true, message: "Form submitted successfully." });
  } catch (err) {
    console.error("Email error:", err.message);
    res.status(500).json({ success: false, error: "Failed to send email." });
  }
});

app.listen(PORT, () => console.log(`form-backend listening on ${PORT}`));
