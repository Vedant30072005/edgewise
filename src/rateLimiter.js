/**
 * Pluggable rate limiter.
 * Current backend: in-memory (single process).
 * To scale to multi-instance SaaS: swap MemoryStore for a Redis store
 * that implements the same hit(key) interface.
 */
class MemoryStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.store = new Map();
  }

  hit(key) {
    const now = Date.now();
    // Prune expired entries on every hit to prevent unbounded Map growth
    // in long-running processes. O(n) but n is bounded by unique IPs in one window.
    for (const [k, v] of this.store) {
      if (now - v.start > this.windowMs) this.store.delete(k);
    }
    const rec = this.store.get(key) || { count: 0, start: now };
    if (now - rec.start > this.windowMs) { rec.count = 0; rec.start = now; }
    rec.count += 1;
    this.store.set(key, rec);
    return rec.count;
  }
}

/**
 * Returns Express middleware that rate-limits by IP.
 * @param {{ windowMs: number, max: number, message?: string }} opts
 */
function createMiddleware({ windowMs, max, message = 'Too many attempts. Try again later.' }) {
  const store = new MemoryStore(windowMs);
  return (req, res, next) => {
    const count = store.hit(req.ip || 'unknown');
    if (count > max) return res.status(429).json({ error: message });
    next();
  };
}

module.exports = { createMiddleware };
