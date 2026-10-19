'use strict';
/* Small, optional polish. Native scrolling, dialogs and navigation are left untouched:
   only a confirmation pulse after real actions and a hover preload of public store sections. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function feedback(element) {
    if (!element?.animate || reduced.matches) return;
    element.getAnimations().filter(a => a.id === 'nt-feedback').forEach(a => a.cancel());
    const a = element.animate([{scale:'1',boxShadow:'0 0 0 0 #a8c8ec00'},{scale:'1.035',boxShadow:'0 0 0 5px #a8c8ec25',offset:.35},{scale:'1',boxShadow:'0 0 0 9px #a8c8ec00'}],{duration:430,easing:'cubic-bezier(.2,.7,.2,1)'});
    a.id = 'nt-feedback';
  }
  window.NTMotion = {
    feedback,
    cartAdded(id) {
      if (id == null) return;
      document.querySelectorAll(`button[data-id="${CSS.escape(String(id))}"]:is([data-act="cart"],[data-act="add"])`).forEach(feedback);
    },
  };
  // Store sections only, through the store's own navigation cache. No APIs, cart, checkout or account pages.
  const publicPaths = new Set(['/','/about/','/mixing-mastering/','/ghost-production/']);
  const queued = new Set(); let hoverTimer;
  function prefetch(link) {
    if (!link || !window.NTNavigation || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !publicPaths.has(url.pathname) || url.search || url.pathname === location.pathname || link.hasAttribute('download') || queued.has(url.pathname) || queued.size >= 4) return;
    queued.add(url.pathname);
    window.NTNavigation.preload(url.href).catch(() => queued.delete(url.pathname));
  }
  document.addEventListener('pointerover', event => { clearTimeout(hoverTimer); const link = event.target.closest?.('a[href]'); if (link) hoverTimer = setTimeout(() => prefetch(link), 160); });
  document.addEventListener('pointerout', () => clearTimeout(hoverTimer));
  document.addEventListener('focusin', event => prefetch(event.target.closest?.('a[href]')));
})();
