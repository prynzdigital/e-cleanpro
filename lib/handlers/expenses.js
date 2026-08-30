const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');
const { logAudit } = require('../audit');

const CATEGORY_VALUES = ['Supplies', 'Fuel', 'Payroll', 'Equipment', 'Insurance', 'Marketing', 'Other'];

function normalizeCategory(category) {
  return CATEGORY_VALUES.includes(category) ? category : 'Other';
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v) {
  return v ? v : null;
}

async function fetchExpenseById(id) {
  const rows = await sql`
    SELECT
      e.id, e.category, e.amount, e.expense_date, e.vendor, e.description,
      e.job_id, e.receipt_url, e.notes, e.created_at
    FROM expenses e
    WHERE e.id = ${id}
  `;
  return rows[0];
}

module.exports = async (req, res) => {
  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      const rows = await sql`
        SELECT id, category, amount, expense_date, vendor, description, job_id, receipt_url, notes, created_at
        FROM expenses
        ORDER BY expense_date DESC, created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ expenses: rows, categories: CATEGORY_VALUES });
    } catch (err) {
      console.error('Failed to fetch expenses:', err);
      res.status(500).json({ error: 'Failed to fetch expenses' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const { category, amount, expenseDate, vendor, description, jobId, receiptUrl, notes } = body;

    const amountNum = toNumberOrNull(amount);
    if (amountNum === null || amountNum <= 0) {
      res.status(400).json({ error: 'A valid amount is required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO expenses (category, amount, expense_date, vendor, description, job_id, receipt_url, notes)
        VALUES (
          ${normalizeCategory(category)}, ${amountNum}, ${toDateOrNull(expenseDate) || new Date().toISOString().slice(0, 10)},
          ${vendor || null}, ${description || null}, ${toNumberOrNull(jobId)}, ${receiptUrl || null}, ${notes || null}
        )
        RETURNING id
      `;
      const full = await fetchExpenseById(rows[0].id);
      await logAudit(req, { action: 'create', resource: 'expenses', resourceId: rows[0].id });
      res.status(201).json({ ok: true, expense: full });
    } catch (err) {
      console.error('Failed to create expense:', err);
      res.status(500).json({ error: 'Failed to create expense' });
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
      res.status(400).json({ error: 'Invalid expense id' });
      return;
    }

    const body = req.body || {};
    const { category, amount, expenseDate, vendor, description, jobId, receiptUrl, notes } = body;

    const amountNum = toNumberOrNull(amount);
    if (amountNum === null || amountNum <= 0) {
      res.status(400).json({ error: 'A valid amount is required' });
      return;
    }

    try {
      await ensureSchema();
      const updated = await sql`
        UPDATE expenses SET
          category = ${normalizeCategory(category)},
          amount = ${amountNum},
          expense_date = ${toDateOrNull(expenseDate) || new Date().toISOString().slice(0, 10)},
          vendor = ${vendor || null},
          description = ${description || null},
          job_id = ${toNumberOrNull(jobId)},
          receipt_url = ${receiptUrl || null},
          notes = ${notes || null}
        WHERE id = ${id}
        RETURNING id
      `;
      if (updated.length === 0) {
        res.status(404).json({ error: 'Expense not found' });
        return;
      }
      const full = await fetchExpenseById(id);
      await logAudit(req, { action: 'update', resource: 'expenses', resourceId: id });
      res.status(200).json({ ok: true, expense: full });
    } catch (err) {
      console.error('Failed to update expense:', err);
      res.status(500).json({ error: 'Failed to update expense' });
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
      res.status(400).json({ error: 'Invalid expense id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM expenses WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Expense not found' });
        return;
      }
      await logAudit(req, { action: 'delete', resource: 'expenses', resourceId: id });
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete expense:', err);
      res.status(500).json({ error: 'Failed to delete expense' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
