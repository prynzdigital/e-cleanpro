const BUSINESS_EMAIL = 'info@ecleanproservices.com';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

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
  const { name, company, phone, email, address, date, time, notes, estimate } = body;

  if (!name || !phone || !isValidEmail(email) || !address) {
    res.status(400).json({ error: 'Missing or invalid required fields' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured');
    res.status(500).json({ error: 'Email service is not configured' });
    return;
  }

  const estimateLine = estimate
    ? `${escapeHtml(estimate.facility)} &middot; ${Number(estimate.sqft || 0).toLocaleString()} sq ft &middot; ${escapeHtml(estimate.floors)} floor(s) &middot; ${escapeHtml(estimate.frequency)} &middot; approx. $${Math.round(estimate.monthlyTotal || 0).toLocaleString()}/month`
    : 'No estimate captured';

  const html = `
    <div style="font-family:sans-serif; max-width:560px;">
      <h2 style="color:#07403c;">New Booking Request — E-Clean Pro Services</h2>
      <table cellpadding="6" style="border-collapse:collapse;">
        <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><strong>Company</strong></td><td>${escapeHtml(company || '—')}</td></tr>
        <tr><td><strong>Phone</strong></td><td>${escapeHtml(phone)}</td></tr>
        <tr><td><strong>Email</strong></td><td>${escapeHtml(email)}</td></tr>
        <tr><td><strong>Facility Address</strong></td><td>${escapeHtml(address)}</td></tr>
        <tr><td><strong>Preferred Start Date</strong></td><td>${escapeHtml(date || '—')}</td></tr>
        <tr><td><strong>Preferred Contact Time</strong></td><td>${escapeHtml(time || '—')}</td></tr>
        <tr><td><strong>Notes</strong></td><td>${escapeHtml(notes || '—')}</td></tr>
      </table>
      <hr style="margin:16px 0; border:none; border-top:1px solid #ddd;">
      <p><strong>Calculator Estimate:</strong><br>${estimateLine}</p>
    </div>
  `;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Using the Resend sandbox sender until mail.ecleanproservices.com finishes
        // domain verification in the Resend dashboard (resend.com/domains).
        from: 'E-Clean Pro Website <onboarding@resend.dev>',
        to: [BUSINESS_EMAIL],
        reply_to: email,
        subject: `New Booking Request from ${name}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend error:', errText);
      res.status(502).json({ error: 'Failed to send email', detail: errText });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unexpected error' });
  }
};
