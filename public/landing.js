/* ============================================================
   EQUITY LAB — interactive signature element
   One fixed noise sequence; the discipline slider changes drift
   and volatility so the curve morphs continuously (deterministic).
   ============================================================ */
(function(){
  const canvas = document.getElementById('equityCanvas');
  const ctx = canvas.getContext('2d');
  const slider = document.getElementById('discipline');
  const out = document.getElementById('disciplineOut');
  const verdict = document.getElementById('verdict');
  const statPnl = document.getElementById('statPnl');
  const statDd = document.getElementById('statDd');
  const statExp = document.getElementById('statExp');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const N = 240;
  // Deterministic noise (mulberry32)
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  const rng = mulberry32(20260610);
  const noise = Array.from({length:N}, () => (rng()*2-1) + (rng()*2-1)); // softer tails
  const nMean = noise.reduce((a,b)=>a+b,0)/N;
  for(let i=0;i<N;i++) noise[i] -= nMean; // zero-mean so the slider owns the trend

  let drawProgress = reduceMotion ? 1 : 0;

  function series(d){ // d in [0,1]
    const drift = -0.10 + d*0.27;          // bleeds when undisciplined, compounds when not
    const vol   = 2.4 - d*1.7;             // calmer curve with discipline
    const pts = [0];
    for(let i=0;i<N;i++){
      // occasional "tilt cluster" when discipline is low
      const tilt = (d < 0.45 && i%53 < 5) ? -vol*0.9*(0.45-d) : 0;
      pts.push(pts[i] + drift + noise[i]*vol + tilt);
    }
    return pts;
  }

  function stats(pts){
    const pnl = pts[pts.length-1];
    let peak = -Infinity, maxDd = 0;
    for(const v of pts){ peak = Math.max(peak, v); maxDd = Math.max(maxDd, peak - v); }
    return { pnl, maxDd, exp: pnl/N };
  }

  function resize(){
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const r = canvas.parentElement.getBoundingClientRect();
    canvas.width = r.width*dpr; canvas.height = r.height*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw();
  }

  function draw(){
    const d = slider.value/100;
    const pts = series(d);
    const s = stats(pts);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const padX = 18, padT = 34, padB = 30;
    const min = Math.min(...pts), max = Math.max(...pts);
    const span = (max-min)||1;
    const X = i => padX + (i/N)*(w-2*padX);
    const Y = v => padT + (1-(v-min)/span)*(h-padT-padB);

    ctx.clearRect(0,0,w,h);

    // grid
    ctx.strokeStyle = 'rgba(16,16,25,.07)'; ctx.lineWidth = 1;
    for(let g=1; g<6; g++){
      const gy = padT + g*(h-padT-padB)/6;
      ctx.beginPath(); ctx.moveTo(padX,gy); ctx.lineTo(w-padX,gy); ctx.stroke();
    }
    // zero line
    if(min<0 && max>0){
      ctx.strokeStyle = 'rgba(16,16,25,.3)'; ctx.setLineDash([4,5]);
      ctx.beginPath(); ctx.moveTo(padX,Y(0)); ctx.lineTo(w-padX,Y(0)); ctx.stroke();
      ctx.setLineDash([]);
    }

    const upto = Math.max(2, Math.floor(N*drawProgress));

    // drawdown shading (below running peak)
    let peak = pts[0];
    ctx.fillStyle = 'rgba(206,43,29,.10)';
    ctx.beginPath();
    let started = false;
    for(let i=0;i<=upto;i++){
      peak = Math.max(peak, pts[i]);
      if(pts[i] < peak - 0.001){
        if(!started){ ctx.moveTo(X(i),Y(peak)); started = true; }
        ctx.lineTo(X(i),Y(pts[i]));
      } else if(started){
        ctx.lineTo(X(i),Y(peak)); ctx.closePath(); ctx.fill();
        ctx.beginPath(); started = false;
      }
    }
    if(started){ ctx.lineTo(X(upto),Y(peak)); ctx.closePath(); ctx.fill(); }

    // area under curve, faint ultramarine
    const grad = ctx.createLinearGradient(0,padT,0,h-padB);
    grad.addColorStop(0,'rgba(35,35,230,.12)');
    grad.addColorStop(1,'rgba(35,35,230,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(X(0), h-padB);
    for(let i=0;i<=upto;i++) ctx.lineTo(X(i),Y(pts[i]));
    ctx.lineTo(X(upto), h-padB); ctx.closePath(); ctx.fill();

    // equity line
    ctx.strokeStyle = '#2323E6'; ctx.lineWidth = 2.4; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath();
    for(let i=0;i<=upto;i++){ i===0 ? ctx.moveTo(X(i),Y(pts[i])) : ctx.lineTo(X(i),Y(pts[i])); }
    ctx.stroke();

    // endpoint dot + label
    const ex = X(upto), ey = Y(pts[upto]);
    ctx.fillStyle = '#2323E6';
    ctx.beginPath(); ctx.arc(ex,ey,4.5,0,Math.PI*2); ctx.fill();
    ctx.font = '600 12px "Spline Sans Mono", monospace';
    const lbl = (pts[upto]>=0?'+':'') + pts[upto].toFixed(1) + 'R';
    ctx.fillStyle = pts[upto]>=0 ? '#0B7C55' : '#CE2B1D';
    ctx.fillText(lbl, Math.min(ex+10, w-58), ey-8);

    // stats
    statPnl.textContent = (s.pnl>=0?'+':'') + s.pnl.toFixed(1) + 'R';
    statPnl.className = s.pnl>=0 ? 'win' : 'loss';
    statDd.textContent = '-' + Math.min(99, s.maxDd*0.9).toFixed(1) + '%';
    statExp.textContent = (s.exp>=0?'+':'') + s.exp.toFixed(2) + 'R';
    statExp.className = s.exp>=0 ? 'win' : 'loss';
  }

  function verdictFor(v){
    if(v < 20) return '<b>Untracked.</b> Negative drift, deep drawdowns. This is most traders’ reality — and they can’t see it, because there’s no record.';
    if(v < 50) return '<b>Occasional notes.</b> Better, but the tilt clusters are still there. A journal you only open after wins isn’t a journal.';
    if(v < 80) return '<b>Consistent log.</b> Drawdowns shrink because rule breaks get caught the same week they appear, not the same quarter.';
    return '<b>Full loop.</b> Log, tag, review, adjust. The curve isn’t luck — it’s the compounding of small corrections.';
  }

  function update(){
    out.textContent = slider.value + '%';
    verdict.innerHTML = verdictFor(+slider.value);
    draw();
  }

  slider.addEventListener('input', update);
  window.addEventListener('resize', resize);

  // intro draw animation
  function intro(ts0){
    const dur = 1600;
    function step(ts){
      drawProgress = Math.min(1, (ts-ts0)/dur);
      // ease out
      const e = 1-Math.pow(1-drawProgress,3);
      drawProgress = e;
      draw();
      if(e < 1) requestAnimationFrame(step); else { drawProgress = 1; draw(); }
    }
    requestAnimationFrame(step);
  }

  resize();
  update();
  if(!reduceMotion){
    const io = new IntersectionObserver((es)=>{
      if(es[0].isIntersecting){ requestAnimationFrame(t=>intro(t)); io.disconnect(); }
    },{threshold:.3});
    io.observe(canvas);
  }
})();

/* ---------- ticker: duplicate track for seamless loop ---------- */
(function(){
  const t = document.getElementById('tickerTrack');
  t.innerHTML += t.innerHTML;
})();

/* ---------- scroll reveal ---------- */
(function(){
  const els = document.querySelectorAll('.reveal');
  if(!('IntersectionObserver' in window)){ els.forEach(e=>e.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(en=>{ if(en.isIntersecting){ en.target.classList.add('is-in'); io.unobserve(en.target); } });
  },{threshold:.12, rootMargin:'0px 0px -6% 0px'});
  els.forEach(e=>io.observe(e));
})();
