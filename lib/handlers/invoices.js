const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');

const STATUS_VALUES = ['Unpaid', 'Paid', 'Overdue', 'Cancelled'];

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'Unpaid';
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v) {
  return v ? v : null;
}

function toLineItemsOrNull(v) {
  if (!Array.isArray(v)) return null;
  const cleaned = v
    .map((item) => ({
      description: String(item.description || '').trim(),
      qty: toNumberOrNull(item.qty) ?? 1,
      rate: toNumberOrNull(item.rate) ?? 0,
      tax: toNumberOrNull(item.tax) ?? 0,
    }))
    .filter((item) => item.description);
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

async function fetchInvoiceById(id) {
  const rows = await sql`
    SELECT
      i.id, i.client_id, i.contract_id, i.job_id, i.amount, i.due_date,
      i.status, i.payment_method, i.paid_date, i.notes, i.created_at,
      i.service_location, i.service_dates, i.payment_terms, i.discount, i.line_items,
      c.name AS client_name, c.company AS client_company, c.address AS client_address,
      c.phone AS client_phone, c.email AS client_email
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.id = ${id}
  `;
  return rows[0];
}

module.exports = async (req, res) => {
  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      // Lazily flip Unpaid invoices past their due date to Overdue on read,
      // so status stays accurate without a scheduled job.
      await sql`UPDATE invoices SET status = 'Overdue' WHERE status = 'Unpaid' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`;
      const rows = await sql`
        SELECT
          i.id, i.client_id, i.contract_id, i.job_id, i.amount, i.due_date,
          i.status, i.payment_method, i.paid_date, i.notes, i.created_at,
          i.service_location, i.service_dates, i.payment_terms, i.discount, i.line_items,
          c.name AS client_name, c.company AS client_company, c.address AS client_address,
          c.phone AS client_phone, c.email AS client_email
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        ORDER BY i.created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ invoices: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
      res.status(500).json({ error: 'Failed to fetch invoices' });
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
      clientId, contractId, jobId, amount, dueDate, status, paymentMethod, paidDate, notes,
      serviceLocation, serviceDates, paymentTerms, discount, lineItems,
    } = body;

    const clientIdNum = Number(clientId);
    if (!Number.isInteger(clientIdNum) || clientIdNum <= 0) {
      res.status(400).json({ error: 'A client must be selected' });
      return;
    }
    const amountNum = toNumberOrNull(amount);
    if (amountNum === null || amountNum <= 0) {
      res.status(400).json({ error: 'A valid amount is required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO invoices (
          client_id, contract_id, job_id, amount, due_date, status, payment_method, paid_date, notes,
          service_location, service_dates, payment_terms, discount, line_items
        )
        VALUES (
          ${clientIdNum}, ${toNumberOrNull(contractId)}, ${toNumberOrNull(jobId)}, ${amountNum},
          ${toDateOrNull(dueDate)}, ${normalizeStatus(status)}, ${paymentMethod || null},
          ${toDateOrNull(paidDate)}, ${notes || null},
          ${serviceLocation || null}, ${serviceDates || null}, ${paymentTerms || null},
          ${toNumberOrNull(discount) ?? 0}, ${toLineItemsOrNull(lineItems)}
        )
        RETURNING id
      `;
      const full = await fetchInvoiceById(rows[0].id);
      res.status(201).json({ ok: true, invoice: full });
    } catch (err) {
      console.error('Failed to create invoice:', err);
      res.status(500).json({ error: 'Failed to create invoice' });
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
      res.status(400).json({ error: 'Invalid invoice id' });
      return;
    }

    const body = req.body || {};
    const {
      clientId, contractId, jobId, amount, dueDate, status, paymentMethod, paidDate, notes,
      serviceLocation, serviceDates, paymentTerms, discount, lineItems,
    } = body;

    const clientIdNum = Number(clientId);
    if (!Number.isInteger(clientIdNum) || clientIdNum <= 0) {
      res.status(400).json({ error: 'A client must be selected' });
      return;
    }
    const amountNum = toNumberOrNull(amount);
    if (amountNum === null || amountNum <= 0) {
      res.status(400).json({ error: 'A valid amount is required' });
      return;
    }

    const normalizedStatus = normalizeStatus(status);
    // Auto-stamp paid_date when marked Paid and none was given.
    const paidDateValue = normalizedStatus === 'Paid' ? (toDateOrNull(paidDate) || new Date().toISOString().slice(0, 10)) : toDateOrNull(paidDate);

    try {
      await ensureSchema();
      const updated = await sql`
        UPDATE invoices SET
          client_id = ${clientIdNum},
          contract_id = ${toNumberOrNull(contractId)},
          job_id = ${toNumberOrNull(jobId)},
          amount = ${amountNum},
          due_date = ${toDateOrNull(dueDate)},
          status = ${normalizedStatus},
          payment_method = ${paymentMethod || null},
          paid_date = ${paidDateValue},
          notes = ${notes || null},
          service_location = ${serviceLocation || null},
          service_dates = ${serviceDates || null},
          payment_terms = ${paymentTerms || null},
          discount = ${toNumberOrNull(discount) ?? 0},
          line_items = ${toLineItemsOrNull(lineItems)}
        WHERE id = ${id}
        RETURNING id
      `;
      if (updated.length === 0) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      const full = await fetchInvoiceById(id);
      res.status(200).json({ ok: true, invoice: full });
    } catch (err) {
      console.error('Failed to update invoice:', err);
      res.status(500).json({ error: 'Failed to update invoice' });
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
      res.status(400).json({ error: 'Invalid invoice id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM invoices WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete invoice:', err);
      res.status(500).json({ error: 'Failed to delete invoice' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
