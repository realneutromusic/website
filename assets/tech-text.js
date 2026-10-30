/* Tech Text on the hero's NEUTRO: the letter under the cursor turns into a dashed outline inside a selection frame
   (size label, specks running round it); letters can be dragged and spring back, a click bounces them in a wave, and
   with the cursor away a lens sweeps the word by itself.

   Port to plain JavaScript of «TechText» from React Bits (https://reactbits.dev/text-animations/tech-text).
   Copyright (c) 2026 David Haz — MIT + Commons Clause License Condition v1.0
   (https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md). Permission is hereby granted, free of charge, to use,
   copy, modify, merge, publish and distribute the Software as part of an application, website or product, including for
   commercial purposes, as long as the components themselves are not sold, sublicensed or redistributed. The above
   copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

   Changes from the original: it draws over the real <h1> (the HTML text stays for search engines, screen readers and
   layout, only made transparent), each letter at the position, colour and shadow the page gives it; reveal "letter"
   only (no intro, guides or area lens); settings fixed to the component's defaults. */
(() => {
  const h1 = document.querySelector('.hero h1');
  if (!h1 || !window.CanvasRenderingContext2D || !('ResizeObserver' in window)) return;
  const S = { reach: 200, dashLength: 4, dashGap: 2, strokeWidth: 1.5, specks: 15, selection: true, labels: true,
    draggable: true, bounce: 0.4, sweep: true, speed: 1, clickKick: true };
  const LABEL_FONT = "500 10px 'JetBrains Mono', ui-monospace, monospace";
  const SPRING = 320, KICK_DECAY = 0.62;
  const SHADOW = { color: 'rgba(4,7,13,0.6)', blur: 40, y: 4 }; // = the h1's text-shadow
  const approach = (current, target, dt, seconds) => current + (target - current) * (1 - Math.exp(-dt / seconds));
  const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0));
  const noise = (...values) => {
    let h = 2166136261;
    for (const value of values) {
      h = Math.imul(h ^ (value | 0), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    }
    return (h >>> 0) / 4294967296;
  };
  const signed = v => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

  const canvas = document.createElement('canvas');
  canvas.className = 'tech-text-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 1, height = 1, dpr = 1, pad = 80, raf = 0, last = performance.now(), visible = false, ready = false;
  let word = null, glyphs = [], clock = 0, pulse = 0, placed = false, dragging = -1, cursor = '';
  const kicks = [];
  const press = { x: 0, y: 0, time: 0, index: -1 };
  const pointer = { x: 0, y: 0, inside: false };
  const grab = { x: 0, y: 0 };
  const lens = { x: 0, y: 0 };
  const frame = { x1: 0, y1: 0, x2: 0, y2: 0, alpha: 0, index: -1 };

  /** A letter drawn once at full resolution: filled, as a dashed outline, or only its shadow (like text-shadow, every
   *  letter's shadow goes under all the letters, so they are drawn in a pass of their own). */
  const sprite = (glyph, font, stroke, shadow = false) => {
    const extra = shadow ? SHADOW.blur + 8 : Math.ceil(S.strokeWidth * 2 + 4);
    // on whole device pixels, so the letter inside keeps its sub-pixel position when blitted (like the HTML text)
    const left = Math.floor((glyph.box.x1 - extra) * dpr) / dpr, top = Math.floor((glyph.box.y1 - extra) * dpr) / dpr;
    const w = glyph.box.x2 - glyph.box.x1 + extra * 2, h = glyph.box.y2 - glyph.box.y1 + extra * 2 + (shadow ? SHADOW.y : 0);
    const image = document.createElement('canvas');
    image.width = Math.max(1, Math.ceil(w * dpr)); image.height = Math.max(1, Math.ceil(h * dpr));
    const c = image.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, -left * dpr, -top * dpr);
    c.font = font; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    if (stroke) {
      c.lineJoin = 'round'; c.lineWidth = S.strokeWidth * 2; c.lineCap = 'butt'; c.strokeStyle = glyph.color;
      c.setLineDash([Math.max(1, S.dashLength), Math.max(1, S.dashGap)]);
      c.strokeText(glyph.char, glyph.x, word.baseline);
      c.setLineDash([]);
      c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
      c.fillText(glyph.char, glyph.x, word.baseline);
    } else if (shadow) {
      c.shadowColor = SHADOW.color; c.shadowBlur = SHADOW.blur * dpr; c.shadowOffsetY = SHADOW.y * dpr;
      c.fillStyle = '#000';
      c.fillText(glyph.char, glyph.x, word.baseline);
      c.shadowColor = 'transparent';
      c.globalCompositeOperation = 'destination-out';
      c.fillText(glyph.char, glyph.x, word.baseline); // only the shadow stays
    } else {
      c.fillStyle = glyph.color;
      c.fillText(glyph.char, glyph.x, word.baseline);
    }
    return { image, left, top };
  };

  /** Letters where the browser laid them out: x of each character and the baseline, relative to the canvas. */
  const layout = () => {
    h1.classList.remove('tech-text-on'); // read the real colours
    const cs = getComputedStyle(h1);
    const size = parseFloat(cs.fontSize);
    pad = Math.round(Math.max(60, size * 0.9));
    const font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    const box = h1.getBoundingClientRect();
    width = Math.max(1, h1.clientWidth); height = Math.max(1, h1.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.left = canvas.style.top = `${-pad}px`;
    canvas.style.width = `${width + pad * 2}px`; canvas.style.height = `${height + pad * 2}px`;
    canvas.width = Math.round((width + pad * 2) * dpr); canvas.height = Math.round((height + pad * 2) * dpr);
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    h1.appendChild(probe);
    const baseline = probe.getBoundingClientRect().bottom - box.top + pad;
    probe.remove();
    ctx.font = font;
    const previous = glyphs;
    glyphs = [];
    const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const color = getComputedStyle(node.parentElement).color;
      for (let i = 0; i < node.data.length; i++) {
        const char = node.data[i];
        if (!char.trim()) continue;
        range.setStart(node, i); range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        const x = r.left - box.left + pad, own = ctx.measureText(char);
        const kept = previous[glyphs.length];
        glyphs.push({ char, color, x, index: glyphs.length, run: node,
          box: { x1: x - own.actualBoundingBoxLeft, y1: baseline - own.actualBoundingBoxAscent, x2: x + own.actualBoundingBoxRight, y2: baseline + own.actualBoundingBoxDescent },
          offset: kept?.char === char ? kept.offset : { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, outline: 0 });
      }
    }
    if (!glyphs.length) return false;
    word = { size, baseline,
      left: Math.min(...glyphs.map(g => g.box.x1)), right: Math.max(...glyphs.map(g => g.box.x2)),
      top: Math.min(...glyphs.map(g => g.box.y1)), bottom: Math.max(...glyphs.map(g => g.box.y2)) };
    for (const g of glyphs) { g.shadow = sprite(g, font, false, true); g.fill = sprite(g, font, false); g.dashes = sprite(g, font, true); }
    dragging = -1; frame.index = -1;
    h1.classList.add('tech-text-on');
    return true;
  };

  const glyphAt = (x, y) => {
    if (!word || y < word.top - 24 || y > word.bottom + 24) return -1;
    let best = -1, bestDistance = Infinity;
    glyphs.forEach((glyph, i) => {
      const x1 = glyph.box.x1 + glyph.offset.x, x2 = glyph.box.x2 + glyph.offset.x;
      const d = x < x1 ? x1 - x : x > x2 ? x - x2 : 0;
      if (d < bestDistance) { bestDistance = d; best = i; }
    });
    return bestDistance < 28 ? best : -1;
  };
  const blit = (art, dx, dy) => ctx.drawImage(art.image, Math.round((art.left + dx) * dpr), Math.round((art.top + dy) * dpr));
  const crisp = v => (Math.round(v * dpr) + 0.5) / dpr;
  const perimeterPoint = (distance, w, h) => {
    let d = ((distance % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
    if (d < w) return [frame.x1 + d, frame.y1, 0, -1];
    d -= w;
    if (d < h) return [frame.x2, frame.y1 + d, 1, 0];
    d -= h;
    if (d < w) return [frame.x2 - d, frame.y2, 0, 1];
    d -= w;
    return [frame.x1, frame.y2 - d, -1, 0];
  };

  const drawSpecks = (a, accent) => {
    const w = frame.x2 - frame.x1, h = frame.y2 - frame.y1;
    if (w < 2 || h < 2) return;
    const perimeter = 2 * (w + h), seed = frame.index + 1, grid = 3;
    ctx.fillStyle = accent; ctx.strokeStyle = accent;
    for (let k = 0; k < S.specks; k++) {
      const period = 0.5 + noise(seed, k, 11) * 1.2;
      const t = pulse / period + noise(seed, k, 17), cycle = Math.floor(t), life = t - cycle;
      if (life > 0.7) continue;
      const [px, py, nx, ny] = perimeterPoint(noise(seed, k, cycle) * perimeter, w, h);
      const pick = noise(seed, k, cycle, 2);
      const size = pick < 0.46 ? 2 : pick < 0.7 ? 3 : pick < 0.84 ? 5 : pick < 0.94 ? 8 : 11;
      const large = size >= 8;
      const out = (large ? 9 : 4) + Math.floor(noise(seed, k, cycle, 1) * 5) * grid;
      const x = frame.x1 + Math.round((px + nx * out - frame.x1) / grid) * grid;
      const y = frame.y1 + Math.round((py + ny * out - frame.y1) / grid) * grid;
      const tone = noise(seed, k, cycle, 3);
      const blink = life < 0.06 || (life > 0.32 && life < 0.36) ? 0.35 : 1;
      ctx.globalAlpha = a * (large ? 0.3 + 0.4 * tone : 0.3 + 0.6 * tone) * blink;
      const left = Math.round(x - size / 2), top = Math.round(y - size / 2);
      if (tone < 0.26 || (large && tone < 0.78)) {
        ctx.strokeRect(left + 0.5, top + 0.5, size, size);
        if (large && tone > 0.5) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
      } else ctx.fillRect(left, top, size, size);
    }
    for (let j = 0; j < 2; j++) {
      const head = (pulse * 0.42 * S.speed + j * 0.5) * perimeter;
      for (let i = 0; i < 4; i++) {
        const [x, y] = perimeterPoint(head - i * 6, w, h), size = i === 0 ? 3 : 2;
        ctx.globalAlpha = a * [0.95, 0.55, 0.32, 0.16][i];
        ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
      }
    }
    ctx.globalAlpha = 1;
  };

  const drawFrame = () => {
    const glyph = glyphs[frame.index];
    if (!glyph || frame.alpha < 0.01) return;
    const a = frame.alpha, accent = glyph.color;
    const x1 = crisp(frame.x1), y1 = crisp(frame.y1), x2 = crisp(frame.x2), y2 = crisp(frame.y2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = accent; ctx.strokeStyle = accent; ctx.lineWidth = 1;
    const moved = Math.hypot(glyph.offset.x, glyph.offset.y);
    if (moved > 1) {
      const hx = (glyph.box.x1 + glyph.box.x2) / 2, hy = (glyph.box.y1 + glyph.box.y2) / 2;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + glyph.offset.x, hy + glyph.offset.y);
      ctx.setLineDash([3, 4]); ctx.globalAlpha = 0.45 * a; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.rect(Math.round(hx) - 2, Math.round(hy) - 2, 4, 4); ctx.globalAlpha = 0.7 * a; ctx.fill();
    }
    ctx.beginPath(); ctx.rect(x1, y1, x2 - x1, y2 - y1); ctx.globalAlpha = 0.5 * a; ctx.stroke();
    ctx.beginPath();
    for (const [cx, cy] of [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]) ctx.rect(Math.round(cx) - 2, Math.round(cy) - 2, 5, 5);
    ctx.globalAlpha = 0.95 * a; ctx.fill(); ctx.globalAlpha = 1;
    if (S.specks > 0) drawSpecks(a, accent);
    if (S.labels) {
      ctx.font = LABEL_FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = accent; ctx.globalAlpha = 0.62 * a;
      const label = moved > 1
        ? `${signed(Math.round(glyph.offset.x))}, ${signed(Math.round(-glyph.offset.y))}`
        : `${glyph.char}  ${Math.round(glyph.box.x2 - glyph.box.x1)} × ${Math.round(glyph.box.y2 - glyph.box.y1)}`;
      ctx.fillText(label, Math.round(frame.x1), Math.round(frame.y1) - 7);
      ctx.globalAlpha = 1;
    }
  };

  const kick = index => {
    const strength = (word ? word.size : 120) * 11;
    kicks.push({ index, at: pulse, velocity: strength });
    for (let d = 1; d < glyphs.length; d++) {
      const velocity = strength * Math.pow(KICK_DECAY, d);
      if (velocity < 30) break;
      for (const j of [index - d, index + d]) if (j >= 0 && j < glyphs.length) kicks.push({ index: j, at: pulse + d * 0.055, velocity });
    }
    wake();
  };

  const tick = now => {
    raf = 0;
    if (!word) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    const damping = 2 * Math.sqrt(SPRING) * (1 - clamp01(S.bounce) * 0.96);
    const sweeping = S.sweep && !reducedMotion && !pointer.inside && dragging < 0;
    if (sweeping) clock += dt * S.speed;
    pulse += dt;
    let targetX = pointer.x, targetY = pointer.y;
    if (sweeping) {
      targetX = word.left + (word.right - word.left) * (0.5 - 0.5 * Math.cos(clock * 0.45));
      targetY = word.top + (word.bottom - word.top) * (0.45 + 0.1 * Math.sin(clock * 0.8));
    }
    const active = pointer.inside || sweeping || dragging >= 0;
    if (active && !placed) { lens.x = targetX; lens.y = targetY; }
    if (active) {
      const lag = pointer.inside ? 0.05 : 0.22;
      lens.x = approach(lens.x, targetX, dt, lag); lens.y = approach(lens.y, targetY, dt, lag);
    }
    placed = active;

    for (let k = kicks.length - 1; k >= 0; k--) {
      if (kicks[k].at > pulse) continue;
      const glyph = glyphs[kicks[k].index];
      if (glyph) glyph.velocity.y -= kicks[k].velocity;
      kicks.splice(k, 1);
    }
    let moving = false;
    glyphs.forEach((glyph, i) => {
      if (i === dragging) {
        // kept inside the canvas around the word, so a dragged letter is never cut off
        const max = pad * 0.85;
        glyph.offset.x = approach(glyph.offset.x, Math.max(-max * 4, Math.min(max * 4, pointer.x - grab.x)), dt, 0.03);
        glyph.offset.y = approach(glyph.offset.y, Math.max(-max, Math.min(max, pointer.y - grab.y)), dt, 0.03);
        glyph.velocity.x = glyph.velocity.y = 0;
        moving = true;
        return;
      }
      const { offset, velocity } = glyph;
      if (Math.abs(offset.x) < 0.05 && Math.abs(offset.y) < 0.05 && Math.hypot(velocity.x, velocity.y) < 0.5) {
        offset.x = offset.y = velocity.x = velocity.y = 0;
        return;
      }
      velocity.x += (-SPRING * offset.x - damping * velocity.x) * dt;
      velocity.y += (-SPRING * offset.y - damping * velocity.y) * dt;
      offset.x += velocity.x * dt; offset.y += velocity.y * dt;
      moving = true;
    });

    const focus = dragging >= 0 ? dragging : active ? glyphAt(lens.x, lens.y) : -1;
    if (focus >= 0 && S.selection) {
      const glyph = glyphs[focus];
      const bx1 = glyph.box.x1 + glyph.offset.x - 6, by1 = glyph.box.y1 + glyph.offset.y - 6;
      const bx2 = glyph.box.x2 + glyph.offset.x + 6, by2 = glyph.box.y2 + glyph.offset.y + 6;
      if (frame.index < 0 || frame.alpha < 0.02) Object.assign(frame, { x1: bx1, y1: by1, x2: bx2, y2: by2 });
      const glide = focus === dragging ? 0.02 : 0.08;
      frame.x1 = approach(frame.x1, bx1, dt, glide); frame.y1 = approach(frame.y1, by1, dt, glide);
      frame.x2 = approach(frame.x2, bx2, dt, glide); frame.y2 = approach(frame.y2, by2, dt, glide);
      frame.index = focus;
    }
    frame.alpha = approach(frame.alpha, focus >= 0 && S.selection ? 1 : 0, dt, 0.1);
    glyphs.forEach((glyph, i) => {
      const target = i === focus && i !== dragging ? 1 : 0;
      glyph.outline = approach(glyph.outline, target, dt, 0.09);
      if (Math.abs(glyph.outline - target) > 0.002) moving = true; else glyph.outline = target;
    });
    const hovering = focus >= 0 && pointer.inside;
    const nextCursor = dragging >= 0 ? 'grabbing' : hovering && S.draggable ? 'grab' : hovering && S.clickKick ? 'pointer' : '';
    if (nextCursor !== cursor) { cursor = nextCursor; h1.style.cursor = nextCursor; }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const glyph of glyphs) {
      const moved = Math.hypot(glyph.offset.x, glyph.offset.y);
      if (moved > 1) { ctx.globalAlpha = Math.min(1, moved / 24) * 0.55; blit(glyph.dashes, 0, 0); ctx.globalAlpha = 1; }
    }
    // Per text run, like the browser paints text-shadow: the run's shadows, then its letters ("TRO"'s shadow falls on "U").
    for (const run of new Set(glyphs.map(g => g.run))) {
      const letters = glyphs.filter(g => g.run === run);
      for (const glyph of letters) {
        if (glyph.outline < 0.999) { ctx.globalAlpha = 1 - glyph.outline; blit(glyph.shadow, glyph.offset.x, glyph.offset.y); }
      }
      for (const glyph of letters) {
        if (glyph.outline < 0.999) { ctx.globalAlpha = 1 - glyph.outline; blit(glyph.fill, glyph.offset.x, glyph.offset.y); }
        if (glyph.outline > 0.001) { ctx.globalAlpha = glyph.outline; blit(glyph.dashes, glyph.offset.x, glyph.offset.y); }
        ctx.globalAlpha = 1;
      }
    }
    drawFrame();
    const settling = moving || kicks.length > 0 || (frame.alpha > 0.01 && frame.alpha < 0.99);
    if ((active || settling) && visible) raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (raf || !visible || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  // Pointer: the h1 receives the events (the canvas is click-through); coordinates are the canvas's.
  const locate = e => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; };
  h1.addEventListener('pointermove', e => { locate(e); pointer.inside = true; wake(); }, { passive: true });
  h1.addEventListener('pointerenter', e => { locate(e); pointer.inside = true; wake(); }, { passive: true });
  h1.addEventListener('pointerleave', () => { if (dragging >= 0) return; pointer.inside = false; wake(); }, { passive: true });
  h1.addEventListener('pointerdown', e => {
    locate(e); pointer.inside = true;
    const primary = e.pointerType !== 'mouse' || e.button === 0;
    const index = primary ? glyphAt(pointer.x, pointer.y) : -1;
    Object.assign(press, { x: pointer.x, y: pointer.y, time: performance.now(), index });
    if (S.draggable && index >= 0) {
      dragging = index;
      grab.x = pointer.x - glyphs[index].offset.x; grab.y = pointer.y - glyphs[index].offset.y;
      h1.setPointerCapture?.(e.pointerId);
    }
    wake();
  }, { passive: true });
  const onUp = e => {
    if (dragging >= 0) {
      dragging = -1;
      h1.releasePointerCapture?.(e.pointerId);
      const r = h1.getBoundingClientRect();
      pointer.inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }
    if (e.type === 'pointerup' && press.index >= 0 && S.clickKick && !reducedMotion && performance.now() - press.time < 450) {
      locate(e);
      if (Math.hypot(pointer.x - press.x, pointer.y - press.y) < 6) kick(press.index);
    }
    press.index = -1;
    wake();
  };
  h1.addEventListener('pointerup', onUp, { passive: true });
  h1.addEventListener('pointercancel', onUp, { passive: true });

  const relayout = () => { if (layout()) { ready = true; wake(); } };
  let resizeFrame = 0;
  new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(relayout); }).observe(h1);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); }).observe(h1);
  h1.appendChild(canvas);
  // Only once the hero's font is in: drawn with a fallback font, the letters would not match the page.
  const font = getComputedStyle(h1);
  (document.fonts ? document.fonts.load(`${font.fontWeight} 1em ${font.fontFamily}`, h1.textContent) : Promise.resolve())
    .catch(() => {}).then(() => requestAnimationFrame(relayout));
})();
