/**
 * Edgewise — API client module.
 * Thin fetch wrapper; re-exports the same interface as shared.js `api`
 * so other modules can import it directly without globals.
 */
export const api = {
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
  get:   (p)       => api.req(p),
  post:  (p, body) => api.req(p, { method: 'POST',  body }),
  put:   (p, body) => api.req(p, { method: 'PUT',   body }),
  patch: (p, body) => api.req(p, { method: 'PATCH', body }),
  del:   (p)       => api.req(p, { method: 'DELETE' }),
};

export async function logout() {
  try { await api.post('/api/auth/logout'); } finally { window.location.href = '/'; }
}
