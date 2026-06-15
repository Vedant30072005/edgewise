/** Edgewise — /api/auth routes */
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const { db } = require('../db');
const { issueSession, clearSession, requireAuth, isEmail, isNonEmpty, isPassword } = require('../auth');
const { createMiddleware: rateLimiter } = require('../rateLimiter');
const { sendMail } = require('../mailer');

const router = express.Router();

const loginLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts. Try again in 15 minutes.',
});

const forgotLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many password reset requests. Try again in 1 hour.',
});

function appUrl() {
  return process.env.APP_URL || 'http://localhost:3000';
}

router.post('/register', async (req, res) => {
  const { email, name, password } = req.body || {};
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!isNonEmpty(name, 80)) return res.status(400).json({ error: 'Enter your name.' });
  if (!isPassword(password)) return res.status(400).json({ error: 'Password must be 8–128 characters.' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare(`INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)`)
    .run(email.trim(), name.trim(), hash);

  const verifyToken = randomBytes(32).toString('hex');
  const verifyExpires = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare('UPDATE users SET email_verify_token=?, email_verify_expires=? WHERE id=?')
    .run(verifyToken, verifyExpires, info.lastInsertRowid);

  const user = db.prepare('SELECT id, email, name, role, plan, email_verified FROM users WHERE id = ?')
    .get(info.lastInsertRowid);
  issueSession(res, user);

  /* Fire-and-forget: don't hold up the response for email delivery. */
  const verifyUrl = `${appUrl()}/api/auth/verify-email?token=${verifyToken}`;
  sendMail({
    to: user.email,
    subject: 'Verify your Edgewise email',
    text: `Hi ${user.name},\n\nVerify your email address:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create this account, ignore this email.`,
    html: `<p>Hi ${user.name},</p><p><a href="${verifyUrl}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
  }).catch(err => console.error('[edgewise] email error:', err.message));

  res.status(201).json({ user });
});

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  const user = db
    .prepare('SELECT id, email, name, role, is_active, plan, email_verified, password_hash FROM users WHERE email = ?')
    .get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (!user.is_active) return res.status(403).json({ error: 'This account has been deactivated.' });

  issueSession(res, user);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan, email_verified: user.email_verified } });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/* Email verification — server-side redirect so no extra HTML page needed. */
router.get('/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login?msg=invalid-token');
  const user = db
    .prepare('SELECT id FROM users WHERE email_verify_token=? AND email_verify_expires>?')
    .get(token, Date.now());
  if (!user) return res.redirect('/login?msg=expired-token');
  db.prepare('UPDATE users SET email_verified=1, email_verify_token=NULL, email_verify_expires=NULL WHERE id=?')
    .run(user.id);
  res.redirect('/app?verified=1');
});

/* Resend verification email. */
router.post('/resend-verify', requireAuth, async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true });
  const token = randomBytes(32).toString('hex');
  const expires = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare('UPDATE users SET email_verify_token=?, email_verify_expires=? WHERE id=?')
    .run(token, expires, req.user.id);
  const verifyUrl = `${appUrl()}/api/auth/verify-email?token=${token}`;
  await sendMail({
    to: req.user.email,
    subject: 'Verify your Edgewise email',
    text: `Verify your email:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p><a href="${verifyUrl}">Verify your email address</a></p><p>Expires in 24 hours.</p>`,
  });
  res.json({ ok: true });
});

/* Forgot password — always returns ok to not leak whether email exists. */
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const user = db.prepare('SELECT id, email, name FROM users WHERE email=?').get(email);
  if (user) {
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + 60 * 60 * 1000; // 1 hour
    db.prepare('UPDATE users SET password_reset_token=?, password_reset_expires=? WHERE id=?')
      .run(token, expires, user.id);
    const resetUrl = `${appUrl()}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: 'Reset your Edgewise password',
      text: `Hi ${user.name},\n\nReset your password:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore it.`,
      html: `<p>Hi ${user.name},</p><p><a href="${resetUrl}">Reset your password</a></p><p>Expires in 1 hour. If you didn't request this, ignore this email.</p>`,
    });
  }
  res.json({ ok: true });
});

/* Reset password using token from email. */
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Invalid reset link.' });
  if (!isPassword(password)) return res.status(400).json({ error: 'Password must be 8–128 characters.' });
  const user = db
    .prepare('SELECT id FROM users WHERE password_reset_token=? AND password_reset_expires>?')
    .get(token, Date.now());
  if (!user) return res.status(400).json({ error: 'This reset link has expired or already been used. Request a new one.' });
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('UPDATE users SET password_hash=?, password_reset_token=NULL, password_reset_expires=NULL WHERE id=?')
    .run(hash, user.id);
  res.json({ ok: true });
});

module.exports = router;
