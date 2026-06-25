/** Shared trade validation — used by trades routes and import routes. */
const { toNum, isNonEmpty } = require('./auth');

const MOODS = ['calm', 'neutral', 'fomo', 'revenge', 'fear', 'overconfident'];

/**
 * Compute profit/loss in currency units.
 * Formula: (exit − entry) × quantity × direction
 * @param {Object} params
 * @param {string} params.side - 'long' or 'short'
 * @param {number} params.entry_price - Price entered at
 * @param {number} params.exit_price - Price exited at
 * @param {number} params.quantity - Shares/contracts traded
 * @returns {number} Profit/loss in currency (rounded to 2 decimals)
 * @example
 * computePnl({ side: 'long', entry_price: 100, exit_price: 105, quantity: 10 })
 * // → 50 (10 shares × $5 gain)
 */
function computePnl({ side, entry_price, exit_price, quantity }) {
  const dir = side === 'long' ? 1 : -1;
  const pnl = (exit_price - entry_price) * quantity * dir;
  return Math.round(pnl * 100) / 100; // Always return 2-decimal precision
}

/**
 * Validate and sanitize a trade submission.
 * Returns either { trade: <validated trade object> } or { error: <message> }.
 * Validates all required fields, types, ranges, and computes PnL and R-multiple.
 * @param {Object} body - Raw trade submission from request body
 * @returns {Object} { trade: {...} } on success or { error: "message" } on failure
 */
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
  // Validate trade_date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.trade_date || '')) {
    return { error: 'Trade date required. Format: YYYY-MM-DD.' };
  }
  // Check date is not in the future
  const tradeDay = new Date(t.trade_date + 'T00:00:00Z');
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (tradeDay > today) {
    return { error: 'Trade date cannot be in the future.' };
  }
  // Validate symbol
  if (!isNonEmpty(t.symbol, 20)) {
    return { error: 'Symbol required (1-20 characters). Example: AAPL' };
  }
  // Validate side
  if (!['long', 'short'].includes(t.side)) {
    return { error: 'Side must be "long" or "short".' };
  }
  // Validate all numeric fields
  for (const f of ['entry_price', 'exit_price', 'quantity', 'risk_amount']) {
    if (!Number.isFinite(t[f]) || t[f] <= 0) {
      return { error: `${f.replace('_', ' ')} must be a positive number.` };
    }
  }
  // Validate risk_amount does not exceed position value
  const positionValue = t.entry_price * t.quantity;
  if (t.risk_amount > positionValue) {
    return { error: `Risk amount ($${t.risk_amount}) cannot exceed position value ($${Math.round(positionValue)}).` };
  }
  // Ensure mood is valid (default to neutral if not)
  if (!MOODS.includes(t.mood)) t.mood = 'neutral';
  // Compute PnL and R-multiple
  t.pnl = computePnl(t);
  t.r_multiple = Math.round((t.pnl / t.risk_amount) * 100) / 100;
  return { trade: t };
}

module.exports = { MOODS, computePnl, validateTrade };
