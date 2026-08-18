const { sql, ensureSchema } = require('../../lib/db');
const { requireAuth, isSameOrigin } = require('../../lib/auth');

const STATUS_VALUES = ['Active', 'Inactive'];

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
        SELECT
          e.id, e.name, e.phone, e.position, e.pay_rate, e.availability, e.status, e.notes, e.created_at,
          COALESCE(jc.assigned_jobs, 0)::int AS assigned_jobs,
          COALESCE(jc.hours_worked, 0)::float AS hours_worked
        FROM employees e
        LEFT JOIN (
          SELECT employee_id,
                 COUNT(*) FILTER (WHERE status IN ('Scheduled', 'In Progress')) AS assigned_jobs,
                 SUM(hours) FILTER (WHERE status = 'Completed') AS hours_worked
          FROM jobs
          WHERE employee_id IS NOT NULL
          GROUP BY employee_id
        ) jc ON jc.employee_id = e.id
        ORDER BY e.created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ employees: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch employees:', err);
      res.status(500).json({ error: 'Failed to fetch employees' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const { name, phone, position, payRate, availability, status, notes } = body;

    if (!name || !phone) {
      res.status(400).json({ error: 'Name and phone are required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO employees (name, phone, position, pay_rate, availability, status, notes)
        VALUES (
          ${name}, ${phone}, ${position || null}, ${toNumberOrNull(payRate)},
          ${availability || null}, ${normalizeStatus(status)}, ${notes || null}
        )
        RETURNING id, name, phone, position, pay_rate, availability, status, notes, created_at
      `;
      res.status(201).json({ ok: true, employee: { ...rows[0], assigned_jobs: 0, hours_worked: 0 } });
    } catch (err) {
      console.error('Failed to create employee:', err);
      res.status(500).json({ error: 'Failed to create employee' });
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
      res.status(400).json({ error: 'Invalid employee id' });
      return;
    }

    const body = req.body || {};
    const { name, phone, position, payRate, availability, status, notes } = body;

    if (!name || !phone) {
      res.status(400).json({ error: 'Name and phone are required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        UPDATE employees SET
          name = ${name},
          phone = ${phone},
          position = ${position || null},
          pay_rate = ${toNumberOrNull(payRate)},
          availability = ${availability || null},
          status = ${normalizeStatus(status)},
          notes = ${notes || null}
        WHERE id = ${id}
        RETURNING id, name, phone, position, pay_rate, availability, status, notes, created_at
      `;
      if (rows.length === 0) {
        res.status(404).json({ error: 'Employee not found' });
        return;
      }
      res.status(200).json({ ok: true, employee: rows[0] });
    } catch (err) {
      console.error('Failed to update employee:', err);
      res.status(500).json({ error: 'Failed to update employee' });
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
      res.status(400).json({ error: 'Invalid employee id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM employees WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Employee not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete employee:', err);
      res.status(500).json({ error: 'Failed to delete employee' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
