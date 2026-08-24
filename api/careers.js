const { put } = require('@vercel/blob');
const { sql, ensureSchema } = require('../lib/db');
const { sendEmail, escapeHtml, wrapEmail, BUSINESS_EMAIL } = require('../lib/email');

const RESUME_ALLOWED_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const DOC_ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024;

const EXPERTISE_OPTIONS = [
  'Commercial Cleaning Experience', 'Residential Cleaning Experience',
  'Floor Care (Stripping/Waxing/Buffing)', 'Carpet Cleaning Experience',
  'Window Cleaning Experience', 'Supervisory / Team Lead Experience',
  'Own Reliable Transportation', 'Available Weekends / Evenings',
  'Comfortable Working at Heights (Ladders)', 'Able to Lift 25+ lbs',
];

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  if (typeof phone !== 'string') return false;
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

async function handleList(req, res) {
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, title, location, employment_type, description, requirements, created_at
      FROM job_postings
      WHERE status = 'Open'
      ORDER BY created_at DESC
    `;
    res.status(200).json({ jobPostings: rows, expertiseOptions: EXPERTISE_OPTIONS });
  } catch (err) {
    console.error('Failed to list job postings:', err);
    res.status(500).json({ error: 'Failed to load job postings' });
  }
}

async function handleApply(req, res) {
  const body = req.body || {};
  const {
    jobPostingId, name, email, phone, workAuthorized, expertise,
    resumeFilename, resumeContentType, resumeBase64,
  } = body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ error: 'Please provide your full name.' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }
  if (!isValidPhone(phone)) {
    res.status(400).json({ error: 'Please provide a valid phone number.' });
    return;
  }
  if (workAuthorized !== true) {
    res.status(400).json({ error: 'You must confirm your work eligibility to apply.' });
    return;
  }
  if (!resumeBase64 || !RESUME_ALLOWED_TYPES.includes(resumeContentType)) {
    res.status(400).json({ error: 'Please attach your resume/CV or certificate (PDF, Word doc, or image).' });
    return;
  }

  let resumeUrl = null;
  try {
    const buffer = Buffer.from(resumeBase64, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      res.status(400).json({ error: 'File must be under 4MB.' });
      return;
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
      res.status(500).json({ error: 'File uploads are temporarily unavailable. Please try again later.' });
      return;
    }
    const extMap = {
      'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    };
    const ext = extMap[resumeContentType] || 'bin';
    const key = `resumes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const putOptions = { access: 'public', contentType: resumeContentType };
    if (process.env.BLOB_READ_WRITE_TOKEN) putOptions.token = process.env.BLOB_READ_WRITE_TOKEN;
    const blob = await put(key, buffer, putOptions);
    resumeUrl = blob.url;
  } catch (err) {
    console.error('Failed to upload resume:', err);
    res.status(500).json({ error: 'Failed to upload your resume. Please try again.' });
    return;
  }

  const expertiseList = Array.isArray(expertise) ? expertise.filter((e) => EXPERTISE_OPTIONS.includes(e)) : [];
  const jobPostingIdNum = Number(jobPostingId);

  let applicationId;
  let jobTitle = null;
  try {
    await ensureSchema();
    if (Number.isInteger(jobPostingIdNum) && jobPostingIdNum > 0) {
      const jp = await sql`SELECT title FROM job_postings WHERE id = ${jobPostingIdNum}`;
      jobTitle = jp[0] ? jp[0].title : null;
    }
    const rows = await sql`
      INSERT INTO job_applications (job_posting_id, name, email, phone, work_authorized, expertise, resume_url, status)
      VALUES (
        ${Number.isInteger(jobPostingIdNum) && jobPostingIdNum > 0 ? jobPostingIdNum : null},
        ${name.trim()}, ${email.trim()}, ${phone.trim()}, true,
        ${JSON.stringify(expertiseList)}, ${resumeUrl}, 'Under Review'
      )
      RETURNING id
    `;
    applicationId = rows[0].id;
  } catch (err) {
    console.error('Failed to save application:', err);
    res.status(500).json({ error: 'Failed to submit your application. Please try again.' });
    return;
  }

  const firstName = name.trim().split(' ')[0];
  sendEmail({
    to: email.trim(),
    subject: 'Application Under Review — E-Clean Pro Services',
    html: wrapEmail(`
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Thank you for applying${jobTitle ? ` for <strong>${escapeHtml(jobTitle)}</strong>` : ' to E-Clean Pro Services'}. We've received your application and it is currently <strong>under review</strong>.</p>
      <p>Our team will reach out if your qualifications are a match for the next steps. We appreciate your interest in joining our team!</p>
    `),
  }).catch((err) => console.error('Failed to send applicant email:', err));

  sendEmail({
    to: BUSINESS_EMAIL,
    subject: `New Application: ${name.trim()}${jobTitle ? ` — ${jobTitle}` : ''}`,
    html: wrapEmail(`
      <p>A new job application has been submitted.</p>
      <table cellpadding="6" style="border-collapse:collapse;">
        <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><strong>Email</strong></td><td>${escapeHtml(email)}</td></tr>
        <tr><td><strong>Phone</strong></td><td>${escapeHtml(phone)}</td></tr>
        <tr><td><strong>Position</strong></td><td>${escapeHtml(jobTitle || 'General Application')}</td></tr>
        <tr><td><strong>Expertise</strong></td><td>${escapeHtml(expertiseList.join(', ') || '—')}</td></tr>
      </table>
      <p>Review it in the admin dashboard under Careers &rarr; Applications.</p>
    `),
  }).catch((err) => console.error('Failed to send admin notification email:', err));

  res.status(200).json({ ok: true, applicationId });
}

async function handleCheckToken(req, res) {
  const token = req.query.token;
  if (!token || typeof token !== 'string') {
    res.status(400).json({ valid: false });
    return;
  }
  try {
    await ensureSchema();
    const rows = await sql`SELECT name FROM job_applications WHERE upload_token = ${token} AND status = 'Background Check'`;
    if (rows.length === 0) {
      res.status(200).json({ valid: false });
      return;
    }
    res.status(200).json({ valid: true, firstName: rows[0].name.split(' ')[0] });
  } catch (err) {
    console.error('Failed to check upload token:', err);
    res.status(500).json({ valid: false });
  }
}

async function handleUploadDocuments(req, res) {
  const body = req.body || {};
  const {
    token, govIdFilename, govIdContentType, govIdBase64,
    ssnDocFilename, ssnDocContentType, ssnDocBase64,
  } = body;

  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Missing upload token.' });
    return;
  }
  if (!govIdBase64 || !DOC_ALLOWED_TYPES.includes(govIdContentType)) {
    res.status(400).json({ error: 'Please attach a valid government-issued ID (PDF or image).' });
    return;
  }
  if (!ssnDocBase64 || !DOC_ALLOWED_TYPES.includes(ssnDocContentType)) {
    res.status(400).json({ error: 'Please attach a valid Social Security document (PDF or image).' });
    return;
  }

  const govIdBuffer = Buffer.from(govIdBase64, 'base64');
  const ssnDocBuffer = Buffer.from(ssnDocBase64, 'base64');
  if (govIdBuffer.length === 0 || govIdBuffer.length > MAX_BYTES || ssnDocBuffer.length === 0 || ssnDocBuffer.length > MAX_BYTES) {
    res.status(400).json({ error: 'Each file must be under 4MB.' });
    return;
  }

  try {
    await ensureSchema();
    const rows = await sql`SELECT id, name, email FROM job_applications WHERE upload_token = ${token} AND status = 'Background Check'`;
    if (rows.length === 0) {
      res.status(404).json({ error: 'This upload link is invalid or has already been used.' });
      return;
    }
    const application = rows[0];

    await sql`
      UPDATE job_applications SET
        status = 'Background Check Review',
        gov_id_filename = ${govIdFilename || 'id-document'},
        gov_id_content_type = ${govIdContentType},
        gov_id_base64 = ${govIdBuffer.toString('base64')},
        ssn_doc_filename = ${ssnDocFilename || 'ssn-document'},
        ssn_doc_content_type = ${ssnDocContentType},
        ssn_doc_base64 = ${ssnDocBuffer.toString('base64')},
        documents_submitted_at = now()
      WHERE id = ${application.id}
    `;

    const firstName = application.name.split(' ')[0];
    sendEmail({
      to: application.email,
      subject: 'Documents Received — Application Under Review (Background Check)',
      html: wrapEmail(`
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Thank you — we've received your documents. Your application is now <strong>under review (background check)</strong>.</p>
        <p>We'll be in touch once this step is complete. Thank you for your patience!</p>
      `),
    }).catch((err) => console.error('Failed to send doc-received email:', err));

    sendEmail({
      to: BUSINESS_EMAIL,
      subject: `Background Check Documents Submitted: ${application.name}`,
      html: wrapEmail(`
        <p><strong>${escapeHtml(application.name)}</strong> has uploaded their background check documents.</p>
        <p>Review them in the admin dashboard under Careers &rarr; Applications.</p>
      `),
    }).catch((err) => console.error('Failed to send admin doc-notification email:', err));

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Failed to save background check documents:', err);
    res.status(500).json({ error: 'Failed to submit your documents. Please try again.' });
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    if (req.query.action === 'check-token') return handleCheckToken(req, res);
    return handleList(req, res);
  }
  if (req.method === 'POST') {
    if (req.query.action === 'upload-documents') return handleUploadDocuments(req, res);
    return handleApply(req, res);
  }
  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
};
