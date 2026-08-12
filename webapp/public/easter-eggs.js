/**
 * Functioning Faith — easter eggs.
 *
 * Four small things hidden in the app for anyone who pokes around, and nothing
 * else. This file owns no product behaviour: if it fails to load, or a browser
 * refuses it, nobody notices anything missing.
 *
 * The rules it holds itself to, because a delight that costs the app anything
 * has stopped being a delight:
 *  - The SPA rewrites #main on every render, so nothing here binds to a
 *    rendered element. Listeners live on document; the one sprite watches for
 *    the shell around it to be replaced and re-mounts itself.
 *  - No key is ever swallowed (the Konami listener never calls preventDefault,
 *    so arrow keys still scroll), no tap target moves, and the sprite is
 *    absolutely positioned so it can never shift the layout.
 *  - Nothing fires by accident: the sprite needs a deliberate click, the logo
 *    needs a held press that a scroll-drag cancels, and both stand down while a
 *    workout or a moment layer is on screen.
 *  - Reduced motion means no motion, not less motion.
 *  - Every string rendered here is one we wrote. Nothing user-supplied ever
 *    reaches this DOM, and copy goes in through textContent regardless. The
 *    encouragement note is labelled as ours precisely so that nobody can
 *    mistake a bit of kindness for Scripture.
 *  - Found once, then quiet. No badge, no reminder, no nudge to go collect the
 *    rest. The count only appears inside a card you just earned.
 */
(function () {
  'use strict';

  const STORE_KEY = 'ff.eggs.found';
  const EGG_IDS = ['literal', 'konami', 'note', 'console'];

  // localStorage throws outright in some privacy modes, so it is a nicety, not
  // the source of truth. The in-memory mirror keeps the session coherent even
  // when nothing can be written.
  let foundMirror = null;

  function found() {
    if (foundMirror) return foundMirror;
    let list = [];
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = parsed.filter(id => EGG_IDS.indexOf(id) !== -1);
    } catch { /* unreadable storage just means every egg is new again */ }
    foundMirror = list;
    return foundMirror;
  }

  function markFound(id) {
    const list = found();
    if (list.indexOf(id) !== -1) return false;
    list.push(id);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* fine */ }
    syncSprite();
    return true;
  }

  function isFound(id) { return found().indexOf(id) !== -1; }

  function countLine() {
    const n = found().length;
    if (n >= EGG_IDS.length) return 'all four found — thank you for looking around.';
    return 'eggs found: ' + n + ' of ' + EGG_IDS.length;
  }

  const reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  // Never interrupt a live workout, and never stack a card on top of a moment
  // layer. `state` is a top-level const in app.js, which is a global lexical
  // binding rather than a window property — typeof keeps this safe if the
  // script order ever changes or app.js is absent.
  function appIsBusy() {
    if (document.querySelector('.moment-layer, .workout-invite-modal, .ff-egg-layer')) return true;
    try { return typeof state !== 'undefined' && !!(state && state.activeWorkout); } catch { return false; }
  }

  /* ---- Styles -------------------------------------------------------------
     Injected from here so this file stays self-contained. Theme tokens are read
     with fallbacks, so the eggs still look deliberate if styles.css is missing
     or renamed. Everything is namespaced ff-egg-. */

  const CSS = `
.ff-egg {
  position: absolute; left: 0; bottom: 0; width: 20px; height: 20px;
  display: grid; place-items: center; padding: 0; margin: 0;
  background: none; border: 0; cursor: pointer; line-height: 0;
  opacity: .3; transition: opacity .25s ease, transform .25s ease;
}
.ff-egg svg { width: 11px; height: 14px; overflow: visible; }
.ff-egg .ff-egg-shell { fill: var(--hearth-soft, #f0c477); }
.ff-egg .ff-egg-speck { fill: var(--walnut-1, #2b1e12); opacity: .45; }
.ff-egg .ff-egg-crack { stroke: var(--walnut-1, #2b1e12); stroke-width: 1.2; fill: none;
  stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
.ff-egg:hover, .ff-egg:focus-visible { opacity: .95; transform: translateY(-1px); }
.ff-egg:focus-visible { outline: 1px solid var(--gold-2, #d9ab55); outline-offset: 1px; border-radius: 6px; }
.ff-egg.is-found { opacity: .5; }
.ff-egg.is-complete .ff-egg-shell { filter: drop-shadow(0 0 3px var(--gold-2, #d9ab55)); }
.ff-egg.is-cracking { animation: ff-egg-wobble .42s ease-in-out both; }
.ff-egg.is-cracking .ff-egg-crack { opacity: 1; animation: ff-egg-crack .42s ease-out both; }
@keyframes ff-egg-wobble {
  0% { transform: rotate(0) }
  22% { transform: rotate(-11deg) }
  48% { transform: rotate(9deg) }
  74% { transform: rotate(-5deg) }
  100% { transform: rotate(0) }
}
@keyframes ff-egg-crack { from { stroke-dashoffset: 22 } to { stroke-dashoffset: 0 } }

/* The card. Above the moment layer (1000) because it is always the thing the
   member just asked for, and it is dismissed by anything they do next. */
.ff-egg-layer { position: fixed; inset: 0; z-index: 1400; display: grid; place-items: center; padding: 20px; }
.ff-egg-scrim { position: absolute; inset: 0; background: rgba(31,23,15,.46); backdrop-filter: blur(5px); }
.ff-egg-card {
  position: relative; width: min(100%, 340px); padding: 22px 22px 18px;
  text-align: center; border-radius: var(--radius, 20px);
  color: var(--ink, #33251a);
  background: var(--parch-1, #f6efdc);
  border: 1px solid var(--hairline, rgba(74,58,40,.22));
  box-shadow: 0 24px 70px rgba(43,30,18,.42), inset 0 1px 0 rgba(255,255,255,.6);
  animation: ff-egg-in .3s cubic-bezier(.2,.9,.3,1) both;
}
@keyframes ff-egg-in { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
.ff-egg-art { position: relative; display: block; width: 74px; height: 92px; margin: 0 auto 12px; }
.ff-egg-art svg { width: 100%; height: 100%; display: block; }
.ff-egg-art .ff-egg-shell { fill: var(--parch-2, #fdf8ea); stroke: var(--brass, #b08d46); stroke-width: 2; }
.ff-egg-art .ff-egg-band { stroke: var(--gold-2, #d9ab55); stroke-width: 2.4; fill: none; stroke-linecap: round; }
.ff-egg-art .ff-egg-nest { stroke: var(--meadow, #6f8f43); stroke-width: 2.4; fill: none; stroke-linecap: round; opacity: .75; }
.ff-egg-art .ff-egg-glint { fill: #fff; opacity: .75; }
.ff-egg-spark { position: absolute; width: 4px; height: 4px; border-radius: 50%;
  background: var(--gold-2, #d9ab55); opacity: 0; animation: ff-egg-spark 1.5s ease-out both; }
@keyframes ff-egg-spark {
  0% { opacity: 0; transform: translate(0,0) scale(.4) }
  25% { opacity: .95 }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.7) }
}
.ff-egg-title {
  margin: 0 0 8px; font-family: 'Cinzel', Georgia, serif; font-weight: 700;
  font-size: 1.12rem; letter-spacing: .02em; line-height: 1.25; color: var(--ink, #33251a);
}
.ff-egg-body { margin: 0; font-size: .88rem; line-height: 1.55; color: var(--ink-soft, #61503c); }
.ff-egg-foot { margin: 12px 0 0; font-size: .66rem; line-height: 1.5; color: var(--muted, #8d7a5f); }
.ff-egg-count { margin: 4px 0 0; font-size: .62rem; letter-spacing: .1em; text-transform: lowercase; color: var(--muted, #8d7a5f); }
.ff-egg-close {
  margin-top: 16px; padding: 9px 22px; cursor: pointer;
  font-family: 'Cinzel', Georgia, serif; font-weight: 600; font-size: .82rem; letter-spacing: .03em;
  color: var(--ink, #33251a); background: var(--parch-2, #fdf8ea);
  border: 1px solid var(--hairline, rgba(74,58,40,.22)); border-radius: 12px;
}
.ff-egg-close:hover { border-color: var(--gold, #b08d46); }

/* A quieter reply for the second visit to an egg you already found. */
.ff-egg-murmur {
  position: fixed; left: 50%; top: 12px; z-index: 1400; transform: translateX(-50%);
  padding: 8px 16px; border-radius: 999px; pointer-events: none;
  font-size: .78rem; color: var(--parch-2, #fdf8ea);
  background: rgba(43,30,18,.9); border: 1px solid rgba(217,171,85,.45);
  box-shadow: 0 6px 20px rgba(43,30,18,.3);
  animation: ff-egg-murmur 2.6s ease both;
}
@keyframes ff-egg-murmur {
  0% { opacity: 0; transform: translate(-50%, -8px) }
  12%, 78% { opacity: 1; transform: translate(-50%, 0) }
  100% { opacity: 0; transform: translate(-50%, -8px) }
}

/* Konami: one pass of low sun across the screen, touching nothing. */
.ff-egg-sunrise {
  position: fixed; inset: 0; z-index: 1390; pointer-events: none;
  background:
    radial-gradient(120% 60% at 50% 108%, rgba(217,154,63,.5), transparent 62%),
    radial-gradient(90% 50% at 50% -8%, rgba(240,196,119,.42), transparent 60%);
  animation: ff-egg-sunrise 1.5s ease-out both;
}
@keyframes ff-egg-sunrise { 0% { opacity: 0 } 25% { opacity: 1 } 100% { opacity: 0 } }

/* The logo is decorative, so taking the long-press callout off it costs
   nothing and stops iOS offering to save a picture of it mid-press. */
header.topbar .brand-mark { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }

@media (prefers-reduced-motion: reduce) {
  .ff-egg, .ff-egg-card, .ff-egg-murmur, .ff-egg-sunrise,
  .ff-egg.is-cracking, .ff-egg.is-cracking .ff-egg-crack, .ff-egg-spark {
    animation: none !important; transition: none !important;
  }
  .ff-egg-spark, .ff-egg-sunrise { display: none; }
  .ff-egg.is-cracking .ff-egg-crack { opacity: 1; }
}
`;

  function injectStyles() {
    if (document.getElementById('ff-egg-style')) return;
    const style = document.createElement('style');
    style.id = 'ff-egg-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---- Artwork ------------------------------------------------------------
     Static markup we author, so innerHTML is safe here and only here. Every
     other string in this file goes in through textContent. */

  const SPRITE_SVG =
    '<svg viewBox="0 0 20 26" aria-hidden="true" focusable="false">' +
      '<path class="ff-egg-shell" d="M10 1C4.5 6.5 1.5 12.5 1.5 16.5a8.5 9.5 0 0 0 17 0C18.5 12.5 15.5 6.5 10 1z"/>' +
      '<circle class="ff-egg-speck" cx="7" cy="13" r="1"/>' +
      '<circle class="ff-egg-speck" cx="12.5" cy="17" r="1.2"/>' +
      '<path class="ff-egg-crack" d="M3 15l3.5-2.5 3 3.5 3.5-3.5 3 2.5" stroke-dasharray="22"/>' +
    '</svg>';

  const CARD_EGG_SVG =
    '<svg viewBox="0 0 74 92" aria-hidden="true" focusable="false">' +
      '<path class="ff-egg-nest" d="M10 76c8 7 46 7 54 0"/>' +
      '<path class="ff-egg-nest" d="M5 70c10 10 54 10 64 0"/>' +
      '<path class="ff-egg-shell" d="M37 6C17 26 8 44 8 54a29 29 0 0 0 58 0C66 44 57 26 37 6z"/>' +
      '<path class="ff-egg-band" d="M14 50c8 5 14-5 23 0s15-5 23 0"/>' +
      '<path class="ff-egg-band" d="M17 62c7 4 12-4 20 0s13-4 20 0"/>' +
      '<ellipse class="ff-egg-glint" cx="27" cy="30" rx="4.5" ry="7" transform="rotate(-22 27 30)"/>' +
    '</svg>';

  /* ---- The card ----------------------------------------------------------- */

  let layer = null;
  let layerTimer = null;
  let returnFocusTo = null;

  function closeCard() {
    if (!layer) return;
    clearTimeout(layerTimer);
    layer.remove();
    layer = null;
    document.removeEventListener('keydown', onCardKey, true);
    // Give focus back to whatever the member was on, if it is still around.
    if (returnFocusTo && returnFocusTo.isConnected && typeof returnFocusTo.focus === 'function') {
      try { returnFocusTo.focus(); } catch { /* element may have gone read-only */ }
    }
    returnFocusTo = null;
  }

  function onCardKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeCard(); }
  }

  /**
   * A small centred card. Dismissed by the button, by Escape, by a click
   * anywhere outside it, and — as a last resort so nothing can ever be stuck
   * behind it — by a timer.
   */
  function showCard(opts) {
    if (layer) closeCard();
    returnFocusTo = document.activeElement;

    layer = document.createElement('div');
    layer.className = 'ff-egg-layer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', opts.title);

    const scrim = document.createElement('div');
    scrim.className = 'ff-egg-scrim';
    scrim.addEventListener('click', closeCard);

    const card = document.createElement('div');
    card.className = 'ff-egg-card';
    card.tabIndex = -1;

    if (opts.art !== false) {
      const art = document.createElement('div');
      art.className = 'ff-egg-art';
      art.innerHTML = CARD_EGG_SVG;
      if (!reduced.matches) {
        // Six shell flecks, thrown outward once and then gone.
        for (let i = 0; i < 6; i++) {
          const spark = document.createElement('span');
          const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          spark.className = 'ff-egg-spark';
          spark.style.left = '35px';
          spark.style.top = '38px';
          spark.style.setProperty('--dx', Math.round(Math.cos(angle) * 54) + 'px');
          spark.style.setProperty('--dy', Math.round(Math.sin(angle) * 54) + 'px');
          spark.style.animationDelay = (i * 55) + 'ms';
          art.appendChild(spark);
        }
      }
      card.appendChild(art);
    }

    const h = document.createElement('h2');
    h.className = 'ff-egg-title';
    h.textContent = opts.title;
    card.appendChild(h);

    const body = document.createElement('p');
    body.className = 'ff-egg-body';
    body.textContent = opts.body;
    card.appendChild(body);

    if (opts.foot) {
      const foot = document.createElement('p');
      foot.className = 'ff-egg-foot';
      foot.textContent = opts.foot;
      card.appendChild(foot);
    }

    const count = document.createElement('p');
    count.className = 'ff-egg-count';
    count.textContent = countLine();
    card.appendChild(count);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ff-egg-close';
    close.textContent = opts.cta || 'Lovely';
    close.addEventListener('click', closeCard);
    card.appendChild(close);

    layer.appendChild(scrim);
    layer.appendChild(card);
    document.body.appendChild(layer);

    document.addEventListener('keydown', onCardKey, true);
    try { close.focus({ preventScroll: true }); } catch { /* older browsers */ }

    layerTimer = setTimeout(closeCard, 15000);
  }

  /** The lighter reply for an egg you have already met. */
  function murmur(text) {
    const el = document.createElement('div');
    el.className = 'ff-egg-murmur';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  /* ---- Egg one: the literal egg -------------------------------------------
     A speck of gold in the bottom-left gutter of the top bar, where nothing
     else lives. Absolutely positioned inside the sticky header, so it costs no
     layout and can never nudge a control. */

  let sprite = null;

  const REPEAT_LINES = [
    'still an egg.',
    'yep. still an egg.',
    'it has not hatched.',
    'an egg, as before.',
    'holding steady at one egg.',
  ];
  let repeatIndex = 0;

  function hatch() {
    if (isFound('literal')) {
      murmur(REPEAT_LINES[repeatIndex % REPEAT_LINES.length]);
      repeatIndex++;
      return;
    }
    markFound('literal');
    showCard({
      title: 'wow, a literal egg!',
      body: 'You found the literal egg. It has been sitting in the corner of the top bar this whole time, being an egg.',
      foot: 'It does not do anything. That is rather the point of it.',
      cta: 'Wonderful',
    });
  }

  function onSpriteClick() {
    if (!sprite) return;
    if (reduced.matches || isFound('literal')) { hatch(); return; }
    // Let the shell crack before the card lands on top of it.
    sprite.classList.remove('is-cracking');
    void sprite.offsetWidth;
    sprite.classList.add('is-cracking');
    setTimeout(() => {
      if (sprite) sprite.classList.remove('is-cracking');
      hatch();
    }, 420);
  }

  function syncSprite() {
    if (!sprite) return;
    sprite.classList.toggle('is-found', isFound('literal'));
    sprite.classList.toggle('is-complete', found().length >= EGG_IDS.length);
  }

  function mountSprite() {
    if (sprite && sprite.isConnected) return;
    const header = document.querySelector('header.topbar');
    if (!header) { sprite = null; return; }
    sprite = document.createElement('button');
    sprite.type = 'button';
    sprite.className = 'ff-egg';
    // Honest to a screen reader, and reachable by keyboard. It is appended last
    // so it lands at the end of the header's tab order rather than in front of
    // the buttons that actually do something.
    sprite.setAttribute('aria-label', 'A small egg');
    sprite.innerHTML = SPRITE_SVG;
    sprite.addEventListener('click', onSpriteClick);
    header.appendChild(sprite);
    syncSprite();
  }

  /* ---- Egg two: the Konami code -------------------------------------------
     Never calls preventDefault, so arrows keep scrolling the page and nothing
     downstream loses a keystroke. Stands down inside any text field. */

  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
                  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiAt = 0;

  function isTyping(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function onKeydown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) { konamiAt = 0; return; }
    if (isTyping(e.target)) { konamiAt = 0; return; }
    const key = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === KONAMI[konamiAt]) {
      konamiAt++;
      if (konamiAt < KONAMI.length) return;
      konamiAt = 0;
      if (appIsBusy()) return;
      const isNew = markFound('konami');
      if (!reduced.matches) {
        const sun = document.createElement('div');
        sun.className = 'ff-egg-sunrise';
        document.body.appendChild(sun);
        setTimeout(() => sun.remove(), 1600);
      }
      if (!isNew) { murmur('up, up, down, down — still works.'); return; }
      setTimeout(() => showCard({
        title: 'the old code still works',
        body: 'Up, up, down, down, left, right, left, right, B, A. Thirty-odd years on and it still opens something.',
        foot: 'No extra lives. We do not keep lives here, or streaks, or anything else you could lose.',
        cta: 'Ha',
      }), reduced.matches ? 0 : 380);
      return;
    }
    // A miss might itself be the first key of a fresh attempt.
    konamiAt = key === KONAMI[0] ? 1 : 0;
  }

  /* ---- Egg three: hold the logo -------------------------------------------
     A deliberate press-and-hold on the mark, cancelled by any drag, so a member
     scrolling from the top of the screen never triggers it. */

  const HOLD_MS = 800;
  const HOLD_SLOP_PX = 10;

  // Our own words, and said so. We never put a sentence in Scripture's mouth,
  // so a note from us is labelled a note from us.
  const NOTES = [
    'Rest counts. It always counted.',
    'You showed up. That is most of the trick.',
    'Slow miles are still miles.',
    'Nothing in here is keeping score against you.',
    'Go drink some water. That is the entire message.',
  ];

  let holdTimer = null;
  let holdFrom = null;

  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    holdFrom = null;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.isPrimary === false) return;
    if (!e.target.closest || !e.target.closest('header.topbar .brand-mark')) return;
    cancelHold();
    holdFrom = { x: e.clientX, y: e.clientY };
    holdTimer = setTimeout(() => {
      cancelHold();
      if (appIsBusy()) return;
      const isNew = markFound('note');
      const note = NOTES[Math.floor(Math.random() * NOTES.length)];
      if (!isNew) { murmur(note); return; }
      showCard({
        art: false,
        title: 'a note from the people who made this',
        body: note,
        foot: 'Our words, not Scripture — we do not put sentences in that book’s mouth. Hold the mark again any time.',
        cta: 'Thanks',
      });
    }, HOLD_MS);
  }

  function onPointerMove(e) {
    if (!holdFrom) return;
    if (Math.abs(e.clientX - holdFrom.x) > HOLD_SLOP_PX ||
        Math.abs(e.clientY - holdFrom.y) > HOLD_SLOP_PX) cancelHold();
  }

  /* ---- Egg four: the console ---------------------------------------------- */

  function eggsSummary() {
    const isNew = markFound('console');
    const lines = [
      countLine(),
      'literal egg  ' + (isFound('literal') ? 'found' : 'not yet'),
      'konami code  ' + (isFound('konami') ? 'found' : 'not yet'),
      'a held mark  ' + (isFound('note') ? 'found' : 'not yet'),
      'this console ' + (isFound('console') ? 'found' : 'not yet'),
    ];
    if (isNew) lines.push('', 'and that is four ways in. try functioningFaith.hatch() if you are impatient.');
    return lines.join('\n');
  }

  function greetConsole() {
    // Invisible unless someone opens devtools, which makes it the politest egg
    // in the file: it can never interrupt anybody.
    try {
      console.log(
        '%c●%c  Functioning Faith\n' +
        '%cYou opened the console, which is basically an easter egg by itself.\n' +
        'There are four hidden in the app. functioningFaith.eggs() shows how you are doing.',
        'font-size:15px;color:#d9ab55',
        'font-weight:700;color:#b08d46',
        'color:#8d7a5f'
      );
    } catch { /* some embedded webviews have no console */ }

    if (window.functioningFaith) return;
    try {
      window.functioningFaith = {
        eggs: function () { return eggsSummary(); },
        hatch: function () { markFound('console'); hatch(); return 'go on then.'; },
      };
    } catch { /* a frozen window is fine; the eggs above still work */ }
  }

  /* ---- Boot ---------------------------------------------------------------
     One MutationObserver, deliberately shallow: header.topbar is a direct child
     of #app, so childList without subtree catches it being replaced while
     costing nothing for the constant re-renders inside #main. */

  function boot() {
    injectStyles();
    mountSprite();
    greetConsole();

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', cancelHold, true);
    document.addEventListener('pointercancel', cancelHold, true);
    window.addEventListener('blur', cancelHold);
    window.addEventListener('scroll', cancelHold, { passive: true });

    const app = document.getElementById('app');
    if (app && window.MutationObserver) {
      const observer = new MutationObserver(() => {
        if (!sprite || !sprite.isConnected) mountSprite();
      });
      observer.observe(app, { childList: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
