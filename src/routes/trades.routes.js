/** Edgewise — /api/trades routes (per-user journal) */
const express = require('express');
const { all, get, run, pool } = require('../db');
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
  if (statsCache.size > MAX_CACHE_SIZE) {
    const oldest = statsCache.keys().next().value;
    statsCache.delete(oldest);
  }
}

function getCachedStats(userId) {
  const cached = statsCache.get(userId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.stats;
  statsCache.delete(userId);
  return null;
}

function invalidateStatsCache(userId) {
  statsCache.delete(userId);
}

/* ── tier helper ──────────────────────────────────────────────── */
async function tradesThisMonth(userId) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const row = await get(
    `SELECT COUNT(*) AS c FROM trades WHERE user_id=$1 AND to_char(created_at, 'YYYY-MM')=$2`,
    [userId, month]
  );
  return parseInt(row.c);
}

/* ── risk guard ───────────────────────────────────────────────── */
async function checkRiskRules(userId, trade) {
  const s = await get('SELECT * FROM risk_settings WHERE user_id=$1', [userId]);
  if (!s) return [];
  const found = [];
  if (s.max_risk_amount && trade.risk_amount > s.max_risk_amount) {
    found.push({ rule: 'max-risk', detail: `Risked ${trade.risk_amount} against your per-trade cap of ${s.max_risk_amount}.` });
  }
  if (s.daily_loss_limit_r) {
    const dayRow = await get(
      'SELECT COALESCE(SUM(r_multiple),0) AS r FROM trades WHERE user_id=$1 AND trade_date=$2',
      [userId, trade.trade_date]
    );
    const after = parseFloat(dayRow.r) + trade.r_multiple;
    if (after < -s.daily_loss_limit_r) {
      found.push({ rule: 'daily-loss-limit', detail: `Day at ${after.toFixed(2)}R after this trade; your stop-day limit is -${s.daily_loss_limit_r}R.` });
    }
  }
  if (s.cooldown_minutes) {
    const prev = await get(
      `SELECT r_multiple,
              EXTRACT(EPOCH FROM (NOW() - created_at))::INTEGER / 60 AS mins_ago
       FROM trades WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,
      [userId]
    );
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
router.get('/', async (req, res) => {
  const { symbol, mood, setup, from, to, notes, limit = 200, offset = 0 } = req.query;
  let where = 'WHERE user_id=$1';
  const params = [req.user.id];
  let p = 2;
  if (symbol) { where += ` AND symbol LIKE $${p++}`; params.push(`%${symbol.toString().trim().toUpperCase()}%`); }
  if (mood && MOODS.includes(mood)) { where += ` AND mood=$${p++}`; params.push(mood); }
  if (setup) { where += ` AND setup_tag=$${p++}`; params.push(setup.toString().trim().toLowerCase()); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ` AND trade_date>=$${p++}`; params.push(from); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ` AND trade_date<=$${p++}`; params.push(to); }
  if (notes) { where += ` AND notes LIKE $${p++}`; params.push(`%${notes.toString().trim()}%`); }

  const lim = Math.min(Math.max(parseInt(limit) || 200, 1), 500);
  const off = Math.max(parseInt(offset) || 0, 0);

  const [countRow, rows] = await Promise.all([
    get(`SELECT COUNT(*) AS n FROM trades ${where}`, params),
    all(`SELECT * FROM trades ${where} ORDER BY trade_date ASC, id ASC LIMIT $${p} OFFSET $${p+1}`, [...params, lim, off]),
  ]);
  res.json({ trades: rows, total: parseInt(countRow.n) });
});

/* ── create ───────────────────────────────────────────────────── */
router.post('/', createTradeLimiter, async (req, res) => {
  /* Tier enforcement: free plan = 30 trades per calendar month. */
  if (req.user.plan === 'free' && await tradesThisMonth(req.user.id) >= 30) {
    return res.status(402).json({
      error: 'Free plan limit: 30 trades per month. Upgrade to Pro for unlimited logging.',
      code: 'PLAN_LIMIT',
    });
  }
  const { trade, error } = validateTrade(req.body || {});
  if (error) return res.status(400).json({ error });
  const violations = await checkRiskRules(req.user.id, trade);
  const result = await run(
    `INSERT INTO trades
     (user_id, trade_date, symbol, side, entry_price, exit_price, quantity,
      risk_amount, setup_tag, mood, notes, pnl, r_multiple)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [req.user.id, trade.trade_date, trade.symbol, trade.side, trade.entry_price,
     trade.exit_price, trade.quantity, trade.risk_amount, trade.setup_tag,
     trade.mood, trade.notes, trade.pnl, trade.r_multiple]
  );
  const tradeId = result.rows[0].id;
  if (violations.length) {
    await Promise.all(violations.map(v =>
      run('INSERT INTO violations (user_id, trade_id, rule, detail) VALUES ($1,$2,$3,$4)',
        [req.user.id, tradeId, v.rule, v.detail])
    ));
  }
  const row = await get('SELECT * FROM trades WHERE id=$1', [tradeId]);
  invalidateStatsCache(req.user.id);
  res.status(201).json({ trade: row, violations });
});

/* ── update ───────────────────────────────────────────────────── */
router.put('/:id', updateTradeLimiter, async (req, res) => {
  const existing = await get('SELECT id FROM trades WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!existing) return res.status(404).json({ error: 'Trade not found.' });
  const { trade, error } = validateTrade(req.body || {});
  if (error) return res.status(400).json({ error });
  await run(
    `UPDATE trades SET trade_date=$1, symbol=$2, side=$3,
       entry_price=$4, exit_price=$5, quantity=$6,
       risk_amount=$7, setup_tag=$8, mood=$9, notes=$10,
       pnl=$11, r_multiple=$12 WHERE id=$13 AND user_id=$14`,
    [trade.trade_date, trade.symbol, trade.side, trade.entry_price, trade.exit_price,
     trade.quantity, trade.risk_amount, trade.setup_tag, trade.mood, trade.notes,
     trade.pnl, trade.r_multiple, existing.id, req.user.id]
  );
  const row = await get('SELECT * FROM trades WHERE id=$1', [existing.id]);
  invalidateStatsCache(req.user.id);
  res.json({ trade: row });
});

/* ── delete ───────────────────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  const result = await run('DELETE FROM trades WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Trade not found.' });
  invalidateStatsCache(req.user.id);
  res.json({ ok: true });
});

/* ── stats (always all-time, unfiltered) ─────────────────────── */
async function computeStats(userId) {
  const rows = await all(
    `SELECT trade_date, r_multiple, pnl, setup_tag, mood FROM trades WHERE user_id=$1 ORDER BY trade_date ASC, id ASC`,
    [userId]
  );
  const n = rows.length;
  let equity = 0, peak = 0, maxDd = 0, wins = 0, grossWin = 0, grossLoss = 0;
  const curve = [0];
  for (const r of rows) {
    const rm = parseFloat(r.r_multiple);
    equity += rm;
    curve.push(Math.round(equity * 100) / 100);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (rm > 0) { wins += 1; grossWin += rm; }
    else grossLoss += Math.abs(rm);
  }

  /* Current consecutive streak. */
  let streak = { type: null, count: 0 };
  if (n > 0) {
    const isLastWin = parseFloat(rows[n - 1].r_multiple) > 0;
    streak.type = isLastWin ? 'win' : 'loss';
    for (let i = n - 1; i >= 0; i--) {
      if ((parseFloat(rows[i].r_multiple) > 0) === isLastWin) streak.count++;
      else break;
    }
  }

  /* Monthly net R aggregation. */
  const monthMap = new Map();
  for (const r of rows) {
    const mo = r.trade_date.slice(0, 7);
    const m = monthMap.get(mo) || { month: mo, trades: 0, totalR: 0, wins: 0 };
    const rm = parseFloat(r.r_multiple);
    m.trades += 1; m.totalR += rm; if (rm > 0) m.wins += 1;
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

router.get('/stats', async (req, res) => {
  const cached = getCachedStats(req.user.id);
  if (cached) return res.json({ ...cached, _cached: true });
  const stats = await computeStats(req.user.id);
  cacheStatsForUser(req.user.id, stats);
  res.json(stats);
});

/* ── violations ───────────────────────────────────────────────── */
router.get('/violations', async (req, res) => {
  const rows = await all(
    `SELECT id, trade_id, rule, detail, created_at FROM violations WHERE user_id=$1 ORDER BY id DESC LIMIT 50`,
    [req.user.id]
  );
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
  const prompt = `You are a concise trading psychology coach. Trader's last 7 days:\n\nSUMMARY: ${n} trades | ${netR >= 0 ? '+' : ''}${netR}R net | ${winRate}% win rate\nVIOLATIONS: ${violations7.length ? violations7.map(v => `${v.rule} ×${v.c}`).join(', ') : 'none'}\nWORST SETUP: ${worstSetup ? `"${worstSetup.key}" ${worstSetup.totalR}R over ${worstSetup.trades} trades` : 'none'}\nBEST SETUP: ${bestSetup ? `"${bestSetup.key}" +${bestSetup.totalR}R over ${bestSetup.trades} trades` : 'none'}\nWORST MOOD: ${worstMood ? `"${worstMood.key}" ${worstMood.totalR}R over ${worstMood.trades} trades` : 'none'}\n\nTRADE LOG:\n${tradeLog || '(no trades this week)'}\n\nWrite ONE action item for next week. 2 sentences max. Direct, specific, psychologically sharp. No preamble, no sign-off.`;
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
  const [trades7, violations7] = await Promise.all([
    all(
      `SELECT trade_date, symbol, side, r_multiple, setup_tag, mood, notes FROM trades
       WHERE user_id=$1 AND trade_date::DATE >= CURRENT_DATE - INTERVAL '6 days' ORDER BY trade_date ASC, id ASC`,
      [req.user.id]
    ),
    all(
      `SELECT rule, COUNT(*) AS c FROM violations WHERE user_id=$1 AND created_at>=NOW() - INTERVAL '7 days' GROUP BY rule`,
      [req.user.id]
    ),
  ]);
  const n = trades7.length;
  const netR = Math.round(trades7.reduce((a, t) => a + parseFloat(t.r_multiple), 0) * 100) / 100;
  const wins = trades7.filter(t => parseFloat(t.r_multiple) > 0).length;
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
router.get('/export.csv', async (req, res) => {
  const rows = await all(
    `SELECT trade_date, symbol, side, entry_price, exit_price, quantity, risk_amount, setup_tag, mood, pnl, r_multiple, notes
     FROM trades WHERE user_id=$1 ORDER BY trade_date ASC, id ASC`,
    [req.user.id]
  );
  const header = 'date,symbol,side,entry,exit,qty,risk,setup,mood,pnl,r_multiple,notes';
  const body = rows.map(r => [r.trade_date, r.symbol, r.side, r.entry_price, r.exit_price, r.quantity,
    r.risk_amount, r.setup_tag, r.mood, r.pnl, r.r_multiple, r.notes].map(csvCell).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="edgewise-trades.csv"');
  res.send(header + '\n' + body);
});

module.exports = router;
