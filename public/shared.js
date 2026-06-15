/* Edgewise — tiny shared client helpers */
const api = {
  async req(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON (e.g. CSV) */ }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  },
  get: (p) => api.req(p),
  post: (p, body) => api.req(p, { method: 'POST', body }),
  put: (p, body) => api.req(p, { method: 'PUT', body }),
  patch: (p, body) => api.req(p, { method: 'PATCH', body }),
  del: (p) => api.req(p, { method: 'DELETE' }),
};

let toastTimer;
function toast(msg, isErr = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('toast--err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function logout() {
  try { await api.post('/api/auth/logout'); } finally { window.location.href = '/'; }
}

const fmtR = (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(2) + 'R';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
