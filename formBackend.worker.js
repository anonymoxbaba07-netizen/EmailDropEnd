// formBackend - Cloudflare Workers
// Deploy with: npx wrangler deploy

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/formBackend") {
      return new Response("Not Found", { status: 404 });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ─── POST /formBackend ──────────────────────────────────────────────────
    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { success: false, errors: ["Invalid JSON body."] },
          { status: 400, headers: corsHeaders }
        );
      }

      const { name, email, message } = body;

      // 1. Validate
      const errors = validateFormData({ name, email, message });
      if (errors.length > 0) {
        return Response.json(
          { success: false, errors },
          { status: 400, headers: corsHeaders }
        );
      }

      try {
        // 2. Send email via Nodemailer-compatible SMTP using fetch (MailChannels)
        //    Cloudflare Workers supports MailChannels for free transactional email
        await sendEmail({ name, email, message }, env);

        return Response.json(
          { success: true, message: "Form submitted successfully." },
          { status: 201, headers: corsHeaders }
        );
      } catch (err) {
        return Response.json(
          { success: false, error: "Failed to send email. " + err.message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return Response.json(
      { success: false, error: "Method not allowed." },
      { status: 405, headers: corsHeaders }
    );
  },
};

// ─── Validation ───────────────────────────────────────────────────────────────
function validateFormData({ name, email, message }) {
  const errors = [];
  if (!name || name.trim().length < 2)
    errors.push("Name must be at least 2 characters.");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email))
    errors.push("A valid email address is required.");
  if (!message || message.trim().length < 10)
    errors.push("Message must be at least 10 characters.");
  return errors;
}

// ─── Email via MailChannels (free on Cloudflare Workers) ──────────────────────
async function sendEmail({ name, email, message }, env) {
  const payload = {
    personalizations: [
      {
        to: [{ email: env.NOTIFY_EMAIL }],
      },
    ],
    from: { email: env.SENDER_EMAIL, name: "Form Bot" },
    subject: `New Form Submission from ${name}`,
    content: [
      {
        type: "text/html",
        value: `
          <h2>New Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong> ${message}</p>
          <p><em>Submitted at ${new Date().toLocaleString()}</em></p>
        `,
      },
    ],
  };

  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error);
  }
}
