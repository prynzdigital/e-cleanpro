const { sql, ensureSchema } = require('../../lib/db');
const { requireAuth, isSameOrigin } = require('../../lib/auth');

const STATUS_VALUES = ['New', 'Contacted', 'Quoted', 'Scheduled', 'Won', 'Lost'];

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'New';
}

function buildEstimate(estimatedValue) {
  if (estimatedValue === undefined || estimatedValue === null || estimatedValue === '') return null;
  const n = Number(estimatedValue);
  if (!Number.isFinite(n)) return null;
  return JSON.stringify({ monthlyTotal: n, manualEntry: true });
}

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
      res.status(200).json({ bookings: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
      res.status(500).json({ error: 'Failed to fetch bookings' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const { name, company, phone, email, address, date, time, notes, status, estimatedValue } = body;

    if (!name || !phone) {
      res.status(400).json({ error: 'Name and phone are required' });
      return;
    }
    if (email && !isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO bookings (name, company, phone, email, address, preferred_date, preferred_time, notes, estimate, status)
        VALUES (${name}, ${company || null}, ${phone}, ${email || null}, ${address || null}, ${date || null}, ${time || null}, ${notes || null}, ${buildEstimate(estimatedValue)}, ${normalizeStatus(status)})
        RETURNING id, name, company, phone, email, address, preferred_date, preferred_time, notes, estimate, status, created_at
      `;
      res.status(201).json({ ok: true, booking: rows[0] });
    } catch (err) {
      console.error('Failed to create booking:', err);
      res.status(500).json({ error: 'Failed to create booking' });
    }
    return;
  }

  if (req.method === 'PUT') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid booking id' });
      return;
    }

    const body = req.body || {};
    const { name, company, phone, email, address, date, time, notes, status, estimatedValue } = body;

    if (!name || !phone) {
      res.status(400).json({ error: 'Name and phone are required' });
      return;
    }
    if (email && !isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        UPDATE bookings SET
          name = ${name},
          company = ${company || null},
          phone = ${phone},
          email = ${email || null},
          address = ${address || null},
          preferred_date = ${date || null},
          preferred_time = ${time || null},
          notes = ${notes || null},
          status = ${normalizeStatus(status)},
          estimate = COALESCE(${buildEstimate(estimatedValue)}, estimate)
        WHERE id = ${id}
        RETURNING id, name, company, phone, email, address, preferred_date, preferred_time, notes, estimate, status, created_at
      `;
      if (rows.length === 0) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      res.status(200).json({ ok: true, booking: rows[0] });
    } catch (err) {
      console.error('Failed to update booking:', err);
      res.status(500).json({ error: 'Failed to update booking' });
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

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
