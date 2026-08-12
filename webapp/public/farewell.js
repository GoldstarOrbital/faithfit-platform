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
 */
'use strict';

(function () {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') return;

  function muted() {
    try { return localStorage.getItem('ff-intro-sound') === 'off'; } catch (e) { return false; }
  }

  var spokenForThisLeave = false;

  function speakAmen() {
    if (muted() || spokenForThisLeave) return;
    spokenForThisLeave = true;
    try {
      speechSynthesis.cancel(); // don't stack behind anything already queued
      var u = new SpeechSynthesisUtterance('Amen.');
      u.rate = 0.82;
      u.pitch = 0.85;
      u.volume = 0.6;
      var voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
      var calm = voices.find(function (v) { return /calm|soft|whisper/i.test(v.name); });
      if (calm) u.voice = calm;
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
