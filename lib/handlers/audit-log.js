const { sql, ensureSchema } = require('../db');
const { requireAuth } = require('../auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const session = await requireAuth(req, res);
  if (!session) return;
  if (session.role !== 'Owner') {
    res.status(403).json({ error: 'Only owners can view the audit log' });
    return;
  }

  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, user_id, username, role, action, resource, resource_id, details, created_at
      FROM audit_log
      ORDER BY created_at DESC
      LIMIT 1000
    `;
    res.status(200).json({ entries: rows });
  } catch (err) {
    console.error('Failed to fetch audit log:', err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
};
