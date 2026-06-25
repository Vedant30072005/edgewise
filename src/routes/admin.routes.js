/** Edgewise — /api/admin routes (admin role only) */
const express = require('express');
const { all, get, run } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

/* Platform overview */
router.get('/stats', async (_req, res) => {
  const [usersRow, activeRow, tradesRow, last7Row] = await Promise.all([
    get(`SELECT COUNT(*) AS c FROM users`),
    get(`SELECT COUNT(*) AS c FROM users WHERE is_active = 1`),
    get(`SELECT COUNT(*) AS c FROM trades`),
    get(`SELECT COUNT(*) AS c FROM trades WHERE created_at >= NOW() - INTERVAL '7 days'`),
  ]);
  res.json({
    users: parseInt(usersRow.c),
    activeUsers: parseInt(activeRow.c),
    totalTrades: parseInt(tradesRow.c),
    tradesLast7Days: parseInt(last7Row.c),
  });
});

/* User list with journal activity */
router.get('/users', async (_req, res) => {
  const rows = await all(
    `SELECT u.id, u.email, u.name, u.role, u.is_active, u.plan, u.email_verified, u.created_at,
            COUNT(t.id) AS trade_count,
            ROUND(COALESCE(SUM(t.r_multiple), 0)::numeric, 2) AS net_r,
            MAX(t.created_at) AS last_trade_at
     FROM users u LEFT JOIN trades t ON t.user_id = u.id
     GROUP BY u.id ORDER BY u.created_at DESC`
  );
  res.json({ users: rows });
});

/* Activate / deactivate a user (cannot touch yourself or other admins) */
router.patch('/users/:id/active', async (req, res) => {
  const target = await get('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't deactivate your own account." });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admins cannot be deactivated from the panel.' });
  const isActive = req.body?.is_active ? 1 : 0;
  await run('UPDATE users SET is_active = $1 WHERE id = $2', [isActive, target.id]);
  res.json({ ok: true, is_active: isActive });
});

/* Set user plan (free / pro) */
router.patch('/users/:id/plan', async (req, res) => {
  const { plan } = req.body || {};
  if (!['free', 'pro'].includes(plan)) return res.status(400).json({ error: 'Plan must be free or pro.' });
  const target = await get('SELECT id, role FROM users WHERE id=$1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admin accounts are always Pro.' });
  await run('UPDATE users SET plan=$1 WHERE id=$2', [plan, target.id]);
  res.json({ ok: true, plan });
});

/* Delete a user and their journal (same guards) */
router.delete('/users/:id', async (req, res) => {
  const target = await get('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admins cannot be deleted from the panel.' });
  await run('DELETE FROM users WHERE id = $1', [target.id]);
  res.json({ ok: true });
});

module.exports = router;
