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
  })();

  return schemaReady;
}

module.exports = { sql, ensureSchema };
