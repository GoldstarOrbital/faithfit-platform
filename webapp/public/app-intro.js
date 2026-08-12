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
  if (sessionStorage.getItem('ff-intro-shown')) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sessionStorage.setItem('ff-intro-shown', '1');
    return;
  }

  var MAX_MS = 3200; // caps to the shorter clip's real length; never waits on the longer one

  function boot() {
    sessionStorage.setItem('ff-intro-shown', '1');

    var overlay = document.createElement('div');
    overlay.id = 'ff-intro';
    overlay.setAttribute('role', 'presentation');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999', 'background:#2b1e14',
      'display:flex', 'align-items:center', 'justify-content:center',
      'overflow:hidden', 'opacity:1', 'transition:opacity .5s ease',
    ].join(';');

    var stage = document.createElement('div');
    stage.style.cssText = 'position:relative;width:100%;height:100%;max-width:560px;margin:0 auto';

    function makeVideo(src, extraStyle) {
      var v = document.createElement('video');
      v.src = src; v.muted = true; v.playsInline = true; v.autoplay = true; v.loop = false;
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
      overlay.style.opacity = '0';
      setTimeout(function () { overlay.remove(); }, 520);
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
