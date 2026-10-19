'use strict';
/* Lenis is self-hosted. Touch and nested panels retain native scrolling. */
(() => {
  if (!window.Lenis) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let scroll;
  function locked() {
    return document.body.style.overflow === 'hidden' || document.body.style.position === 'fixed'
      || !!document.querySelector('dialog[open]');
  }
  function syncLock() {
    if (!scroll) return;
    if (locked()) { if (!scroll.isStopped) scroll.stop(); }
    else if (scroll.isStopped) scroll.start();
  }
  function setup() {
    if (reduced.matches) { scroll?.destroy(); scroll = null; return; }
    if (scroll) return;
    scroll = new Lenis({
      autoRaf: true, lerp: 0.1, smoothWheel: true, syncTouch: false,
      anchors: true, allowNestedScroll: true, stopInertiaOnNavigate: true,
      prevent: node => !!node.closest('dialog,[role="dialog"],textarea,select,[data-lenis-prevent]'),
    });
    syncLock();
  }
  reduced.addEventListener('change', setup);
  new MutationObserver(syncLock).observe(document.body, {attributes:true,attributeFilter:['style','class']});
  new MutationObserver(syncLock).observe(document.body, {subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  document.addEventListener('toggle', syncLock, true);
  addEventListener('pageshow', () => {scroll?.resize(); syncLock();});
  setup();
})();
