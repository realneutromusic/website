'use strict';
/* Smooth wheel scrolling with self-hosted Lenis (MIT, see vendor/LENIS-LICENSE.txt), desktop mouse/trackpad only.
   Lenis only takes wheel input it can fully own, so it never moves the page at the same time as the browser:
   touch, keyboard, dialogs, inner scroll panels and every scroll requested by page code stay native. */
(() => {
  if (!window.Lenis) return;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(hover: hover) and (pointer: fine)');
  let lenis = null, internal = false;

  // The sites lock the page themselves (modal <dialog>, or body overflow:hidden for the main site's overlays).
  function pageLocked() {
    let modal;
    try { modal = document.querySelector('dialog:modal'); } catch { modal = document.querySelector('dialog[open]'); }
    const body = document.body.style;
    return !!modal || body.overflow === 'hidden' || body.position === 'fixed';
  }
  function sync() {
    if (!lenis) return;
    if (pageLocked()) { if (!lenis.isStopped) lenis.stop(); }
    else if (lenis.isStopped) lenis.start();
  }
  // Stop smooth inertia before anything else scrolls the page, so two animations never compete.
  function settle() {
    if (lenis && !internal && lenis.isScrolling === 'smooth') lenis.reset();
  }
  // Inner panels keep native scrolling while they can still move in that direction. <body> and <html> are
  // skipped on purpose: overflow-x:hidden makes body report overflow-y:auto, and treating it as a nested
  // scroller hands part of the wheel events back to the browser (mixed, flickering scroll).
  function innerScroll(target, dx, dy) {
    const vertical = Math.abs(dy) >= Math.abs(dx), delta = vertical ? dy : dx;
    for (let el = target instanceof Element ? target : target?.parentElement; el && el !== document.body && el !== root; el = el.parentElement) {
      // Firefox reports overflow:visible for <textarea> even though it scrolls its own text.
      const overflow = el.tagName === 'TEXTAREA' ? 'auto' : getComputedStyle(el)[vertical ? 'overflowY' : 'overflowX'];
      if (!/auto|scroll|overlay/.test(overflow)) continue;
      const max = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      if (max <= 1) continue;
      const position = vertical ? el.scrollTop : el.scrollLeft;
      if (delta > 0 ? position < max - 1 : position > 1) return true;
    }
    return false;
  }
  function create() {
    lenis = new Lenis({
      autoRaf: true, lerp: 0.1, smoothWheel: true, syncTouch: false, anchors: false,
      allowNestedScroll: false, stopInertiaOnNavigate: true,
      // No Lenis "prevent" list: an element it skips (e.g. a form textarea or select) would let the browser
      // scroll the page while the inertia keeps running. Every hand-over to the browser goes through settle().
      virtualScroll({ deltaX, deltaY, event }) {
        if (event.type !== 'wheel') return true; // touch stays native (syncTouch:false)
        sync();
        if (lenis.isStopped) return false; // overlay open: it scrolls natively, the page is locked by the site
        // Chrome makes the rest of a wheel sequence non-cancelable when its first event was not handled;
        // those, zoom gestures, opted-out areas and inner panels that can still move belong to the browser.
        const optOut = event.target instanceof Element && event.target.closest('[data-lenis-prevent]');
        if (!event.cancelable || event.ctrlKey || optOut || innerScroll(event.target, deltaX, deltaY)) { settle(); return false; }
        if (lenis.dimensions.scrollHeight !== root.scrollHeight) lenis.dimensions.resize(); // content changed (SPA, releases)
        return true;
      },
    });
    const setScroll = lenis.setScroll;
    lenis.setScroll = function (value) { internal = true; try { return setScroll.call(this, value); } finally { internal = false; } };
    sync();
  }
  function setup() {
    const wanted = desktop.matches && !reduced.matches;
    if (wanted && !lenis) create();
    else if (!wanted && lenis) { lenis.destroy(); lenis = null; }
  }
  for (const [owner, name] of [[window, 'scrollTo'], [window, 'scroll'], [window, 'scrollBy'], [Element.prototype, 'scrollIntoView']]) {
    const original = owner[name];
    if (typeof original === 'function') owner[name] = function (...args) { settle(); return original.apply(this, args); };
  }
  addEventListener('keydown', event => {
    if (/^(Arrow(Up|Down)|Page(Up|Down)|Home|End| )$/.test(event.key) && !event.target.closest?.('input,textarea,select,[contenteditable]')) settle();
  }, true);
  document.addEventListener('click', event => { const link = event.target.closest?.('a[href*="#"]'); if (link?.pathname === location.pathname) settle(); }, true);
  addEventListener('pointerdown', event => { if (event.target === root) settle(); }, true); // scrollbar drag
  addEventListener('popstate', settle);
  addEventListener('pageshow', () => { lenis?.resize(); sync(); });
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['open'] });
  document.addEventListener('close', sync, true);
  reduced.addEventListener('change', setup);
  desktop.addEventListener('change', setup);
  setup();
  window.NTScroll = { get active() { return !!lenis && !lenis.isStopped; }, get lenis() { return lenis; } };
})();
