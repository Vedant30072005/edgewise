/**
 * Edgewise — database layer (SQLite via better-sqlite3)
 * Creates ./data/edgewise.db on first run and seeds the admin account
 * from .env (ADMIN_EMAIL / ADMIN_PASSWORD).
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// DATA_DIR lets the SQLite file live on a mounted persistent volume in
// production (e.g. DATA_DIR=/data). Falls back to ./data for local dev.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'edgewise.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_date  TEXT NOT NULL,                          -- YYYY-MM-DD
  symbol      TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('long','short')),
  entry_price REAL NOT NULL CHECK (entry_price > 0),
  exit_price  REAL NOT NULL CHECK (exit_price > 0),
  quantity    REAL NOT NULL CHECK (quantity > 0),
  risk_amount REAL NOT NULL CHECK (risk_amount > 0),  -- money risked = 1R
  setup_tag   TEXT NOT NULL DEFAULT 'untagged',
  mood        TEXT NOT NULL DEFAULT 'neutral'
              CHECK (mood IN ('calm','neutral','fomo','revenge','fear','overconfident')),
  notes       TEXT NOT NULL DEFAULT '',
  pnl         REAL NOT NULL,                          -- computed server-side
  r_multiple  REAL NOT NULL,                          -- pnl / risk_amount
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_user_date ON trades(user_id, trade_date, id);

CREATE TABLE IF NOT EXISTS risk_settings (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_loss_limit_r REAL,     -- e.g. 3 means stop at -3R on the day; NULL = off
  max_risk_amount    REAL,     -- cap on money risked per trade; NULL = off
  cooldown_minutes   INTEGER   -- min minutes after a logged loss; NULL = off
);

CREATE TABLE IF NOT EXISTS violations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id   INTEGER REFERENCES trades(id) ON DELETE SET NULL,
  rule       TEXT NOT NULL,    -- 'daily-loss-limit' | 'max-risk' | 'revenge-cooldown'
  detail     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_violations_user ON violations(user_id, created_at);
`);

/* Column migrations — runs on every start, safe to re-run. */
;(function migrate() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  const add = (col, def) => {
    if (!cols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  };
  add('plan',                   "TEXT NOT NULL DEFAULT 'free'");
  add('email_verified',         'INTEGER NOT NULL DEFAULT 0');
  add('email_verify_token',     'TEXT');
  add('email_verify_expires',   'INTEGER');
  add('password_reset_token',   'TEXT');
  add('password_reset_expires', 'INTEGER');
})();

/** Seed admin account from environment if it does not exist. */
function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@edgewise.local';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe!123';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(
      `INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')`
    ).run(email, 'Admin', hash);
    console.log(`[edgewise] Seeded admin account: ${email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('[edgewise] WARNING: using default admin password. Set ADMIN_PASSWORD in .env.');
    }
  }
  /* Admins are always pro and pre-verified. */
  db.prepare(`UPDATE users SET plan='pro', email_verified=1 WHERE role='admin'`).run();
}

module.exports = { db, seedAdmin };
