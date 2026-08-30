const crypto = require('crypto');
const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');
const { sendEmail, escapeHtml, wrapEmail } = require('../email');
const { logAudit } = require('../audit');

const STATUS_VALUES = ['Under Review', 'Background Check', 'Background Check Review', 'Approved', 'Rejected', 'Hired'];

async function fetchApplicationById(id) {
  const rows = await sql`
    SELECT
      a.id, a.job_posting_id, a.name, a.email, a.phone, a.address, a.zip_code,
      a.work_authorized, a.expertise, a.race, a.veteran_status, a.military_status,
      a.resume_url, a.status, a.gov_id_filename, a.ssn_doc_filename, a.documents_submitted_at,
      a.admin_notes, a.employee_id, a.created_at,
      jp.title AS job_title
    FROM job_applications a
    LEFT JOIN job_postings jp ON jp.id = a.job_posting_id
    WHERE a.id = ${id}
  `;
  return rows[0];
}

function siteOrigin(req) {
  const host = req.headers.host;
  return `https://${host}`;
}

module.exports = async (req, res) => {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const documentType = req.query.document;
    const id = Number(req.query.id);

    if (documentType) {
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid application id' });
        return;
      }
      if (documentType !== 'govId' && documentType !== 'ssnDoc') {
        res.status(400).json({ error: 'Invalid document type' });
        return;
      }
      try {
        await ensureSchema();
        const rows = documentType === 'govId'
          ? await sql`SELECT gov_id_base64 AS data, gov_id_content_type AS content_type, gov_id_filename AS filename FROM job_applications WHERE id = ${id}`
          : await sql`SELECT ssn_doc_base64 AS data, ssn_doc_content_type AS content_type, ssn_doc_filename AS filename FROM job_applications WHERE id = ${id}`;
        const row = rows[0];
        if (!row || !row.data) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        const buffer = Buffer.from(row.data, 'base64');
        res.statusCode = 200;
        res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${(row.filename || 'document').replace(/["\r\n]/g, '')}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.end(buffer);
      } catch (err) {
        console.error('Failed to fetch application document:', err);
        res.status(500).json({ error: 'Failed to fetch document' });
      }
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        SELECT
          a.id, a.job_posting_id, a.name, a.email, a.phone, a.address, a.zip_code,
          a.work_authorized, a.expertise, a.race, a.veteran_status, a.military_status,
          a.resume_url, a.status, a.gov_id_filename, a.ssn_doc_filename, a.documents_submitted_at,
          a.admin_notes, a.employee_id, a.created_at,
          jp.title AS job_title
        FROM job_applications a
        LEFT JOIN job_postings jp ON jp.id = a.job_posting_id
        ORDER BY a.created_at DESC
        LIMIT 1000
      `;
      res.status(200).json({ applications: rows, statuses: STATUS_VALUES });
    } catch (err) {
      console.error('Failed to fetch applications:', err);
      res.status(500).json({ error: 'Failed to fetch applications' });
    }
    return;
  }

  if (req.method === 'PUT') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid application id' });
      return;
    }

    const body = req.body || {};
    const { action, adminNotes } = body;

    try {
      await ensureSchema();
      const current = await fetchApplicationById(id);
      if (!current) {
        res.status(404).json({ error: 'Application not found' });
        return;
      }

      if (action === 'accept-background-check') {
        if (current.status !== 'Under Review') {
          res.status(400).json({ error: 'Application must be Under Review to move to background check' });
          return;
        }
        const token = crypto.randomBytes(32).toString('base64url');
        await sql`UPDATE job_applications SET status = 'Background Check', upload_token = ${token} WHERE id = ${id}`;

        const uploadUrl = `${siteOrigin(req)}/careers-upload.html?token=${token}`;
        await sendEmail({
          to: current.email,
          subject: 'Next Step: Upload Your Documents — E-Clean Pro Services',
          html: wrapEmail(`
            <p>Hi ${escapeHtml(current.name.split(' ')[0])},</p>
            <p>Good news — your application${current.job_title ? ` for <strong>${escapeHtml(current.job_title)}</strong>` : ''} has moved forward to the background check stage.</p>
            <p>To continue, please upload a government-issued ID (driver's license or state ID) and your Social Security card using the secure link below:</p>
            <p style="margin:20px 0;"><a href="${uploadUrl}" style="background:#0e7d70; color:#fff; padding:12px 24px; border-radius:99px; text-decoration:none; font-weight:700;">Upload Documents</a></p>
            <p style="font-size:12.5px; color:#666;">This link is unique to your application and should not be shared. If the button doesn't work, copy this link into your browser:<br>${uploadUrl}</p>
          `),
        }).catch((err) => console.error('Failed to send background-check email:', err));

      } else if (action === 'reject') {
        if (['Rejected', 'Hired'].includes(current.status)) {
          res.status(400).json({ error: 'Application is already closed out' });
          return;
        }
        await sql`UPDATE job_applications SET status = 'Rejected' WHERE id = ${id}`;

        await sendEmail({
          to: current.email,
          subject: 'Update on Your Application — E-Clean Pro Services',
          html: wrapEmail(`
            <p>Hi ${escapeHtml(current.name.split(' ')[0])},</p>
            <p>Thank you for your interest in joining E-Clean Pro Services${current.job_title ? ` for the <strong>${escapeHtml(current.job_title)}</strong> position` : ''}, and for taking the time to apply.</p>
            <p>After careful consideration, we've decided to move forward with other candidates at this time. This decision isn't a reflection of your qualifications, and we encourage you to apply again for future openings that match your experience.</p>
            <p>We wish you the best in your job search.</p>
          `),
        }).catch((err) => console.error('Failed to send rejection email:', err));

      } else if (action === 'approve') {
        if (current.status !== 'Background Check Review') {
          res.status(400).json({ error: 'Application must have submitted background check documents first' });
          return;
        }
        await sql`UPDATE job_applications SET status = 'Approved' WHERE id = ${id}`;

      } else if (action === 'convert-to-employee') {
        if (current.status !== 'Approved') {
          res.status(400).json({ error: 'Application must be Approved before converting to an employee' });
          return;
        }
        if (current.employee_id) {
          res.status(400).json({ error: 'This application has already been converted to an employee' });
          return;
        }
        const empRows = await sql`
          INSERT INTO employees (name, phone, status, notes)
          VALUES (${current.name}, ${current.phone}, 'Waiting List', ${'Hired via careers application #' + id + '. Email: ' + current.email})
          RETURNING id
        `;
        const employeeId = empRows[0].id;
        await sql`UPDATE job_applications SET status = 'Hired', employee_id = ${employeeId} WHERE id = ${id}`;

        await sendEmail({
          to: current.email,
          subject: 'Congratulations! Welcome to E-Clean Pro Services',
          html: wrapEmail(`
            <p>Hi ${escapeHtml(current.name.split(' ')[0])},</p>
            <p><strong>Congratulations!</strong> You've successfully passed our background check and we're excited to welcome you to the E-Clean Pro Services team.</p>
            <p>You are currently on our waiting list and will be contacted as soon as a job assignment becomes available. We'll be in touch soon with next steps.</p>
            <p>Welcome aboard!</p>
          `),
        }).catch((err) => console.error('Failed to send congratulations email:', err));

      } else if (adminNotes !== undefined) {
        await sql`UPDATE job_applications SET admin_notes = ${adminNotes || null} WHERE id = ${id}`;
      } else {
        res.status(400).json({ error: 'No valid action or update provided' });
        return;
      }

      const full = await fetchApplicationById(id);
      await logAudit(req, { action: action || 'update-notes', resource: 'applications', resourceId: id });
      res.status(200).json({ ok: true, application: full });
    } catch (err) {
      console.error('Failed to update application:', err);
      res.status(500).json({ error: 'Failed to update application' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid application id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM job_applications WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Application not found' });
        return;
      }
      await logAudit(req, { action: 'delete', resource: 'applications', resourceId: id });
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete application:', err);
      res.status(500).json({ error: 'Failed to delete application' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
