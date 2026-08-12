/**
 * The app-open intro: two clips layered together, plus the original chime
 * from intro-sound.js. Shown once per browser session, not on every SPA
 * navigation and not on every reopen -- an intro that repeats forever stops
 * being an intro and becomes friction.
 *
 * "Overlay" is done live in the browser with CSS mix-blend-mode across two
 * stacked <video> elements, not pre-muxed into one file server-side. There is
 * no ffmpeg or any other video-encoding tool available to author this with,
 * and a live layered composite is strictly more controllable anyway: no
 * re-encode quality loss, and it degrades gracefully (see below) instead of
 * failing as an opaque broken file.
 *
 * Degradation, in order:
 *   - prefers-reduced-motion: skip entirely, straight to the app.
 *   - A video fails to load: show whichever one did load; if neither did,
 *     skip to the app rather than sit on a black screen.
 *   - No AudioContext / sound off / no prior user gesture: the visual intro
 *     still plays, silently. Autoplay-with-sound on cold open is not
 *     something a browser will ever allow anyway -- this is not a bug to
 *     chase, it's the platform rule intro-sound.js already documents.
 *   - Always skippable with a single tap, and auto-dismisses on its own.
 */
'use strict';

(function () {
  // #app starts CSS-hidden (see index.html's inline <style>) so there is no
  // flash of the homepage before this script's overlay covers it -- app.js
  // is not deferred and paints #app almost immediately, well before this
  // deferred script runs. Every exit path from this file, including both
  // early returns below, must reveal #app itself; nothing else will.
  function reveal() {
    var a = document.getElementById('app');
    if (a) a.style.visibility = 'visible';
  }

  if (sessionStorage.getItem('ff-intro-shown')) { reveal(); return; }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sessionStorage.setItem('ff-intro-shown', '1');
    reveal();
    return;
  }

  var VERSION = 'v1'; // bump this if intro.mp4/intro-b.mp4 are ever replaced -- see server.js's
                       // immutable-cache rule, which only busts on a changed ?v= query string.
  var MAX_MS = 5000; // both clips loop to fill this, so nothing freeze-frames on its last frame

  function boot() {
    sessionStorage.setItem('ff-intro-shown', '1');

    var overlay = document.createElement('div');
    overlay.id = 'ff-intro';
    overlay.setAttribute('role', 'presentation');
    // A flat opacity cut reads as a jump the moment it starts, not a
    // dissolve. Easing the fade with a slight scale-up and blur alongside it
    // -- both driven by the same transition -- makes the overlay recede
    // rather than just vanish, which is what a "smooth" handoff actually
    // means here. #app underneath has been fully laid out (visibility, not
    // display:none) for the whole 5s the overlay was up, so nothing under it
    // pops or reflows when it's finally revealed -- the only thing moving is
    // this overlay dissolving away from it.
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999', 'background:#2b1e14',
      'display:flex', 'align-items:center', 'justify-content:center',
      'overflow:hidden', 'opacity:1', 'transform:scale(1)', 'filter:blur(0px)',
      'transition:opacity .6s cubic-bezier(.22,.61,.36,1),' +
        'transform .6s cubic-bezier(.22,.61,.36,1),filter .6s ease',
    ].join(';');

    var stage = document.createElement('div');
    stage.style.cssText = 'position:relative;width:100%;height:100%;max-width:560px;margin:0 auto';

    function makeVideo(src, extraStyle) {
      var v = document.createElement('video');
      // ?v=... makes this request match server.js's immutable long-cache rule
      // AND public/sw.js's existing "any versioned same-origin request gets
      // cached" runtime path -- both already exist for app.js/styles.css, so
      // this is reusing infrastructure, not building new caching logic. First
      // play fetches over the network; every play after that, in this browser
      // or the native WebView, is instant from disk/cache-storage.
      v.src = src + '?v=' + VERSION;
      v.muted = true; v.playsInline = true; v.autoplay = true; v.loop = true; v.preload = 'auto';
      v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;' + (extraStyle || '');
      return v;
    }

    // Two clips, blended everywhere (no hard seam) but weighted opposite
    // ways: the logo reveal (intro.mp4) dominant in the top half, the
    // trail-running clip (intro-b.mp4) dominant in the bottom half, with a
    // soft cross-fade band through the middle rather than a split screen.
    var LOGO_MASK = 'linear-gradient(to bottom, black 0%, black 42%, transparent 78%)';
    var VIDEO_MASK = 'linear-gradient(to bottom, transparent 22%, black 58%, black 100%)';

    var base = makeVideo('/intro.mp4', 'mask-image:' + LOGO_MASK + ';-webkit-mask-image:' + LOGO_MASK);
    var wash = makeVideo('/intro-b.mp4', [
      'mix-blend-mode:screen', 'opacity:0.9',
      'mask-image:' + VIDEO_MASK, '-webkit-mask-image:' + VIDEO_MASK,
    ].join(';'));
    stage.appendChild(base);
    stage.appendChild(wash);

    var skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Skip';
    skip.setAttribute('aria-label', 'Skip intro');
    skip.style.cssText = [
      'position:absolute', 'bottom:max(24px,env(safe-area-inset-bottom))', 'right:20px',
      'background:rgba(246,239,223,0.16)', 'color:#f6efdf', 'border:1px solid rgba(246,239,223,0.4)',
      'border-radius:999px', 'padding:8px 18px', 'font-size:14px', 'font-family:inherit',
      'cursor:pointer', 'backdrop-filter:blur(4px)',
    ].join(';');
    stage.appendChild(skip);
    overlay.appendChild(stage);
    document.body.appendChild(overlay);

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      reveal(); // the site stays hidden underneath until skip or natural end -- now
      overlay.style.opacity = '0';
      overlay.style.transform = 'scale(1.04)';
      overlay.style.filter = 'blur(6px)';
      setTimeout(function () { overlay.remove(); }, 620);
    }

    // Neither clip loading is not a failure state worth blocking on -- get
    // the member into the real app rather than stall on a black rectangle.
    var loadFailures = 0;
    function onError() {
      loadFailures++;
      if (loadFailures >= 2) dismiss();
    }
    base.addEventListener('error', onError);
    wash.addEventListener('error', onError);

    skip.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onKey); }
    });
    skip.focus(); // keyboard users land on Skip immediately -- no tabbing through a hidden app first

    try { Promise.all([base.play(), wash.play()]).catch(function () {}); } catch (e) { /* ignore */ }

    // Attempt the chime on the same gesture path as skip/tap -- and once
    // immediately, in case this load itself followed a gesture (e.g. a tap
    // on an install/open prompt). Silent failure is correct, not a bug.
    try { window.FFIntroSound && window.FFIntroSound.play(); } catch (e) { /* ignore */ }
    overlay.addEventListener('click', function () {
      try { window.FFIntroSound && window.FFIntroSound.play(); } catch (e) { /* ignore */ }
    }, { once: true });

    setTimeout(dismiss, MAX_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
