/**
 * Edgewise — app orchestrator (ES module entry point).
 *
 * This file is intentionally lean: it imports focused modules,
 * coordinates the boot sequence, and wires the top-level refresh loop.
 * Business logic lives in the imported modules.
 */
import { api, logout }                         from './modules/api.js';
import { toast, initDarkMode, initMobileNav }  from './modules/ui.js';
import { renderStats, renderDebrief,
         renderSlice, renderGuard }            from './modules/stats.js';
import { renderCurve, drawCurve,
         renderMonthlyBars }                   from './modules/charts.js';
import { loadTrades, renderTable, renderTagList,
         wireForm, wireFilters,
         wireLoadMore, wireImport }            from './modules/trades.js';

/* ── shared state ─────────────────────────────────────────────── */
let lastStats = null;
let _pendingSettings  = {};
let _pendingViolations = [];

/* ── loading skeleton ─────────────────────────────────────────── */
function setLoading(on) {
  document.getElementById('statGrid')?.classList.toggle('loading', on);
  document.getElementById('tradeCount')?.classList.toggle('loading', on);
}

/* ── per-panel error boundary ─────────────────────────────────── */
/**
 * Wraps a promise so a single panel failure never crashes the whole refresh.
 * Shows an inline error message in the target element instead of throwing.
 * @param {Promise}  promise   - The panel fetch/render promise
 * @param {string}   [elId]    - Optional DOM id to show error message in
 * @param {*}        fallback  - Value to resolve to on failure (default null)
 */
function safePanel(promise, elId, fallback = null) {
  return promise.catch(err => {
    console.error(`[edgewise] Panel error${elId ? ` (${elId})` : ''}:`, err.message);
    if (elId) {
      const el = document.getElementById(elId);
      if (el) el.innerHTML =
        `<div class="empty" style="color:var(--loss)">Failed to load — <a href="#" onclick="location.reload()">refresh</a></div>`;
    }
    return fallback;
  });
}

/* ── full page refresh ────────────────────────────────────────── */
async function refresh() {
  setLoading(true);
  try {
    // Fetch all panels in parallel; individual failures are contained.
    const [, stats, , settings, violations] = await Promise.all([
      safePanel(loadTrades(true)),
      safePanel(api.get('/api/trades/stats'), 'statGrid'),
      safePanel(api.get('/api/trades/debrief').then(renderDebrief), 'debriefBody'),
      safePanel(api.get('/api/settings')),
      safePanel(api.get('/api/trades/violations')),
    ]);

    if (stats) {
      lastStats = stats;
      renderStats(lastStats);
      renderCurve(lastStats.curve);
      renderMonthlyBars(lastStats.byMonth);
      renderSlice('bySetup', lastStats.bySetup);
      renderSlice('byMood', lastStats.byMood);
      renderTagList(lastStats);
      document.getElementById('tradeCount').textContent = lastStats.totalTrades + ' TRADES LOGGED';
    }

    _pendingSettings  = settings?.settings  ?? _pendingSettings;
    _pendingViolations = violations?.violations ?? _pendingViolations;

    renderTable(lastStats, refresh);
    renderGuard(_pendingSettings, _pendingViolations);
  } finally {
    setLoading(false);
  }
}

/* ── boot ─────────────────────────────────────────────────────── */
(async function init() {
  initDarkMode();
  initMobileNav();

  let user;
  try {
    const res = await api.get('/api/auth/me');
    user = res.user;
    document.getElementById('navUser').textContent = user.name;
    if (user.role === 'admin') document.getElementById('adminLink').style.display = '';
  } catch { window.location.href = '/login'; return; }

  document.getElementById('fDate').value = new Date().toISOString().slice(0, 10);

  /* Email verify banner */
  if (!user.email_verified) {
    document.getElementById('verifyBanner').style.display = '';
    document.getElementById('resendVerify').addEventListener('click', async (btn) => {
      btn.target.disabled = true; btn.target.textContent = 'Sent';
      try { await api.post('/api/auth/resend-verify', {}); toast('Verification email sent — check your inbox'); }
      catch (e) { toast(e.message, true); btn.target.disabled = false; btn.target.textContent = 'Resend link'; }
    });
  }

  /* Post-verify redirect toast */
  if (new URLSearchParams(location.search).get('verified') === '1') {
    toast('Email verified. ');
    history.replaceState(null, '', '/app');
  }

  /* Risk guard save */
  document.getElementById('guardSaveBtn').addEventListener('click', async () => {
    const gErr = document.getElementById('guardErr');
    gErr.classList.remove('show');
    try {
      await api.put('/api/settings', {
        daily_loss_limit_r: document.getElementById('gDaily').value,
        max_risk_amount:    document.getElementById('gMaxRisk').value,
        cooldown_minutes:   document.getElementById('gCooldown').value,
      });
      toast('Risk rules saved');
      await refresh();
    } catch (e) { gErr.textContent = e.message; gErr.classList.add('show'); }
  });

  /* Logout */
  document.getElementById('logoutBtn').addEventListener('click', logout);

  /* Wire trade form, filters, load-more, import */
  wireForm(refresh);
  wireFilters(async () => { await loadTrades(true); renderTable(lastStats, refresh); });
  wireLoadMore(async () => { await loadTrades(false); renderTable(lastStats, refresh); });
  wireImport(refresh);

  /* Resize redraws charts */
  window.addEventListener('resize', () => {
    if (lastStats) {
      drawCurve(document.getElementById('curve'), lastStats.curve);
      renderMonthlyBars(lastStats.byMonth);
    }
  });

  await refresh();
})();
