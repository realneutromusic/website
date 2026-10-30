'use strict';
(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const scriptBase = new URL('.', document.currentScript.src);
  let brushes;
  function syncMotion() {
    if (!reduced.matches && !brushes) {
      brushes = document.createElement('div'); brushes.className = 'nt-brushes'; brushes.setAttribute('aria-hidden', 'true');
      brushes.innerHTML = Array.from({length:10}, (_, index) => {
        const paths = Array.from({length:20}, (_, row) => {
          const y = 8 + row * 17, start = (row * 19 + index * 7) % 47;
          const from = index % 2 ? 1060 + start : -60 - start, to = index % 2 ? -60 - start : 1060 + start;
          return `<path class="nt-paint-path" d="M${from} ${y} H${to}" pathLength="1" style="--bristle-delay:${((row * 13 + index * 11) % 40) / 100}s"/>`;
        }).join('');
        const image = new URL(`paint/brush-${String(index + 1).padStart(2,'0')}.webp`, scriptBase).href;
        return `<svg class="nt-paint nt-paint-${index}" style="--paint-start:${index * 4.8}s" viewBox="0 0 1000 340" preserveAspectRatio="none" focusable="false"><defs><mask id="nt-paint-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="340">${paths}</mask></defs><image href="${image}" width="1000" height="340" preserveAspectRatio="none" mask="url(#nt-paint-${index})"/></svg>`;
      }).join('');
      document.body.prepend(brushes);
      resumeBrushes();
    }
    root.classList.toggle('nt-background-paused', document.hidden || reduced.matches);
  }
  // Moving between the home page and /catalogue/ is a full page load: without this the strokes would start
  // again from zero. The point the strokes reached is kept for this tab (sessionStorage) and the next page
  // carries on from there, like the Store does when it changes section without reloading.
  const CLOCK = 'nt_brush_clock';
  const brushAnimations = () => brushes ? [...brushes.querySelectorAll('.nt-paint, .nt-paint-path')].flatMap(el => el.getAnimations ? el.getAnimations() : []) : [];
  function saveBrushes() {
    const first = brushAnimations()[0];
    if (!first || first.currentTime == null) return;
    try { sessionStorage.setItem(CLOCK, JSON.stringify({ t: first.currentTime, at: Date.now(), running: !document.hidden })); } catch (e) { /* no storage */ }
  }
  function resumeBrushes() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(CLOCK)); } catch (e) { /* no storage */ }
    if (!saved || !Number.isFinite(saved.t)) return;
    // time spent on the way here only counts if the strokes were moving when the last page was left
    const time = saved.t + (saved.running ? Math.max(0, Date.now() - saved.at) : 0);
    for (const animation of brushAnimations()) animation.currentTime = time;
  }
  addEventListener('pagehide', saveBrushes);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveBrushes(); });
  syncMotion(); document.addEventListener('visibilitychange', syncMotion); reduced.addEventListener('change', syncMotion);
  const links = [...document.querySelectorAll('.topbar nav a[href^="#"]')];
  links.forEach(link => {
    const label = link.textContent.trim(); link.setAttribute('aria-label', label);
    link.replaceChildren(...[...label].map((letter, index) => {
      const wrap = document.createElement('span'); wrap.className = 'nt-nav-letter'; wrap.setAttribute('aria-hidden','true');
      wrap.dataset.letter = letter; wrap.style.setProperty('--letter',index);
      const glyph = document.createElement('span'); glyph.textContent = letter; wrap.append(glyph); return wrap;
    }));
  });
  const sections = links.map(link => ({ link, section: document.getElementById(link.hash.slice(1)) })).filter(item => item.section);
  let frame = 0;
  function updateActive() {
    frame = 0;
    // Full Catalogue view (#catalogue): the Home sections are hidden; it belongs to Releases.
    if (root.classList.contains('is-catalogue')) {
      for (const item of sections) item.link.hash === '#releases' ? item.link.setAttribute('aria-current','location') : item.link.removeAttribute('aria-current');
      return;
    }
    let current = sections[0];
    for (const item of sections) if (item.section.getBoundingClientRect().top <= 150) current = item;
    for (const item of sections) item === current ? item.link.setAttribute('aria-current','location') : item.link.removeAttribute('aria-current');
  }
  document.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(updateActive); }, {passive:true});
  addEventListener('nt:view', updateActive);
  updateActive();
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        if (!reduced.matches) entry.target.classList.add('nt-enter');
        observer.unobserve(entry.target);
      }
    }, {threshold:.1});
    document.querySelectorAll('.block-head,.socials-field,.contact-panel').forEach(el => observer.observe(el));
  }
})();
