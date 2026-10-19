'use strict';
/* Progressive enhancement: native transitions, small scroll depth and safe page prefetch. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let transition, sequence = 0, clean = () => {}, lastCard;
  const enabled = () => !reduced.matches && typeof document.startViewTransition === 'function';
  function swap(update, source, target) {
    if (!enabled()) return Promise.resolve(update());
    transition?.skipTransition(); clean();
    const ticket = ++sequence;
    let destination, applied = false;
    const change = async () => { if (ticket !== sequence) return; applied = true; if (source) source.style.viewTransitionName = ''; await update(); if (ticket !== sequence) return; destination = target?.(); if (destination?.isConnected) destination.style.viewTransitionName = 'nt-cover'; };
    if (source) source.style.viewTransitionName = 'nt-cover';
    clean = () => { source?.style.removeProperty('view-transition-name'); destination?.style.removeProperty('view-transition-name'); };
    try { transition = document.startViewTransition(change); }
    catch { clean(); return applied ? Promise.resolve() : Promise.resolve(update()); }
    transition.finished.catch(() => {}).finally(() => { if (ticket === sequence) { clean(); transition = null; } });
    return transition.updateCallbackDone;
  }
  function cover(source, update, target) {
    const rect = source?.getBoundingClientRect();
    if (!enabled() || !rect?.width || rect.bottom <= 0 || rect.top >= innerHeight) { update(); return; }
    swap(update, source, target).catch(() => {});
  }
  function feedback(element) {
    if (!element || reduced.matches) return;
    element.getAnimations().filter(a => a.id === 'nt-feedback').forEach(a => a.cancel());
    const a = element.animate([{scale:'1',boxShadow:'0 0 0 0 #a8c8ec00'},{scale:'1.035',boxShadow:'0 0 0 5px #a8c8ec25',offset:.35},{scale:'1',boxShadow:'0 0 0 9px #a8c8ec00'}],{duration:430,easing:'cubic-bezier(.2,.7,.2,1)'}); a.id = 'nt-feedback';
  }
  window.NTMotion = {
    get enabled() { return enabled(); }, swap, cover, feedback,
    origin(id) {
      if (lastCard?.isConnected && (lastCard.dataset.id === id || lastCard.querySelector('[data-ghost-open]')?.dataset.ghostOpen === id)) return lastCard.querySelector('.cover img,.cover');
      return [...document.querySelectorAll('.card[data-id],#feature[data-id]')].find(el => el.dataset.id === id)?.querySelector('.cover img,.cover');
    },
    cartAdded(id) {
      document.querySelectorAll('[data-act="cart"],[data-id]').forEach(el => { if (el.matches('button,a') && (el.dataset.act === 'cart' || el.dataset.id === id)) feedback(el); });
    },
  };
  document.addEventListener('click', event => { const card = event.target.closest('.card,#feature,.release-card'); if (card) lastCard = card; },true);
  // Individual translate composes with the existing hover and entrance transforms.
  const active = new Set(), tracked = new Set(); let frame = 0;
  function depth() {
    frame = 0;
    for (const el of active) {
      if (!el.isConnected) { active.delete(el); tracked.delete(el); continue; }
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--nt-depth', reduced.matches ? '0px' : `${Math.max(-8,Math.min(8,(rect.top + rect.height/2 - innerHeight/2)*.018)).toFixed(2)}px`);
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(depth); };
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => { for (const e of entries) e.isIntersecting ? active.add(e.target) : active.delete(e.target); schedule(); },{rootMargin:'80px'}) : null;
  function scan(root) {
    if (!(root instanceof Element) && root !== document) return;
    for (const el of root.querySelectorAll('.block-head h2,.hero h1,.ghost-intro h1,.section-head h2,.svc-head h2')) if (!tracked.has(el)) {tracked.add(el); el.classList.add('nt-scroll-depth'); observer?.observe(el);}
  }
  scan(document);
  new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) scan(node); for (const el of tracked) if (!el.isConnected) {observer?.unobserve(el);tracked.delete(el);active.delete(el);} }).observe(document.body,{childList:true,subtree:true});
  addEventListener('scroll', schedule,{passive:true}); addEventListener('resize',schedule,{passive:true});
  reduced.addEventListener('change',() => { if (reduced.matches) {transition?.skipTransition();for(const el of tracked)el.style.setProperty('--nt-depth','0px');} schedule(); });
  // Only public HTML pages. No API, cart, checkout, account or product actions are speculated.
  const publicPaths = new Set(['/','/about/','/mixing-mastering/','/ghost-production/']);
  const queued = new Set(); let hoverTimer;
  function prefetch(link) {
    if (!link || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) return;
    const url = new URL(link.href,location.href);
    const own = url.origin === location.origin;
    const publicStore = url.origin === 'https://store.realneutromusic.com';
    if ((!own && !publicStore) || !publicPaths.has(url.pathname) || url.search || (own && url.pathname === location.pathname) || link.hasAttribute('download') || queued.has(url.href) || queued.size >= 4) return;
    queued.add(url.href);
    if (own && window.NTNavigation) { window.NTNavigation.preload(url.href).catch(() => queued.delete(url.href)); return; }
    if (HTMLScriptElement.supports?.('speculationrules')) {const rule=document.createElement('script');rule.type='speculationrules';rule.textContent=JSON.stringify({prefetch:[{urls:[url.href],eagerness:'immediate'}]});document.head.append(rule);}
    else { const hint = document.createElement('link');hint.rel='prefetch';hint.href=url.href;document.head.append(hint); }
  }
  document.addEventListener('pointerover',event=>{clearTimeout(hoverTimer);const link=event.target.closest('a[href]');if(link)hoverTimer=setTimeout(()=>prefetch(link),160);});
  document.addEventListener('pointerout',()=>clearTimeout(hoverTimer));
  document.addEventListener('focusin',event=>prefetch(event.target.closest('a[href]')));
})();
