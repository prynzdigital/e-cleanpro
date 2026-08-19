const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin, hashPassword } = require('../auth');

const ROLE_VALUES = ['Owner', 'Admin'];
const STATUS_VALUES = ['Active', 'Inactive'];

async function isLastActiveOwner(id) {
  const target = (await sql`SELECT role, status FROM admin_users WHERE id = ${id}`)[0];
  if (!target || target.role !== 'Owner' || target.status !== 'Active') return false;
  const activeOwners = await sql`SELECT COUNT(*)::int AS n FROM admin_users WHERE role = 'Owner' AND status = 'Active'`;
  return activeOwners[0].n <= 1;
}

module.exports = async (req, res) => {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (session.role !== 'Owner') {
    res.status(403).json({ error: 'Only owners can manage team members' });
    return;
  }

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      const rows = await sql`SELECT id, username, role, status, created_at FROM admin_users ORDER BY created_at ASC`;
      res.status(200).json({ users: rows, roles: ROLE_VALUES, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch users:', err);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const { username, password, role } = body;

    if (!username || typeof username !== 'string' || !username.trim()) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    try {
      await ensureSchema();
      const passwordHash = await hashPassword(password);
      const rows = await sql`
        INSERT INTO admin_users (username, password_hash, role, status)
        VALUES (${username.trim()}, ${passwordHash}, ${ROLE_VALUES.includes(role) ? role : 'Admin'}, 'Active')
        RETURNING id, username, role, status, created_at
      `;
      res.status(201).json({ ok: true, user: rows[0] });
    } catch (err) {
      if (String(err.message || '').toLowerCase().includes('duplicate')) {
        res.status(409).json({ error: 'That username is already taken' });
        return;
      }
      console.error('Failed to create user:', err);
      res.status(500).json({ error: 'Failed to create user' });
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
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    const body = req.body || {};
    const { role, status, password } = body;

    try {
      await ensureSchema();

      const demoting = role && role !== 'Owner';
      const deactivating = status === 'Inactive';
      if ((demoting || deactivating) && (await isLastActiveOwner(id))) {
        res.status(400).json({ error: 'Cannot remove the last active owner' });
        return;
      }

      let passwordHash = null;
      if (password) {
        if (String(password).length < 8) {
          res.status(400).json({ error: 'Password must be at least 8 characters' });
          return;
        }
        passwordHash = await hashPassword(password);
      }

      const rows = await sql`
        UPDATE admin_users SET
          role = COALESCE(${ROLE_VALUES.includes(role) ? role : null}, role),
          status = COALESCE(${STATUS_VALUES.includes(status) ? status : null}, status),
          password_hash = COALESCE(${passwordHash}, password_hash)
        WHERE id = ${id}
        RETURNING id, username, role, status, created_at
      `;
      if (rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.status(200).json({ ok: true, user: rows[0] });
    } catch (err) {
      console.error('Failed to update user:', err);
      res.status(500).json({ error: 'Failed to update user' });
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
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }
    if (id === session.userId) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    try {
      await ensureSchema();
      if (await isLastActiveOwner(id)) {
        res.status(400).json({ error: 'Cannot remove the last active owner' });
        return;
      }
      const deleted = await sql`DELETE FROM admin_users WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete user:', err);
      res.status(500).json({ error: 'Failed to delete user' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
