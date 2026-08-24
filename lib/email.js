const FROM_ADDRESS = 'E-Clean Pro Services <careers@mail.ecleanproservices.com>';
const BUSINESS_EMAIL = 'info@ecleanproservices.com';

async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured; skipping email');
    return false;
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!resendRes.ok) {
    console.error('Resend error:', await resendRes.text());
    return false;
  }
  return true;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function wrapEmail(bodyHtml) {
  return `
    <div style="font-family:sans-serif; max-width:560px; color:#0b1f1d;">
      <h2 style="color:#07403c; margin-bottom:16px;">E-Clean Pro Services</h2>
      ${bodyHtml}
      <hr style="margin:24px 0; border:none; border-top:1px solid #ddd;">
      <p style="font-size:12px; color:#666;">E-Clean Pro Services LLC &middot; 19980 Aine Drive, Frankfort, IL 60423</p>
    </div>
  `;
}

module.exports = { sendEmail, escapeHtml, wrapEmail, BUSINESS_EMAIL };
