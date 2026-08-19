const { getSession, getActiveUserById } = require('../auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const tokenSession = getSession(req);
  if (!tokenSession || !tokenSession.userId) {
    res.status(200).json({ authenticated: false, username: null, role: null, userId: null });
    return;
  }

  let user = null;
  try {
    user = await getActiveUserById(tokenSession.userId);
  } catch (err) {
    console.error('Session check failed:', err);
  }

  res.status(200).json({
    authenticated: !!user,
    username: user ? user.username : null,
    role: user ? user.role : null,
    userId: user ? user.id : null,
  });
};
