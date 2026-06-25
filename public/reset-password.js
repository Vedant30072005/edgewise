const token = new URLSearchParams(location.search).get('token');
if (!token) {
  document.getElementById('formCard').style.display = 'none';
  document.getElementById('expiredCard').style.display = '';
}

const err = document.getElementById('err');
const btn = document.getElementById('submit');

async function submit() {
  err.classList.remove('show');
  const password = document.getElementById('password').value;
  const confirm  = document.getElementById('confirm').value;
  if (password !== confirm) {
    err.textContent = 'Passwords do not match.'; err.classList.add('show'); return;
  }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api.post('/api/auth/reset-password', { token, password });
    toast('Password updated — sign in with your new password.');
    setTimeout(() => { window.location.href = '/login'; }, 1500);
  } catch (e) {
    if (e.message.includes('expired') || e.message.includes('used')) {
      document.getElementById('formCard').style.display = 'none';
      document.getElementById('expiredCard').style.display = '';
    } else {
      err.textContent = e.message; err.classList.add('show');
      btn.disabled = false; btn.textContent = 'Set new password';
    }
  }
}
btn?.addEventListener('click', submit);
document.querySelectorAll('input').forEach(i =>
  i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
