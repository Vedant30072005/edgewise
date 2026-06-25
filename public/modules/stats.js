/* Edgewise — stats (plain script, no ES module syntax) */

function renderStats(s) {
  const set = (id, txt, cls) => {
    const el = document.getElementById(id);
    el.textContent = txt;
    el.className = cls || '';
  };
  set('sNet', s.totalTrades ? fmtR(s.netR) : '—', s.netR >= 0 ? 'win' : 'loss');
  set('sWin', s.totalTrades ? s.winRate + '%' : '—');
  set('sExp', s.totalTrades ? fmtR(s.expectancy) : '—', s.expectancy >= 0 ? 'win' : 'loss');
  set('sDd', s.totalTrades ? (s.maxDrawdownR === 0 ? '0.00R' : '-' + s.maxDrawdownR.toFixed(2) + 'R') : '—', s.maxDrawdownR > 0 ? 'loss' : '');
  set('sPf', s.profitFactor != null ? s.profitFactor.toFixed(2) : '—');
  const str = s.streak;
  if (str && str.count > 0) {
    set('sStr',
      (str.type === 'win' ? '+' : '-') + str.count + (str.type === 'win' ? 'W' : 'L'),
      str.type === 'win' ? 'win' : 'loss');
  } else {
    set('sStr', '—');
  }
}

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
