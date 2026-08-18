const { getSession } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const session = getSession(req);
  res.status(200).json({ authenticated: !!session, username: session ? session.username : null });
};
