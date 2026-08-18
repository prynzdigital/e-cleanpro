const { sql, ensureSchema } = require('../lib/db');
const { DEFAULTS } = require('../lib/content-defaults');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const content = { ...DEFAULTS };

  try {
    await ensureSchema();
    const rows = await sql`SELECT key, value FROM site_content`;
    for (const row of rows) {
      content[row.key] = row.value;
    }
  } catch (err) {
    // Database not provisioned yet, or unreachable -- fall back to defaults
    // so the site still renders correctly rather than breaking.
    console.error('content fetch failed, using defaults:', err.message);
  }

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.status(200).json(content);
};
