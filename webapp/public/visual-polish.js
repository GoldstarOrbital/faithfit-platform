/**
 * A site-wide visual polish layer: cards settle into place as they enter
 * view instead of simply appearing, and interactive elements get a slightly
 * more considered transition than the bare defaults.
 *
 * This has to work against the grain of how the app renders: app.js rebuilds
 * whole screens with `main.innerHTML = ...` on every navigation, so there is
 * no single mount point to hook once. A MutationObserver on #app re-attaches
 * the reveal behavior to whatever cards just appeared, every time -- same
 * resilience pattern public/easter-eggs.js already uses for the same reason.
 *
 * Fully inert on prefers-reduced-motion: the hidden-until-revealed CSS is
 * never even injected in that case, so nothing depends on this script
 * running correctly for content to be visible. That matters more than the
 * animation does.
 */
'use strict';

(function () {
  if (window.__ffVisualPolish) return; // never double-install across re-injections
  window.__ffVisualPolish = true;

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CSS = `
.ff-reveal { opacity: 0; transform: translateY(14px); }
.ff-reveal.ff-in {
  opacity: 1; transform: translateY(0);
  transition: opacity .55s cubic-bezier(.22,.61,.36,1), transform .55s cubic-bezier(.22,.61,.36,1);
}
.card, .home-action, .explore-tile, .follow-btn, .primary, button {
  transition: transform .18s cubic-bezier(.22,.61,.36,1), box-shadow .18s ease, opacity .18s ease;
}
.card:hover, .explore-tile:hover, .home-action:hover { transform: translateY(-1px); }
`;

  if (!reduced) {
    const style = document.createElement('style');
    style.id = 'ff-visual-polish-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const io = !reduced && 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('ff-in');
          io.unobserve(entry.target); // settle once, never re-toggle on scroll up/down
        });
      }, { threshold: 0.12 })
    : null;

  // Hard fallback, independent of whether IntersectionObserver ever actually
  // fires: nothing marked .ff-reveal may stay invisible forever. This is not
  // hypothetical caution -- verified directly that a plain, textbook
  // IntersectionObserver on a real, on-screen, correctly-sized element can
  // simply never deliver a callback in some environments. A card that never
  // reveals is a much worse outcome than one that skips its entrance
  // animation, so this always wins.
  const FALLBACK_MS = 1200;
  function scheduleFallback(card) {
    setTimeout(function () {
      if (!card.classList.contains('ff-in')) card.classList.add('ff-in');
    }, FALLBACK_MS);
  }

  function claim(root) {
    if (!io) return;
    const cards = root.matches && root.matches('.card') ? [root] : (root.querySelectorAll ? root.querySelectorAll('.card') : []);
    (root.matches && root.matches('.card') ? [root] : Array.from(cards)).forEach(function (card) {
      if (card.dataset.ffRevealDone) return;
      card.dataset.ffRevealDone = '1';
      scheduleFallback(card);
      card.classList.add('ff-reveal');
      io.observe(card);
    });
  }

  function scan() {
    const app = document.getElementById('app');
    if (app) claim(app);
  }

  scan();
  const mo = new MutationObserver(function (mutations) {
    for (const m of mutations) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) claim(node);
      });
    }
  });
  const target = document.getElementById('app') || document.body;
  mo.observe(target, { childList: true, subtree: true });
})();
