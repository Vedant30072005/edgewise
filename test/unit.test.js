/**
 * Edgewise — unit tests for pure business-logic modules.
 * No DB, no network, no server. Fast and isolated.
 * Run: node --test test/unit.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/* Stub env so db.js is never required */
process.env.JWT_SECRET = 'unit-test-secret';
process.env.NODE_ENV = 'test';

const { computePnl, validateTrade, MOODS } = require('../src/tradeValidator');
const { groupByKey } = require('../src/analytics');
const { createMiddleware } = require('../src/rateLimiter');

/* ────────────────────────────────────────────────────────────────
   computePnl
   ──────────────────────────────────────────────────────────────── */
test('computePnl: long trade profit', () => {
  assert.equal(computePnl({ side: 'long', entry_price: 100, exit_price: 105, quantity: 10 }), 50);
});

test('computePnl: long trade loss', () => {
  assert.equal(computePnl({ side: 'long', entry_price: 100, exit_price: 95, quantity: 10 }), -50);
});

test('computePnl: short trade profit', () => {
  assert.equal(computePnl({ side: 'short', entry_price: 200, exit_price: 190, quantity: 5 }), 50);
});

test('computePnl: short trade loss', () => {
  assert.equal(computePnl({ side: 'short', entry_price: 200, exit_price: 210, quantity: 5 }), -50);
});

test('computePnl: rounds to 2 decimal places', () => {
  // (105.333... - 100) * 3 = 15.999... → 16.00
  const result = computePnl({ side: 'long', entry_price: 100, exit_price: 105.3334, quantity: 3 });
  assert.equal(result, Math.round(result * 100) / 100);
});

test('computePnl: breakeven trade', () => {
  assert.equal(computePnl({ side: 'long', entry_price: 100, exit_price: 100, quantity: 10 }), 0);
});

/* ────────────────────────────────────────────────────────────────
   validateTrade
   ──────────────────────────────────────────────────────────────── */
function validBase() {
  return {
    trade_date: '2025-01-15',
    symbol: 'AAPL',
    side: 'long',
    entry_price: 100,
    exit_price: 110,
    quantity: 10,
    risk_amount: 50,
    setup_tag: 'breakout',
    mood: 'calm',
    notes: '',
  };
}

test('validateTrade: accepts a valid long trade', () => {
  const { trade, error } = validateTrade(validBase());
  assert.equal(error, undefined);
  assert.ok(trade);
  assert.equal(trade.symbol, 'AAPL');
  assert.equal(trade.pnl, 100);          // (110 - 100) * 10
  assert.equal(trade.r_multiple, 2);     // 100 / 50
});

test('validateTrade: accepts a valid short trade', () => {
  const body = { ...validBase(), side: 'short', entry_price: 200, exit_price: 190, quantity: 5, risk_amount: 25 };
  const { trade, error } = validateTrade(body);
  assert.equal(error, undefined);
  assert.equal(trade.pnl, 50);           // (190 - 200) * 5 * -1
  assert.equal(trade.r_multiple, 2);
});

test('validateTrade: rejects future trade_date', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const body = { ...validBase(), trade_date: tomorrow.toISOString().slice(0, 10) };
  const { error } = validateTrade(body);
  assert.ok(error);
  assert.ok(error.includes('future'));
});

test('validateTrade: rejects malformed date', () => {
  const { error } = validateTrade({ ...validBase(), trade_date: '15-01-2025' });
  assert.ok(error);
  assert.ok(error.toLowerCase().includes('date'));
});

test('validateTrade: rejects empty symbol', () => {
  const { error } = validateTrade({ ...validBase(), symbol: '' });
  assert.ok(error);
  assert.ok(error.includes('Symbol'));
});

test('validateTrade: rejects symbol over 20 chars (truncates silently — check actual length)', () => {
  // Symbol is sliced to 20 chars; 21-char input should still parse but symbol is truncated
  const body = { ...validBase(), symbol: 'ABCDEFGHIJKLMNOPQRSTU' }; // 21 chars
  const { trade } = validateTrade(body);
  assert.ok(trade);
  assert.equal(trade.symbol.length, 20);
});

test('validateTrade: uppercases and trims symbol', () => {
  const { trade } = validateTrade({ ...validBase(), symbol: '  aapl  ' });
  assert.equal(trade.symbol, 'AAPL');
});

test('validateTrade: rejects invalid side', () => {
  const { error } = validateTrade({ ...validBase(), side: 'buy' });
  assert.ok(error);
  assert.ok(error.includes('long') || error.includes('short'));
});

test('validateTrade: rejects zero entry_price', () => {
  const { error } = validateTrade({ ...validBase(), entry_price: 0 });
  assert.ok(error);
});

test('validateTrade: rejects negative quantity', () => {
  const { error } = validateTrade({ ...validBase(), quantity: -5 });
  assert.ok(error);
});

test('validateTrade: rejects risk_amount greater than position value', () => {
  // position value = 100 * 1 = 100; risk_amount = 200 → invalid
  const { error } = validateTrade({ ...validBase(), entry_price: 100, quantity: 1, risk_amount: 200 });
  assert.ok(error);
  assert.ok(error.toLowerCase().includes('risk'));
});

test('validateTrade: coerces unknown mood to neutral', () => {
  const { trade } = validateTrade({ ...validBase(), mood: 'euphoric' });
  assert.equal(trade.mood, 'neutral');
});

test('validateTrade: accepts all valid moods', () => {
  for (const mood of MOODS) {
    const { trade, error } = validateTrade({ ...validBase(), mood });
    assert.equal(error, undefined, `mood "${mood}" should be valid`);
    assert.equal(trade.mood, mood);
  }
});

test('validateTrade: defaults setup_tag to "untagged" when empty', () => {
  const { trade } = validateTrade({ ...validBase(), setup_tag: '' });
  assert.equal(trade.setup_tag, 'untagged');
});

test('validateTrade: lowercases setup_tag', () => {
  const { trade } = validateTrade({ ...validBase(), setup_tag: 'GAP-FADE' });
  assert.equal(trade.setup_tag, 'gap-fade');
});

test('validateTrade: truncates notes to 2000 chars', () => {
  const long = 'x'.repeat(2500);
  const { trade } = validateTrade({ ...validBase(), notes: long });
  assert.equal(trade.notes.length, 2000);
});

test('validateTrade: accepts string numbers (form inputs)', () => {
  // HTML forms send strings; toNum() should coerce them
  const body = { ...validBase(), entry_price: '100', exit_price: '110', quantity: '10', risk_amount: '50' };
  const { trade, error } = validateTrade(body);
  assert.equal(error, undefined);
  assert.equal(trade.pnl, 100);
});

/* ────────────────────────────────────────────────────────────────
   groupByKey
   ──────────────────────────────────────────────────────────────── */
const sampleTrades = [
  { setup_tag: 'breakout', mood: 'calm',     r_multiple:  2 },
  { setup_tag: 'breakout', mood: 'fomo',     r_multiple: -1 },
  { setup_tag: 'vcp',      mood: 'calm',     r_multiple:  1 },
  { setup_tag: 'vcp',      mood: 'neutral',  r_multiple:  3 },
  { setup_tag: 'gap-fade', mood: 'fomo',     r_multiple: -2 },
];

test('groupByKey: groups by setup_tag correctly', () => {
  const result = groupByKey(sampleTrades, 'setup_tag');
  const keys = result.map(r => r.key);
  assert.ok(keys.includes('breakout'));
  assert.ok(keys.includes('vcp'));
  assert.ok(keys.includes('gap-fade'));
  assert.equal(result.length, 3);
});

test('groupByKey: counts trades per group', () => {
  const result = groupByKey(sampleTrades, 'setup_tag');
  const breakout = result.find(r => r.key === 'breakout');
  assert.equal(breakout.trades, 2);
});

test('groupByKey: computes totalR correctly', () => {
  const result = groupByKey(sampleTrades, 'setup_tag');
  const vcp = result.find(r => r.key === 'vcp');
  assert.equal(vcp.totalR, 4);      // 1 + 3
});

test('groupByKey: computes expectancy correctly', () => {
  const result = groupByKey(sampleTrades, 'setup_tag');
  const vcp = result.find(r => r.key === 'vcp');
  assert.equal(vcp.expectancy, 2);  // 4R / 2 trades
});

test('groupByKey: computes winRate as percentage (0-100)', () => {
  const result = groupByKey(sampleTrades, 'setup_tag');
  const vcp = result.find(r => r.key === 'vcp');
  assert.equal(vcp.winRate, 100);   // both trades won
  const breakout = result.find(r => r.key === 'breakout');
  assert.equal(breakout.winRate, 50); // 1 of 2 won
});

test('groupByKey: sorts by expectancy descending', () => {
  const result = groupByKey(sampleTrades, 'setup_tag');
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i - 1].expectancy >= result[i].expectancy,
      `result[${i-1}].expectancy (${result[i-1].expectancy}) should be >= result[${i}].expectancy (${result[i].expectancy})`);
  }
});

test('groupByKey: handles single-trade group', () => {
  const single = [{ setup_tag: 'solo', r_multiple: 1.5 }];
  const result = groupByKey(single, 'setup_tag');
  assert.equal(result.length, 1);
  assert.equal(result[0].trades, 1);
  assert.equal(result[0].expectancy, 1.5);
  assert.equal(result[0].winRate, 100);
});

test('groupByKey: handles all-loss group', () => {
  const losers = [
    { setup_tag: 'bad', r_multiple: -1 },
    { setup_tag: 'bad', r_multiple: -2 },
  ];
  const result = groupByKey(losers, 'setup_tag');
  assert.equal(result[0].winRate, 0);
  assert.equal(result[0].totalR, -3);
});

test('groupByKey: groups by mood key', () => {
  const result = groupByKey(sampleTrades, 'mood');
  const moods = result.map(r => r.key);
  assert.ok(moods.includes('calm'));
  assert.ok(moods.includes('fomo'));
  assert.ok(moods.includes('neutral'));
});

test('groupByKey: returns empty array for empty input', () => {
  const result = groupByKey([], 'setup_tag');
  assert.equal(result.length, 0);
});

/* ────────────────────────────────────────────────────────────────
   rateLimiter (MemoryStore behaviour via middleware)
   ──────────────────────────────────────────────────────────────── */

/** Simulate Express req/res/next for rate limiter tests */
function fakeReq(ip = '1.2.3.4') {
  return { ip };
}
function fakeRes() {
  const r = {
    _status: 200,
    _body: null,
    status(s) { r._status = s; return r; },
    json(body) { r._body = body; },
  };
  return r;
}

test('rateLimiter: allows requests within limit', () => {
  const mw = createMiddleware({ windowMs: 60000, max: 3 });
  let passed = 0;
  const req = fakeReq();
  for (let i = 0; i < 3; i++) {
    const res = fakeRes();
    mw(req, res, () => passed++);
  }
  assert.equal(passed, 3);
});

test('rateLimiter: blocks after max exceeded', () => {
  const mw = createMiddleware({ windowMs: 60000, max: 2 });
  const req = fakeReq('5.5.5.5');
  let blocked = false;
  // Consume limit
  mw(req, fakeRes(), () => {});
  mw(req, fakeRes(), () => {});
  // One more — should block
  const res = fakeRes();
  mw(req, res, () => {});
  assert.equal(res._status, 429);
});

test('rateLimiter: tracks keys independently', () => {
  const mw = createMiddleware({ windowMs: 60000, max: 1 });
  const req1 = fakeReq('10.0.0.1');
  const req2 = fakeReq('10.0.0.2');
  let p1 = 0, p2 = 0;
  mw(req1, fakeRes(), () => p1++);
  mw(req2, fakeRes(), () => p2++);
  assert.equal(p1, 1);
  assert.equal(p2, 1);
});

test('rateLimiter: resets counter after window expires', async () => {
  const mw = createMiddleware({ windowMs: 50, max: 1 }); // 50ms window
  const req = fakeReq('7.7.7.7');
  let passed = 0;
  // Use the limit
  mw(req, fakeRes(), () => passed++);
  assert.equal(passed, 1);
  // Wait for window to expire
  await new Promise(r => setTimeout(r, 60));
  // Should be allowed again
  mw(req, fakeRes(), () => passed++);
  assert.equal(passed, 2);
});

test('rateLimiter: uses custom message on 429', () => {
  const mw = createMiddleware({ windowMs: 60000, max: 0, message: 'custom error' });
  const req = fakeReq('8.8.8.8');
  const res = fakeRes();
  mw(req, res, () => {});
  assert.equal(res._status, 429);
  assert.equal(res._body.error, 'custom error');
});
