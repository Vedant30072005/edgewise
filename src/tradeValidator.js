/** Shared trade validation — used by trades routes and import routes. */
const { toNum, isNonEmpty } = require('./auth');

const MOODS = ['calm', 'neutral', 'fomo', 'revenge', 'fear', 'overconfident'];

function computePnl({ side, entry_price, exit_price, quantity }) {
  const dir = side === 'long' ? 1 : -1;
  return (exit_price - entry_price) * quantity * dir;
}

function validateTrade(body) {
  const t = {
    trade_date: body.trade_date,
    symbol: (body.symbol || '').toString().trim().toUpperCase().slice(0, 20),
    side: body.side,
    entry_price: toNum(body.entry_price),
    exit_price: toNum(body.exit_price),
    quantity: toNum(body.quantity),
    risk_amount: toNum(body.risk_amount),
    setup_tag: (body.setup_tag || 'untagged').toString().trim().toLowerCase().slice(0, 40) || 'untagged',
    mood: body.mood || 'neutral',
    notes: (body.notes || '').toString().slice(0, 2000),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.trade_date || '')) return { error: 'Pick a trade date.' };
  if (!isNonEmpty(t.symbol, 20)) return { error: 'Enter a symbol.' };
  if (!['long', 'short'].includes(t.side)) return { error: 'Side must be long or short.' };
  for (const f of ['entry_price', 'exit_price', 'quantity', 'risk_amount']) {
    if (!Number.isFinite(t[f]) || t[f] <= 0) return { error: `${f.replace('_', ' ')} must be a positive number.` };
  }
  if (!MOODS.includes(t.mood)) t.mood = 'neutral';
  t.pnl = Math.round(computePnl(t) * 100) / 100;
  t.r_multiple = Math.round((t.pnl / t.risk_amount) * 100) / 100;
  return { trade: t };
}

module.exports = { MOODS, computePnl, validateTrade };
