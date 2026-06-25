/**
 * Edgewise — charts module.
 * Handles: equity curve canvas, monthly performance bars, resize listener.
 */

export function renderCurve(curve, lastStats) {
  const empty = curve.length < 2;
  document.getElementById('curveEmpty').style.display = empty ? '' : 'none';
  document.querySelector('.curve-wrap').style.display = empty ? 'none' : '';
  document.getElementById('curveNote').textContent = empty ? '' : (curve.length - 1) + ' trades · drawdown shaded';
  if (empty) return;
  drawCurve(document.getElementById('curve'), curve);
}

export function drawCurve(canvas, curve) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, padX = 10, padT = 16, padB = 14;
  const N = curve.length - 1;
  const min = Math.min(...curve), max = Math.max(...curve), span = (max - min) || 1;
  const X = i => padX + (i / N) * (w - 2 * padX);
  const Y = v => padT + (1 - (v - min) / span) * (h - padT - padB);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(16,16,25,.07)';
  for (let g = 1; g < 5; g++) {
    const gy = padT + g * (h - padT - padB) / 5;
    ctx.beginPath(); ctx.moveTo(padX, gy); ctx.lineTo(w - padX, gy); ctx.stroke();
  }
  if (min < 0 && max > 0) {
    ctx.strokeStyle = 'rgba(16,16,25,.3)'; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(padX, Y(0)); ctx.lineTo(w - padX, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  }
  let peak = curve[0]; ctx.fillStyle = 'rgba(206,43,29,.10)'; ctx.beginPath(); let started = false;
  for (let i = 0; i <= N; i++) {
    peak = Math.max(peak, curve[i]);
    if (curve[i] < peak - 1e-9) {
      if (!started) { ctx.moveTo(X(Math.max(0, i - 1)), Y(peak)); started = true; }
      ctx.lineTo(X(i), Y(curve[i]));
    } else if (started) {
      ctx.lineTo(X(i), Y(peak)); ctx.closePath(); ctx.fill(); ctx.beginPath(); started = false;
    }
  }
  if (started) { ctx.lineTo(X(N), Y(peak)); ctx.closePath(); ctx.fill(); }
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, 'rgba(35,35,230,.12)'); grad.addColorStop(1, 'rgba(35,35,230,0)');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(X(0), h - padB);
  for (let i = 0; i <= N; i++) ctx.lineTo(X(i), Y(curve[i]));
  ctx.lineTo(X(N), h - padB); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#2323E6'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= N; i++) i ? ctx.lineTo(X(i), Y(curve[i])) : ctx.moveTo(X(i), Y(curve[i]));
  ctx.stroke();
  ctx.fillStyle = '#2323E6'; ctx.beginPath(); ctx.arc(X(N), Y(curve[N]), 4, 0, Math.PI * 2); ctx.fill();
}

export function renderMonthlyBars(byMonth) {
  const panel = document.getElementById('monthlyPanel');
  if (!byMonth || byMonth.length < 2) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const show = byMonth.slice(-12);
  document.getElementById('monthlyNote').textContent = show.length + ' MONTHS';

  const canvas = document.getElementById('monthlyCanvas');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width, h = rect.height;
  const padL = 8, padR = 8, padT = 28, padB = 36;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const barW = Math.max(4, (innerW / show.length) * 0.65);
  const gap = innerW / show.length;

  const vals = show.map(m => m.totalR);
  const maxVal = Math.max(...vals.map(Math.abs), 0.5);
  const zeroY = padT + innerH * (maxVal / (2 * maxVal));

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(16,16,25,.25)'; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(w - padR, zeroY); ctx.stroke();
  ctx.setLineDash([]);

  show.forEach((m, i) => {
    const x = padL + i * gap + (gap - barW) / 2;
    const barH = Math.abs(m.totalR) / maxVal * (innerH / 2);
    const isPos = m.totalR >= 0;
    const barY = isPos ? zeroY - barH : zeroY;

    ctx.fillStyle = isPos ? 'rgba(11,124,85,.8)' : 'rgba(206,43,29,.8)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, barY, barW, Math.max(barH, 1), 2) : ctx.rect(x, barY, barW, Math.max(barH, 1));
    ctx.fill();

    ctx.fillStyle = isPos ? 'var(--win, #0B7C55)' : 'var(--loss, #CE2B1D)';
    ctx.font = `bold ${Math.min(11, Math.max(9, barW * 0.5))}px monospace`;
    ctx.textAlign = 'center';
    const labelY = isPos ? barY - 4 : barY + barH + 11;
    if (barH > 4) ctx.fillText((isPos ? '+' : '') + m.totalR.toFixed(1), x + barW / 2, labelY);

    const [yr, mo] = m.month.split('-');
    const moName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo) - 1];
    ctx.fillStyle = 'rgba(16,16,25,.45)';
    ctx.font = `${Math.min(10, Math.max(8, gap * 0.35))}px monospace`;
    ctx.fillText(moName, x + barW / 2, h - padB + 14);
    if (show.length <= 6) ctx.fillText(yr, x + barW / 2, h - padB + 25);
  });
}
