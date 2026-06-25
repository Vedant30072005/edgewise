(async function init() {
  try {
    const { user } = await api.get('/api/auth/me');
    if (user.role !== 'admin') { window.location.href = '/app'; return; }
    document.getElementById('navUser').textContent = user.name + ' · ADMIN';
  } catch { window.location.href = '/login'; return; }
  await refresh();
})();
document.getElementById('logoutBtn').addEventListener('click', logout);

async function refresh() {
  const [stats, { users }] = await Promise.all([api.get('/api/admin/stats'), api.get('/api/admin/users')]);
  document.getElementById('sUsers').textContent = stats.users;
  document.getElementById('sActive').textContent = stats.activeUsers;
  document.getElementById('sTrades').textContent = stats.totalTrades;
  document.getElementById('sWeek').textContent = stats.tradesLast7Days;
  document.getElementById('refreshNote').textContent = 'UPDATED ' + new Date().toLocaleTimeString();

  document.getElementById('usersBody').innerHTML = users.map(u => `
    <tr>
      <td class="mono">${u.id}</td>
      <td><b>${esc(u.name)}</b></td>
      <td class="mono" style="font-size:13px">${esc(u.email)}</td>
      <td><span class="tag" style="${u.role === 'admin' ? 'border-color:var(--ultra);color:var(--ultra)' : ''}">${u.role}</span></td>
      <td><span class="tag" style="${u.plan === 'pro' ? 'border-color:var(--ultra);color:var(--ultra)' : 'color:var(--ink-faint)'}">${u.plan || 'free'}</span>${u.email_verified ? '' : ' <span style="font-size:10px;color:var(--ink-faint)" title="Email not verified">✉?</span>'}</td>
      <td><span class="tag ${u.is_active ? 'tag--mood-calm' : 'tag--mood-revenge'}">${u.is_active ? 'active' : 'deactivated'}</span></td>
      <td class="mono">${u.trade_count}</td>
      <td class="mono ${u.net_r >= 0 ? 'win' : 'loss'}">${u.trade_count ? fmtR(u.net_r) : '—'}</td>
      <td class="mono" style="font-size:12.5px;color:var(--ink-faint)">${u.last_trade_at ? esc(u.last_trade_at.slice(0, 10)) : '—'}</td>
      <td class="mono" style="font-size:12.5px;color:var(--ink-faint)">${esc(u.created_at.slice(0, 10))}</td>
      <td>${u.role === 'admin' ? '<span class="mono" style="font-size:11px;color:var(--ink-faint)">PROTECTED</span>' : `
        <div class="row-actions" style="flex-wrap:wrap;gap:6px">
          <button class="btn btn--sm ${u.is_active ? 'btn--ghost' : 'btn--ultra'}" data-toggle="${u.id}" data-next="${u.is_active ? 0 : 1}">
            ${u.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
          <button class="btn btn--sm ${u.plan === 'pro' ? 'btn--ghost' : 'btn--ultra'}" data-plan="${u.id}" data-next="${u.plan === 'pro' ? 'free' : 'pro'}">
            ${u.plan === 'pro' ? 'Set Free' : 'Set Pro'}
          </button>
          <button class="btn btn--sm btn--danger" data-del="${u.id}" data-email="${esc(u.email)}">Delete</button>
        </div>`}
      </td>
    </tr>`).join('');

  document.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api.patch(`/api/admin/users/${b.dataset.plan}/plan`, { plan: b.dataset.next });
      toast(`Plan set to ${b.dataset.next}`);
      await refresh();
    } catch (e) { toast(e.message, true); }
  }));
  document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api.patch(`/api/admin/users/${b.dataset.toggle}/active`, { is_active: b.dataset.next === '1' });
      toast(b.dataset.next === '1' ? 'Account reactivated' : 'Account deactivated');
      await refresh();
    } catch (e) { toast(e.message, true); }
  }));
  document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Delete ${b.dataset.email} and their entire journal? This cannot be undone.`)) return;
    try { await api.del('/api/admin/users/' + b.dataset.del); toast('Account deleted'); await refresh(); }
    catch (e) { toast(e.message, true); }
  }));
}
