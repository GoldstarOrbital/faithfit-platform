/**
 * The app-open intro, v2 -- Instagram/TikTok-style: quick, the mark and the
 * name, then gone. Nothing else.
 *
 * This replaces the earlier two-video-blend intro entirely. That version
 * looked good but violated the one requirement that actually matters for an
 * app-open moment: it depended on fetching two video files before it could
 * show anything definite, and even cached, a <video> has decode latency a
 * CSS animation does not. This version has ZERO network dependency -- the
 * mark below is the same geometry as public/icon.svg, inlined directly in
 * this file, so there is nothing to fetch, decode, or wait on. It can start
 * animating the instant this script runs.
 *
 * Total on-screen time is ~900ms. That is deliberate: Instagram, TikTok, and
 * Facebook's own splash moments are all under a second -- a "doorway," not a
 * scene. The previous version's job (something slower and more atmospheric)
 * is done elsewhere now (the ambient chime, the pause moment); this file's
 * only job is: name, mark, gone, smoothly.
 *
 * Same contract as before: shown once per session, skips entirely on
 * prefers-reduced-motion, and #app (hidden via CSS in index.html's <head>)
 * is revealed the instant this either completes or bails out -- never later
 * than that, and never dependent on a network request succeeding.
 *
 * Audio: alongside the existing ambient chime attempt, a real, licensed
 * violin recording now plays too -- "Violin open string" by Clngre, CC
 * BY-SA 3.0 / GFDL, Wikimedia Commons (full attribution in
 * ATTRIBUTIONS.md). Only ~0.7s of it, trimmed at playback time via
 * AudioBufferSourceNode's native start(when, offset, duration) rather than
 * a separately-edited file. Same best-effort contract as the chime: never
 * blocks or delays the visual, silent if autoplay is refused.
 */
'use strict';

(function () {
  function reveal() {
    var a = document.getElementById('app');
    if (a) a.style.visibility = 'visible';
  }

  if (sessionStorage.getItem('ff-intro-shown')) { reveal(); return; }
  sessionStorage.setItem('ff-intro-shown', '1');

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reveal();
    return;
  }

  var TOTAL_MS = 900;

  function boot() {
    var overlay = document.createElement('div');
    overlay.id = 'ff-intro';
    overlay.setAttribute('role', 'presentation');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999', 'background:#f6efdf',
      'display:flex', 'align-items:center', 'justify-content:center', 'flex-direction:column', 'gap:14px',
      'opacity:1', 'transition:opacity .32s ease',
    ].join(';');

    // Same geometry as public/icon.svg, inlined -- nothing to fetch.
    overlay.innerHTML =
      '<svg width="88" height="88" viewBox="0 0 512 512" style="transform:scale(0.7);opacity:0;' +
        'animation:ff-mark-in .5s cubic-bezier(.22,.9,.32,1.24) .05s forwards">' +
        '<rect width="512" height="512" rx="112" fill="#f6efdf"/>' +
        '<circle cx="256" cy="256" r="176" fill="none" stroke="#2b1e14" stroke-width="36" stroke-dasharray="496 613" transform="rotate(96 256 256)"/>' +
        '<circle cx="256" cy="256" r="176" fill="none" stroke="#d9ab55" stroke-width="36" stroke-dasharray="496 613" transform="rotate(-84 256 256)"/>' +
        '<path d="M316 126v264M240 218h152" stroke="#d9ab55" stroke-width="36"/>' +
        '<path d="M296 96h-22c-30 0-54 24-54 54v226M128 218h132" fill="none" stroke="#2b1e14" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>' +
      '<div style="font-family:\'Cinzel\',serif;font-weight:700;letter-spacing:0.02em;font-size:1.05rem;color:#2b1e14;' +
        'opacity:0;transform:translateY(6px);animation:ff-name-in .45s ease .22s forwards">Functioning Faith</div>' +
      '<style>@keyframes ff-mark-in{to{transform:scale(1);opacity:1}}' +
             '@keyframes ff-name-in{to{transform:translateY(0);opacity:1}}</style>';

    document.body.appendChild(overlay);

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      reveal();
      overlay.style.opacity = '0';
      setTimeout(function () { overlay.remove(); }, 340);
    }

    overlay.addEventListener('click', dismiss);
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onKey); }
    });

    // One attempt at the chime, on the same terms it always had: silent
    // unless a real gesture already unlocked it. Fire-and-forget -- it must
    // never be why anything here waits.
    try { window.FFIntroSound && window.FFIntroSound.play(); } catch (e) { /* ignore */ }
    playViolinSnippet();

    setTimeout(dismiss, TOTAL_MS);
  }

  // A real, licensed recording -- not a synthesized tone -- for this quick
  // moment specifically. "Violin open string" by Clngre, CC BY-SA 3.0 /
  // GFDL, from Wikimedia Commons (full attribution in ATTRIBUTIONS.md and
  // the file header there). Only its first ~0.7s plays, via
  // AudioBufferSourceNode's native start(when, offset, duration) -- no
  // separate trimmed file, the browser does the trim. Same best-effort
  // contract as the chime above: silent if autoplay is refused, never
  // blocks or delays the visual, which is already scheduled independently.
  function playViolinSnippet() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var finished = false;
      var finish = function () {
        if (finished) return;
        finished = true;
        try { var p = ctx.close(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* already closing */ }
      };
      fetch('/violin-open-string.ogg?v=v1')
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) { return ctx.decodeAudioData(buf); })
        .then(function (audioBuffer) {
          var src = ctx.createBufferSource();
          src.buffer = audioBuffer;
          var gain = ctx.createGain();
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.04);
          gain.gain.setValueAtTime(0.4, ctx.currentTime + 0.55);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
          src.connect(gain); gain.connect(ctx.destination);
          src.start(0, 0, 0.7);
          src.onended = finish;
          setTimeout(finish, 1000);
        })
        .catch(finish);
    } catch (e) { /* best-effort */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
