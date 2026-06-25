/* Edgewise — UI helpers (plain script, no ES module syntax) */

function initDarkMode() {
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

function initMobileNav() {
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
