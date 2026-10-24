'use strict';
/* About section: the artist card's gentle mouse tilt, like the store's About card (±5° / ±4° around its resting angle,
   mouse only, nothing with reduced motion). */
(() => {
  let card = null, rx0 = 0, ry0 = 0;
  const rest = el => { el?.style.removeProperty('--rx'); el?.style.removeProperty('--ry'); };
  document.addEventListener('pointermove', e => {
    const el = e.pointerType === 'mouse' ? e.target.closest?.('[data-tilt-card]') : null;
    if (el !== card) {
      rest(card); card = el;
      if (el) { const base = getComputedStyle(el); rx0 = parseFloat(base.getPropertyValue('--rx')) || 0; ry0 = parseFloat(base.getPropertyValue('--ry')) || 0; }
    }
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${(ry0 + x * 10).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${(rx0 - y * 8).toFixed(2)}deg`);
  }, { passive: true });
  document.addEventListener('pointerout', e => { if (!e.relatedTarget && card) { rest(card); card = null; } });
})();
