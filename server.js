/**
 * Edgewise — server entry point.
 * Run: npm install && npm start  →  http://localhost:3000
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { initSchema, seedAdmin, pool } = require('./src/db');
const { attachUser } = require('./src/auth');
const { info, error: logError } = require('./src/logger');
const authRoutes = require('./src/routes/auth.routes');
const tradeRoutes = require('./src/routes/trades.routes');
const adminRoutes = require('./src/routes/admin.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const importRoutes = require('./src/routes/import.routes');

// Schema and admin seed run async on startup

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// Behind a hosting reverse proxy (Render/Railway/Fly/nginx/etc.): trust the
// first hop so req.ip (rate limiting) and req.secure (HTTPS) are accurate.
app.set('trust proxy', 1);

// Baseline security headers, plus HTTPS enforcement in production.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy: restricts resource origins to same-site.
  // unsafe-inline for style is required for the inline style attributes used
  // throughout the HTML; scripts are strictly same-origin only.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    // Redirect only when the proxy explicitly reports the original scheme as
    // http (loop-safe; never fires for direct/local requests or health checks).
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const host = req.headers.host || '';
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    if (proto === 'http' && !isLocal) {
      return res.redirect(308, `https://${host}${req.originalUrl}`);
    }
  }
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(attachUser);

/* ---------- API ---------- */
app.use('/api/auth', authRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/import', importRoutes);

/* Health check for hosting platforms (Render, Railway, Vercel, etc.) */
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (err) {
    logError('Health check failed', { reason: err.message });
    res.status(503).json({ status: 'error', reason: err.message, uptime: process.uptime() });
  }
});

/* API Documentation (Swagger/OpenAPI) */
app.get('/api/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'api-docs.html'));
});

/* ---------- Pages ---------- */
const pub = (f) => path.join(__dirname, 'public', f);

// Guarded pages: redirect instead of serving a broken page.
app.get('/app', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.sendFile(pub('app.html'));
});
app.get('/admin', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.redirect('/app');
  res.sendFile(pub('admin.html'));
});
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/app');
  res.sendFile(pub('login.html'));
});
app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/app');
  res.sendFile(pub('register.html'));
});
app.get('/forgot-password', (req, res) => res.sendFile(pub('forgot-password.html')));
app.get('/reset-password', (req, res) => res.sendFile(pub('reset-password.html')));

app.use(express.static(path.join(__dirname, 'public')));

/* ── Express error handler — catches unhandled errors in routes ──── */
/* Must have 4 params so Express recognises it as error middleware. */
app.use((err, req, res, _next) => {
  // Multer file-size and file-type errors surface here
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Something went wrong.';
  logError('Unhandled route error', {
    method: req.method,
    path: req.originalUrl,
    status,
    reason: err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

/* JSON 404 for unknown API routes; pages fall back to landing */
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((_req, res) => res.status(404).sendFile(pub('index.html')));

// Export for testing; listen only if this is the main module
module.exports = app;

if (require.main === module) {
  (async () => {
    await initSchema();
    await seedAdmin();
    const server = app.listen(PORT, () => {
      info('Server started', { port: PORT, env: isProd ? 'production' : 'development' });
      console.log(`[edgewise] running at http://localhost:${PORT}`);
      console.log('[edgewise] landing: /   app: /app   admin: /admin');
    });

    // Graceful shutdown on SIGTERM (load balancer drain, Render/Railway redeploy)
    process.on('SIGTERM', () => {
      info('SIGTERM received, shutting down gracefully...');
      server.close(() => {
        info('Server closed');
        process.exit(0);
      });
      // Force exit after 10 seconds
      setTimeout(() => {
        logError('Forced shutdown after 10s timeout');
        process.exit(1);
      }, 10000);
    });
  })();
}
