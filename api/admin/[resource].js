// Vercel's Hobby plan caps a deployment at 12 Serverless Functions. Every
// admin endpoint lives at a single path segment (/api/admin/<name>), so this
// one dynamic route dispatches all of them to handlers under lib/handlers/
// (which aren't in /api and therefore don't count against that limit).
const RESOURCE_HANDLERS = {
  dashboard: require('../../lib/handlers/dashboard'),
  leads: require('../../lib/handlers/leads'),
  clients: require('../../lib/handlers/clients'),
  quotes: require('../../lib/handlers/quotes'),
  contracts: require('../../lib/handlers/contracts'),
  employees: require('../../lib/handlers/employees'),
  jobs: require('../../lib/handlers/jobs'),
  invoices: require('../../lib/handlers/invoices'),
  expenses: require('../../lib/handlers/expenses'),
  supplies: require('../../lib/handlers/supplies'),
  reports: require('../../lib/handlers/reports'),
  content: require('../../lib/handlers/content'),
  upload: require('../../lib/handlers/upload'),
  login: require('../../lib/handlers/login'),
  logout: require('../../lib/handlers/logout'),
  session: require('../../lib/handlers/session'),
};

module.exports = async (req, res) => {
  const handler = RESOURCE_HANDLERS[req.query.resource];
  if (!handler) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  return handler(req, res);
};
