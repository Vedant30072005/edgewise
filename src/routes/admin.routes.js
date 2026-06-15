/** Edgewise — /api/admin routes (admin role only) */
const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

/* Platform overview */
router.get('/stats', (_req, res) => {
  const users = db.prepare(`SELECT COUNT(*) c FROM users`).get().c;
  const active = db.prepare(`SELECT COUNT(*) c FROM users WHERE is_active = 1`).get().c;
  const trades = db.prepare(`SELECT COUNT(*) c FROM trades`).get().c;
  const last7 = db
    .prepare(`SELECT COUNT(*) c FROM trades WHERE created_at >= datetime('now','-7 days')`)
    .get().c;
  res.json({ users, activeUsers: active, totalTrades: trades, tradesLast7Days: last7 });
});

/* User list with journal activity */
router.get('/users', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.is_active, u.plan, u.email_verified, u.created_at,
              COUNT(t.id) AS trade_count,
              ROUND(COALESCE(SUM(t.r_multiple), 0), 2) AS net_r,
              MAX(t.created_at) AS last_trade_at
       FROM users u LEFT JOIN trades t ON t.user_id = u.id
       GROUP BY u.id ORDER BY u.created_at DESC`
    )
    .all();
  res.json({ users: rows });
});

/* Activate / deactivate a user (cannot touch yourself or other admins) */
router.patch('/users/:id/active', (req, res) => {
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't deactivate your own account." });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admins cannot be deactivated from the panel.' });
  const isActive = req.body?.is_active ? 1 : 0;
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive, target.id);
  res.json({ ok: true, is_active: isActive });
});

/* Set user plan (free / pro) */
router.patch('/users/:id/plan', (req, res) => {
  const { plan } = req.body || {};
  if (!['free', 'pro'].includes(plan)) return res.status(400).json({ error: 'Plan must be free or pro.' });
  const target = db.prepare('SELECT id, role FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admin accounts are always Pro.' });
  db.prepare('UPDATE users SET plan=? WHERE id=?').run(plan, target.id);
  res.json({ ok: true, plan });
});

/* Delete a user and their journal (same guards) */
router.delete('/users/:id', (req, res) => {
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admins cannot be deleted from the panel.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

module.exports = router;
