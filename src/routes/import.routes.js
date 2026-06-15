/** Edgewise — /api/import routes (CSV bulk import) */
const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { validateTrade } = require('../tradeValidator');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.match(/\.csv$/i)) return cb(new Error('Only CSV files are allowed.'));
    cb(null, true);
  },
});

/* ── simple CSV parser (RFC 4180, no dependencies) ──────────────*/
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];
  const parseRow = (line) => {
    const cells = [];
    let inQ = false, cell = '';
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cell.trim()); cell = ''; }
      else { cell += ch; }
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, ''));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cells = parseRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    return obj;
  });
}

/* ── flexible column aliases ─────────────────────────────────── */
const ALIASES = {
  trade_date:   ['date', 'trade_date', 'tradedate', 'trade_date_', 'day'],
  symbol:       ['symbol', 'ticker', 'sym', 'instrument', 'stock', 'asset'],
  side:         ['side', 'direction', 'type', 'long_short', 'buy_sell'],
  entry_price:  ['entry', 'entry_price', 'entryprice', 'entry_px', 'open', 'buy_price', 'open_price'],
  exit_price:   ['exit', 'exit_price', 'exitprice', 'exit_px', 'close', 'sell_price', 'close_price'],
  quantity:     ['qty', 'quantity', 'size', 'shares', 'contracts', 'lots', 'amount', 'volume'],
  risk_amount:  ['risk', 'risk_amount', 'riskamount', 'risk_per_trade', 'stop_loss_amount'],
  setup_tag:    ['setup', 'setup_tag', 'setuptag', 'strategy', 'pattern', 'tag', 'setup_name'],
  mood:         ['mood', 'emotion', 'state', 'psychology', 'mindset', 'feeling'],
  notes:        ['notes', 'note', 'comment', 'comments', 'journal', 'description', 'remarks'],
};

function mapColumns(headers) {
  const map = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const found = headers.find(h => aliases.includes(h));
    if (found) map[field] = found;
  }
  return map;
}

/* ── import endpoint ─────────────────────────────────────────── */
router.post('/trades', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}` });
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const text = req.file.buffer.toString('utf8');
  const rows = parseCSV(text);
  if (!rows.length) return res.status(400).json({ error: 'File is empty or not a valid CSV.' });

  const firstRowKeys = Object.keys(rows[0]);
  const colMap = mapColumns(firstRowKeys);

  const required = ['trade_date', 'symbol', 'side', 'entry_price', 'exit_price', 'quantity', 'risk_amount'];
  const missing = required.filter(f => !colMap[f]);
  if (missing.length) {
    return res.status(400).json({
      error: `Cannot find required columns: ${missing.join(', ')}. Expected headers: date, symbol, side, entry, exit, qty, risk. Optional: setup, mood, notes.`,
    });
  }

  /* Tier check: cap free plan at 30/month. */
  let importLimit = rows.length;
  if (req.user.plan === 'free') {
    const month = new Date().toISOString().slice(0, 7);
    const used = db.prepare(`SELECT COUNT(*) c FROM trades WHERE user_id=? AND strftime('%Y-%m', created_at)=?`)
      .get(req.user.id, month).c;
    const available = Math.max(0, 30 - used);
    if (available === 0) {
      return res.status(402).json({ error: 'Free plan limit: 30 trades per month. Upgrade to Pro for unlimited imports.', code: 'PLAN_LIMIT' });
    }
    importLimit = Math.min(rows.length, available);
  }

  const insertStmt = db.prepare(
    `INSERT INTO trades (user_id, trade_date, symbol, side, entry_price, exit_price, quantity, risk_amount, setup_tag, mood, notes, pnl, r_multiple)
     VALUES (@user_id, @trade_date, @symbol, @side, @entry_price, @exit_price, @quantity, @risk_amount, @setup_tag, @mood, @notes, @pnl, @r_multiple)`
  );

  const imported = [];
  const skipped = [];
  const get = (row, field) => (colMap[field] ? (row[colMap[field]] || '').toString().trim() : '');

  db.transaction(() => {
    for (let i = 0; i < Math.min(rows.length, importLimit); i++) {
      const row = rows[i];
      const body = {
        trade_date:  get(row, 'trade_date'),
        symbol:      get(row, 'symbol'),
        side:        get(row, 'side').toLowerCase(),
        entry_price: get(row, 'entry_price'),
        exit_price:  get(row, 'exit_price'),
        quantity:    get(row, 'quantity'),
        risk_amount: get(row, 'risk_amount'),
        setup_tag:   get(row, 'setup_tag') || 'untagged',
        mood:        get(row, 'mood') || 'neutral',
        notes:       get(row, 'notes'),
      };
      const { trade, error } = validateTrade(body);
      if (error) { skipped.push({ row: i + 2, reason: error }); continue; }
      insertStmt.run({ ...trade, user_id: req.user.id });
      imported.push(trade.symbol);
    }
  })();

  const truncated = rows.length > importLimit ? rows.length - importLimit : 0;
  res.json({
    imported: imported.length,
    skipped,
    truncated,
    message: truncated > 0 ? `${truncated} rows skipped (free plan limit reached).` : undefined,
  });
});

module.exports = router;
