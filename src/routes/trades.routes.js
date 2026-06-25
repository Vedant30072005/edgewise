/** Edgewise — /api/trades routes (per-user journal) */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { csvCell } = require('../csv');
const { groupByKey } = require('../analytics');
const { MOODS, validateTrade } = require('../tradeValidator');
const { createMiddleware: rateLimiter } = require('../rateLimiter');

const router = express.Router();
router.use(requireAuth);

/* ── Rate limiters ─────────────────────────────────────────────── */
const createTradeLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100,
  message: 'Too many trades created. Limit: 100 per hour.',
});

const updateTradeLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 200,
  message: 'Too many trade updates. Limit: 200 per hour.',
});

/* ── STATS CACHE: invalidate on trade create/update/delete ── */
const statsCache = new Map(); // userId → { stats, timestamp }
const CACHE_TTL_MS = 300000; // 5 minutes
const MAX_CACHE_SIZE = 1000;  // cap entries to prevent unbounded memory growth

function cacheStatsForUser(userId, stats) {
  statsCache.set(userId, { stats, timestamp: Date.now() });
  // Evict oldest entries if cache exceeds max size
  if (statsCache.size > MAX_CACHE_SIZE) {
    const oldest = statsCache.keys().next().value;
    statsCache.delete(oldest);
  }
}

function getCachedStats(userId) {
  const cached = statsCache.get(userId);
  if (!cached) return null;
  // Return cache if still fresh (< TTL)
  if (Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.stats;
  // Expired: invalidate
  statsCache.delete(userId);
  return null;
}

function invalidateStatsCache(userId) {
  statsCache.delete(userId);
}

/* ── tier helper ──────────────────────────────────────────────── */
function tradesThisMonth(userId) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  return db.prepare(
    `SELECT COUNT(*) c FROM trades WHERE user_id=? AND strftime('%Y-%m', created_at)=?`
  ).get(userId, month).c;
}

/* ── risk guard ───────────────────────────────────────────────── */
function checkRiskRules(userId, trade) {
  const s = db.prepare('SELECT * FROM risk_settings WHERE user_id=?').get(userId);
  if (!s) return [];
  const found = [];
  if (s.max_risk_amount && trade.risk_amount > s.max_risk_amount) {
    found.push({ rule: 'max-risk', detail: `Risked ${trade.risk_amount} against your per-trade cap of ${s.max_risk_amount}.` });
  }
  if (s.daily_loss_limit_r) {
    const dayR = db
      .prepare('SELECT COALESCE(SUM(r_multiple),0) r FROM trades WHERE user_id=? AND trade_date=?')
      .get(userId, trade.trade_date).r;
    const after = dayR + trade.r_multiple;
    if (after < -s.daily_loss_limit_r) {
      found.push({ rule: 'daily-loss-limit', detail: `Day at ${after.toFixed(2)}R after this trade; your stop-day limit is -${s.daily_loss_limit_r}R.` });
    }
  }
  if (s.cooldown_minutes) {
    const prev = db
      .prepare(`SELECT r_multiple,
                  CAST((julianday('now') - julianday(created_at)) * 24 * 60 AS INTEGER) AS mins_ago
                FROM trades WHERE user_id=? ORDER BY id DESC LIMIT 1`)
      .get(userId);
    if (prev && prev.r_multiple < 0) {
      const mins = prev.mins_ago;
      if (mins >= 0 && mins < s.cooldown_minutes) {
        found.push({ rule: 'revenge-cooldown', detail: `Logged ${Math.max(1, mins)} min after a loss; your cooldown is ${s.cooldown_minutes} min.` });
      }
    }
  }
  return found;
}

/* ── list trades (filtered + paginated) ──────────────────────── */
router.get('/', (req, res) => {
  const { symbol, mood, setup, from, to, notes, limit = 200, offset = 0 } = req.query;
  let where = 'WHERE user_id=?';
  const params = [req.user.id];
  if (symbol) { where += ' AND symbol LIKE ?'; params.push(`%${symbol.toString().trim().toUpperCase()}%`); }
  if (mood && MOODS.includes(mood)) { where += ' AND mood=?'; params.push(mood); }
  if (setup) { where += ' AND setup_tag=?'; params.push(setup.toString().trim().toLowerCase()); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ' AND trade_date>=?'; params.push(from); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ' AND trade_date<=?'; params.push(to); }
  if (notes) { where += ' AND notes LIKE ?'; params.push(`%${notes.toString().trim()}%`); }
  const total = db.prepare(`SELECT COUNT(*) n FROM trades ${where}`).get(...params).n;
  const lim = Math.min(Math.max(parseInt(limit) || 200, 1), 500);
  const off = Math.max(parseInt(offset) || 0, 0);
  const rows = db.prepare(`SELECT * FROM trades ${where} ORDER BY trade_date ASC, id ASC LIMIT ? OFFSET ?`)
    .all(...params, lim, off);
  res.json({ trades: rows, total });
});

/* ── create ───────────────────────────────────────────────────── */
router.post('/', createTradeLimiter, (req, res) => {
  /* Tier enforcement: free plan = 30 trades per calendar month. */
  if (req.user.plan === 'free' && tradesThisMonth(req.user.id) >= 30) {
    return res.status(402).json({
      error: 'Free plan limit: 30 trades per month. Upgrade to Pro for unlimited logging.',
      code: 'PLAN_LIMIT',
    });
  }
  const { trade, error } = validateTrade(req.body || {});
  if (error) return res.status(400).json({ error });
  const violations = checkRiskRules(req.user.id, trade);
  const info = db.prepare(
    `INSERT INTO trades
     (user_id, trade_date, symbol, side, entry_price, exit_price, quantity,
      risk_amount, setup_tag, mood, notes, pnl, r_multiple)
     VALUES (@user_id, @trade_date, @symbol, @side, @entry_price, @exit_price, @quantity,
             @risk_amount, @setup_tag, @mood, @notes, @pnl, @r_multiple)`
  ).run({ ...trade, user_id: req.user.id });
  const insertV = db.prepare(`INSERT INTO violations (user_id, trade_id, rule, detail) VALUES (?,?,?,?)`);
  for (const v of violations) insertV.run(req.user.id, info.lastInsertRowid, v.rule, v.detail);
  const row = db.prepare('SELECT * FROM trades WHERE id=?').get(info.lastInsertRowid);
  invalidateStatsCache(req.user.id);
  res.status(201).json({ trade: row, violations });
});

/* ── update ───────────────────────────────────────────────────── */
router.put('/:id', updateTradeLimiter, (req, res) => {
  const existing = db.prepare('SELECT id FROM trades WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Trade not found.' });
  const { trade, error } = validateTrade(req.body || {});
  if (error) return res.status(400).json({ error });
  db.prepare(
    `UPDATE trades SET trade_date=@trade_date, symbol=@symbol, side=@side,
       entry_price=@entry_price, exit_price=@exit_price, quantity=@quantity,
       risk_amount=@risk_amount, setup_tag=@setup_tag, mood=@mood, notes=@notes,
       pnl=@pnl, r_multiple=@r_multiple WHERE id=@id AND user_id=@user_id`
  ).run({ ...trade, id: existing.id, user_id: req.user.id });
  const row = db.prepare('SELECT * FROM trades WHERE id=?').get(existing.id);
  invalidateStatsCache(req.user.id);
  res.json({ trade: row });
});

/* ── delete ───────────────────────────────────────────────────── */
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM trades WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Trade not found.' });
  invalidateStatsCache(req.user.id);
  res.json({ ok: true });
});

/* ── stats (always all-time, unfiltered) ─────────────────────── */
/**
 * Compute comprehensive trade statistics: equity curve, win rate, expectancy, max drawdown, etc.
 * @param {number} userId
 * @returns {Object} Stats object with curve, metrics, breakdown by setup/mood
 */
function computeStats(userId) {
  const rows = db
    .prepare(`SELECT trade_date, r_multiple, pnl, setup_tag, mood FROM trades WHERE user_id=? ORDER BY trade_date ASC, id ASC`)
    .all(userId);
  const n = rows.length;
  let equity = 0, peak = 0, maxDd = 0, wins = 0, grossWin = 0, grossLoss = 0;
  const curve = [0];
  for (const r of rows) {
    equity += r.r_multiple;
    curve.push(Math.round(equity * 100) / 100);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (r.r_multiple > 0) { wins += 1; grossWin += r.r_multiple; }
    else grossLoss += Math.abs(r.r_multiple);
  }

  /* Current consecutive streak. */
  let streak = { type: null, count: 0 };
  if (n > 0) {
    const isLastWin = rows[n - 1].r_multiple > 0;
    streak.type = isLastWin ? 'win' : 'loss';
    for (let i = n - 1; i >= 0; i--) {
      if ((rows[i].r_multiple > 0) === isLastWin) streak.count++;
      else break;
    }
  }

  /* Monthly net R aggregation (for performance bar chart). */
  const monthMap = new Map();
  for (const r of rows) {
    const mo = r.trade_date.slice(0, 7);
    const m = monthMap.get(mo) || { month: mo, trades: 0, totalR: 0, wins: 0 };
    m.trades += 1; m.totalR += r.r_multiple; if (r.r_multiple > 0) m.wins += 1;
    monthMap.set(mo, m);
  }
  const byMonth = [...monthMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({ ...m, totalR: Math.round(m.totalR * 100) / 100 }));

  return {
    totalTrades: n,
    netR: Math.round(equity * 100) / 100,
    winRate: n ? Math.round((wins / n) * 1000) / 10 : 0,
    expectancy: n ? Math.round((equity / n) * 100) / 100 : 0,
    maxDrawdownR: Math.round(maxDd * 100) / 100,
    profitFactor: grossLoss ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    curve,
    streak,
    byMonth,
    bySetup: groupByKey(rows, 'setup_tag'),
    byMood: groupByKey(rows, 'mood'),
  };
}

router.get('/stats', (req, res) => {
  // Check cache first: if recent, return cached stats
  const cached = getCachedStats(req.user.id);
  if (cached) {
    return res.json({ ...cached, _cached: true });
  }
  // Not cached: compute and store
  const stats = computeStats(req.user.id);
  cacheStatsForUser(req.user.id, stats);
  res.json(stats);
});

/* ── violations ───────────────────────────────────────────────── */
router.get('/violations', (req, res) => {
  const rows = db
    .prepare(`SELECT id, trade_id, rule, detail, created_at FROM violations WHERE user_id=? ORDER BY id DESC LIMIT 50`)
    .all(req.user.id);
  res.json({ violations: rows });
});

/* ── AI-powered debrief ───────────────────────────────────────── */
let _anthropicClient;
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}

async function callAIDebrief({ n, netR, winRate, violations7, worstSetup, bestSetup, worstMood, trades7 }) {
  const client = getAnthropicClient();
  if (!client) return null;
  const tradeLog = trades7.map(t =>
    `${t.trade_date} ${t.symbol} ${t.side.toUpperCase()} | ${t.setup_tag} | ${t.mood} | ${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple}R${t.notes ? ` | "${t.notes.slice(0, 80)}"` : ''}`
  ).join('\n');
  const prompt = `You are a concise trading psychology coach. Trader's last 7 days:

SUMMARY: ${n} trades | ${netR >= 0 ? '+' : ''}${netR}R net | ${winRate}% win rate
VIOLATIONS: ${violations7.length ? violations7.map(v => `${v.rule} ×${v.c}`).join(', ') : 'none'}
WORST SETUP: ${worstSetup ? `"${worstSetup.key}" ${worstSetup.totalR}R over ${worstSetup.trades} trades` : 'none'}
BEST SETUP: ${bestSetup ? `"${bestSetup.key}" +${bestSetup.totalR}R over ${bestSetup.trades} trades` : 'none'}
WORST MOOD: ${worstMood ? `"${worstMood.key}" ${worstMood.totalR}R over ${worstMood.trades} trades` : 'none'}

TRADE LOG:
${tradeLog || '(no trades this week)'}

Write ONE action item for next week. 2 sentences max. Direct, specific, psychologically sharp — surface patterns the trader might miss (mood-setup correlations, note themes, timing). No preamble, no sign-off.`;
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0]?.text?.trim() || null;
  } catch (err) {
    console.error('[edgewise] AI debrief error:', err.message);
    return null;
  }
}

function algorithmicAction({ n, revengeCount, worstMood, worstSetup, untagged, bestSetup }) {
  if (n === 0) return 'No trades logged this week. If you traded, the journal is lying by omission — backfill before the memory rewrites itself.';
  if (revengeCount > 0) return `You logged ${revengeCount} trade${revengeCount > 1 ? 's' : ''} inside your post-loss cooldown. Next week: after any loss, close the terminal for the full cooldown. One rule, nothing else.`;
  if (worstMood) return `Trades tagged "${worstMood.key}" cost you ${worstMood.totalR}R this week. Next week: no entries while ${worstMood.key} — flat is a position.`;
  if (worstSetup) return `"${worstSetup.key}" cost you ${worstSetup.totalR}R across ${worstSetup.trades} trades. Pause that setup for a week and trade only what's paying.`;
  if (untagged > 0) return `${untagged} trade${untagged > 1 ? 's are' : ' is'} untagged. Untagged trades can't teach you anything — tag them this weekend.`;
  if (bestSetup) return `"${bestSetup.key}" made ${bestSetup.totalR}R over ${bestSetup.trades} trades. Change nothing; let the sample grow before sizing up.`;
  return 'Sample is small and mixed. Change nothing for another week — consistency before optimization.';
}

router.get('/debrief', async (req, res) => {
  const trades7 = db
    .prepare(`SELECT trade_date, symbol, side, r_multiple, setup_tag, mood, notes FROM trades
              WHERE user_id=? AND trade_date>=date('now','-6 days') ORDER BY trade_date ASC, id ASC`)
    .all(req.user.id);
  const violations7 = db
    .prepare(`SELECT rule, COUNT(*) c FROM violations WHERE user_id=? AND created_at>=datetime('now','-7 days') GROUP BY rule`)
    .all(req.user.id);
  const n = trades7.length;
  const netR = Math.round(trades7.reduce((a, t) => a + t.r_multiple, 0) * 100) / 100;
  const wins = trades7.filter(t => t.r_multiple > 0).length;
  const winRate = n ? Math.round((wins / n) * 1000) / 10 : 0;
  const bySetup = groupByKey(trades7, 'setup_tag');
  const byMood = groupByKey(trades7, 'mood');
  const worstSetup = [...bySetup].sort((a, b) => a.totalR - b.totalR).find(s => s.totalR < 0 && s.trades >= 2) || null;
  const bestSetup = [...bySetup].sort((a, b) => b.totalR - a.totalR).find(s => s.totalR > 0 && s.trades >= 2) || null;
  const worstMood = byMood.filter(m => m.totalR < 0 && m.trades >= 2 && ['fomo', 'revenge', 'overconfident', 'fear'].includes(m.key))
    .sort((a, b) => a.totalR - b.totalR)[0] || null;
  const revengeCount = violations7.find(v => v.rule === 'revenge-cooldown')?.c || 0;
  const untagged = bySetup.find(s => s.key === 'untagged')?.trades || 0;
  const aiAction = await callAIDebrief({ n, netR, winRate, violations7, worstSetup, bestSetup, worstMood, trades7 });
  const action = aiAction || algorithmicAction({ n, revengeCount, worstMood, worstSetup, untagged, bestSetup });
  res.json({ window: 'last 7 days', trades: n, netR, winRate, violations: violations7, worstSetup, bestSetup, worstMood, action, aiPowered: !!aiAction });
});

/* ── CSV export ───────────────────────────────────────────────── */
router.get('/export.csv', (req, res) => {
  const rows = db
    .prepare(`SELECT trade_date, symbol, side, entry_price, exit_price, quantity, risk_amount, setup_tag, mood, pnl, r_multiple, notes FROM trades WHERE user_id=? ORDER BY trade_date ASC, id ASC`)
    .all(req.user.id);
  const header = 'date,symbol,side,entry,exit,qty,risk,setup,mood,pnl,r_multiple,notes';
  const body = rows.map(r => [r.trade_date, r.symbol, r.side, r.entry_price, r.exit_price, r.quantity,
    r.risk_amount, r.setup_tag, r.mood, r.pnl, r.r_multiple, r.notes].map(csvCell).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="edgewise-trades.csv"');
  res.send(header + '\n' + body);
});

module.exports = router;
