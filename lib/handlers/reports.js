const { sql, ensureSchema } = require('../db');
const { requireAuth } = require('../auth');

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
      revenueByMonth,
      expensesByCategory,
      expensesByMonth,
      jobStatusCounts,
      leadStatusCounts,
      totalPaidRevenue,
      totalExpenses,
      unpaidTotal,
      overdueTotal,
    ] = await Promise.all([
      sql`
        SELECT to_char(date_trunc('month', paid_date), 'YYYY-MM') AS month, COALESCE(SUM(amount), 0)::float AS total
        FROM invoices
        WHERE status = 'Paid' AND paid_date >= date_trunc('month', now() - interval '5 months')
        GROUP BY 1 ORDER BY 1
      `,
      sql`
        SELECT category, COALESCE(SUM(amount), 0)::float AS total
        FROM expenses
        WHERE expense_date >= date_trunc('month', now() - interval '5 months')
        GROUP BY category ORDER BY total DESC
      `,
      sql`
        SELECT to_char(date_trunc('month', expense_date), 'YYYY-MM') AS month, COALESCE(SUM(amount), 0)::float AS total
        FROM expenses
        WHERE expense_date >= date_trunc('month', now() - interval '5 months')
        GROUP BY 1 ORDER BY 1
      `,
      sql`SELECT status, COUNT(*)::int AS n FROM jobs GROUP BY status`,
      sql`SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status`,
      sql`SELECT COALESCE(SUM(amount), 0)::float AS total FROM invoices WHERE status = 'Paid'`,
      sql`SELECT COALESCE(SUM(amount), 0)::float AS total FROM expenses`,
      sql`SELECT COALESCE(SUM(amount), 0)::float AS total FROM invoices WHERE status = 'Unpaid'`,
      sql`SELECT COALESCE(SUM(amount), 0)::float AS total FROM invoices WHERE status = 'Overdue'`,
    ]);

    const jobStatusMap = jobStatusCounts.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
    const totalJobs = Object.values(jobStatusMap).reduce((a, b) => a + b, 0);
    const completedJobs = jobStatusMap.Completed || 0;
    const jobCompletionRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : null;

    const leadStatusMap = leadStatusCounts.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
    const totalLeads = Object.values(leadStatusMap).reduce((a, b) => a + b, 0);
    const wonLeads = leadStatusMap.Won || 0;
    const leadConversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : null;

    res.status(200).json({
      revenueByMonth,
      expensesByCategory,
      expensesByMonth,
      jobStatusCounts: jobStatusMap,
      jobCompletionRate,
      leadStatusCounts: leadStatusMap,
      leadConversionRate,
      totalPaidRevenue: totalPaidRevenue[0].total,
      totalExpenses: totalExpenses[0].total,
      netProfit: totalPaidRevenue[0].total - totalExpenses[0].total,
      unpaidTotal: unpaidTotal[0].total,
      overdueTotal: overdueTotal[0].total,
    });
  } catch (err) {
    console.error('Failed to load reports:', err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
};
