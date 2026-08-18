const { sql, ensureSchema } = require('../../lib/db');
const { requireAuth, isSameOrigin } = require('../../lib/auth');
const { DEFAULTS, CONTENT_KEYS } = require('../../lib/content-defaults');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  await ensureSchema();

  if (req.method === 'GET') {
    const content = { ...DEFAULTS };
    try {
      const rows = await sql`SELECT key, value FROM site_content`;
      for (const row of rows) content[row.key] = row.value;
    } catch (err) {
      console.error('Failed to fetch content:', err);
      res.status(500).json({ error: 'Failed to fetch content' });
      return;
    }
    res.status(200).json(content);
    return;
  }

  if (req.method === 'PUT') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const updates = req.body || {};
    const entries = Object.entries(updates).filter(([key]) => CONTENT_KEYS.includes(key));

    if (entries.length === 0) {
      res.status(400).json({ error: 'No valid content keys provided' });
      return;
    }

    // Validate JSON-shaped fields before writing so a bad edit can't corrupt
    // the calculator on the live site.
    for (const [key, value] of entries) {
      if ((key === 'pricing_facility_types' || key === 'pricing_addons') && typeof value === 'string') {
        try {
          JSON.parse(value);
        } catch {
          res.status(400).json({ error: `${key} must be valid JSON` });
          return;
        }
      }
    }

    try {
      for (const [key, value] of entries) {
        await sql`
          INSERT INTO site_content (key, value, updated_at)
          VALUES (${key}, ${String(value)}, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `;
      }
    } catch (err) {
      console.error('Failed to save content:', err);
      res.status(500).json({ error: 'Failed to save content' });
      return;
    }

    res.status(200).json({ ok: true, updated: entries.map(([key]) => key) });
    return;
  }

  res.setHeader('Allow', 'GET, PUT');
  res.status(405).json({ error: 'Method not allowed' });
};
