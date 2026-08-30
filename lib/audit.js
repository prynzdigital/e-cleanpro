const { sql, ensureSchema } = require('./db');

// Records an admin action for accountability. MUST be awaited, and MUST be
// called before the handler sends its response (res.json/res.status().json()) --
// Neon's serverless driver runs each query as its own HTTPS fetch, and this
// project has already hit the failure mode where an un-awaited fetch issued
// after the response was sent got silently dropped when the function froze.
// Logging after the response would carry the exact same risk.
async function logAudit(req, { action, resource, resourceId, details }) {
  const user = req.adminUser;
  if (!user) return;
  try {
    await ensureSchema();
    await sql`
      INSERT INTO audit_log (user_id, username, role, action, resource, resource_id, details)
      VALUES (
        ${user.userId}, ${user.username}, ${user.role},
        ${action}, ${resource}, ${resourceId != null ? String(resourceId) : null}, ${details || null}
      )
    `;
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

module.exports = { logAudit };
