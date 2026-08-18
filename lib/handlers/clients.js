const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');

const STATUS_VALUES = ['Active', 'Paused', 'Inactive'];

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'Active';
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      const rows = await sql`
        SELECT id, name, company, phone, email, address, service_type, square_footage,
               cleaning_frequency, contract_amount, notes, status, source_lead_id, created_at
        FROM clients
        ORDER BY created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ clients: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch clients:', err);
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const {
      name, company, phone, email, address, serviceType, squareFootage,
      cleaningFrequency, contractAmount, notes, status, sourceLeadId,
    } = body;

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
        INSERT INTO clients (
          name, company, phone, email, address, service_type, square_footage,
          cleaning_frequency, contract_amount, notes, status, source_lead_id
        )
        VALUES (
          ${name}, ${company || null}, ${phone}, ${email || null}, ${address || null},
          ${serviceType || null}, ${toNumberOrNull(squareFootage)}, ${cleaningFrequency || null},
          ${toNumberOrNull(contractAmount)}, ${notes || null}, ${normalizeStatus(status)},
          ${toNumberOrNull(sourceLeadId)}
        )
        RETURNING id, name, company, phone, email, address, service_type, square_footage,
                  cleaning_frequency, contract_amount, notes, status, source_lead_id, created_at
      `;
      res.status(201).json({ ok: true, client: rows[0] });
    } catch (err) {
      console.error('Failed to create client:', err);
      res.status(500).json({ error: 'Failed to create client' });
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
      res.status(400).json({ error: 'Invalid client id' });
      return;
    }

    const body = req.body || {};
    const {
      name, company, phone, email, address, serviceType, squareFootage,
      cleaningFrequency, contractAmount, notes, status,
    } = body;

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
        UPDATE clients SET
          name = ${name},
          company = ${company || null},
          phone = ${phone},
          email = ${email || null},
          address = ${address || null},
          service_type = ${serviceType || null},
          square_footage = ${toNumberOrNull(squareFootage)},
          cleaning_frequency = ${cleaningFrequency || null},
          contract_amount = ${toNumberOrNull(contractAmount)},
          notes = ${notes || null},
          status = ${normalizeStatus(status)}
        WHERE id = ${id}
        RETURNING id, name, company, phone, email, address, service_type, square_footage,
                  cleaning_frequency, contract_amount, notes, status, source_lead_id, created_at
      `;
      if (rows.length === 0) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
      res.status(200).json({ ok: true, client: rows[0] });
    } catch (err) {
      console.error('Failed to update client:', err);
      res.status(500).json({ error: 'Failed to update client' });
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
      res.status(400).json({ error: 'Invalid client id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM clients WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete client:', err);
      res.status(500).json({ error: 'Failed to delete client' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
