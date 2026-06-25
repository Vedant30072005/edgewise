/* Edgewise — app orchestrator (plain script, loaded after module scripts) */

var lastStats = null;
var _pendingSettings  = {};
var _pendingViolations = [];

function setLoading(on) {
  document.getElementById('statGrid')?.classList.toggle('loading', on);
  document.getElementById('tradeCount')?.classList.toggle('loading', on);
}

function safePanel(promise, elId, fallback) {
  if (fallback === undefined) fallback = null;
  return promise.catch(function(err) {
    console.error('[edgewise] Panel error' + (elId ? ' (' + elId + ')' : '') + ':', err.message);
    if (elId) {
      const el = document.getElementById(elId);
      if (el) el.innerHTML =
        '<div class="empty" style="color:var(--loss)">Failed to load — <a href="#" onclick="location.reload()">refresh</a></div>';
    }
    return fallback;
  });
}

async function refresh() {
  setLoading(true);
  try {
    const results = await Promise.all([
      safePanel(loadTrades(true)),
      safePanel(api.get('/api/trades/stats'), 'statGrid'),
      safePanel(api.get('/api/trades/debrief').then(renderDebrief), 'debriefBody'),
      safePanel(api.get('/api/settings')),
      safePanel(api.get('/api/trades/violations')),
    ]);
    const stats      = results[1];
    const settings   = results[3];
    const violations = results[4];

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

    _pendingSettings   = settings?.settings   ?? _pendingSettings;
    _pendingViolations = violations?.violations ?? _pendingViolations;

    renderTable(lastStats, refresh);
    renderGuard(_pendingSettings, _pendingViolations);
  } finally {
    setLoading(false);
  }
}

(async function init() {
  initDarkMode();
  initMobileNav();

  let user;
  try {
    const res = await api.get('/api/auth/me');
    user = res.user;
    document.getElementById('navUser').textContent = user.name;
    if (user.role === 'admin') document.getElementById('adminLink').style.display = '';
  } catch (e) { window.location.href = '/login'; return; }

  document.getElementById('fDate').value = new Date().toISOString().slice(0, 10);

  if (!user.email_verified) {
    document.getElementById('verifyBanner').style.display = '';
    document.getElementById('resendVerify').addEventListener('click', async function(ev) {
      ev.target.disabled = true; ev.target.textContent = 'Sent';
      try { await api.post('/api/auth/resend-verify', {}); toast('Verification email sent — check your inbox'); }
      catch (e) { toast(e.message, true); ev.target.disabled = false; ev.target.textContent = 'Resend link'; }
    });
  }

  if (new URLSearchParams(location.search).get('verified') === '1') {
    toast('Email verified.');
    history.replaceState(null, '', '/app');
  }

  document.getElementById('guardSaveBtn').addEventListener('click', async function() {
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

  document.getElementById('logoutBtn').addEventListener('click', logout);

  wireForm(refresh);
  wireFilters(async function() { await loadTrades(true); renderTable(lastStats, refresh); });
  wireLoadMore(async function() { await loadTrades(false); renderTable(lastStats, refresh); });
  wireImport(refresh);

  window.addEventListener('resize', function() {
    if (lastStats) {
      drawCurve(document.getElementById('curve'), lastStats.curve);
      renderMonthlyBars(lastStats.byMonth);
    }
  });

  await refresh();
})();
