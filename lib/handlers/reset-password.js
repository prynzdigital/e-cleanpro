const { sql, ensureSchema } = require('../db');
const { hashPassword } = require('../auth');
const { isRateLimited, clientIp } = require('../rateLimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (isRateLimited(clientIp(req), { maxAttempts: 10, windowMs: 15 * 60 * 1000 })) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

  const { token, password } = req.body || {};
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Missing reset token.' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id FROM admin_users
      WHERE reset_token = ${token} AND reset_token_expires > now() AND status = 'Active'
    `;
    if (rows.length === 0) {
      res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    await sql`
      UPDATE admin_users SET password_hash = ${passwordHash}, reset_token = NULL, reset_token_expires = NULL
      WHERE id = ${rows[0].id}
    `;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Failed to reset password:', err);
    res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
};
