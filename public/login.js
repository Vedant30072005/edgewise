const err = document.getElementById('err');
const btn = document.getElementById('submit');

const urlMsg = new URLSearchParams(location.search).get('msg');
if (urlMsg === 'invalid-token' || urlMsg === 'expired-token') {
  err.textContent = 'That verification link has expired. Sign in and request a new one.';
  err.classList.add('show');
}

async function submit() {
  err.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const { user } = await api.post('/api/auth/login', {
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    });
    window.location.href = user.role === 'admin' ? '/admin' : '/app';
  } catch (e) {
    err.textContent = e.message; err.classList.add('show');
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}
btn.addEventListener('click', submit);
document.querySelectorAll('input').forEach(i =>
  i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
