const err = document.getElementById('err');
const ok  = document.getElementById('ok');
const btn = document.getElementById('submit');

async function submit() {
  err.classList.remove('show'); ok.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await api.post('/api/auth/forgot-password', { email: document.getElementById('email').value.trim() });
    ok.textContent = 'If that email is registered, a reset link is on its way.';
    ok.classList.add('show');
    btn.textContent = 'Link sent';
  } catch (e) {
    err.textContent = e.message; err.classList.add('show');
    btn.disabled = false; btn.textContent = 'Send reset link';
  }
}
btn.addEventListener('click', submit);
document.getElementById('email').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
