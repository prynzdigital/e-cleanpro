const crypto = require('crypto');
const { sql, ensureSchema } = require('../db');
const { sendEmail, escapeHtml, wrapEmail } = require('../email');
const { isRateLimited, clientIp } = require('../rateLimit');

function siteOrigin(req) {
  const host = req.headers.host;
  return `https://${host}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (isRateLimited(clientIp(req), { maxAttempts: 5, windowMs: 15 * 60 * 1000 })) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

  // Always the same response regardless of what we find, so this endpoint
  // can't be used to check which emails have an admin account.
  const generic = { ok: true, message: "If an account with that email exists, we've sent a password reset link." };

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    res.status(200).json(generic);
    return;
  }

  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, username, email FROM admin_users
      WHERE lower(email) = ${email.trim().toLowerCase()} AND status = 'Active'
    `;
    const user = rows[0];
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      await sql`
        UPDATE admin_users SET reset_token = ${token}, reset_token_expires = now() + interval '1 hour'
        WHERE id = ${user.id}
      `;
      const resetUrl = `${siteOrigin(req)}/admin/?reset=${token}`;
      await sendEmail({
        to: user.email,
        subject: 'Password Reset — E-Clean Pro Services Admin',
        html: wrapEmail(`
          <p>Hi ${escapeHtml(user.username)},</p>
          <p>We received a request to reset your admin dashboard password. This link expires in 1 hour.</p>
          <p style="margin:20px 0;"><a href="${resetUrl}" style="background:#0e7d70; color:#fff; padding:12px 24px; border-radius:99px; text-decoration:none; font-weight:700;">Reset Password</a></p>
          <p style="font-size:12.5px; color:#666;">If you didn't request this, you can safely ignore this email — your password won't change. If the button doesn't work, copy this link into your browser:<br>${resetUrl}</p>
        `),
      });
    }
  } catch (err) {
    console.error('Failed to process forgot-password request:', err);
  }

  res.status(200).json(generic);
};
