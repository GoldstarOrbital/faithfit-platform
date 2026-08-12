// Functioning Faith — the opening motif.
//
// A short pastoral phrase that plays ONCE, the first time someone opens the
// app, as a doorway rather than a jingle. Everything about it is synthesized
// here at runtime with the Web Audio API: there is no audio file, no network
// request, and nothing borrowed. The tune below is an original nine-note phrase
// written for this file.
//
// Three rules govern this whole file, and they outrank the music:
//
//   1. Never make noise the user did not invite. It plays once in a lifetime,
//      never on a schedule, and a single tap turns it off forever. If we cannot
//      persist that "off" — private mode with localStorage blocked — we do not
//      play at all, because a sound you cannot permanently silence is a trap.
//   2. Never fight the browser. Autoplay policy blocks audio until the page has
//      had a real user gesture. We create the AudioContext inside that gesture,
//      and if it is still refused we go quiet and say nothing. No console noise,
//      no thrown errors, no retry storm.
//   3. Never delay the app. Nothing here runs on the critical path; the script
//      registers a couple of listeners and gets out of the way.
//
// prefers-reduced-motion: reduce is treated as "this person wants the interface
// to stop performing at them", which covers an unrequested tune as well as an
// unrequested animation.
(function () {
  'use strict';

  if (window.FFIntroSound) return;   // never double-install

  // --- Preference ------------------------------------------------------------
  // Mirrors the reel-sound pattern in app.js (`ff-reels-sound`): one key, read
  // and written through try/catch so a locked-down storage jar cannot throw.
  //
  //   ''      never heard it — the one-time welcome is still owed
  //   'heard' it has played its one time; it will not play again on its own
  //   'on'    the user explicitly asked to hear it every visit
  //   'off'   the user explicitly turned it off; permanent
  const PREF_KEY = 'ff-intro-sound';

  function pref() {
    try { return localStorage.getItem(PREF_KEY) || ''; } catch { return ''; }
  }
  function setPref(value) {
    try { localStorage.setItem(PREF_KEY, value); } catch { /* private mode */ }
  }
  // A preference we cannot write is a preference we cannot honour. Probe once
  // rather than discovering it at the moment the user asks us to stop.
  function storageWorks() {
    try {
      localStorage.setItem(PREF_KEY + '.probe', '1');
      localStorage.removeItem(PREF_KEY + '.probe');
      return true;
    } catch { return false; }
  }
  function wantsQuiet() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  }

  // --- The motif -------------------------------------------------------------
  // Second pass. The first version was a perky, evenly-spaced flute tune over a
  // rhythmic plucked arpeggio — pleasant, but it reads as a jingle: a clear
  // beginning-middle-end melody with a "high point" and a bouncy backing line.
  // That is the wrong register entirely for a doorway into a quiet app.
  //
  // What actually reads as "a scene out of Middle-earth" — Rivendell, not a
  // marching song — is mostly SPACE: a long, slow-swelling drone/pad under
  // almost nothing, three or four widely-spaced tones rather than a tune, and
  // real reverb depth. Still D Dorian (the raised sixth is still what makes it
  // read as old-world rather than merely minor), but the melodic line is now
  // static and unhurried instead of a run.
  const D3 = 146.83, A3 = 220.00, B3 = 246.94,
        D4 = 293.66, F4 = 349.23, A4 = 440.00, B4 = 493.88,
        D5 = 587.33;

  // The flute line: [frequency, start, sounding length]. Four long, widely
  // spaced tones over eight seconds — this is a held breath, not a run.
  const FLUTE = [
    [A4, 0.00, 1.60],   // enter from nothing, and stay
    [D5, 2.20, 2.00],   // a fifth up — the only real "movement" in the piece
    [B4, 4.60, 1.80],   // the raised sixth, sitting a long time
    [A4, 6.60, 1.90],   // settles back down, and is gone
  ];

  // The plucked line is now three isolated low tones, seconds apart — felt as
  // punctuation under the drone, not a rhythm section.
  const PLUCK = [
    [D3, 0.40], [F4, 3.40], [A3, 6.20],
  ];

  const DRONE = [D3, A3];      // an open fifth — felt more than heard
  const DRONE_UNTIL = 7.80;    // the drone outlives the melody, then fades
  const PIECE_END = 8.60;      // master fade completes here
  const FADE_FROM = 7.60;

  // Peak master level, a touch lower than before: this is meant to sit at the
  // edge of hearing, not announce itself. The voices below top out around 0.4
  // combined, so this lands nearer -18 dBFS.
  const MASTER_LEVEL = 0.26;

  // --- Synthesis -------------------------------------------------------------
  // Every envelope starts and ends at 0.0001 rather than 0, because
  // exponentialRampToValueAtTime cannot touch zero and a hard cut to zero is
  // exactly what a click sounds like.

  function noiseBuffer(ctx, seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // A synthesized impulse response — decaying noise. Not a real room, but it
  // gives the tones an "outdoors" tail, which is most of what separates a warm
  // synth flute from a test tone.
  function impulseResponse(ctx, seconds, decay) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /**
   * One wooden-flute note.
   *
   * A sine fundamental with a quiet octave above it for body, a breath of
   * bandpassed noise at the attack, and a vibrato that only arrives once the
   * note has settled — which is what a player actually does. Vibrato present
   * from the first millisecond is the single biggest tell of a synth flute.
   */
  function flute(ctx, dest, air, freq, at, dur) {
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(6000, freq * 6);
    lp.Q.value = 0.6;
    gain.connect(lp);
    lp.connect(dest);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);

    const partial = ctx.createOscillator();
    partial.type = 'sine';
    partial.frequency.value = freq * 2;
    const partialGain = ctx.createGain();
    partialGain.gain.value = 0.10;
    partial.connect(partialGain);
    partialGain.connect(gain);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.8;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(0.0001, at);
    lfoDepth.gain.linearRampToValueAtTime(freq * 0.004, at + Math.min(0.35, dur * 0.7));
    lfo.connect(lfoDepth);
    lfoDepth.connect(osc.frequency);

    const attack = Math.min(0.09, dur * 0.35);
    const release = 0.22;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.24, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.17, at + dur * 0.85);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur + release);

    const stopAt = at + dur + release + 0.05;
    osc.start(at); osc.stop(stopAt);
    partial.start(at); partial.stop(stopAt);
    lfo.start(at); lfo.stop(stopAt);

    // The chiff of air at the very front of the note.
    if (air) {
      const breath = ctx.createBufferSource();
      breath.buffer = air;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * 2.4;
      bp.Q.value = 1.2;
      const breathGain = ctx.createGain();
      breathGain.gain.setValueAtTime(0.0001, at);
      breathGain.gain.exponentialRampToValueAtTime(0.030, at + 0.02);
      breathGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      breath.connect(bp); bp.connect(breathGain); breathGain.connect(lp);
      breath.start(at); breath.stop(at + 0.20);
    }
  }

  /**
   * One plucked string.
   *
   * Not a physical string model — a triangle for the body, a saw an octave up
   * and a hair sharp for shimmer, and a lowpass swept downward over the first
   * half-second. A pluck lives almost entirely in how fast its brightness dies,
   * so the filter sweep matters more than the waveform choice.
   */
  function pluck(ctx, dest, freq, at) {
    const dur = 1.05;
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(Math.min(7200, freq * 9), at);
    lp.frequency.exponentialRampToValueAtTime(Math.max(240, freq * 2), at + 0.45);
    gain.connect(lp);
    lp.connect(dest);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = freq;
    body.connect(gain);

    const edge = ctx.createOscillator();
    edge.type = 'sawtooth';
    edge.frequency.value = freq * 2.002;
    const edgeGain = ctx.createGain();
    edgeGain.gain.value = 0.16;
    edge.connect(edgeGain);
    edgeGain.connect(gain);

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    body.start(at); body.stop(at + dur + 0.05);
    edge.start(at); edge.stop(at + dur + 0.05);
  }

  /** One drone tone: swells in slowly, holds, and is gone before the melody. */
  function drone(ctx, dest, freq, at, until) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.055, at + 0.9);
    gain.gain.setValueAtTime(0.055, until - 1.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, until);

    osc.connect(gain); gain.connect(lp); lp.connect(dest);
    osc.start(at); osc.stop(until + 0.05);
  }

  // --- Transport -------------------------------------------------------------
  let ctx = null;          // created lazily, inside a gesture, closed when done
  let master = null;       // the one gain everything passes through
  let closeTimer = null;
  let playing = false;

  function audioContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { ctx = null; }
    return ctx;
  }

  function teardown() {
    playing = false;
    master = null;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    const dying = ctx;
    ctx = null;
    if (dying && dying.state !== 'closed') {
      try { const p = dying.close(); if (p && p.catch) p.catch(() => {}); } catch { /* already gone */ }
    }
  }

  function schedule(audio) {
    const t0 = audio.currentTime + 0.08;   // a little headroom to build the graph

    master = audio.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.linearRampToValueAtTime(MASTER_LEVEL, t0 + 0.06);
    master.gain.setValueAtTime(MASTER_LEVEL, t0 + FADE_FROM);
    master.gain.linearRampToValueAtTime(0, t0 + PIECE_END);

    const dry = audio.createGain();
    dry.gain.value = 0.62; // more of the signal now comes through the hall, not direct
    master.connect(dry);
    dry.connect(audio.destination);

    // Reverb is a nicety. If ConvolverNode is missing or the buffer will not
    // build, the dry path alone still sounds fine. A longer, slower-decaying
    // tail than before -- this piece is meant to sound like it is happening
    // somewhere spacious, not close to the microphone.
    try {
      const verb = audio.createConvolver();
      verb.buffer = impulseResponse(audio, 3.2, 3.4);
      const wet = audio.createGain();
      wet.gain.value = 0.46;
      master.connect(verb);
      verb.connect(wet);
      wet.connect(audio.destination);
    } catch { /* dry only */ }

    let air = null;
    try { air = noiseBuffer(audio, 0.30); } catch { air = null; }

    for (const [freq, start, dur] of FLUTE) flute(audio, master, air, freq, t0 + start, dur);
    for (const [freq, start] of PLUCK) pluck(audio, master, freq, t0 + start);
    for (const freq of DRONE) drone(audio, master, freq, t0, t0 + DRONE_UNTIL);

    playing = true;
    closeTimer = setTimeout(teardown, (PIECE_END + 0.4) * 1000);
  }

  /**
   * Play the motif. Resolves true only if sound actually started.
   *
   * Must be called from inside a user gesture the first time: an AudioContext
   * created outside one starts suspended, and resume() will not lift it. Both
   * outcomes are silent — a refusal here is the browser doing its job, not an
   * error worth reporting.
   */
  function play() {
    if (playing) return Promise.resolve(false);
    const audio = audioContext();
    if (!audio) return Promise.resolve(false);
    let resumed;
    try {
      resumed = audio.state === 'running' ? Promise.resolve() : audio.resume();
    } catch { return Promise.resolve(false); }
    return Promise.resolve(resumed).then(() => {
      if (!ctx || audio.state !== 'running') return false;
      schedule(audio);
      return true;
    }).catch(() => false);
  }

  /** Fade out and release the audio device — used by "turn it off" and on hide. */
  function stop() {
    if (!ctx || !master) { teardown(); return; }
    const audio = ctx;
    try {
      const now = audio.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value || 0.0001, now);
      master.gain.linearRampToValueAtTime(0, now + 0.25);
    } catch { /* the graph is already unwinding */ }
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(teardown, 400);
  }

  // --- The off switch --------------------------------------------------------
  // The tune is only defensible if the way out of it is as loud as the tune. It
  // shows up once, with the sound, and it says plainly what just happened and
  // how to stop it happening again.
  const NOTE_CSS = `
.ff-intro-note {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(86px + env(safe-area-inset-bottom));
  width: calc(100% - 28px); max-width: 420px; z-index: 210;
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px 12px; border-radius: var(--radius-sm, 14px);
  background: var(--parch-2, #fdf8ea); color: var(--ink, #33251a);
  border: 1px solid var(--hairline, rgba(74,58,40,0.22));
  box-shadow: 0 10px 28px rgba(43,30,18,0.24);
  font-family: var(--ui, 'Inter', system-ui, sans-serif); font-size: 0.78rem;
  opacity: 0; transform: translate(-50%, 8px);
  transition: opacity .28s ease, transform .28s ease;
}
.ff-intro-note.shown { opacity: 1; transform: translate(-50%, 0); }
.ff-intro-note-mark { color: var(--hearth, #d99a3f); font-size: 1rem; line-height: 1.4; }
.ff-intro-note-copy { flex: 1; min-width: 0; }
.ff-intro-note-copy b { display: block; font-weight: 600; }
.ff-intro-note-copy span { display: block; color: var(--muted, #8d7a5f); font-size: 0.72rem; margin-top: 1px; }
.ff-intro-note-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ff-intro-note-acts button {
  font: inherit; font-size: 0.72rem; font-weight: 600; cursor: pointer;
  padding: 6px 11px; border-radius: var(--radius-round, 999px);
  border: 1px solid var(--hairline, rgba(74,58,40,0.22));
  background: transparent; color: var(--ink-soft, #61503c);
}
.ff-intro-note-acts button[data-intro-act="off"] { border-color: var(--brass, #b08d46); color: var(--walnut-0, #3a2a1a); }
.ff-intro-note-x {
  align-self: flex-start; background: none; border: none; cursor: pointer;
  color: var(--muted, #8d7a5f); font-size: 0.9rem; line-height: 1; padding: 2px 2px 2px 6px;
}
@media (prefers-reduced-motion: reduce) {
  .ff-intro-note { transition: none; opacity: 1; transform: translate(-50%, 0); }
}
`;

  let noteEl = null;
  let noteTimer = null;

  function injectCss() {
    if (document.getElementById('ff-intro-sound-css')) return;
    const style = document.createElement('style');
    style.id = 'ff-intro-sound-css';
    style.textContent = NOTE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function dismissNote() {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
    const el = noteEl;
    noteEl = null;
    if (!el) return;
    el.classList.remove('shown');
    setTimeout(() => el.remove(), 300);
  }

  /**
   * @param {boolean} firstTime true on the once-ever welcome, which is the only
   *   moment we offer "play every visit". On later plays (someone who opted in)
   *   the notice is just the off switch.
   */
  function showNote(firstTime) {
    injectCss();
    dismissNote();
    const el = document.createElement('div');
    el.className = 'ff-intro-note';
    el.setAttribute('role', 'status');
    // Every string below is a literal in this file — nothing user-controlled is
    // interpolated, so there is no escaping to do here.
    el.innerHTML =
      '<span class="ff-intro-note-mark" aria-hidden="true">♪</span>' +
      '<div class="ff-intro-note-copy">' +
        '<b>' + (firstTime ? 'A welcome from Functioning Faith' : 'Opening tune') + '</b>' +
        '<span>' + (firstTime
          ? 'A short tune, played once — it will not greet you again unless you ask.'
          : 'Playing because you asked for it each visit.') + '</span>' +
        '<div class="ff-intro-note-acts">' +
          '<button type="button" data-intro-act="off">Turn it off for good</button>' +
          (firstTime ? '<button type="button" data-intro-act="on">Play it every visit</button>' : '') +
        '</div>' +
      '</div>' +
      '<button type="button" class="ff-intro-note-x" data-intro-act="dismiss" aria-label="Dismiss">✕</button>';

    el.addEventListener('click', (event) => {
      const btn = event.target.closest ? event.target.closest('[data-intro-act]') : null;
      if (!btn) return;
      const act = btn.getAttribute('data-intro-act');
      if (act === 'off') {
        setPref('off');
        stop();                                   // silence the tune mid-phrase
        setStatus(el, 'Turned off. It will not play again.');
        return;
      }
      if (act === 'on') {
        setPref('on');
        setStatus(el, 'It will play each time you open the app.');
        return;
      }
      dismissNote();
    });

    document.body.appendChild(el);
    noteEl = el;
    requestAnimationFrame(() => el.classList.add('shown'));
    noteTimer = setTimeout(dismissNote, 11000);
  }

  /** Collapse the notice to a single confirming line, then let it go. */
  function setStatus(el, text) {
    const copy = el.querySelector('.ff-intro-note-copy');
    if (copy) {
      copy.textContent = text;                    // textContent, not innerHTML
      copy.style.fontWeight = '600';
    }
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(dismissNote, 2400);
  }

  // --- Arming ----------------------------------------------------------------
  // We cannot play on load, so we wait for the first real gesture. Two things
  // that wait needs: it must not hijack a gesture that was aimed at other audio,
  // and it must expire. A tune that arrives four minutes into a session is not
  // a welcome, it is an interruption.
  const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'];
  const ARM_WINDOW_MS = 60000;
  const MEDIA_TARGETS = '[data-reel-frame], [data-reel-sound], audio, video, iframe';

  let armed = false;
  let armTimer = null;
  let attempts = 0;

  function shouldGreet() {
    if (wantsQuiet()) return false;       // asked us to stop performing
    if (!storageWorks()) return false;    // could not honour an "off"
    const p = pref();
    if (p === 'off') return false;
    if (p === 'on') return true;
    return p !== 'heard';
  }

  function disarm() {
    if (!armed) return;
    armed = false;
    if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    GESTURE_EVENTS.forEach(name => document.removeEventListener(name, onGesture));
  }

  function onGesture(event) {
    if (!armed) return;
    const target = event && event.target;
    // Do not sing over something else the user just started, and do not sing
    // because someone typed their password.
    if (target && typeof target.closest === 'function') {
      if (target.closest(MEDIA_TARGETS)) { disarm(); return; }
      if (event.type === 'keydown' && target.closest('input, textarea, select, [contenteditable]')) return;
    }
    if (document.visibilityState === 'hidden') return;

    const firstTime = pref() !== 'on';
    attempts += 1;
    play().then((started) => {
      if (started) {
        disarm();
        if (firstTime) setPref('heard');
        showNote(firstTime);
      } else if (attempts >= 4) {
        // Autoplay policy is not going to relent on this page. Stop asking.
        disarm();
      }
    });
  }

  function arm() {
    if (armed || !shouldGreet()) return;
    armed = true;
    GESTURE_EVENTS.forEach(name =>
      document.addEventListener(name, onGesture, { passive: true }));
    armTimer = setTimeout(disarm, ARM_WINDOW_MS);
  }

  // Leaving the tab mid-phrase should not leave a tune playing into an empty
  // room, and it should not hold the audio device open either.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && playing) stop();
  });

  // --- Public surface --------------------------------------------------------
  // Small on purpose. A settings row anywhere in the app can read and write the
  // preference through this without knowing anything about Web Audio.
  window.FFIntroSound = {
    /** @returns {'on'|'off'|'heard'|''} */
    preference: pref,
    /** @param {'on'|'off'|'heard'} value */
    setPreference(value) {
      if (value !== 'on' && value !== 'off' && value !== 'heard') return;
      setPref(value);
      if (value === 'off') { disarm(); stop(); }
    },
    /**
     * Play it now regardless of preference — for a "hear it" button in settings.
     * Call from a click handler; outside a gesture the browser will refuse and
     * this resolves false.
     */
    play,
    stop,
    supported: !!(window.AudioContext || window.webkitAudioContext),
  };

  arm();
})();
