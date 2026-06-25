/**
 * Edgewise — UI utilities module.
 * Handles: toast, dark mode, mobile nav, escape helper, formatters.
 * These are pure UI helpers with no business logic.
 */

/* ── formatters ───────────────────────────────────────────────── */
export const fmtR = (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(2) + 'R';
export const esc  = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── toast ────────────────────────────────────────────────────── */
let toastTimer;
export function toast(msg, isErr = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('toast--err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ── dark mode ────────────────────────────────────────────────── */
export function initDarkMode() {
  const stored = localStorage.getItem('edgewise-dark-mode');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const shouldBeDark = stored === 'true' || (stored === null && prefersDark);
  if (shouldBeDark) {
    document.documentElement.setAttribute('data-dark-mode', '');
  } else {
    document.documentElement.setAttribute('data-light-mode', '');
  }

  document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.documentElement.hasAttribute('data-dark-mode');
    if (isDark) {
      document.documentElement.removeAttribute('data-dark-mode');
      document.documentElement.setAttribute('data-light-mode', '');
      localStorage.setItem('edgewise-dark-mode', 'false');
    } else {
      document.documentElement.removeAttribute('data-light-mode');
      document.documentElement.setAttribute('data-dark-mode', '');
      localStorage.setItem('edgewise-dark-mode', 'true');
    }
  });
}

/* ── mobile nav ───────────────────────────────────────────────── */
export function initMobileNav() {
  const menuToggle = document.getElementById('menuToggle');
  const navRight   = document.getElementById('navRight');
  menuToggle.addEventListener('click', () => {
    const isActive = menuToggle.classList.toggle('active');
    navRight.classList.toggle('active');
    menuToggle.setAttribute('aria-expanded', isActive);
  });
  navRight.querySelectorAll('a, button').forEach(el => {
    if (el.id !== 'themeToggle') {
      el.addEventListener('click', () => {
        menuToggle.classList.remove('active');
        navRight.classList.remove('active');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    }
  });
}
