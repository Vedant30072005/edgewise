/**
 * Edgewise — database layer (PostgreSQL via node-postgres)
 * Schema is created on first run via initSchema() called from server.js.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

/** Run a query and return all rows. */
async function all(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** Run a query and return the first row or null. */
async function get(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] ?? null;
}

/** Run a query and return the raw pg Result. */
async function run(sql, params = []) {
  return pool.query(sql, params);
}

/** Create all tables if they don't exist. Idempotent — safe to call on every boot. */
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                     SERIAL PRIMARY KEY,
      email                  TEXT NOT NULL,
      name                   TEXT NOT NULL,
      password_hash          TEXT NOT NULL,
      role                   TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
      plan                   TEXT NOT NULL DEFAULT 'free',
      is_active              INTEGER NOT NULL DEFAULT 1,
      email_verified         INTEGER NOT NULL DEFAULT 0,
      email_verify_token     TEXT,
      email_verify_expires   BIGINT,
      password_reset_token   TEXT,
      password_reset_expires BIGINT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

    CREATE TABLE IF NOT EXISTS trades (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trade_date  TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      side        TEXT NOT NULL CHECK (side IN ('long','short')),
      entry_price REAL NOT NULL CHECK (entry_price > 0),
      exit_price  REAL NOT NULL CHECK (exit_price > 0),
      quantity    REAL NOT NULL CHECK (quantity > 0),
      risk_amount REAL NOT NULL CHECK (risk_amount > 0),
      setup_tag   TEXT NOT NULL DEFAULT 'untagged',
      mood        TEXT NOT NULL DEFAULT 'neutral'
                  CHECK (mood IN ('calm','neutral','fomo','revenge','fear','overconfident')),
      notes       TEXT NOT NULL DEFAULT '',
      pnl         REAL NOT NULL,
      r_multiple  REAL NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_trades_user_date ON trades(user_id, trade_date, id);

    CREATE TABLE IF NOT EXISTS risk_settings (
      user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      daily_loss_limit_r REAL,
      max_risk_amount    REAL,
      cooldown_minutes   INTEGER
    );

    CREATE TABLE IF NOT EXISTS violations (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trade_id   INTEGER REFERENCES trades(id) ON DELETE SET NULL,
      rule       TEXT NOT NULL,
      detail     TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_violations_user ON violations(user_id, created_at);
  `);
}

/** Seed admin account from environment if it does not exist. */
async function seedAdmin() {
  const bcrypt = require('bcryptjs');
  const email = process.env.ADMIN_EMAIL || 'admin@edgewise.local';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe!123';
  const existing = await get('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (!existing) {
    const hash = await bcrypt.hash(password, 12);
    await run(
      `INSERT INTO users (email, name, password_hash, role, plan, email_verified)
       VALUES ($1, $2, $3, 'admin', 'pro', 1)`,
      [email, 'Admin', hash]
    );
    console.log(`[edgewise] Seeded admin account: ${email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('[edgewise] WARNING: using default admin password. Set ADMIN_PASSWORD in env.');
    }
  }
  /* Admins are always pro and pre-verified. */
  await run(`UPDATE users SET plan='pro', email_verified=1 WHERE role='admin'`);
}

module.exports = { pool, all, get, run, initSchema, seedAdmin };
