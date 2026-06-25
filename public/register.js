const err = document.getElementById('err');
const btn = document.getElementById('submit');

async function submit() {
  err.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await api.post('/api/auth/register', {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    });
    window.location.href = '/app';
  } catch (e) {
    err.textContent = e.message; err.classList.add('show');
    btn.disabled = false; btn.textContent = 'Create account';
  }
}
btn.addEventListener('click', submit);
document.querySelectorAll('input').forEach(i =>
  i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
