// Force-directed relationship graph on a canvas. No libraries.
(function () {
  const host = document.getElementById('graph');
  if (!host) return;

  const data = JSON.parse(host.dataset.graph);
  const CATEGORY_COLOUR = {
    chamber: '#7b2d26', professional: '#9a7b31', firm: '#2f6b47',
    education: '#3c5a8a', court: '#6b4a7a', family: '#b06a3a',
  };

  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const INK = dark ? '#ece7df' : '#1c1a17';
  const MUTED = dark ? '#857e74' : '#8a8279';

  let W = 0, H = 0, dpr = devicePixelRatio || 1;
  function resize() {
    W = host.clientWidth; H = host.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- model ----------------------------------------------------------------
  const nodes = data.nodes.map((n, i) => ({
    ...n,
    x: 0, y: 0, vx: 0, vy: 0,
    r: n.slug === data.root ? 13 : n.is_senior_advocate ? 10 : n.is_aor ? 8.5 : 7,
    i,
  }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const links = data.edges
    .map(e => ({ ...e, s: byId.get(e.source), t: byId.get(e.target) }))
    .filter(l => l.s && l.t);

  // Seed positions in concentric rings by graph distance so the layout settles fast.
  const maxDepth = Math.max(1, ...nodes.map(n => n.depth));
  const perRing = {};
  nodes.forEach(n => { perRing[n.depth] = (perRing[n.depth] || 0) + 1; });
  const seen = {};
  nodes.forEach(n => {
    seen[n.depth] = (seen[n.depth] || 0);
    const a = (seen[n.depth]++ / perRing[n.depth]) * Math.PI * 2;
    const rad = n.depth === 0 ? 0 : 90 + (n.depth / maxDepth) * 150;
    n.x = Math.cos(a) * rad; n.y = Math.sin(a) * rad;
  });

  let view = { x: 0, y: 0, k: 1 };
  let alpha = 1;

  function step() {
    // repulsion
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const p = nodes[a], q = nodes[b];
        let dx = q.x - p.x, dy = q.y - p.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const force = 5200 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force, fy = (dy / d) * force;
        p.vx -= fx; p.vy -= fy; q.vx += fx; q.vy += fy;
      }
    }
    // springs — stronger ties sit closer
    for (const l of links) {
      const target = 120 - (l.strength || 3) * 9;
      let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - target) * 0.02;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
    }
    // gravity + integrate
    for (const n of nodes) {
      if (n === dragging) continue;
      n.vx += -n.x * 0.006; n.vy += -n.y * 0.006;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx * alpha; n.y += n.vy * alpha;
    }
    alpha = Math.max(0.05, alpha * 0.995);
  }

  function toScreen(n) {
    return { x: n.x * view.k + view.x + W / 2, y: n.y * view.k + view.y + H / 2 };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (const l of links) {
      const a = toScreen(l.s), b = toScreen(l.t);
      ctx.strokeStyle = CATEGORY_COLOUR[l.category] || MUTED;
      ctx.globalAlpha = hovered && !(hovered === l.s || hovered === l.t) ? 0.12 : 0.55;
      ctx.lineWidth = Math.max(1, (l.strength || 3) * 0.45) * view.k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const n of nodes) {
      const p = toScreen(n);
      const r = n.r * view.k;
      const dim = hovered && hovered !== n && !links.some(l =>
        (l.s === hovered && l.t === n) || (l.t === hovered && l.s === n));

      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.slug === data.root ? '#7b2d26'
        : n.is_senior_advocate ? '#9a7b31'
        : n.is_aor ? '#3c5a8a' : (dark ? '#4a453e' : '#c9c2b7');
      ctx.fill();
      ctx.strokeStyle = dark ? '#1f1e1b' : '#fff';
      ctx.lineWidth = 1.5; ctx.stroke();

      if (view.k > 0.55 || n.slug === data.root || n === hovered) {
        ctx.fillStyle = n === hovered ? INK : MUTED;
        ctx.font = `${n === hovered || n.slug === data.root ? '600 ' : ''}${Math.max(10, 11 * view.k)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(n.full_name, p.x, p.y + r + 12);
      }
    }
    ctx.globalAlpha = 1;

    if (hovered) {
      const lines = [
        [hovered.honorific, hovered.full_name].filter(Boolean).join(' '),
        hovered.headline || '',
        hovered.base_city || '',
      ].filter(Boolean);
      const p = toScreen(hovered);
      ctx.font = '12px system-ui, sans-serif';
      const w = Math.max(...lines.map(t => ctx.measureText(t).width)) + 18;
      const h = lines.length * 16 + 12;
      const bx = Math.min(Math.max(p.x + 14, 6), W - w - 6);
      const by = Math.min(Math.max(p.y - h - 10, 6), H - h - 6);
      ctx.fillStyle = dark ? 'rgba(31,30,27,0.96)' : 'rgba(255,255,255,0.97)';
      ctx.strokeStyle = dark ? '#33302b' : '#e5e0d8';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left';
      lines.forEach((t, i) => {
        ctx.fillStyle = i === 0 ? INK : MUTED;
        ctx.font = i === 0 ? '600 12px system-ui, sans-serif' : '11px system-ui, sans-serif';
        ctx.fillText(t, bx + 9, by + 20 + i * 16);
      });
    }
  }

  // --- interaction ----------------------------------------------------------
  let hovered = null, dragging = null, panning = null;

  function pick(mx, my) {
    let best = null, bestD = 18;
    for (const n of nodes) {
      const p = toScreen(n);
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < Math.max(bestD, n.r * view.k + 6)) { best = n; bestD = d; }
    }
    return best;
  }

  const rel = e => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  canvas.addEventListener('mousemove', e => {
    const [mx, my] = rel(e);
    if (dragging) {
      dragging.x = (mx - W / 2 - view.x) / view.k;
      dragging.y = (my - H / 2 - view.y) / view.k;
      dragging.vx = dragging.vy = 0; alpha = Math.max(alpha, 0.5);
    } else if (panning) {
      view.x += mx - panning[0]; view.y += my - panning[1]; panning = [mx, my];
    } else {
      const h = pick(mx, my);
      if (h !== hovered) { hovered = h; canvas.style.cursor = h ? 'pointer' : 'grab'; }
    }
  });

  canvas.addEventListener('mousedown', e => {
    const [mx, my] = rel(e);
    const n = pick(mx, my);
    if (n) dragging = n; else panning = [mx, my];
  });

  addEventListener('mouseup', () => { dragging = null; panning = null; });

  canvas.addEventListener('click', e => {
    const n = pick(...rel(e));
    if (n) location.href = '/lawyer/' + n.slug;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    view.k = k;
  }, { passive: false });

  addEventListener('resize', resize);
  resize();

  (function loop() { step(); draw(); requestAnimationFrame(loop); })();
})();
