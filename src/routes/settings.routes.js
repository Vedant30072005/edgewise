/** Edgewise — /api/settings routes (risk guard configuration) */
const express = require('express');
const { get, run } = require('../db');
const { requireAuth, toNum } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const DEFAULTS = { daily_loss_limit_r: null, max_risk_amount: null, cooldown_minutes: null };

router.get('/', async (req, res) => {
  const row = await get(
    'SELECT daily_loss_limit_r, max_risk_amount, cooldown_minutes FROM risk_settings WHERE user_id = $1',
    [req.user.id]
  );
  res.json({ settings: row || DEFAULTS });
});

router.put('/', async (req, res) => {
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
  await run(
    `INSERT INTO risk_settings (user_id, daily_loss_limit_r, max_risk_amount, cooldown_minutes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(user_id) DO UPDATE SET
       daily_loss_limit_r = EXCLUDED.daily_loss_limit_r,
       max_risk_amount    = EXCLUDED.max_risk_amount,
       cooldown_minutes   = EXCLUDED.cooldown_minutes`,
    [req.user.id, clean.daily_loss_limit_r, clean.max_risk_amount, clean.cooldown_minutes]
  );
  res.json({ settings: clean });
});

module.exports = router;
