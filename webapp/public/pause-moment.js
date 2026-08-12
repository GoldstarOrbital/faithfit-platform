/**
 * "Stop and smell the sunflowers" -- an occasional, gentle invitation to
 * breathe, surfaced ambiently instead of only living where someone has to
 * already know to look for it (Explore -> Breathe).
 *
 * Same restraint discipline as lib/retention.js's nudges: this is not a
 * notification, it never repeats within a rate-limit window, and it never
 * fires on a cold open -- only after real, unhurried engagement (a minimum
 * of active time in the tab AND a minimum amount of scrolling), so it reads
 * as a pause offered mid-session, not a popup thrown at arrival.
 *
 * Content is never invented here: the line shown comes from GET /api/motivation,
 * the same verified quote/verse source the Explore "Motivation" tab already
 * uses. This file only decides *when* to offer a pause, never *what* to say.
 *
 * Degrades completely on prefers-reduced-motion (skipped outright, same
 * precedent as app-intro.js) and on any fetch failure (never shows a broken
 * card).
 */
'use strict';

(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const RATE_LIMIT_MS = 20 * 60 * 60 * 1000; // at most once per ~20 hours
  const MIN_ACTIVE_MS = 75000;               // 75s of real, foregrounded time
  const MIN_SCROLL_PX = 500;                 // and genuine scrolling, not a bounce
  const AUTO_DISMISS_MS = 16000;
  const KEY = 'ff-pause-last-shown';

  function lastShown() {
    try { return Number(localStorage.getItem(KEY)) || 0; } catch (e) { return 0; }
  }
  function markShown() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* private mode: just won't rate-limit */ }
  }
  function eligible() {
    return Date.now() - lastShown() > RATE_LIMIT_MS;
  }

  // --- engagement signal -------------------------------------------------
  let activeMs = 0, lastTick = Date.now(), scrolled = 0, lastScrollY = window.scrollY;
  let armed = eligible();

  function tick() {
    if (!armed) return;
    const now = Date.now();
    if (document.visibilityState === 'visible') activeMs += now - lastTick;
    lastTick = now;
    if (activeMs >= MIN_ACTIVE_MS && scrolled >= MIN_SCROLL_PX) offer();
  }

  window.addEventListener('scroll', function () {
    scrolled += Math.abs(window.scrollY - lastScrollY);
    lastScrollY = window.scrollY;
  }, { passive: true });

  const timer = setInterval(tick, 4000);

  // --- the card ------------------------------------------------------------
  const CSS = `
.ff-pause {
  position: fixed; left: 50%; bottom: calc(86px + env(safe-area-inset-bottom));
  transform: translate(-50%, 10px); width: calc(100% - 28px); max-width: 380px;
  z-index: 205; opacity: 0; transition: opacity .5s ease, transform .5s ease;
  background: var(--parch-2, #fdf8ea); color: var(--ink, #33251a);
  border: 1px solid var(--hairline, rgba(74,58,40,0.22));
  border-radius: var(--radius-sm, 14px); box-shadow: 0 14px 32px rgba(43,30,18,0.26);
  padding: 16px; font-family: var(--ui, 'Inter', system-ui, sans-serif); text-align: center;
}
.ff-pause.shown { opacity: 1; transform: translate(-50%, 0); }
.ff-pause-ring {
  width: 46px; height: 46px; margin: 0 auto 10px; border-radius: 50%;
  background: radial-gradient(circle, var(--hearth-soft, #f0c477) 0%, var(--hearth, #d99a3f) 70%);
  animation: ff-pause-breathe 5s ease-in-out infinite;
}
@keyframes ff-pause-breathe { 0%,100% { transform: scale(0.85); opacity: 0.75; } 50% { transform: scale(1.12); opacity: 1; } }
.ff-pause-line { font-size: 0.92rem; line-height: 1.5; font-style: italic; }
.ff-pause-attr { font-size: 0.74rem; color: var(--muted, #8d7a5f); margin-top: 4px; }
.ff-pause-acts { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
.ff-pause-acts button {
  font: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer;
  padding: 7px 14px; border-radius: var(--radius-round, 999px); border: 1px solid var(--hairline, rgba(74,58,40,0.22));
  background: transparent; color: var(--ink-soft, #61503c);
}
.ff-pause-acts button[data-pause-act="go"] { border-color: var(--brass, #b08d46); color: var(--walnut-0, #3a2a1a); font-weight: 700; }
`;

  async function offer() {
    armed = false;
    clearInterval(timer);
    if (!window.state || !window.state.me || !window.state.me.user) return; // signed-in members only

    let quote;
    try {
      const res = await fetch('/api/motivation', { credentials: 'same-origin' });
      if (!res.ok) return;
      quote = await res.json();
      if (!quote || !quote.text) return;
    } catch (e) { return; }

    markShown();

    if (!document.getElementById('ff-pause-css')) {
      const style = document.createElement('style');
      style.id = 'ff-pause-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const el = document.createElement('div');
    el.className = 'ff-pause';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="ff-pause-ring" aria-hidden="true"></div>' +
      '<div class="ff-pause-line">' + escapeHtmlLocal(quote.text) + '</div>' +
      (quote.attribution ? '<div class="ff-pause-attr">' + escapeHtmlLocal(quote.attribution) + '</div>' : '') +
      '<div class="ff-pause-acts">' +
        '<button type="button" data-pause-act="go">Breathe for a moment</button>' +
        '<button type="button" data-pause-act="dismiss">Not now</button>' +
      '</div>';

    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('shown'); });

    const dismissTimer = setTimeout(dismiss, AUTO_DISMISS_MS);
    function dismiss() {
      clearTimeout(dismissTimer);
      el.classList.remove('shown');
      setTimeout(function () { el.remove(); }, 400);
    }
    el.addEventListener('click', function (e) {
      const btn = e.target.closest ? e.target.closest('[data-pause-act]') : null;
      if (!btn) return;
      if (btn.dataset.pauseAct === 'go' && typeof window.setTab === 'function') {
        window.state.exploreTab = 'breathe';
        window.setTab('explore');
      }
      dismiss();
    });
  }

  // Same-file-local escaping -- this card renders text from GET /api/motivation,
  // which is server content, not arbitrary user input, but escaping on the way
  // into innerHTML costs nothing and removes any doubt.
  function escapeHtmlLocal(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
