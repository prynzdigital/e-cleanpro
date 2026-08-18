const { sql, ensureSchema } = require('../db');
const { requireAuth } = require('../auth');

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

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
      clientsThisMonth,
      clientsLastMonth,
      activeClients,
      totalLeads,
      newLeadsThisMonth,
      leadsLastMonth,
      leadsByStatus,
      pendingQuotes,
      quoteStats,
      recurringValue,
      activeContracts,
      contractsThisMonth,
      contractsLastMonth,
      todaysJobs,
      upcomingJobs,
      jobsByStatus,
      recentLeads,
      recentClients,
      recentQuotes,
      recentCompletedJobs,
    ] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n FROM clients`,
      sql`SELECT COUNT(*)::int AS n FROM clients WHERE created_at >= date_trunc('month', now())`,
      sql`SELECT COUNT(*)::int AS n FROM clients WHERE created_at >= date_trunc('month', now() - interval '1 month') AND created_at < date_trunc('month', now())`,
      sql`SELECT COUNT(*)::int AS n FROM clients WHERE status = 'Active'`,
      sql`SELECT COUNT(*)::int AS n FROM leads`,
      sql`SELECT COUNT(*)::int AS n FROM leads WHERE created_at >= date_trunc('month', now())`,
      sql`SELECT COUNT(*)::int AS n FROM leads WHERE created_at >= date_trunc('month', now() - interval '1 month') AND created_at < date_trunc('month', now())`,
      sql`SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status`,
      sql`SELECT COUNT(*)::int AS n FROM quotes WHERE status = 'Sent'`,
      sql`SELECT status, COUNT(*)::int AS n FROM quotes GROUP BY status`,
      sql`SELECT COALESCE(SUM(contract_amount), 0)::float AS total FROM clients WHERE status = 'Active'`,
      sql`SELECT COUNT(*)::int AS n FROM contracts WHERE status = 'Active'`,
      sql`SELECT COUNT(*)::int AS n FROM contracts WHERE created_at >= date_trunc('month', now())`,
      sql`SELECT COUNT(*)::int AS n FROM contracts WHERE created_at >= date_trunc('month', now() - interval '1 month') AND created_at < date_trunc('month', now())`,
      sql`SELECT COUNT(*)::int AS n FROM jobs WHERE scheduled_date = CURRENT_DATE AND status IN ('Scheduled', 'In Progress')`,
      sql`SELECT COUNT(*)::int AS n FROM jobs WHERE scheduled_date > CURRENT_DATE AND scheduled_date <= CURRENT_DATE + INTERVAL '7 days' AND status = 'Scheduled'`,
      sql`SELECT status, COUNT(*)::int AS n FROM jobs GROUP BY status`,
      sql`SELECT name, company, created_at FROM leads ORDER BY created_at DESC LIMIT 5`,
      sql`SELECT name, company, created_at FROM clients ORDER BY created_at DESC LIMIT 5`,
      sql`SELECT c.name AS client_name, q.created_at FROM quotes q JOIN clients c ON c.id = q.client_id ORDER BY q.created_at DESC LIMIT 5`,
      sql`SELECT c.name AS client_name, j.completed_at FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.status = 'Completed' AND j.completed_at IS NOT NULL ORDER BY j.completed_at DESC LIMIT 5`,
    ]);

    const quoteStatusMap = {};
    quoteStats.forEach((r) => { quoteStatusMap[r.status] = r.n; });
    const decided = (quoteStatusMap.Accepted || 0) + (quoteStatusMap.Declined || 0);
    const conversionRate = decided > 0 ? Math.round(((quoteStatusMap.Accepted || 0) / decided) * 100) : null;

    const activity = [
      ...recentLeads.map((r) => ({ type: 'lead', label: 'New Lead Added', detail: r.company ? `${r.name} — ${r.company}` : r.name, at: r.created_at })),
      ...recentClients.map((r) => ({ type: 'client', label: 'New Client Added', detail: r.company ? `${r.name} — ${r.company}` : r.name, at: r.created_at })),
      ...recentQuotes.map((r) => ({ type: 'quote', label: 'New Quote Created', detail: r.client_name, at: r.created_at })),
      ...recentCompletedJobs.map((r) => ({ type: 'job', label: 'Job Completed', detail: r.client_name, at: r.completed_at })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6);

    res.status(200).json({
      totalClients: totalClients[0].n,
      clientsTrend: pctChange(clientsThisMonth[0].n, clientsLastMonth[0].n),
      activeClients: activeClients[0].n,
      totalLeads: totalLeads[0].n,
      newLeadsThisMonth: newLeadsThisMonth[0].n,
      leadsTrend: pctChange(newLeadsThisMonth[0].n, leadsLastMonth[0].n),
      leadsByStatus: leadsByStatus.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {}),
      pendingQuotes: pendingQuotes[0].n,
      quotesByStatus: quoteStatusMap,
      quoteConversionRate: conversionRate,
      monthlyRecurringValue: recurringValue[0].total,
      activeContracts: activeContracts[0].n,
      contractsTrend: pctChange(contractsThisMonth[0].n, contractsLastMonth[0].n),
      todaysJobs: todaysJobs[0].n,
      upcomingJobs: upcomingJobs[0].n,
      jobsByStatus: jobsByStatus.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {}),
      recentActivity: activity,
    });
  } catch (err) {
    console.error('Failed to load dashboard stats:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
};
