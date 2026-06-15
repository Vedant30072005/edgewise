/** Edgewise — /api/settings routes (risk guard configuration) */
const express = require('express');
const { db } = require('../db');
const { requireAuth, toNum } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const DEFAULTS = { daily_loss_limit_r: null, max_risk_amount: null, cooldown_minutes: null };

router.get('/', (req, res) => {
  const row = db.prepare('SELECT daily_loss_limit_r, max_risk_amount, cooldown_minutes FROM risk_settings WHERE user_id = ?')
    .get(req.user.id);
  res.json({ settings: row || DEFAULTS });
});

router.put('/', (req, res) => {
  const body = req.body || {};
  const clean = {};
  for (const [key, max] of [['daily_loss_limit_r', 100], ['max_risk_amount', 1e9], ['cooldown_minutes', 1440]]) {
    const raw = body[key];
    if (raw === null || raw === '' || raw === undefined) { clean[key] = null; continue; }
    const n = toNum(raw);
    if (!Number.isFinite(n) || n <= 0 || n > max) {
      return res.status(400).json({ error: `${key.replaceAll('_', ' ')} must be a positive number (or empty to disable).` });
    }
    clean[key] = key === 'cooldown_minutes' ? Math.round(n) : n;
  }
  db.prepare(
    `INSERT INTO risk_settings (user_id, daily_loss_limit_r, max_risk_amount, cooldown_minutes)
     VALUES (@user_id, @daily_loss_limit_r, @max_risk_amount, @cooldown_minutes)
     ON CONFLICT(user_id) DO UPDATE SET
       daily_loss_limit_r = excluded.daily_loss_limit_r,
       max_risk_amount    = excluded.max_risk_amount,
       cooldown_minutes   = excluded.cooldown_minutes`
  ).run({ user_id: req.user.id, ...clean });
  res.json({ settings: clean });
});

module.exports = router;
