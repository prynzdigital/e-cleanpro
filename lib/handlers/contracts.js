const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');

const STATUS_VALUES = ['Draft', 'Active', 'Expired', 'Cancelled'];

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'Draft';
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v) {
  return v ? v : null;
}

async function fetchContractById(id) {
  const rows = await sql`
    SELECT
      c.id, c.client_id, c.quote_id, c.property_address, c.start_date, c.end_date,
      c.monthly_price, c.services, c.status, c.signed_contract_url, c.notes, c.created_at,
      cl.name AS client_name, cl.company AS client_company
    FROM contracts c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.id = ${id}
  `;
  return rows[0];
}

module.exports = async (req, res) => {
  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      const rows = await sql`
        SELECT
          c.id, c.client_id, c.quote_id, c.property_address, c.start_date, c.end_date,
          c.monthly_price, c.services, c.status, c.signed_contract_url, c.notes, c.created_at,
          cl.name AS client_name, cl.company AS client_company
        FROM contracts c
        JOIN clients cl ON cl.id = c.client_id
        ORDER BY c.created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ contracts: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch contracts:', err);
      res.status(500).json({ error: 'Failed to fetch contracts' });
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
      clientId, quoteId, propertyAddress, startDate, endDate, monthlyPrice,
      services, status, signedContractUrl, notes,
    } = body;

    const clientIdNum = Number(clientId);
    if (!Number.isInteger(clientIdNum) || clientIdNum <= 0) {
      res.status(400).json({ error: 'A client must be selected' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO contracts (
          client_id, quote_id, property_address, start_date, end_date,
          monthly_price, services, status, signed_contract_url, notes
        )
        VALUES (
          ${clientIdNum}, ${toNumberOrNull(quoteId)}, ${propertyAddress || null},
          ${toDateOrNull(startDate)}, ${toDateOrNull(endDate)}, ${toNumberOrNull(monthlyPrice)},
          ${services || null}, ${normalizeStatus(status)}, ${signedContractUrl || null}, ${notes || null}
        )
        RETURNING id
      `;
      const full = await fetchContractById(rows[0].id);
      res.status(201).json({ ok: true, contract: full });
    } catch (err) {
      console.error('Failed to create contract:', err);
      res.status(500).json({ error: 'Failed to create contract' });
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
      res.status(400).json({ error: 'Invalid contract id' });
      return;
    }

    const body = req.body || {};
    const {
      clientId, propertyAddress, startDate, endDate, monthlyPrice,
      services, status, signedContractUrl, notes,
    } = body;

    const clientIdNum = Number(clientId);
    if (!Number.isInteger(clientIdNum) || clientIdNum <= 0) {
      res.status(400).json({ error: 'A client must be selected' });
      return;
    }

    try {
      await ensureSchema();
      const updated = await sql`
        UPDATE contracts SET
          client_id = ${clientIdNum},
          property_address = ${propertyAddress || null},
          start_date = ${toDateOrNull(startDate)},
          end_date = ${toDateOrNull(endDate)},
          monthly_price = ${toNumberOrNull(monthlyPrice)},
          services = ${services || null},
          status = ${normalizeStatus(status)},
          signed_contract_url = ${signedContractUrl || null},
          notes = ${notes || null}
        WHERE id = ${id}
        RETURNING id
      `;
      if (updated.length === 0) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      const full = await fetchContractById(id);
      res.status(200).json({ ok: true, contract: full });
    } catch (err) {
      console.error('Failed to update contract:', err);
      res.status(500).json({ error: 'Failed to update contract' });
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
      res.status(400).json({ error: 'Invalid contract id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM contracts WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete contract:', err);
      res.status(500).json({ error: 'Failed to delete contract' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
