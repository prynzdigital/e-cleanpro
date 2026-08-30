const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sql, ensureSchema } = require('./db');

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSessionToken(user) {
  const payload = base64url(JSON.stringify({
    uid: user.id, u: user.username, role: user.role, exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  }));
  const signature = hmac(payload);
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  let expectedSignature;
  try {
    expectedSignature = hmac(payload);
  } catch {
    return null;
  }
  if (!signature || !timingSafeEqual(signature, expectedSignature)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.exp || Date.now() > data.exp) return null;
  return { userId: data.uid, username: data.u, role: data.role };
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

// Cheap, DB-free check: is the cookie present and its signature/expiry valid?
// Does not confirm the account still exists or is active — see requireAuth.
function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return verifySessionToken(token);
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

// Lightweight CSRF mitigation for cookie-authenticated state-changing requests:
// same-origin fetches always send an Origin header matching the site's own host.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function getUserByUsername(username) {
  await ensureSchema();
  const rows = await sql`SELECT id, username, password_hash, role, status FROM admin_users WHERE username = ${username}`;
  return rows[0] || null;
}

async function getActiveUserById(id) {
  if (!id) return null;
  await ensureSchema();
  const rows = await sql`SELECT id, username, role, status FROM admin_users WHERE id = ${id} AND status = 'Active'`;
  return rows[0] || null;
}

// Call at the top of any protected admin route. Returns the session if
// valid, otherwise sends a 401 response itself and returns null.
//
// Re-checks the account against the database on every call rather than
// trusting the signed cookie alone, so deactivating or deleting a user (or
// changing their role) takes effect on their very next request instead of
// waiting up to 7 days for the existing session token to expire.
async function requireAuth(req, res) {
  const tokenSession = getSession(req);
  if (!tokenSession || !tokenSession.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }

  let user;
  try {
    user = await getActiveUserById(tokenSession.userId);
  } catch (err) {
    console.error('Failed to verify session against database:', err);
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  const session = { userId: user.id, username: user.username, role: user.role };
  // Also available for anything reading req directly (e.g. audit logging)
  // without needing the handler to thread the return value through.
  req.adminUser = session;
  return session;
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
  hashPassword,
  isSameOrigin,
  requireAuth,
  getUserByUsername,
  getActiveUserById,
};
