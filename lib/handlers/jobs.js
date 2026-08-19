const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');

const STATUS_VALUES = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'Scheduled';
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v) {
  return v ? v : null;
}

function toJsonOrNull(v) {
  if (v === undefined || v === null) return null;
  return JSON.stringify(v);
}

async function fetchJobById(id) {
  const rows = await sql`
    SELECT
      j.id, j.client_id, j.contract_id, j.employee_id, j.location, j.scheduled_date,
      j.scheduled_time, j.cleaning_type, j.status, j.checklist, j.notes, j.photos,
      j.hours, j.completed_at, j.created_at,
      cl.name AS client_name, cl.company AS client_company,
      e.name AS employee_name
    FROM jobs j
    JOIN clients cl ON cl.id = j.client_id
    LEFT JOIN employees e ON e.id = j.employee_id
    WHERE j.id = ${id}
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
          j.id, j.client_id, j.contract_id, j.employee_id, j.location, j.scheduled_date,
          j.scheduled_time, j.cleaning_type, j.status, j.checklist, j.notes, j.photos,
          j.hours, j.completed_at, j.created_at,
          cl.name AS client_name, cl.company AS client_company,
          e.name AS employee_name
        FROM jobs j
        JOIN clients cl ON cl.id = j.client_id
        LEFT JOIN employees e ON e.id = j.employee_id
        ORDER BY j.scheduled_date ASC NULLS LAST, j.scheduled_time ASC NULLS LAST
        LIMIT 1000
      `;
      res.status(200).json({ jobs: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      res.status(500).json({ error: 'Failed to fetch jobs' });
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
      clientId, contractId, employeeId, location, scheduledDate, scheduledTime,
      cleaningType, status, checklist, notes, photos, hours,
    } = body;

    const clientIdNum = Number(clientId);
    if (!Number.isInteger(clientIdNum) || clientIdNum <= 0) {
      res.status(400).json({ error: 'A client must be selected' });
      return;
    }

    const normalizedStatus = normalizeStatus(status);

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO jobs (
          client_id, contract_id, employee_id, location, scheduled_date, scheduled_time,
          cleaning_type, status, checklist, notes, photos, hours, completed_at
        )
        VALUES (
          ${clientIdNum}, ${toNumberOrNull(contractId)}, ${toNumberOrNull(employeeId)},
          ${location || null}, ${toDateOrNull(scheduledDate)}, ${scheduledTime || null},
          ${cleaningType || null}, ${normalizedStatus}, ${toJsonOrNull(checklist)},
          ${notes || null}, ${toJsonOrNull(photos)}, ${toNumberOrNull(hours)},
          ${normalizedStatus === 'Completed' ? new Date().toISOString() : null}
        )
        RETURNING id
      `;
      const full = await fetchJobById(rows[0].id);
      res.status(201).json({ ok: true, job: full });
    } catch (err) {
      console.error('Failed to create job:', err);
      res.status(500).json({ error: 'Failed to create job' });
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
      res.status(400).json({ error: 'Invalid job id' });
      return;
    }

    const body = req.body || {};
    const {
      clientId, contractId, employeeId, location, scheduledDate, scheduledTime,
      cleaningType, status, checklist, notes, photos, hours,
    } = body;

    const clientIdNum = Number(clientId);
    if (!Number.isInteger(clientIdNum) || clientIdNum <= 0) {
      res.status(400).json({ error: 'A client must be selected' });
      return;
    }

    const normalizedStatus = normalizeStatus(status);

    try {
      await ensureSchema();
      const existing = await sql`SELECT status, completed_at FROM jobs WHERE id = ${id}`;
      if (existing.length === 0) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      let completedAtExpr;
      if (normalizedStatus === 'Completed' && !existing[0].completed_at) {
        completedAtExpr = new Date().toISOString();
      } else if (normalizedStatus !== 'Completed') {
        completedAtExpr = null;
      } else {
        completedAtExpr = existing[0].completed_at;
      }

      const updated = await sql`
        UPDATE jobs SET
          client_id = ${clientIdNum},
          contract_id = ${toNumberOrNull(contractId)},
          employee_id = ${toNumberOrNull(employeeId)},
          location = ${location || null},
          scheduled_date = ${toDateOrNull(scheduledDate)},
          scheduled_time = ${scheduledTime || null},
          cleaning_type = ${cleaningType || null},
          status = ${normalizedStatus},
          checklist = ${toJsonOrNull(checklist)},
          notes = ${notes || null},
          photos = ${toJsonOrNull(photos)},
          hours = ${toNumberOrNull(hours)},
          completed_at = ${completedAtExpr}
        WHERE id = ${id}
        RETURNING id
      `;
      if (updated.length === 0) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      const full = await fetchJobById(id);
      res.status(200).json({ ok: true, job: full });
    } catch (err) {
      console.error('Failed to update job:', err);
      res.status(500).json({ error: 'Failed to update job' });
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
      res.status(400).json({ error: 'Invalid job id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM jobs WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete job:', err);
      res.status(500).json({ error: 'Failed to delete job' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
