const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');

const TYPE_VALUES = ['Review', 'Complaint'];
const STATUS_VALUES = ['New', 'In Progress', 'Resolved'];

function normalizeType(type) {
  return TYPE_VALUES.includes(type) ? type : 'Review';
}

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'New';
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v) {
  const n = toNumberOrNull(v);
  return n === null ? null : Math.round(n);
}

async function fetchReviewById(id) {
  const rows = await sql`
    SELECT
      r.id, r.client_id, r.job_id, r.type, r.rating, r.source, r.comment,
      r.status, r.resolution, r.created_at,
      c.name AS client_name, c.company AS client_company
    FROM reviews r
    LEFT JOIN clients c ON c.id = r.client_id
    WHERE r.id = ${id}
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
          r.id, r.client_id, r.job_id, r.type, r.rating, r.source, r.comment,
          r.status, r.resolution, r.created_at,
          c.name AS client_name, c.company AS client_company
        FROM reviews r
        LEFT JOIN clients c ON c.id = r.client_id
        ORDER BY r.created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ reviews: rows, types: TYPE_VALUES, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
      res.status(500).json({ error: 'Failed to fetch reviews' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const { clientId, jobId, type, rating, source, comment, status, resolution } = body;

    if (!comment || !String(comment).trim()) {
      res.status(400).json({ error: 'A comment is required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO reviews (client_id, job_id, type, rating, source, comment, status, resolution)
        VALUES (
          ${toNumberOrNull(clientId)}, ${toNumberOrNull(jobId)}, ${normalizeType(type)}, ${toIntOrNull(rating)},
          ${source || null}, ${comment.trim()}, ${normalizeStatus(status)}, ${resolution || null}
        )
        RETURNING id
      `;
      const full = await fetchReviewById(rows[0].id);
      res.status(201).json({ ok: true, review: full });
    } catch (err) {
      console.error('Failed to create review:', err);
      res.status(500).json({ error: 'Failed to create review' });
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
      res.status(400).json({ error: 'Invalid review id' });
      return;
    }

    const body = req.body || {};
    const { clientId, jobId, type, rating, source, comment, status, resolution } = body;

    if (!comment || !String(comment).trim()) {
      res.status(400).json({ error: 'A comment is required' });
      return;
    }

    try {
      await ensureSchema();
      const updated = await sql`
        UPDATE reviews SET
          client_id = ${toNumberOrNull(clientId)},
          job_id = ${toNumberOrNull(jobId)},
          type = ${normalizeType(type)},
          rating = ${toIntOrNull(rating)},
          source = ${source || null},
          comment = ${comment.trim()},
          status = ${normalizeStatus(status)},
          resolution = ${resolution || null}
        WHERE id = ${id}
        RETURNING id
      `;
      if (updated.length === 0) {
        res.status(404).json({ error: 'Review not found' });
        return;
      }
      const full = await fetchReviewById(id);
      res.status(200).json({ ok: true, review: full });
    } catch (err) {
      console.error('Failed to update review:', err);
      res.status(500).json({ error: 'Failed to update review' });
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
      res.status(400).json({ error: 'Invalid review id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM reviews WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Review not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete review:', err);
      res.status(500).json({ error: 'Failed to delete review' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
