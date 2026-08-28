const { sql, ensureSchema } = require('../lib/db');
const { DEFAULTS } = require('../lib/content-defaults');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const content = { ...DEFAULTS };
  let featuredReviews = [];

  try {
    await ensureSchema();
    const rows = await sql`SELECT key, value FROM site_content`;
    for (const row of rows) {
      content[row.key] = row.value;
    }
    // Admin-curated testimonials only: type='Review' (never Complaints) and
    // explicitly marked featured, so nothing surfaces publicly without a
    // deliberate opt-in from staff.
    featuredReviews = await sql`
      SELECT r.rating, r.comment, r.source, r.created_at, c.name AS client_name, c.company AS client_company
      FROM reviews r
      LEFT JOIN clients c ON c.id = r.client_id
      WHERE r.type = 'Review' AND r.featured = true
      ORDER BY r.rating DESC NULLS LAST, r.created_at DESC
      LIMIT 12
    `;
  } catch (err) {
    // Database not provisioned yet, or unreachable -- fall back to defaults
    // so the site still renders correctly rather than breaking.
    console.error('content fetch failed, using defaults:', err.message);
  }

  content.featuredReviews = featuredReviews;

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.status(200).json(content);
};
