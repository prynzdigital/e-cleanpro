const { neon } = require('@neondatabase/serverless');

// Vercel's Neon integration (Storage tab -> Postgres) injects several env var
// names depending on setup flow; DATABASE_URL is the current standard one,
// with POSTGRES_URL kept as a fallback for older-style provisioning.
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = connectionString ? neon(connectionString) : null;

let schemaReady = null;

// Idempotent — safe to call on every request. Cached per warm serverless
// instance so it only actually hits the database once per cold start.
async function ensureSchema() {
  if (!sql) throw new Error('DATABASE_URL (or POSTGRES_URL) is not configured');
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    // One-time migration: the CRM pipeline table was originally called
    // "bookings" (public-facing booking form submissions). It's now framed
    // as "Leads" in the admin CRM. Renaming preserves existing rows instead
    // of creating a second empty table.
    await sql`ALTER TABLE IF EXISTS bookings RENAME TO leads;`;

    await sql`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT,
        phone TEXT NOT NULL,
        email TEXT,
        address TEXT,
        preferred_date TEXT,
        preferred_time TEXT,
        notes TEXT,
        estimate JSONB,
        status TEXT NOT NULL DEFAULT 'New',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    // Older schema had email/address as NOT NULL; relax to match manual
    // lead entry (name + phone only are required).
    await sql`ALTER TABLE leads ALTER COLUMN email DROP NOT NULL;`;
    await sql`ALTER TABLE leads ALTER COLUMN address DROP NOT NULL;`;

    await sql`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT,
        phone TEXT NOT NULL,
        email TEXT,
        address TEXT,
        service_type TEXT,
        square_footage NUMERIC,
        cleaning_frequency TEXT,
        contract_amount NUMERIC,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'Active',
        source_lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS quotes (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        property_address TEXT,
        square_footage NUMERIC,
        services TEXT,
        cleaning_frequency TEXT,
        price NUMERIC,
        status TEXT NOT NULL DEFAULT 'Draft',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS site_content (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        position TEXT,
        pay_rate NUMERIC,
        availability TEXT,
        status TEXT NOT NULL DEFAULT 'Active',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
        property_address TEXT,
        start_date DATE,
        end_date DATE,
        monthly_price NUMERIC,
        services TEXT,
        status TEXT NOT NULL DEFAULT 'Active',
        signed_contract_url TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        location TEXT,
        scheduled_date DATE,
        scheduled_time TEXT,
        cleaning_type TEXT,
        status TEXT NOT NULL DEFAULT 'Scheduled',
        checklist JSONB,
        notes TEXT,
        photos JSONB,
        hours NUMERIC,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        amount NUMERIC NOT NULL,
        due_date DATE,
        status TEXT NOT NULL DEFAULT 'Unpaid',
        payment_method TEXT,
        paid_date DATE,
        notes TEXT,
        service_location TEXT,
        service_dates TEXT,
        payment_terms TEXT,
        discount NUMERIC NOT NULL DEFAULT 0,
        line_items JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    // invoices predates these columns in production; CREATE TABLE IF NOT
    // EXISTS above is a no-op once the table already exists, so the new
    // columns need their own explicit, idempotent migration.
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_location TEXT;`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_dates TEXT;`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms TEXT;`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount NUMERIC NOT NULL DEFAULT 0;`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items JSONB;`;

    await sql`
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        category TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
        vendor TEXT,
        description TEXT,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        receipt_url TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS supplies (
        id SERIAL PRIMARY KEY,
        item_name TEXT NOT NULL,
        quantity NUMERIC NOT NULL DEFAULT 0,
        reorder_threshold NUMERIC,
        unit_cost NUMERIC,
        supplier TEXT,
        last_ordered_date DATE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        type TEXT NOT NULL DEFAULT 'Review',
        rating INTEGER,
        source TEXT,
        comment TEXT,
        status TEXT NOT NULL DEFAULT 'New',
        resolution TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Admin',
        status TEXT NOT NULL DEFAULT 'Active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    // One-time migration: seed the database from the original env-var admin
    // (ADMIN_USERNAME / ADMIN_PASSWORD_HASH) so existing credentials keep
    // working once login switches from env vars to DB-backed multi-user
    // accounts. Only runs while the table is empty.
    const existingUserCount = await sql`SELECT COUNT(*)::int AS n FROM admin_users`;
    if (existingUserCount[0].n === 0 && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH) {
      await sql`
        INSERT INTO admin_users (username, password_hash, role, status)
        VALUES (${process.env.ADMIN_USERNAME}, ${process.env.ADMIN_PASSWORD_HASH}, 'Owner', 'Active')
        ON CONFLICT (username) DO NOTHING
      `;
    }

    await sql`
      CREATE TABLE IF NOT EXISTS job_postings (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        location TEXT,
        employment_type TEXT,
        description TEXT,
        requirements TEXT,
        status TEXT NOT NULL DEFAULT 'Open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    // Career applications. gov_id / ssn document bytes are stored as base64
    // TEXT (not Blob, not bytea) -- this data never gets a public URL and is
    // only ever served back out through the authenticated admin document
    // endpoint. Base64-in-TEXT sidesteps any ambiguity in how the Postgres
    // wire driver handles bytea, matching every other blob-ish field
    // (JSONB, estimates) that already round-trips reliably as text here.
    await sql`
      CREATE TABLE IF NOT EXISTS job_applications (
        id SERIAL PRIMARY KEY,
        job_posting_id INTEGER REFERENCES job_postings(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        work_authorized BOOLEAN NOT NULL DEFAULT false,
        expertise JSONB,
        resume_url TEXT,
        status TEXT NOT NULL DEFAULT 'Under Review',
        upload_token TEXT UNIQUE,
        gov_id_filename TEXT,
        gov_id_content_type TEXT,
        gov_id_base64 TEXT,
        ssn_doc_filename TEXT,
        ssn_doc_content_type TEXT,
        ssn_doc_base64 TEXT,
        documents_submitted_at TIMESTAMPTZ,
        admin_notes TEXT,
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
  })();

  return schemaReady;
}

module.exports = { sql, ensureSchema };
