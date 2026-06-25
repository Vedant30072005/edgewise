/**
 * Edgewise — auth helpers and middleware.
 * Sessions are JWTs stored in an httpOnly cookie ("ew_token").
 */
const jwt = require('jsonwebtoken');
const { get } = require('./db');

const COOKIE_NAME = 'ew_token';
const TOKEN_TTL = '7d';

function jwtSecret() {
  if (!process.env.JWT_SECRET) {
    console.warn('[edgewise] WARNING: JWT_SECRET not set in .env — using an insecure default. Fine for local dev only.');
  }
  return process.env.JWT_SECRET || 'dev-only-insecure-secret';
}

function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret(), { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}

/** Attach req.user if a valid session cookie is present; never throws. */
async function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, jwtSecret());
    const user = await get(
      'SELECT id, email, name, role, is_active, plan, email_verified FROM users WHERE id = $1',
      [payload.sub]
    );
    if (user && user.is_active) req.user = user;
  } catch {
    /* invalid/expired token — treat as logged out */
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

/* ---------- small validators ---------- */
const isEmail = (s) =>
  typeof s === 'string' &&
  s.length >= 5 && s.length <= 254 &&
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+$/.test(s);
const isNonEmpty = (s, max = 120) => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= max;
const isPassword = (s) => typeof s === 'string' && s.length >= 8 && s.length <= 128;
const toNum = (v) => (typeof v === 'number' ? v : parseFloat(v));

module.exports = {
  COOKIE_NAME,
  issueSession,
  clearSession,
  attachUser,
  requireAuth,
  requireAdmin,
  isEmail,
  isNonEmpty,
  isPassword,
  toNum,
};
