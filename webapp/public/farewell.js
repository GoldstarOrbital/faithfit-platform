/**
 * A soft spoken "Amen" when someone leaves the app.
 *
 * Spoken with the browser's own text-to-speech (SpeechSynthesisUtterance) --
 * no recorded voice actor, no audio file, nothing to license. Same reasoning
 * as intro-sound.js's synthesized chime: a real effect with zero copyright
 * exposure. Respects the same mute preference that chime already reads
 * (localStorage 'ff-intro-sound' === 'off'), so muting sound once mutes both,
 * rather than asking someone to find and disable two separate switches.
 *
 * "Leave" is detected two ways, deliberately not one:
 *   - `visibilitychange` -> document.hidden: fires on every platform --
 *     switching tabs, backgrounding a mobile browser, or the WebView going
 *     background inside the Capacitor wrapper.
 *   - Capacitor's App plugin 'pause' event, when running natively: the more
 *     precise native signal, listened for in addition to (not instead of)
 *     visibilitychange, with a guard so a leave is only spoken once even if
 *     both fire for the same event.
 *
 * This is inherently best-effort. A tab closed outright, or an app force-
 * quit, may cut off before the utterance finishes or before it starts at
 * all -- there is no reliable way to guarantee audio plays past the moment
 * a page is torn down, on any platform. That's an accepted limitation, not
 * a bug to chase.
 *
 * WHY A "PRIME ON FIRST GESTURE" STEP EXISTS BELOW: verified directly in a
 * fresh browser session that speechSynthesis.speak() is silently dropped --
 * no error, nothing spoken -- when navigator.userActivation.hasBeenActive is
 * still false, which it is until any real tap/click/key happens anywhere on
 * the page. A leave triggered by switching tabs seconds after opening the
 * app, before ever touching anything in it, hits exactly that state. So the
 * very first genuine gesture anywhere in the app fires one silent (volume 0)
 * speak()+cancel() to register activation with the engine; the real "Amen"
 * on actually leaving then has a real chance of being heard instead of
 * being dropped by the same policy that blocks autoplaying audio.
 */
'use strict';

(function () {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') return;

  function muted() {
    try { return localStorage.getItem('ff-intro-sound') === 'off'; } catch (e) { return false; }
  }

  var primed = false;
  function primeOnce() {
    if (primed) return;
    primed = true;
    try {
      var warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0;
      speechSynthesis.speak(warm);
      speechSynthesis.cancel();
    } catch (e) { /* best-effort */ }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (name) {
    document.addEventListener(name, primeOnce, { passive: true, once: true });
  });

  var spokenForThisLeave = false;

  // Picks the most natural-sounding voice actually available, rather than
  // whatever the browser defaults to (frequently the flattest, most robotic
  // option in the list). Ranked by real naming signals from the platforms
  // that ship these: "Natural"/"Neural"/"Enhanced" mark newer neural voices
  // on Edge, Chrome, Windows, and Apple platforms; their labels vary by OS.
  // voices on macOS/iOS carry the same distinction. Falls back to any local
  // (non-network) voice over a remote one -- local voices are consistently
  // better-sounding defaults across browsers -- and only then to whatever is
  // first in the list.
  function bestVoice() {
    var voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
    if (!voices.length) return null;
    var english = voices.filter(function (v) { return /^en/i.test(v.lang || ''); });
    var pool = english.length ? english : voices;
    function score(v) {
      var name = v.name || '';
      if (/natural|neural/i.test(name)) return 3;
      if (/enhanced/i.test(name)) return 2;
      if (v.localService) return 1;
      return 0;
    }
    return pool.slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }

  function speakAmen() {
    if (muted() || spokenForThisLeave) return;
    spokenForThisLeave = true;
    try {
      speechSynthesis.cancel(); // don't stack behind anything already queued
      var u = new SpeechSynthesisUtterance('Amen.');
      u.rate = 0.82;
      u.pitch = 0.85;
      u.volume = 0.6;
      var voice = bestVoice();
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    } catch (e) { /* best-effort; never fatal */ }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) speakAmen();
    else spokenForThisLeave = false; // back in the app -- the next leave should speak again
  });

  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    var AppPlugin = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (AppPlugin && AppPlugin.addListener) {
      AppPlugin.addListener('pause', speakAmen);
      AppPlugin.addListener('resume', function () { spokenForThisLeave = false; });
    }
  }
})();
