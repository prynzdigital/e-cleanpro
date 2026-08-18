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
    await sql`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        address TEXT NOT NULL,
        preferred_date TEXT,
        preferred_time TEXT,
        notes TEXT,
        estimate JSONB,
        status TEXT NOT NULL DEFAULT 'New',
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
  })();

  return schemaReady;
}

module.exports = { sql, ensureSchema };
