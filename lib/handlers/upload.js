const { put } = require('@vercel/blob');
const { requireAuth, isSameOrigin } = require('../auth');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 4 * 1024 * 1024; // stay under Vercel's serverless request body limit

function safeExt(filename, contentType) {
  const fromType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[contentType];
  if (fromType) return fromType;
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename || '');
  return match ? match[1].toLowerCase() : 'bin';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    res.status(500).json({ error: 'File storage is not configured' });
    return;
  }

  const body = req.body || {};
  const { filename, contentType, dataBase64, folder } = body;

  if (!ALLOWED_TYPES.includes(contentType)) {
    res.status(400).json({ error: 'Unsupported file type' });
    return;
  }
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    res.status(400).json({ error: 'No file data provided' });
    return;
  }

  const safeFolder = folder === 'contracts' ? 'contracts' : 'jobs';

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    res.status(400).json({ error: 'Invalid file data' });
    return;
  }
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    res.status(400).json({ error: 'File must be under 4MB' });
    return;
  }

  try {
    const ext = safeExt(filename, contentType);
    const key = `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const putOptions = { access: 'public', contentType };
    if (process.env.BLOB_READ_WRITE_TOKEN) putOptions.token = process.env.BLOB_READ_WRITE_TOKEN;
    const blob = await put(key, buffer, putOptions);
    res.status(200).json({ ok: true, url: blob.url });
  } catch (err) {
    console.error('Failed to upload file:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
};
