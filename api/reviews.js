const { sql, ensureSchema } = require('../lib/db');
const { sendEmail, escapeHtml, wrapEmail, BUSINESS_EMAIL } = require('../lib/email');
const { isRateLimited, clientIp } = require('../lib/rateLimit');

const TYPE_VALUES = ['Review', 'Complaint'];

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  if (body.website) {
    res.status(200).json({ ok: true });
    return;
  }
  if (isRateLimited(clientIp(req), { maxAttempts: 5, windowMs: 15 * 60 * 1000 })) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

  const { name, email, phone, comment } = body;
  const type = TYPE_VALUES.includes(body.type) ? body.type : 'Review';
  const rating = type === 'Review' ? Number(body.rating) : null;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ error: 'Please provide your full name.' });
    return;
  }
  if (email && !isValidEmail(email)) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }
  if (!comment || typeof comment !== 'string' || comment.trim().length < 5) {
    res.status(400).json({ error: 'Please tell us a bit more before submitting.' });
    return;
  }
  if (type === 'Review' && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    res.status(400).json({ error: 'Please select a rating from 1 to 5.' });
    return;
  }

  try {
    await ensureSchema();
    await sql`
      INSERT INTO reviews (type, rating, source, comment, status, submitted_by_name, submitted_by_email, submitted_by_phone)
      VALUES (${type}, ${rating}, 'Website', ${comment.trim()}, 'New', ${name.trim()}, ${email || null}, ${phone || null})
    `;
  } catch (err) {
    console.error('Failed to save website review/complaint:', err.message);
    res.status(500).json({ error: 'Failed to submit. Please try again.' });
    return;
  }

  try {
    await sendEmail({
      to: BUSINESS_EMAIL,
      replyTo: email || undefined,
      subject: `New ${type} from Website — ${name.trim()}`,
      html: wrapEmail(`
        <p>A new ${type.toLowerCase()} was submitted through the website.</p>
        <table cellpadding="6" style="border-collapse:collapse;">
          <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
          <tr><td><strong>Email</strong></td><td>${escapeHtml(email || '—')}</td></tr>
          <tr><td><strong>Phone</strong></td><td>${escapeHtml(phone || '—')}</td></tr>
          ${type === 'Review' ? `<tr><td><strong>Rating</strong></td><td>${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</td></tr>` : ''}
          <tr><td><strong>Message</strong></td><td>${escapeHtml(comment)}</td></tr>
        </table>
      `),
    });
  } catch (err) {
    console.error('Failed to send review/complaint notification email:', err);
  }

  res.status(200).json({ ok: true });
};
