const { verifyPassword, createSessionToken, setSessionCookie, isSameOrigin, getUserByUsername } = require('../auth');

// Simple per-instance rate limit. Resets on cold start -- not a substitute
// for the bcrypt cost factor + strong password, just an extra speed bump.
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function tooManyAttempts(key) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  record.count += 1;
  return record.count > MAX_ATTEMPTS;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!isSameOrigin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (tooManyAttempts(ip)) {
    res.status(429).json({ error: 'Too many attempts. Try again later.' });
    return;
  }

  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Missing credentials' });
    return;
  }

  let user;
  try {
    user = await getUserByUsername(username);
  } catch (err) {
    console.error('Login lookup failed:', err);
    res.status(500).json({ error: 'Login is temporarily unavailable' });
    return;
  }

  if (!user || user.status !== 'Active') {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = createSessionToken(user);
  setSessionCookie(res, token);
  res.status(200).json({ ok: true, role: user.role, userId: user.id });
};
