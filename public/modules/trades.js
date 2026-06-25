/* Edgewise — trades (plain script, no ES module syntax) */

const PAGE_SIZE = 200;
var trades = [];
var filteredTotal = 0;
const filters = { symbol: '', mood: '', setup: '', notes: '', from: '', to: '' };

var editingId = null;
const f = (id) => document.getElementById(id);

/* ── data loading ─────────────────────────────────────────────── */
async function loadTrades(reset) {
  if (reset) trades = [];
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: trades.length });
  if (filters.symbol) params.set('symbol', filters.symbol);
  if (filters.mood)   params.set('mood', filters.mood);
  if (filters.setup)  params.set('setup', filters.setup);
  if (filters.notes)  params.set('notes', filters.notes);
  if (filters.from)   params.set('from', filters.from);
  if (filters.to)     params.set('to', filters.to);
  const { trades: t, total } = await api.get('/api/trades?' + params);
  trades = reset ? t : [...trades, ...t];
  filteredTotal = total;
}

/* ── table ────────────────────────────────────────────────────── */
function renderTable(lastStats, onRefresh) {
  const hasAll = lastStats?.totalTrades > 0;
  const hasRows = trades.length > 0;

  const filtersEl = document.getElementById('tradeFilters');
  if (filtersEl) filtersEl.style.display = hasAll ? 'flex' : 'none';

  const countEl = document.getElementById('tradeFilterCount');
  if (countEl) {
    const hasFilters = Object.values(filters).some(v => v);
    countEl.textContent = hasFilters ? `${filteredTotal} MATCHING` : '';
  }

  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn  = document.getElementById('loadMoreBtn');
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
    try { await api.del('/api/trades/' + b.dataset.del); toast('Trade deleted'); await onRefresh(); }
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

function renderTagList(lastStats) {
  const tags = (lastStats?.bySetup || []).map(s => s.key);
  document.getElementById('tagList').innerHTML = tags.map(t => `<option value="${esc(t)}">`).join('');
}

/* ── form ─────────────────────────────────────────────────────── */
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

function resetForm() {
  ['fSymbol', 'fEntry', 'fExit', 'fQty', 'fRisk', 'fNotes'].forEach(id => f(id).value = '');
  f('fMood').value = 'neutral'; previewR();
  editingId = null;
  document.getElementById('saveBtn').textContent = 'Log trade';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

function wireForm(onRefresh) {
  ['fEntry', 'fExit', 'fQty', 'fRisk', 'fSide'].forEach(id => f(id).addEventListener('input', previewR));

  document.getElementById('cancelEditBtn').addEventListener('click', resetForm);

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const formErr = document.getElementById('formErr');
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
      await onRefresh();
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
}

function wireFilters(onApply) {
  f('ffSymbol').addEventListener('input',  e => { filters.symbol = e.target.value.trim(); onApply(); });
  f('ffMood').addEventListener('change',   e => { filters.mood   = e.target.value; onApply(); });
  f('ffSetup').addEventListener('input',   e => { filters.setup  = e.target.value.trim(); onApply(); });
  f('ffNotes').addEventListener('input',   e => { filters.notes  = e.target.value.trim(); onApply(); });
  f('ffFrom').addEventListener('change',   e => { filters.from   = e.target.value; onApply(); });
  f('ffTo').addEventListener('change',     e => { filters.to     = e.target.value; onApply(); });

  document.getElementById('clearFilters').addEventListener('click', async () => {
    Object.keys(filters).forEach(k => filters[k] = '');
    f('ffSymbol').value = ''; f('ffMood').value = ''; f('ffSetup').value = '';
    f('ffNotes').value = ''; f('ffFrom').value = ''; f('ffTo').value = '';
    await onApply();
  });
}

function wireLoadMore(onLoadMore) {
  document.getElementById('loadMoreBtn').addEventListener('click', async () => {
    const btn = document.getElementById('loadMoreBtn');
    btn.disabled = true; btn.textContent = 'Loading…';
    await onLoadMore();
    btn.disabled = false;
  });
}

function wireImport(onRefresh) {
  document.getElementById('importToggle').addEventListener('click', () => {
    const sec = document.getElementById('importSection');
    const btn = document.getElementById('importToggle');
    const open = sec.style.display !== 'none';
    sec.style.display = open ? 'none' : '';
    btn.textContent = open ? 'Show' : 'Hide';
  });

  document.getElementById('importBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('importFile');
    const result    = document.getElementById('importResult');
    if (!fileInput.files.length) {
      result.innerHTML = '<p style="color:var(--loss);font-size:13.5px">Choose a CSV file first.</p>';
      return;
    }
    const btn = document.getElementById('importBtn');
    btn.disabled = true; btn.textContent = 'Importing…';
    result.innerHTML = '';
    try {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      const res  = await fetch('/api/import/trades', { method: 'POST', credentials: 'same-origin', body: formData });
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
      await onRefresh();
    } catch (e) {
      result.innerHTML = `<p style="color:var(--loss);font-size:13.5px">${esc(e.message)}</p>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Import';
    }
  });
}
