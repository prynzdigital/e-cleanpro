const { sql, ensureSchema } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    await ensureSchema();

    const [
      totalClients,
      activeClients,
      totalLeads,
      newLeadsThisMonth,
      leadsByStatus,
      pendingQuotes,
      quoteStats,
      recurringValue,
    ] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n FROM clients`,
      sql`SELECT COUNT(*)::int AS n FROM clients WHERE status = 'Active'`,
      sql`SELECT COUNT(*)::int AS n FROM leads`,
      sql`SELECT COUNT(*)::int AS n FROM leads WHERE created_at >= date_trunc('month', now())`,
      sql`SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status`,
      sql`SELECT COUNT(*)::int AS n FROM quotes WHERE status = 'Sent'`,
      sql`SELECT status, COUNT(*)::int AS n FROM quotes GROUP BY status`,
      sql`SELECT COALESCE(SUM(contract_amount), 0)::float AS total FROM clients WHERE status = 'Active'`,
    ]);

    const quoteStatusMap = {};
    quoteStats.forEach((r) => { quoteStatusMap[r.status] = r.n; });
    const decided = (quoteStatusMap.Accepted || 0) + (quoteStatusMap.Declined || 0);
    const conversionRate = decided > 0 ? Math.round(((quoteStatusMap.Accepted || 0) / decided) * 100) : null;

    res.status(200).json({
      totalClients: totalClients[0].n,
      activeClients: activeClients[0].n,
      totalLeads: totalLeads[0].n,
      newLeadsThisMonth: newLeadsThisMonth[0].n,
      leadsByStatus: leadsByStatus.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {}),
      pendingQuotes: pendingQuotes[0].n,
      quotesByStatus: quoteStatusMap,
      quoteConversionRate: conversionRate,
      monthlyRecurringValue: recurringValue[0].total,
    });
  } catch (err) {
    console.error('Failed to load dashboard stats:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats', detail: err.message, stack: err.stack });
  }
};
