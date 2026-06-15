/**
 * Edgewise — server entry point.
 * Run: npm install && npm start  →  http://localhost:3000
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { seedAdmin } = require('./src/db');
const { attachUser } = require('./src/auth');
const authRoutes = require('./src/routes/auth.routes');
const tradeRoutes = require('./src/routes/trades.routes');
const adminRoutes = require('./src/routes/admin.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const importRoutes = require('./src/routes/import.routes');

seedAdmin();

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

/* JSON 404 for unknown API routes; pages fall back to landing */
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((_req, res) => res.status(404).sendFile(pub('index.html')));

app.listen(PORT, () => {
  console.log(`[edgewise] running at http://localhost:${PORT}`);
  console.log('[edgewise] landing: /   app: /app   admin: /admin');
});
