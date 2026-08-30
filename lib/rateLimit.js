// Simple per-instance rate limit, keyed by caller IP. Resets on cold start --
// not a substitute for a real distributed limiter, just an extra speed bump
// against scripted abuse of public endpoints. Same approach already used by
// login.js, pulled out here so every public POST endpoint can share it.
const buckets = new Map();

function isRateLimited(key, { maxAttempts, windowMs }) {
  const now = Date.now();
  const record = buckets.get(key);
  if (!record || now - record.first > windowMs) {
    buckets.set(key, { count: 1, first: now });
    return false;
  }
  record.count += 1;
  return record.count > maxAttempts;
}

function clientIp(req) {
  return req.headers['x-forwarded-for'] || 'unknown';
}

module.exports = { isRateLimited, clientIp };
