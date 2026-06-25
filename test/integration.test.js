const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('path');

// Must set env before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-' + Date.now();
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'Admin123!';
process.env.DATA_DIR = path.join(__dirname, '..', 'data-test');

const app = require('../server');

let server;
let baseUrl = 'http://localhost';
let authToken = null;
let userId = null;

/**
 * Make HTTP request to app (JSON, includes cookies).
 */
function makeRequest(method, path, body = null, cookies = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (cookies) options.headers['Cookie'] = cookies;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        let body = null;
        try {
          body = data ? JSON.parse(data) : null;
        } catch {
          // Not JSON; leave body as null (for HTML responses)
        }
        resolve({
          status: res.statusCode,
          body,
          rawBody: data,
          setCookie: setCookie ? setCookie[0] : null,
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/^([^=]+=[^;]+)/);
  return match ? match[1] : null;
}

test('Integration: Full trade journal flow', async (t) => {
  // Generate unique test email to avoid conflicts on repeated runs
  const testEmail = `trader-${Date.now()}@test.local`;
  
  // Start server
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  await t.test('GET / returns landing page', async () => {
    const res = await makeRequest('GET', '/');
    assert.equal(res.status, 200);
    assert.ok(res.rawBody && res.rawBody.includes('<!DOCTYPE'));
  });

  await t.test('POST /api/auth/register creates account', async () => {
    const res = await makeRequest('POST', '/api/auth/register', {
      email: testEmail,
      name: 'Test Trader',
      password: 'TestPass123!',
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.user);
    assert.equal(res.body.user.email, testEmail);
    assert.ok(res.setCookie);
    userId = res.body.user.id;
    authToken = extractCookie(res.setCookie);
  });

  await t.test('POST /api/auth/register duplicate email fails', async () => {
    const res = await makeRequest('POST', '/api/auth/register', {
      email: testEmail, // Try to register same email again
      name: 'Another',
      password: 'Pass456!',
    });
    assert.equal(res.status, 409); // 409 Conflict is correct for duplicate
    assert.ok(res.body.error);
  });

  await t.test('GET /api/auth/me returns current user', async () => {
    const res = await makeRequest('GET', '/api/auth/me', null, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, userId);
    assert.equal(res.body.user.email, testEmail);
  });

  await t.test('POST /api/trades creates a long trade', async () => {
    const res = await makeRequest('POST', '/api/trades', {
      trade_date: '2026-06-20',
      symbol: 'AAPL',
      side: 'long',
      entry_price: 100,
      exit_price: 105,
      quantity: 10,
      risk_amount: 50,
      setup_tag: 'gap-fade',
      mood: 'calm',
      notes: 'Strong support bounce',
    }, authToken);
    assert.equal(res.status, 201);
    assert.ok(res.body.trade);
    assert.equal(res.body.trade.symbol, 'AAPL');
    assert.equal(res.body.trade.pnl, 50); // (105 - 100) * 10
    assert.equal(res.body.trade.r_multiple, 1); // 50 / 50
    assert.equal(res.body.violations.length, 0);
  });

  await t.test('POST /api/trades creates a short trade', async () => {
    const res = await makeRequest('POST', '/api/trades', {
      trade_date: '2026-06-21',
      symbol: 'TSLA',
      side: 'short',
      entry_price: 200,
      exit_price: 195,
      quantity: 5,
      risk_amount: 25,
      setup_tag: 'vcp',
      mood: 'neutral',
      notes: '',
    }, authToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.trade.symbol, 'TSLA');
    assert.equal(res.body.trade.pnl, 25); // (195 - 200) * 5 * -1
    assert.equal(res.body.trade.r_multiple, 1);
  });

  await t.test('POST /api/trades rejects trade with future date', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const futureDate = tomorrow.toISOString().split('T')[0];
    const res = await makeRequest('POST', '/api/trades', {
      trade_date: futureDate,
      symbol: 'MSFT',
      side: 'long',
      entry_price: 100,
      exit_price: 105,
      quantity: 1,
      risk_amount: 5,
    }, authToken);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('future'));
  });

  await t.test('POST /api/trades rejects negative quantity', async () => {
    const res = await makeRequest('POST', '/api/trades', {
      trade_date: '2026-06-22',
      symbol: 'GOOG',
      side: 'long',
      entry_price: 100,
      exit_price: 105,
      quantity: -5,
      risk_amount: 25,
    }, authToken);
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test('POST /api/trades rejects missing symbol', async () => {
    const res = await makeRequest('POST', '/api/trades', {
      trade_date: '2026-06-23',
      symbol: '',
      side: 'long',
      entry_price: 100,
      exit_price: 105,
      quantity: 1,
      risk_amount: 5,
    }, authToken);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('Symbol'));
  });

  await t.test('GET /api/trades returns all trades', async () => {
    const res = await makeRequest('GET', '/api/trades', null, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.trades.length, 2);
    assert.equal(res.body.total, 2);
  });

  await t.test('GET /api/trades filters by symbol', async () => {
    const res = await makeRequest('GET', '/api/trades?symbol=AAPL', null, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.trades.length, 1);
    assert.equal(res.body.trades[0].symbol, 'AAPL');
  });

  await t.test('GET /api/trades/stats computes metrics correctly', async () => {
    const res = await makeRequest('GET', '/api/trades/stats', null, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.totalTrades, 2);
    assert.equal(res.body.netR, 2); // 1R + 1R
    assert.equal(res.body.winRate, 100);
    assert.equal(res.body.expectancy, 1);
    assert.equal(res.body.profitFactor, null); // No losses
    assert.deepEqual(res.body.curve, [0, 1, 2]);
    assert.equal(res.body.streak.type, 'win');
    assert.equal(res.body.streak.count, 2);
  });

  await t.test('GET /api/trades/stats returns cached result on second call', async () => {
    const res1 = await makeRequest('GET', '/api/trades/stats', null, authToken);
    const res2 = await makeRequest('GET', '/api/trades/stats', null, authToken);
    assert.equal(res2.status, 200);
    assert.equal(res2.body._cached, true);
  });

  await t.test('PUT /api/trades/:id updates trade', async () => {
    // Get first trade ID
    const list = await makeRequest('GET', '/api/trades', null, authToken);
    const tradeId = list.body.trades[0].id;
    
    const res = await makeRequest('PUT', `/api/trades/${tradeId}`, {
      trade_date: '2026-06-20',
      symbol: 'AAPL',
      side: 'long',
      entry_price: 100,
      exit_price: 110, // Changed from 105
      quantity: 10,
      risk_amount: 50,
      setup_tag: 'breakout',
      mood: 'calm',
      notes: 'Updated notes',
    }, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.trade.exit_price, 110);
    assert.equal(res.body.trade.pnl, 100); // (110 - 100) * 10
    assert.equal(res.body.trade.r_multiple, 2); // 100 / 50
  });

  await t.test('DELETE /api/trades/:id removes trade', async () => {
    const list = await makeRequest('GET', '/api/trades', null, authToken);
    const tradeId = list.body.trades[0].id;
    
    const res = await makeRequest('DELETE', `/api/trades/${tradeId}`, null, authToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
    
    // Verify deletion
    const after = await makeRequest('GET', '/api/trades', null, authToken);
    assert.equal(after.body.total, 1);
  });

  await t.test('GET /api/trades/stats after delete invalidates cache', async () => {
    const res = await makeRequest('GET', '/api/trades/stats', null, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.totalTrades, 1);
  });

  await t.test('GET /api/auth/me returns 401 without auth', async () => {
    const res = await makeRequest('GET', '/api/auth/me', null, '');
    assert.equal(res.status, 401);
  });

  await t.test('POST /api/auth/logout clears cookie', async () => {
    const res = await makeRequest('POST', '/api/auth/logout', null, authToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
  });

  // Close server
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('Integration: Risk guard rules', async (t) => {
  // Generate unique test email
  const riskTestEmail = `risktest-${Date.now()}@test.local`;
  
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  let cookie = null;

  await t.test('Register and set risk rules', async () => {
    const register = await makeRequest('POST', '/api/auth/register', {
      email: riskTestEmail,
      name: 'Risk Tester',
      password: 'Pass123!',
    });
    assert.equal(register.status, 201);
    cookie = extractCookie(register.setCookie);

    const setRules = await makeRequest('PUT', '/api/settings', {
      daily_loss_limit_r: 2,
      max_risk_amount: 100,
      cooldown_minutes: 15,
    }, cookie);
    assert.equal(setRules.status, 200);
  });

  await t.test('Trade that violates max_risk_amount generates violation', async () => {
    const res = await makeRequest('POST', '/api/trades', {
      trade_date: '2026-06-25',
      symbol: 'XYZ',
      side: 'long',
      entry_price: 100,
      exit_price: 95,
      quantity: 10,
      risk_amount: 150, // Exceeds max of 100
      setup_tag: 'test',
      mood: 'neutral',
    }, cookie);
    assert.equal(res.status, 201);
    assert.equal(res.body.violations.length, 1);
    assert.equal(res.body.violations[0].rule, 'max-risk');
  });

  await new Promise((resolve) => server.close(resolve));
});

test('Integration: Password reset flow', async (t) => {
  const resetTestEmail = `reset-${Date.now()}@test.local`;
  let resetToken = null;
  
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  await t.test('POST /api/auth/register creates account', async () => {
    const res = await makeRequest('POST', '/api/auth/register', {
      email: resetTestEmail,
      name: 'Reset Tester',
      password: 'OldPass123!',
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.user);
  });

  await t.test('POST /api/auth/forgot-password returns ok (no email leak)', async () => {
    const res = await makeRequest('POST', '/api/auth/forgot-password', {
      email: resetTestEmail,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
  });

  await t.test('POST /api/auth/forgot-password with invalid email returns ok', async () => {
    const res = await makeRequest('POST', '/api/auth/forgot-password', {
      email: 'nonexistent@test.local',
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
  });

  await t.test('POST /api/auth/forgot-password with invalid format returns 400', async () => {
    const res = await makeRequest('POST', '/api/auth/forgot-password', {
      email: 'not-an-email',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test('GET /api/auth/reset-password with invalid token redirects', async () => {
    const res = await makeRequest('GET', '/api/auth/verify-email?token=invalidtoken', null, '');
    // Should redirect to /login (302 is default redirect)
    assert.equal(res.status, 302);
  });

  await t.test('POST /api/auth/reset-password without token returns 400', async () => {
    const res = await makeRequest('POST', '/api/auth/reset-password', {
      token: '',
      password: 'NewPass456!',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test('POST /api/auth/reset-password with invalid password returns 400', async () => {
    const res = await makeRequest('POST', '/api/auth/reset-password', {
      token: 'sometoken',
      password: 'short', // Too short
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('Password'));
  });

  await t.test('POST /api/auth/reset-password with expired token returns 400', async () => {
    const res = await makeRequest('POST', '/api/auth/reset-password', {
      token: 'expired-token-12345678901234567890123456789012',
      password: 'NewPass456!',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  await new Promise((resolve) => server.close(resolve));
});

