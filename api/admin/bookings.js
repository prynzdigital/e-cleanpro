const { sql, ensureSchema } = require('../../lib/db');
const { requireAuth, isSameOrigin } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
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
    return;
  }

  if (req.method === 'DELETE') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid booking id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM bookings WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete booking:', err);
      res.status(500).json({ error: 'Failed to delete booking' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
