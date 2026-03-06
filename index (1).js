const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const nodemailer = require("nodemailer");

const GMAIL_USER  = "mike@altsfundlink.com";
const GMAIL_PASS  = "rlpjbvuiezxdbxsk";
const ADMIN_EMAIL = "mike@altsfundlink.com";
const ADMIN_URL   = "https://mfaciman.github.io/platform/admin.html";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

// ── FUNCTION 1: Notify admin when new user registers ──────────────────────────
exports.notifyAdminOnRegistration = onDocumentCreated("users/{uid}", async (event) => {
  const user = event.data.data();

  if (user.status !== "pending") return null;

  const { displayName, email, firmName, bdAffiliation, phone } = user;

  const mailOptions = {
    from: `"Alts Fund Link" <${GMAIL_USER}>`,
    to: ADMIN_EMAIL,
    subject: `New AFL Registration — ${displayName} (${firmName || "No firm"})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a2035; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #c9a84c; margin: 0; font-size: 22px;">ALTS FUND LINK</h1>
          <p style="color: #8892b0; margin: 4px 0 0;">New Registration Pending Approval</p>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #666; width: 140px;"><strong>Name</strong></td>
              <td style="padding: 8px 0; color: #222;">${displayName || "–"}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>Email</strong></td>
              <td style="padding: 8px 0; color: #222;">${email || "–"}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>Firm</strong></td>
              <td style="padding: 8px 0; color: #222;">${firmName || "–"}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>BD Affiliation</strong></td>
              <td style="padding: 8px 0; color: #222;">${bdAffiliation || "–"}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>Phone</strong></td>
              <td style="padding: 8px 0; color: #222;">${phone || "–"}</td>
            </tr>
          </table>
          <div style="margin-top: 24px; text-align: center;">
            <a href="${ADMIN_URL}"
               style="background: #c9a84c; color: #1a2035; padding: 12px 32px; border-radius: 6px;
                      text-decoration: none; font-weight: bold; font-size: 15px; display: inline-block;">
              Review in Admin Panel →
            </a>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 20px; text-align: center;">
            Alts Fund Link · For authorized use only
          </p>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Admin notification sent for new user: ${email}`);
  } catch (err) {
    console.error("Failed to send admin notification email:", err);
  }

  return null;
});

// ── FUNCTION 2: Send status email to user on approve/reject ───────────────────
exports.sendUserStatusEmail = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const { to, subject, html } = req.body;

  if (!to || !subject || !html) {
    res.status(400).send("Missing required fields");
    return;
  }

  const mailOptions = {
    from: `"Alts Fund Link" <${GMAIL_USER}>`,
    to,
    subject,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Status email sent to: ${to}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Failed to send status email:", err);
    res.status(500).json({ error: err.message });
  }
});
