/* Edgewise — trading journal app logic */

/* ── state ────────────────────────────────────────────────────── */
let trades = [];
let filteredTotal = 0;
let lastStats = null;
const PAGE_SIZE = 200;

const filters = { symbol: '', mood: '', setup: '', notes: '', from: '', to: '' };

/* ── boot ─────────────────────────────────────────────────────── */
(async function init() {
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

  /* Show verified toast after email verify redirect */
  if (new URLSearchParams(location.search).get('verified') === '1') {
    toast('Email verified. ');
    history.replaceState(null, '', '/app');
  }

  await refresh();
})();

document.getElementById('logoutBtn').addEventListener('click', logout);

/* ── data loading ─────────────────────────────────────────────── */
async function loadTrades(reset = false) {
  if (reset) trades = [];
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: trades.length });
  if (filters.symbol) params.set('symbol', filters.symbol);
  if (filters.mood) params.set('mood', filters.mood);
  if (filters.setup) params.set('setup', filters.setup);
  if (filters.notes) params.set('notes', filters.notes);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const { trades: t, total } = await api.get('/api/trades?' + params);
  trades = reset ? t : [...trades, ...t];
  filteredTotal = total;
}

async function refresh() {
  await Promise.all([
    loadTrades(true),
    api.get('/api/trades/stats').then(s => { lastStats = s; }),
    api.get('/api/trades/debrief').then(renderDebrief),
    api.get('/api/settings').then(({ settings }) => _pendingSettings = settings),
    api.get('/api/trades/violations').then(({ violations }) => _pendingViolations = violations),
  ]);
  renderStats(lastStats);
  renderCurve(lastStats.curve);
  renderMonthlyBars(lastStats.byMonth);
  renderTable();
  renderSlice('bySetup', lastStats.bySetup);
  renderSlice('byMood', lastStats.byMood);
  renderTagList();
  renderGuard(_pendingSettings, _pendingViolations);
  document.getElementById('tradeCount').textContent = lastStats.totalTrades + ' TRADES LOGGED';
}
let _pendingSettings = {}, _pendingViolations = [];

/* ── stats ────────────────────────────────────────────────────── */
function renderStats(s) {
  const set = (id, txt, cls) => { const el = document.getElementById(id); el.textContent = txt; el.className = cls || ''; };
  set('sNet', s.totalTrades ? fmtR(s.netR) : '—', s.netR >= 0 ? 'win' : 'loss');
  set('sWin', s.totalTrades ? s.winRate + '%' : '—');
  set('sExp', s.totalTrades ? fmtR(s.expectancy) : '—', s.expectancy >= 0 ? 'win' : 'loss');
  set('sDd', s.totalTrades ? '-' + s.maxDrawdownR.toFixed(2) + 'R' : '—', 'loss');
  set('sPf', s.profitFactor != null ? s.profitFactor.toFixed(2) : '—');
  const str = s.streak;
  if (str && str.count > 0) {
    set('sStr', (str.type === 'win' ? '+' : '-') + str.count + (str.type === 'win' ? 'W' : 'L'),
      str.type === 'win' ? 'win' : 'loss');
  } else {
    set('sStr', '—');
  }
}

/* ── weekly debrief ───────────────────────────────────────────── */
function renderDebrief(d) {
  document.getElementById('debriefMeta').textContent =
    d.trades ? `${d.trades} TRADES · ${fmtR(d.netR)} · ${d.winRate}% WIN` : 'NO TRADES THIS WEEK';
  const bits = [];
  if (d.worstSetup) bits.push(`Worst setup: <b>${esc(d.worstSetup.key)}</b> <span class="loss mono">${fmtR(d.worstSetup.totalR)}</span> over ${d.worstSetup.trades} trades.`);
  if (d.worstMood) bits.push(`Costliest state: <b>${esc(d.worstMood.key)}</b> <span class="loss mono">${fmtR(d.worstMood.totalR)}</span>.`);
  if (d.bestSetup) bits.push(`Paying setup: <b>${esc(d.bestSetup.key)}</b> <span class="win mono">${fmtR(d.bestSetup.totalR)}</span> over ${d.bestSetup.trades} trades.`);
  if (d.violations.length) bits.push(`Rule breaks: ${d.violations.map(v => `<b>${esc(v.rule)}</b> ×${v.c}`).join(', ')}.`);
  const aiLabel = d.aiPowered
    ? `THIS WEEK'S ONE ACTION ITEM &nbsp;<span style="color:var(--ultra);font-size:9px;letter-spacing:.14em">AI</span>`
    : `THIS WEEK'S ONE ACTION ITEM`;
  document.getElementById('debriefBody').innerHTML = `
    ${bits.length ? `<p style="font-size:14.5px;color:var(--ink-soft);margin-bottom:14px">${bits.join(' ')}</p>` : ''}
    <div style="border:1px dashed var(--line-strong);border-radius:2px;padding:14px 16px">
      <span class="mono" style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ultra)">${aiLabel}</span>
      <p style="margin-top:6px;font-size:15px"><b>${esc(d.action)}</b></p>
    </div>`;
}

/* ── risk guard ───────────────────────────────────────────────── */
function renderGuard(s, violations) {
  document.getElementById('gDaily').value = s.daily_loss_limit_r ?? '';
  document.getElementById('gMaxRisk').value = s.max_risk_amount ?? '';
  document.getElementById('gCooldown').value = s.cooldown_minutes ?? '';
  const armed = [s.daily_loss_limit_r, s.max_risk_amount, s.cooldown_minutes].filter(v => v != null).length;
  document.getElementById('guardState').textContent = armed ? `${armed} RULE${armed > 1 ? 'S' : ''} ARMED` : 'DISARMED';
  const list = document.getElementById('violationsList');
  if (!violations.length) { list.innerHTML = ''; return; }
  list.innerHTML = `
    <span class="mono" style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint)">
      Recent violations — the receipts (${violations.length} shown)
    </span>
    ${violations.map(v => `
      <div class="slice-row">
        <span class="tag tag--mood-revenge">${esc(v.rule)}</span>
        <span style="flex:1;font-size:13.5px;color:var(--ink-soft);margin:0 14px">${esc(v.detail)}</span>
        <span class="mono" style="font-size:11.5px;color:var(--ink-faint)">${esc(v.created_at.slice(0, 16))}</span>
      </div>`).join('')}`;
}

document.getElementById('guardSaveBtn').addEventListener('click', async () => {
  const gErr = document.getElementById('guardErr');
  gErr.classList.remove('show');
  try {
    await api.put('/api/settings', {
      daily_loss_limit_r: document.getElementById('gDaily').value,
      max_risk_amount: document.getElementById('gMaxRisk').value,
      cooldown_minutes: document.getElementById('gCooldown').value,
    });
    toast('Risk rules saved');
    await refresh();
  } catch (e) { gErr.textContent = e.message; gErr.classList.add('show'); }
});

/* ── equity curve ─────────────────────────────────────────────── */
function renderCurve(curve) {
  const empty = curve.length < 2;
  document.getElementById('curveEmpty').style.display = empty ? '' : 'none';
  document.querySelector('.curve-wrap').style.display = empty ? 'none' : '';
  document.getElementById('curveNote').textContent = empty ? '' : (curve.length - 1) + ' trades · drawdown shaded';
  if (empty) return;
  drawCurve(document.getElementById('curve'), curve);
}

function drawCurve(canvas, curve) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, padX = 10, padT = 16, padB = 14;
  const N = curve.length - 1;
  const min = Math.min(...curve), max = Math.max(...curve), span = (max - min) || 1;
  const X = i => padX + (i / N) * (w - 2 * padX);
  const Y = v => padT + (1 - (v - min) / span) * (h - padT - padB);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(16,16,25,.07)';
  for (let g = 1; g < 5; g++) { const gy = padT + g * (h - padT - padB) / 5;
    ctx.beginPath(); ctx.moveTo(padX, gy); ctx.lineTo(w - padX, gy); ctx.stroke(); }
  if (min < 0 && max > 0) {
    ctx.strokeStyle = 'rgba(16,16,25,.3)'; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(padX, Y(0)); ctx.lineTo(w - padX, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  }
  let peak = curve[0]; ctx.fillStyle = 'rgba(206,43,29,.10)'; ctx.beginPath(); let started = false;
  for (let i = 0; i <= N; i++) {
    peak = Math.max(peak, curve[i]);
    if (curve[i] < peak - 1e-9) {
      if (!started) { ctx.moveTo(X(Math.max(0, i - 1)), Y(peak)); started = true; }
      ctx.lineTo(X(i), Y(curve[i]));
    } else if (started) { ctx.lineTo(X(i), Y(peak)); ctx.closePath(); ctx.fill(); ctx.beginPath(); started = false; }
  }
  if (started) { ctx.lineTo(X(N), Y(peak)); ctx.closePath(); ctx.fill(); }
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, 'rgba(35,35,230,.12)'); grad.addColorStop(1, 'rgba(35,35,230,0)');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(X(0), h - padB);
  for (let i = 0; i <= N; i++) ctx.lineTo(X(i), Y(curve[i]));
  ctx.lineTo(X(N), h - padB); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#2323E6'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= N; i++) i ? ctx.lineTo(X(i), Y(curve[i])) : ctx.moveTo(X(i), Y(curve[i]));
  ctx.stroke();
  ctx.fillStyle = '#2323E6'; ctx.beginPath(); ctx.arc(X(N), Y(curve[N]), 4, 0, Math.PI * 2); ctx.fill();
}

window.addEventListener('resize', () => {
  if (lastStats) {
    drawCurve(document.getElementById('curve'), lastStats.curve);
    renderMonthlyBars(lastStats.byMonth);
  }
});

/* ── monthly performance bars ─────────────────────────────────── */
function renderMonthlyBars(byMonth) {
  const panel = document.getElementById('monthlyPanel');
  if (!byMonth || byMonth.length < 2) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const show = byMonth.slice(-12); // last 12 months
  document.getElementById('monthlyNote').textContent = show.length + ' MONTHS';

  const canvas = document.getElementById('monthlyCanvas');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width, h = rect.height;
  const padL = 8, padR = 8, padT = 28, padB = 36;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const barW = Math.max(4, (innerW / show.length) * 0.65);
  const gap = innerW / show.length;

  const vals = show.map(m => m.totalR);
  const maxVal = Math.max(...vals.map(Math.abs), 0.5);
  const zeroY = padT + innerH * (maxVal / (2 * maxVal));

  ctx.clearRect(0, 0, w, h);

  /* zero line */
  ctx.strokeStyle = 'rgba(16,16,25,.25)'; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(w - padR, zeroY); ctx.stroke();
  ctx.setLineDash([]);

  /* bars */
  show.forEach((m, i) => {
    const x = padL + i * gap + (gap - barW) / 2;
    const barH = Math.abs(m.totalR) / maxVal * (innerH / 2);
    const isPos = m.totalR >= 0;
    const barY = isPos ? zeroY - barH : zeroY;

    ctx.fillStyle = isPos ? 'rgba(11,124,85,.8)' : 'rgba(206,43,29,.8)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, barY, barW, Math.max(barH, 1), 2) : ctx.rect(x, barY, barW, Math.max(barH, 1));
    ctx.fill();

    /* value label */
    ctx.fillStyle = isPos ? 'var(--win, #0B7C55)' : 'var(--loss, #CE2B1D)';
    ctx.font = `bold ${Math.min(11, Math.max(9, barW * 0.5))}px monospace`;
    ctx.textAlign = 'center';
    const labelY = isPos ? barY - 4 : barY + barH + 11;
    if (barH > 4) ctx.fillText((isPos ? '+' : '') + m.totalR.toFixed(1), x + barW / 2, labelY);

    /* month label */
    const [yr, mo] = m.month.split('-');
    const moName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo) - 1];
    ctx.fillStyle = 'rgba(16,16,25,.45)';
    ctx.font = `${Math.min(10, Math.max(8, gap * 0.35))}px monospace`;
    ctx.fillText(moName, x + barW / 2, h - padB + 14);
    if (show.length <= 6) ctx.fillText(yr, x + barW / 2, h - padB + 25);
  });
}

/* ── trades table ─────────────────────────────────────────────── */
function renderTable() {
  const hasAll = lastStats?.totalTrades > 0;
  const hasRows = trades.length > 0;

  const filtersEl = document.getElementById('tradeFilters');
  if (filtersEl) filtersEl.style.display = hasAll ? 'flex' : 'none';

  const countEl = document.getElementById('tradeFilterCount');
  if (countEl) {
    const hasFilters = Object.values(filters).some(v => v);
    countEl.textContent = hasFilters ? `${filteredTotal} MATCHING` : '';
  }

  /* Load more button */
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreWrap && loadMoreBtn) {
    const remaining = filteredTotal - trades.length;
    if (remaining > 0) {
      loadMoreWrap.style.display = '';
      loadMoreBtn.textContent = `Load ${Math.min(remaining, PAGE_SIZE)} more`;
    } else {
      loadMoreWrap.style.display = 'none';
    }
  }

  document.getElementById('tradesTable').style.display = hasRows ? '' : 'none';

  const emptyEl = document.getElementById('tableEmpty');
  if (!hasAll) {
    emptyEl.style.display = '';
    emptyEl.innerHTML = '<b>The table is the mirror</b>Every row is evidence. Log the losers especially — they pay the tuition.';
  } else if (!hasRows) {
    emptyEl.style.display = '';
    emptyEl.innerHTML = '<b>No matching trades</b>Adjust the filters above or clear them to see all trades.';
  } else {
    emptyEl.style.display = 'none';
  }

  if (!hasRows) return;

  document.getElementById('tradesBody').innerHTML = trades.map(t => `
    <tr>
      <td class="mono">${esc(t.trade_date)}</td>
      <td><b>${esc(t.symbol)}</b></td>
      <td class="mono">${t.side === 'long' ? 'LONG' : 'SHORT'}</td>
      <td class="mono">${t.entry_price} → ${t.exit_price}</td>
      <td class="mono">${t.quantity}</td>
      <td class="mono ${t.pnl >= 0 ? 'win' : 'loss'}">${t.pnl >= 0 ? '+' : ''}${t.pnl}</td>
      <td class="mono ${t.r_multiple >= 0 ? 'win' : 'loss'}"><b>${fmtR(t.r_multiple)}</b></td>
      <td><span class="tag">${esc(t.setup_tag)}</span></td>
      <td><span class="tag tag--mood-${esc(t.mood)}">${esc(t.mood)}</span></td>
      <td style="max-width:240px;font-size:13px;color:var(--ink-soft)">${esc(t.notes)}</td>
      <td><div class="row-actions">
        <button class="icon-btn icon-btn--edit" data-edit="${t.id}" aria-label="Edit trade ${esc(t.symbol)} on ${esc(t.trade_date)}">
          <svg viewBox="0 0 15 15" fill="none"><path d="M10.5 2.5l2 2L5 12l-2.6.6L3 10l7.5-7.5z" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
        <button class="icon-btn" data-del="${t.id}" aria-label="Delete trade ${esc(t.symbol)} on ${esc(t.trade_date)}">
          <svg viewBox="0 0 15 15" fill="none"><path d="M2 4h11M5 4V2.5h5V4M4 4l.7 9h5.6L11 4" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
      </div></td>
    </tr>`).join('');

  document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this trade? The journal forgets nothing unless you make it.')) return;
    try { await api.del('/api/trades/' + b.dataset.del); toast('Trade deleted'); await refresh(); }
    catch (e) { toast(e.message, true); }
  }));
  document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const t = trades.find(x => x.id === +b.dataset.edit);
    if (!t) return;
    editingId = t.id;
    f('fDate').value = t.trade_date; f('fSymbol').value = t.symbol; f('fSide').value = t.side;
    f('fEntry').value = t.entry_price; f('fExit').value = t.exit_price; f('fQty').value = t.quantity;
    f('fRisk').value = t.risk_amount; f('fTag').value = t.setup_tag; f('fMood').value = t.mood;
    f('fNotes').value = t.notes;
    previewR();
    document.getElementById('saveBtn').textContent = 'Update trade';
    document.getElementById('cancelEditBtn').style.display = '';
    document.getElementById('saveBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}

document.getElementById('loadMoreBtn').addEventListener('click', async () => {
  const btn = document.getElementById('loadMoreBtn');
  btn.disabled = true; btn.textContent = 'Loading…';
  await loadTrades(false);
  renderTable();
  btn.disabled = false;
});

function renderTagList() {
  const tags = (lastStats?.bySetup || []).map(s => s.key);
  document.getElementById('tagList').innerHTML = tags.map(t => `<option value="${esc(t)}">`).join('');
}

/* ── slices ───────────────────────────────────────────────────── */
function renderSlice(id, rows) {
  const el = document.getElementById(id);
  if (!rows.length) { el.innerHTML = '<div class="empty">Needs logged trades.</div>'; return; }
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.expectancy)), 0.01);
  el.innerHTML = rows.map(r => `
    <div class="slice-row">
      <span class="mono" style="min-width:110px">${esc(r.key)}</span>
      <div class="bar"><i style="width:${Math.round(Math.abs(r.expectancy) / maxAbs * 100)}%;
        background:${r.expectancy >= 0 ? 'var(--win)' : 'var(--loss)'}"></i></div>
      <span class="mono ${r.expectancy >= 0 ? 'win' : 'loss'}" style="min-width:64px;text-align:right">${fmtR(r.expectancy)}</span>
      <span class="mono" style="color:var(--ink-faint);min-width:54px;text-align:right">${r.trades}t</span>
    </div>`).join('');
}

/* ── trade form ───────────────────────────────────────────────── */
const formErr = document.getElementById('formErr');
const f = (id) => document.getElementById(id);

function previewR() {
  const side = f('fSide').value === 'long' ? 1 : -1;
  const pnl = (parseFloat(f('fExit').value) - parseFloat(f('fEntry').value)) * parseFloat(f('fQty').value) * side;
  const risk = parseFloat(f('fRisk').value);
  const el = document.getElementById('rPreview');
  if (Number.isFinite(pnl) && Number.isFinite(risk) && risk > 0) {
    const r = pnl / risk;
    el.textContent = `P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} · ${fmtR(r)}`;
    el.style.color = r >= 0 ? 'var(--win)' : 'var(--loss)';
  } else el.textContent = '';
}
['fEntry', 'fExit', 'fQty', 'fRisk', 'fSide'].forEach(id => f(id).addEventListener('input', previewR));

let editingId = null;

function resetForm() {
  ['fSymbol', 'fEntry', 'fExit', 'fQty', 'fRisk', 'fNotes'].forEach(id => f(id).value = '');
  f('fMood').value = 'neutral'; previewR();
  editingId = null;
  document.getElementById('saveBtn').textContent = 'Log trade';
  document.getElementById('cancelEditBtn').style.display = 'none';
}
document.getElementById('cancelEditBtn').addEventListener('click', resetForm);

document.getElementById('saveBtn').addEventListener('click', async () => {
  formErr.classList.remove('show');
  const btn = document.getElementById('saveBtn');
  const updating = editingId !== null;
  btn.disabled = true; btn.textContent = updating ? 'Updating…' : 'Logging…';
  try {
    const payload = {
      trade_date: f('fDate').value, symbol: f('fSymbol').value, side: f('fSide').value,
      entry_price: f('fEntry').value, exit_price: f('fExit').value, quantity: f('fQty').value,
      risk_amount: f('fRisk').value, setup_tag: f('fTag').value, mood: f('fMood').value,
      notes: f('fNotes').value,
    };
    const res = updating
      ? await api.put('/api/trades/' + editingId, payload)
      : await api.post('/api/trades', payload);
    resetForm();
    if (res.violations?.length) {
      toast('RULE BROKEN: ' + res.violations.map(v => v.rule).join(', ') + ' — recorded', true);
    } else {
      toast(updating ? 'Trade updated' : 'Trade logged');
    }
    await refresh();
  } catch (e) {
    if (e.message.includes('PLAN_LIMIT') || e.message.includes('Free plan')) {
      formErr.textContent = e.message + ' Contact admin to upgrade your account.';
    } else {
      formErr.textContent = e.message;
    }
    formErr.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = editingId !== null ? 'Update trade' : 'Log trade';
  }
});

/* ── filter controls (server-side) ───────────────────────────── */
async function applyFilters() {
  await loadTrades(true);
  renderTable();
}

f('ffSymbol').addEventListener('input', e => { filters.symbol = e.target.value.trim(); applyFilters(); });
f('ffMood').addEventListener('change', e => { filters.mood = e.target.value; applyFilters(); });
f('ffSetup').addEventListener('input', e => { filters.setup = e.target.value.trim(); applyFilters(); });
f('ffNotes').addEventListener('input', e => { filters.notes = e.target.value.trim(); applyFilters(); });
f('ffFrom').addEventListener('change', e => { filters.from = e.target.value; applyFilters(); });
f('ffTo').addEventListener('change', e => { filters.to = e.target.value; applyFilters(); });

document.getElementById('clearFilters').addEventListener('click', async () => {
  Object.keys(filters).forEach(k => filters[k] = '');
  f('ffSymbol').value = ''; f('ffMood').value = ''; f('ffSetup').value = '';
  f('ffNotes').value = ''; f('ffFrom').value = ''; f('ffTo').value = '';
  await applyFilters();
});

/* ── import ───────────────────────────────────────────────────── */
document.getElementById('importToggle').addEventListener('click', () => {
  const sec = document.getElementById('importSection');
  const btn = document.getElementById('importToggle');
  const open = sec.style.display !== 'none';
  sec.style.display = open ? 'none' : '';
  btn.textContent = open ? 'Show' : 'Hide';
});

document.getElementById('importBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('importFile');
  const result = document.getElementById('importResult');
  if (!fileInput.files.length) { result.innerHTML = '<p style="color:var(--loss);font-size:13.5px">Choose a CSV file first.</p>'; return; }
  const btn = document.getElementById('importBtn');
  btn.disabled = true; btn.textContent = 'Importing…';
  result.innerHTML = '';
  try {
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const res = await fetch('/api/import/trades', { method: 'POST', credentials: 'same-origin', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    let html = `<p style="font-size:13.5px;margin-bottom:8px"><span class="mono win">✓ ${data.imported} trade${data.imported !== 1 ? 's' : ''} imported.</span>`;
    if (data.skipped.length) html += ` <span class="mono loss">${data.skipped.length} skipped.</span>`;
    if (data.truncated) html += ` <span class="mono" style="color:var(--ink-faint)">${data.truncated} not imported (plan limit).</span>`;
    html += `</p>`;
    if (data.skipped.length) {
      html += `<details style="font-size:12.5px;color:var(--ink-faint)"><summary style="cursor:pointer">Show skipped rows</summary><ul style="margin:6px 0 0 16px">`;
      data.skipped.forEach(s => { html += `<li>Row ${s.row}: ${esc(s.reason)}</li>`; });
      html += `</ul></details>`;
    }
    result.innerHTML = html;
    fileInput.value = '';
    await refresh();
  } catch (e) {
    result.innerHTML = `<p style="color:var(--loss);font-size:13.5px">${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Import';
  }
});
