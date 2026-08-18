const { sql, ensureSchema } = require('../../lib/db');
const { requireAuth, isSameOrigin } = require('../../lib/auth');

const STATUS_VALUES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'];

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'Draft';
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchQuoteById(id) {
  const rows = await sql`
    SELECT
      q.id, q.client_id, q.property_address, q.square_footage, q.services,
      q.cleaning_frequency, q.price, q.status, q.notes, q.created_at,
      c.name AS client_name, c.company AS client_company
    FROM quotes q
    JOIN clients c ON c.id = q.client_id
    WHERE q.id = ${id}
  `;
  return rows[0];
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      const rows = await sql`
        SELECT
          q.id, q.client_id, q.property_address, q.square_footage, q.services,
          q.cleaning_frequency, q.price, q.status, q.notes, q.created_at,
          c.name AS client_name, c.company AS client_company
        FROM quotes q
        JOIN clients c ON c.id = q.client_id
        ORDER BY q.created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ quotes: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch quotes:', err);
      res.status(500).json({ error: 'Failed to fetch quotes' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const { clientId, propertyAddress, squareFootage, services, cleaningFrequency, price, status, notes } = body;

    const clientIdNum = Number(clientId);
    if (!Number.isInteger(clientIdNum) || clientIdNum <= 0) {
      res.status(400).json({ error: 'A client must be selected' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO quotes (client_id, property_address, square_footage, services, cleaning_frequency, price, status, notes)
        VALUES (
          ${clientIdNum}, ${propertyAddress || null}, ${toNumberOrNull(squareFootage)}, ${services || null},
          ${cleaningFrequency || null}, ${toNumberOrNull(price)}, ${normalizeStatus(status)}, ${notes || null}
        )
        RETURNING id
      `;
      const full = await fetchQuoteById(rows[0].id);
      res.status(201).json({ ok: true, quote: full });
    } catch (err) {
      console.error('Failed to create quote:', err);
      res.status(500).json({ error: 'Failed to create quote' });
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
      res.status(400).json({ error: 'Invalid quote id' });
      return;
    }

    const body = req.body || {};
    const { clientId, propertyAddress, squareFootage, services, cleaningFrequency, price, status, notes } = body;

    const clientIdNum = Number(clientId);
    if (!Number.isInteger(clientIdNum) || clientIdNum <= 0) {
      res.status(400).json({ error: 'A client must be selected' });
      return;
    }

    try {
      await ensureSchema();
      const updated = await sql`
        UPDATE quotes SET
          client_id = ${clientIdNum},
          property_address = ${propertyAddress || null},
          square_footage = ${toNumberOrNull(squareFootage)},
          services = ${services || null},
          cleaning_frequency = ${cleaningFrequency || null},
          price = ${toNumberOrNull(price)},
          status = ${normalizeStatus(status)},
          notes = ${notes || null}
        WHERE id = ${id}
        RETURNING id
      `;
      if (updated.length === 0) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }
      const full = await fetchQuoteById(id);
      res.status(200).json({ ok: true, quote: full });
    } catch (err) {
      console.error('Failed to update quote:', err);
      res.status(500).json({ error: 'Failed to update quote' });
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
      res.status(400).json({ error: 'Invalid quote id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM quotes WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete quote:', err);
      res.status(500).json({ error: 'Failed to delete quote' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
