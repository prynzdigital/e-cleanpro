const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');

const STATUS_VALUES = ['Open', 'Closed'];

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'Open';
}

module.exports = async (req, res) => {
  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      const rows = await sql`
        SELECT
          jp.id, jp.title, jp.location, jp.employment_type, jp.description, jp.requirements,
          jp.status, jp.created_at,
          COALESCE(ac.n, 0)::int AS application_count
        FROM job_postings jp
        LEFT JOIN (
          SELECT job_posting_id, COUNT(*) AS n FROM job_applications
          WHERE job_posting_id IS NOT NULL GROUP BY job_posting_id
        ) ac ON ac.job_posting_id = jp.id
        ORDER BY jp.created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ jobPostings: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch job postings:', err);
      res.status(500).json({ error: 'Failed to fetch job postings' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const { title, location, employmentType, description, requirements, status } = body;

    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO job_postings (title, location, employment_type, description, requirements, status)
        VALUES (${title.trim()}, ${location || null}, ${employmentType || null}, ${description || null}, ${requirements || null}, ${normalizeStatus(status)})
        RETURNING id, title, location, employment_type, description, requirements, status, created_at
      `;
      res.status(201).json({ ok: true, jobPosting: { ...rows[0], application_count: 0 } });
    } catch (err) {
      console.error('Failed to create job posting:', err);
      res.status(500).json({ error: 'Failed to create job posting' });
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
      res.status(400).json({ error: 'Invalid job posting id' });
      return;
    }

    const body = req.body || {};
    const { title, location, employmentType, description, requirements, status } = body;

    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        UPDATE job_postings SET
          title = ${title.trim()},
          location = ${location || null},
          employment_type = ${employmentType || null},
          description = ${description || null},
          requirements = ${requirements || null},
          status = ${normalizeStatus(status)}
        WHERE id = ${id}
        RETURNING id, title, location, employment_type, description, requirements, status, created_at
      `;
      if (rows.length === 0) {
        res.status(404).json({ error: 'Job posting not found' });
        return;
      }
      res.status(200).json({ ok: true, jobPosting: rows[0] });
    } catch (err) {
      console.error('Failed to update job posting:', err);
      res.status(500).json({ error: 'Failed to update job posting' });
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
      res.status(400).json({ error: 'Invalid job posting id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM job_postings WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Job posting not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete job posting:', err);
      res.status(500).json({ error: 'Failed to delete job posting' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
