// formBackend - Node/Express for Render
// Accepts ANY form fields (JSON or standard HTML form posts) and delivers them via:
//   - Resend email API   (set RESEND_API_KEY + NOTIFY_EMAIL)   -> works on Render free tier
//   - Zapier webhook     (set ZAPIER_WEBHOOK_URL)              -> optional, needs paid Zapier
// Set one or both.

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const {
  RESEND_API_KEY,
  NOTIFY_EMAIL,
  SENDER_EMAIL = "onboarding@resend.dev",
  ZAPIER_WEBHOOK_URL,
  ALLOWED_ORIGIN,
} = process.env;

app.use(cors({ origin: ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELDS = 50;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Flatten whatever was submitted into { key: string }
function normalize(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {}).slice(0, MAX_FIELDS)) {
    if (k.startsWith("_")) continue; // reserved/control fields like _subject, _honey
    const val = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
    if (val.trim() !== "") out[k] = val.trim().slice(0, 5000);
  }
  return out;
}

async function sendResend(fields, subject) {
  const emailField = Object.entries(fields).find(([k, v]) => /e-?mail/i.test(k) && EMAIL_RE.test(v));
  const rows = Object.entries(fields)
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0"><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join("");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Form Bot <${SENDER_EMAIL}>`,
      to: [NOTIFY_EMAIL],
      ...(emailField && { reply_to: emailField[1] }),
      subject,
      html: `<h2>${escapeHtml(subject)}</h2><table>${rows}</table><p><em>${new Date().toISOString()}</em></p>`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function sendZapier(fields, meta) {
  const res = await fetch(ZAPIER_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...fields, ...meta }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Zapier ${res.status}: ${await res.text()}`);
}

app.get("/", (_req, res) => res.send("form-backend is running"));

app.post("/formBackend", async (req, res) => {
  const useResend = RESEND_API_KEY && NOTIFY_EMAIL;
  if (!useResend && !ZAPIER_WEBHOOK_URL) {
    return res.status(500).json({ success: false, error: "Server is not configured." });
  }

  // Honeypot: bots fill hidden "_honey" field; pretend success
  if (req.body && req.body._honey) return res.status(201).json({ success: true });

  const fields = normalize(req.body);
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ success: false, errors: ["No form data received."] });
  }
  // Only validate an email if the form actually has one
  const badEmail = Object.entries(fields).find(([k, v]) => /^e-?mail$/i.test(k) && !EMAIL_RE.test(v));
  if (badEmail) {
    return res.status(400).json({ success: false, errors: [`"${badEmail[0]}" is not a valid email address.`] });
  }

  const subject = (req.body._subject && String(req.body._subject).slice(0, 150)) || "New form submission";
  const meta = { submitted_at: new Date().toISOString(), source_origin: req.get("origin") || null };

  const jobs = [];
  if (useResend) jobs.push(sendResend(fields, subject));
  if (ZAPIER_WEBHOOK_URL) jobs.push(sendZapier(fields, meta));

  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === "rejected");
  failed.forEach((f) => console.error("Delivery error:", f.reason.message));

  if (failed.length === results.length) {
    return res.status(502).json({ success: false, error: "Failed to deliver submission." });
  }
  res.status(201).json({ success: true, message: "Form submitted successfully." });
});

app.listen(PORT, () => console.log(`form-backend listening on ${PORT}`));
