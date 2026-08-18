const { sql, ensureSchema } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!requireAuth(req, res)) return;

  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, name, company, phone, email, address, preferred_date,
             preferred_time, notes, estimate, status, created_at
      FROM bookings
      ORDER BY created_at DESC
      LIMIT 500
    `;
    res.status(200).json({ bookings: rows });
  } catch (err) {
    console.error('Failed to fetch bookings:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};
