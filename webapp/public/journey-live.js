// Journey live mode — the interactive "ride the route" session.
//
// Real speed drives a 3D world forward and advances the route as you go. Speed
// comes from a smart trainer / spin bike / treadmill over Bluetooth FTMS, a
// speed sensor or footpod, GPS, or a pace the user declares. Progress is
// persisted in small increments, so a refresh or a dropped Bluetooth
// connection never erases a session.
//
// Loaded after app.js, so it can use its top-level helpers (api, fmtKm,
// escapeHtml, journeyMapSvg, renderJourneyDetail).

let journeyLive = null; // { session, world, pushTimer, lastPushedKm, key }

// --- GPS acquisition bar -----------------------------------------------------
// The pattern every run app uses, because it works: a band across the top that
// is red while the fix is not good enough, turns green the moment it is, and
// then gets out of the way on its own. It says what is missing rather than just
// showing a colour.

let gpsBarHideTimer = null;
let gpsBarState = null;      // 'acquiring' | 'ready' — so we only react to changes

function showGpsBar(ready, text) {
  const bar = document.getElementById('gps-bar');
  const label = document.getElementById('gps-bar-text');
  if (!bar || !label) return;

  const next = ready ? 'ready' : 'acquiring';
  label.textContent = text || (ready ? 'GPS ready' : 'Acquiring GPS…');
  bar.hidden = false;
  bar.classList.toggle('ready', ready);
  // Force the transition to run when it first appears.
  requestAnimationFrame(() => bar.classList.add('shown'));

  if (next !== gpsBarState) {
    gpsBarState = next;
    if (gpsBarHideTimer) { clearTimeout(gpsBarHideTimer); gpsBarHideTimer = null; }
    if (ready) {
      // Green, then away after five seconds.
      gpsBarHideTimer = setTimeout(hideGpsBar, 5000);
    }
  }
}

function hideGpsBar() {
  const bar = document.getElementById('gps-bar');
  if (gpsBarHideTimer) { clearTimeout(gpsBarHideTimer); gpsBarHideTimer = null; }
  gpsBarState = null;
  if (!bar) return;
  bar.classList.remove('shown');
  setTimeout(() => { bar.hidden = true; bar.classList.remove('ready'); }, 320);
}

// Transient cards over the world -- the gate verse, the moment verse, a segment
// split -- must always take themselves away again. Anything left on screen sits
// on top of the route you are riding.
//
// Every card is shown through here so that:
//   * it always has a dismissal scheduled, well inside 30 seconds;
//   * showing it again cancels the previous timer instead of leaving a stale one
//     that would hide the new card early;
//   * tapping the card clears it immediately, except on the verse itself, which
//     opens its discussion.
const CARD_MS = { 'live-waypoint': 12000, 'live-moment': 15000, 'live-split': 10000 };
const cardTimers = {};
const cardDeadlines = {};

function showCard(id) {
  const box = document.getElementById(id);
  if (!box) return null;
  if (cardTimers[id]) { clearTimeout(cardTimers[id]); cardTimers[id] = null; }
  box.hidden = false;
  box.onclick = (ev) => {
    if (ev.target.closest && ev.target.closest('[data-verse-ref]')) return;  // verse opens its thread
    hideCard(id);
  };
  const ms = CARD_MS[id] || 15000;
  // A deadline as well as a timer: background tabs throttle setTimeout heavily,
  // so a card scheduled for 15s can fire far later. The deadline lets us clear
  // anything overdue the moment the page is looked at again.
  cardDeadlines[id] = Date.now() + ms;
  cardTimers[id] = setTimeout(() => hideCard(id), ms);
  return box;
}

function hideCard(id) {
  if (cardTimers[id]) { clearTimeout(cardTimers[id]); cardTimers[id] = null; }
  cardDeadlines[id] = 0;
  const box = document.getElementById(id);
  if (box) box.hidden = true;
}

function clearCardTimers() {
  for (const id of Object.keys(cardTimers)) {
    if (cardTimers[id]) clearTimeout(cardTimers[id]);
    cardTimers[id] = null;
    cardDeadlines[id] = 0;
  }
}

// Clear anything past its deadline. Called on the session tick and whenever the
// page is looked at again, so a card can never outlive its welcome just because
// a background tab throttled its timer.
function sweepOverdueCards() {
  const now = Date.now();
  for (const id of Object.keys(cardDeadlines)) {
    if (cardDeadlines[id] && now >= cardDeadlines[id]) hideCard(id);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sweepOverdueCards();
});

function teardownJourneyLive() {
  clearCardTimers();
  hideGpsBar();
  if (!journeyLive) return;
  try { journeyLive.session.stop(); } catch {}
  try { if (journeyLive.world) journeyLive.world.dispose(); } catch {}
  if (journeyLive.pushTimer) clearInterval(journeyLive.pushTimer);
  if (journeyLive.momentTimer) clearInterval(journeyLive.momentTimer);
  if (journeyLive.overlayTimer) clearInterval(journeyLive.overlayTimer);
  journeyLive = null;
}

async function renderJourneyLive(key) {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
  teardownJourneyLive();

  let data;
  try { data = await api('/journeys/' + encodeURIComponent(key)); }
  catch { main.innerHTML = '<div class="card glass">Could not load this journey.</div>'; return; }
  const j = data.journey;
  const startKm = Number(data.progress_km) || 0;

  main.innerHTML = [
    '<div class="live-wrap">',
    '  <div class="live-canvas-wrap">',
    '    <canvas id="live-canvas"></canvas>',
    '    <div class="live-hud">',
    '      <div class="live-hud-speed"><span id="live-speed">--</span><small>km/h</small></div>',
    '      <div class="live-hud-hr"><span id="live-hr">--</span><small>bpm</small>',
    '        <div class="live-hud-zone" id="live-zone"></div></div>',
    '      <div class="live-hud-right">',
    '        <div class="live-rider-tag">● Rider · You</div>',
    '        <div><span id="live-dist">' + fmtKm(startKm) + '</span><small> / ' + fmtKm(j.total_km) + ' km</small></div>',
    '        <div class="live-hud-src" id="live-src">Not connected</div>',
    '        <div class="live-hud-grade" id="live-grade"></div>',
    '      </div>',
    '    </div>',
    '    <div class="live-race-banner" id="live-race-banner" hidden></div>',
    '    <div class="live-3d-fallback" id="live-fallback" hidden></div>',
    '    <div class="live-waypoint" id="live-waypoint" hidden></div>',
    '    <div class="live-moment" id="live-moment" hidden></div>',
    '    <div class="live-gaps" id="live-gaps" hidden></div>',
    '    <div class="live-split" id="live-split" hidden></div>',
    '    <div class="live-minimap"><div class="journey-minimap-label">COURSE</div>' + journeyMapSvg(j, data.waypoints, startKm) + '</div>',
    '  </div>',
    '  <div class="card glass live-panel">',
    '    <div class="challenge-track"><span id="live-bar" style="width:' + (data.percent || 0) + '%"></span></div>',
    '    <div class="journey-next" id="live-next">' + (data.next_waypoint
        ? 'Next: ' + escapeHtml(data.next_waypoint.title) + ' in ' + fmtKm(data.next_waypoint.km_remaining) + ' km'
        : 'The last stretch is ahead.') + '</div>',
    '    <div class="field-label">How are you moving?</div>',
    '    <div class="live-sources">',
    '      <button class="ghost" id="src-ftms">Smart bike / treadmill</button>',
    '      <button class="ghost" id="src-sensor">Speed sensor / footpod</button>',
    '      <button class="ghost" id="src-gps">GPS (outdoors)</button>',
    '      <button class="ghost" id="src-manual">Set a pace</button>',
    '      <button class="ghost" id="src-hr">Heart rate monitor</button>',
    '    </div>',
    '    <div class="live-gps-gate" id="live-gps-gate" hidden></div>',
    '    <div class="muted live-note" id="live-note">Pair equipment for measured speed. A pace you set yourself is recorded as declared, not measured.</div>',
    '    <div class="live-controls">',
    '      <button class="primary" id="live-start">Start</button>',
    '      <button class="ghost" id="live-finish">Finish &amp; save</button>',
    '      <button class="ghost" id="live-exit">Exit</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('');

  const el = (id) => document.getElementById(id);
  const note = (msg) => { el('live-note').textContent = msg; };

  // 3D world — falls back to the flat route map if WebGL/Three.js is unavailable.
  const canvas = el('live-canvas');
  let world = null;
  try {
    world = await window.FunctioningFaithJourney3D.create(canvas, { journey: j, waypoints: data.waypoints, onError: () => {} });
  } catch { world = null; }
  if (!world) {
    canvas.hidden = true;
    const fb = el('live-fallback');
    fb.hidden = false;
    fb.innerHTML = '<div class="journey-map-wrap tall">' + journeyMapSvg(j, data.waypoints, startKm) + '</div>'
      + '<div class="muted" style="padding:8px">3D needs WebGL, which this browser or device is not providing. The route map still tracks your progress.</div>';
  } else {
    world.setDistance(startKm);
  }

  // Every real heart-rate reading of the session, for the effort summary on save.
  const hrSamples = [];

  // Real recorded rides on this road, replayed alongside you. An empty list is
  // shown as exactly that rather than filled in with invented riders.
  let ghostInfo = { ghosts: [], note: null };
  try { ghostInfo = await api('/journeys/' + encodeURIComponent(key) + '/ghosts'); } catch {}
  if (world && ghostInfo && ghostInfo.ghosts && ghostInfo.ghosts.length) {
    world.setGhosts(ghostInfo.ghosts);
  }
  // Remember each rival's last gap so an overtake becomes a small, truthful
  // on-road moment instead of a made-up achievement. A ghost only exists when
  // its owner has actually recorded this route.
  const lastGhostGaps = new Map();

  // Segment boundaries, so a stretch between waypoints can be timed.
  let segs = [];
  try { segs = (await api('/journeys/' + encodeURIComponent(key) + '/segments')).segments || []; } catch {}
  // The segment the rider is on when the session starts, and when it began.
  let curSeg = segs.find(sg => startKm >= sg.from_km && startKm < sg.to_km) || null;
  let segStartedAt = null;      // elapsed seconds when the current segment began
  let segStartedKm = startKm;

  const session = window.FunctioningFaithSensors.createSession({
    onUpdate(s) {
      if (s.hrMeasured && s.hr) hrSamples.push({ hr: s.hr, at: Math.round(s.elapsedSec) });
      const total = startKm + s.distanceKm;
      const shownSpeed = (s.source === 'manual') ? s.declaredPaceKmh : s.speedKmh;
      el('live-speed').textContent = (shownSpeed != null) ? Number(shownSpeed).toFixed(1) : '--';
      el('live-dist').textContent = fmtKm(total);
      el('live-src').textContent = s.sourceLabel;
      sweepOverdueCards();
      refreshStartGate(s);
      // Blank unless a monitor is actually streaming. Never an estimate.
      el('live-hr').textContent = (s.hrMeasured && s.hr) ? String(s.hr) : '--';
      if (world) {
        world.setDistance(total);
        world.setSpeed(shownSpeed || 0);
        world.setElapsed(s.elapsedSec);

        const g = world.getGrade();
        const gradeEl = el('live-grade');
        if (gradeEl) gradeEl.textContent = Math.abs(g) < 0.6 ? '' : (g > 0 ? '▲ ' : '▼ ') + Math.abs(g).toFixed(1) + '%';

        // Where you stand against everyone actually on this road.
        const gaps = world.ghostDeltas(total).filter(x => Math.abs(x.delta_km) < 3);
        const gapsEl = el('live-gaps');
        const raceEl = el('live-race-banner');
        if (gapsEl) {
          if (!gaps.length) { gapsEl.hidden = true; }
          else {
            gapsEl.hidden = false;
            gapsEl.innerHTML = gaps
              .sort((a, b) => Math.abs(a.delta_km) - Math.abs(b.delta_km))
              .slice(0, 4)
              .map(x => '<div class="live-gap-row' + (x.is_self ? ' self' : '') + '">'
                + '<span class="live-gap-name">' + escapeHtml(x.display_name) + '</span>'
                + '<span class="live-gap-delta ' + (x.delta_km >= 0 ? 'ahead' : 'behind') + '">'
                + (x.delta_km >= 0 ? '+' : '') + (x.delta_km * 1000).toFixed(0) + ' m</span></div>')
              .join('');
          }
        }
        if (raceEl) {
          const nearest = gaps.slice().sort((a, b) => Math.abs(a.delta_km) - Math.abs(b.delta_km))[0];
          if (!nearest) {
            raceEl.hidden = true;
          } else {
            const key = (nearest.display_name || 'rider') + ':' + (nearest.is_self ? 'self' : 'rival');
            const previous = lastGhostGaps.get(key);
            const overtook = previous != null && previous >= 0 && nearest.delta_km < 0;
            lastGhostGaps.set(key, nearest.delta_km);
            const metres = Math.abs(nearest.delta_km * 1000).toFixed(0);
            raceEl.hidden = false;
            raceEl.classList.toggle('is-overtake', overtook);
            raceEl.innerHTML = overtook
              ? '<strong>OVERTAKE</strong><span>You passed ' + escapeHtml(nearest.display_name || 'a rider') + '</span>'
              : '<strong>' + (nearest.delta_km >= 0 ? 'CHASE' : 'DEFEND') + '</strong><span>'
                + escapeHtml(nearest.display_name || 'Rider') + ' · ' + metres + ' m ' + (nearest.delta_km >= 0 ? 'ahead' : 'behind') + '</span>';
            if (overtook) {
              world.setRaceIntensity(1);
              setTimeout(() => { if (raceEl) raceEl.classList.remove('is-overtake'); }, 1200);
            } else if (Math.abs(nearest.delta_km) < 0.08) {
              world.setRaceIntensity(0.42);
            }
          }
        }
      }

      // Segment timing: crossing a waypoint closes one stretch and opens the next.
      if (segs.length) {
        if (!curSeg) {
          curSeg = segs.find(sg => total >= sg.from_km && total < sg.to_km) || null;
          if (curSeg) { segStartedAt = s.elapsedSec; segStartedKm = total; }
        } else if (total >= curSeg.to_km) {
          const done = curSeg;
          const startedAt = segStartedAt;
          // Only submit a segment we actually rode end to end this session; if
          // we joined it part-way the time would flatter us.
          if (startedAt != null && segStartedKm <= done.from_km + 0.05) {
            submitSegment(done, s.elapsedSec - startedAt, s.source && s.source !== 'manual');
          }
          curSeg = segs.find(sg => total >= sg.from_km && total < sg.to_km) || null;
          segStartedAt = s.elapsedSec;
          segStartedKm = total;
        }
      }
      el('live-bar').style.width = Math.min(100, Math.round((total / j.total_km) * 100)) + '%';
    },
  });

  journeyLive = { session, world, pushTimer: null, momentTimer: null, overlayTimer: null, lastPushedKm: 0, key: j.key };

  async function submitSegment(seg, durationSec, measured) {
    if (!(durationSec > 0)) return;
    let r;
    try {
      r = await api('/journeys/' + encodeURIComponent(j.key) + '/segments/' + seg.index + '/complete',
        { method: 'POST', body: { duration_sec: +durationSec.toFixed(1), measured: !!measured } });
    } catch { return; }
    if (!r) return;
    const mmss = (sec) => Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
    const box = showCard('live-split');
    if (!box) return;
    box.innerHTML = '<div class="live-split-hd">' + escapeHtml(r.from) + ' → ' + escapeHtml(r.to) + '</div>'
      + '<div class="live-split-time">' + mmss(r.duration_sec) + '</div>'
      + '<div class="live-split-note">'
      +   (r.personal_best
            ? (r.previous_best_sec != null
                ? '🏅 Personal best — ' + Math.round(r.previous_best_sec - r.duration_sec) + 's faster'
                : '🏁 First time on this stretch')
            : 'Your best here: ' + mmss(r.previous_best_sec))
      +   ' · ' + (r.rank === 1 ? 'fastest on this road' : 'ranked ' + r.rank + ' on this road')
      +   (r.measured ? '' : ' · declared pace')
      + '</div>';

    // Segment results are the only place we call a rank. The rank comes from
    // the server's real, plausibility-checked leaderboard, never from a local
    // animation or an estimated performance.
    if (world && r.rank && r.rank <= 3) world.setRaceIntensity(0.8);

  }

  function showWaypoint(w) {
    const box = showCard('live-waypoint');
    if (!box) return;
    box.innerHTML = '<div class="live-wp-km">' + fmtKm(w.km_mark) + ' km</div>'
      + '<div class="live-wp-title">' + escapeHtml(w.title) + '</div>'
      + (w.narrative ? '<div class="live-wp-narrative">' + escapeHtml(w.narrative) + '</div>' : '')
      + (w.scripture_ref
        ? '<div class="verse-card verse-tappable" data-verse-ref="' + escapeHtml(w.scripture_ref) + '">'
          + '<div class="verse-ref">' + escapeHtml(w.scripture_ref) + '</div>'
          + (w.scripture_text ? '<div class="verse-text">' + escapeHtml(w.scripture_text) + '</div>' : '')
          + '<div class="verse-convo">\ud83d\udcac Talk about this</div>' + '</div>'
        : '');
    const vb = box.querySelector('[data-verse-ref]');
    if (vb) vb.onclick = () => {
      teardownJourneyLive();
      if (typeof renderVerseThread === 'function') renderVerseThread(vb.dataset.verseRef);
    };
  }

  // Persist in small increments: live waypoint unlocks, and nothing lost if the
  // tab closes mid-session.
  async function pushProgress() {
    if (!journeyLive) return;
    const covered = session.state.distanceKm;
    const delta = covered - journeyLive.lastPushedKm;
    if (delta < 0.02) return; // ~20 m of real movement
    journeyLive.lastPushedKm = covered;
    try {
      const r = await api('/journeys/' + encodeURIComponent(j.key) + '/progress', { method: 'POST', body: { add_km: +delta.toFixed(4) } });
      if (r && r.crossed && r.crossed.length) r.crossed.forEach(showWaypoint);
      if (r && r.completed) note('Journey complete — the whole road behind you.');
      if (r && r.next_waypoint) overlayNext = r.next_waypoint.title || null;
    } catch { /* keep the session alive; the next tick retries */ }
  }

  // --- The right word at the right physiological moment --------------------
  // Ask the server where this session actually is every 45s and, when the
  // moment changes, surface scripture for it. Verses are never repeated within
  // a session, and each one opens into its own discussion.
  const seenRefs = [];
  let lastMoment = null;
  let lastVerseAt = 0;

  // Scripture arrives because something happened, not because time passed.
  //
  // A verse on a timer is a notification; a verse when the road tilts up, or
  // when you have been fading for half a minute, is company. So the session
  // watches for those moments and only then asks the server what to say.
  //
  // Guard rails, because the failure mode of any trigger is chatter:
  //   * nothing at all within the first two minutes -- settle in first;
  //   * at least six minutes between verses, whatever fires;
  //   * each kind of trigger has to reset before it can fire again.
  const VERSE_MIN_GAP_MS = 6 * 60 * 1000;
  const VERSE_SETTLE_MS = 2 * 60 * 1000;

  let sessionStartedAt = 0;
  let slowSince = null;          // when the current fade began
  let armedSlow = true;          // re-arms once the rider picks the pace back up
  let armedClimb = true;         // re-arms once the climb is behind them
  let lastTriggerKind = null;

  /**
   * Decide whether this moment deserves a verse, and why. Returns a trigger
   * name, or null for "say nothing".
   */
  function verseTrigger(st) {
    if (!st.running) return null;
    const now = Date.now();
    const elapsed = now - sessionStartedAt;
    if (elapsed < VERSE_SETTLE_MS) return null;
    if (now - lastVerseAt < VERSE_MIN_GAP_MS) return null;

    const speeds = (st.recentSpeeds || []).filter(v => Number.isFinite(v) && v > 0);
    const cur = Number.isFinite(st.speedKmh) ? st.speedKmh : null;

    // A climb worth warning about, close enough to matter.
    if (armedClimb && world && typeof world.nextClimbKm === 'function') {
      const km = world.nextClimbKm(3.5, 0.9);
      if (km != null && km < 0.35) {
        armedClimb = false;
        return 'climb_ahead';
      }
    }
    if (!armedClimb && world && typeof world.gradeAhead === 'function' && world.gradeAhead(150) < 1) {
      armedClimb = true;                       // the hill is behind them
    }

    // A real fade: well off your own average for a sustained stretch, while
    // actually moving. A momentary dip at a junction is not a crisis.
    if (speeds.length >= 20 && cur != null) {
      const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      if (avg > 3 && cur < avg * 0.78) {
        if (slowSince == null) slowSince = now;
        if (armedSlow && now - slowSince > 25000) {
          armedSlow = false;
          return 'slowing';
        }
      } else {
        slowSince = null;
        if (cur >= avg * 0.95) armedSlow = true;   // back on it; may fire again later
      }
    }
    return null;
  }

  // Creator overlay: while a token exists, mirror what is on screen to the
  // server so an OBS browser source can draw it. Off by default, and a failed
  // push never disturbs the ride.
  let overlayOn = false;
  let overlayCurrent = null;   // { label, measured, reference, text }
  try { overlayOn = !!(await api('/overlay/token')).token; } catch { overlayOn = false; }

  async function pushOverlay(s) {
    if (!overlayOn || !journeyLive) return;
    const total = startKm + s.distanceKm;
    try {
      await api('/overlay/state', { method: 'POST', body: {
        journey_name: j.name,
        journey_world: j.world,
        distance_km: +total.toFixed(3),
        total_km: j.total_km,
        percent: Math.min(100, (total / j.total_km) * 100),
        speed_kmh: (s.source === 'manual') ? s.declaredPaceKmh : s.speedKmh,
        elapsed_sec: Math.round(s.elapsedSec),
        hr: s.hr, hr_measured: !!s.hrMeasured,
        zone: overlayZone,
        moment_label: overlayCurrent ? overlayCurrent.label : null,
        moment_measured: overlayCurrent ? overlayCurrent.measured : false,
        verse_reference: overlayCurrent ? overlayCurrent.reference : null,
        verse_text: overlayCurrent ? overlayCurrent.text : null,
        next_waypoint: overlayNext,
        riding: !!s.running,
      } });
    } catch { /* the overlay is decoration; never let it break a session */ }
  }
  let overlayZone = null, overlayNext = null;
  let zoneHintShown = false;

  async function checkMoment(forcedTrigger) {
    if (!journeyLive || !session.state.running) return;
    const s = session.state;
    const trigger = forcedTrigger || verseTrigger(s);
    if (!trigger) return;
    lastTriggerKind = trigger;
    let r;
    try {
      r = await api('/live/moment', {
        method: 'POST',
        body: {
          elapsed_sec: s.elapsedSec,
          distance_km: startKm + s.distanceKm,
          total_km: j.total_km,
          speed_kmh: s.speedKmh,
          recent_speeds: s.recentSpeeds || [],
          hr: s.hr,
          hr_measured: !!s.hrMeasured,
          recent_hr: s.recentHr || [],
          terrain: j.terrain,
          // Why we are asking, so the server can meet the actual moment rather
          // than re-deriving it from numbers that have already moved on.
          trigger,
          grade_ahead: (world && typeof world.gradeAhead === 'function') ? world.gradeAhead(200) : null,
          seen_refs: seenRefs,
        },
      });
    } catch { return; }
    if (!r) return;

    const zoneEl = el('live-zone');
    if (zoneEl) zoneEl.textContent = (r.measured && r.zone) ? ('Z' + r.zone) : '';
    overlayZone = (r.measured && r.zone) ? r.zone : null;
    // Tell them once why a connected strap is not producing zones.
    if (r.zone_hint && !zoneHintShown) { zoneHintShown = true; note(r.zone_hint); }

    lastMoment = r.moment;
    if (!r.verse) return;
    lastVerseAt = Date.now();
    seenRefs.push(r.verse.reference);
    overlayCurrent = { label: r.label, measured: !!r.measured,
                       reference: r.verse.reference, text: r.verse.text };
    // Clear it from the overlay when it clears from the screen, so a stream is
    // not left holding a verse from ten minutes ago.
    setTimeout(() => { overlayCurrent = null; }, CARD_MS['live-moment'] || 15000);
    showMoment(r);
  }

  function showMoment(r) {
    const box = showCard('live-moment');
    if (!box) return;
    box.innerHTML = '<div class="live-moment-hd">' + escapeHtml(r.label)
      + '<span class="live-moment-src">' + (r.measured ? 'measured' : 'from pace &amp; route') + '</span></div>'
      + '<div class="live-moment-why">' + escapeHtml(r.reason) + '</div>'
      + '<div class="verse-card verse-tappable live-moment-verse" data-verse-ref="' + escapeHtml(r.verse.reference) + '">'
      +   '<div class="verse-ref">' + escapeHtml(r.verse.reference) + '</div>'
      +   '<div class="verse-text">' + escapeHtml(r.verse.text) + '</div>'
      // The one line written for this member, at this moment, in their own
      // tradition. Marked off from the verse above it so the boundary between
      // scripture and commentary is visible, not implied.
      +   (r.verse.note
            ? '<div class="moment-note">' + escapeHtml(r.verse.note) + '</div>'
            : '')
      +   '<div class="verse-convo">\ud83d\udcac Talk about this</div>'
      + '</div>';
    const btn = box.querySelector('[data-verse-ref]');
    if (btn) btn.onclick = () => {
      // Scripture as conversation: the verse you were given mid-session opens
      // straight into its thread rather than vanishing.
      teardownJourneyLive();
      if (typeof renderVerseThread === 'function') renderVerseThread(btn.dataset.verseRef);
      else renderJourneyDetail(j.key);
    };

  }

  if (ghostInfo && ghostInfo.note) note(ghostInfo.note);
  else if (ghostInfo && ghostInfo.ghosts && ghostInfo.ghosts.length) {
    note(ghostInfo.ghosts.length + ' recorded ride' + (ghostInfo.ghosts.length === 1 ? '' : 's')
      + ' on this road will ride it with you.');
  }

  const btUnsupported = 'This browser has no Web Bluetooth — try Chrome or Edge.';
  el('src-hr').onclick = async () => {
    note('Pairing… choose your heart rate strap.');
    try {
      await session.connectHr();
      note('Monitor connected. Your zones and effort are measured from here on.');
    } catch (e) {
      note(e && e.message === 'web_bluetooth_unsupported' ? btUnsupported
        : 'No monitor paired. Without one, heart rate and zones stay blank — nothing is estimated.');
    }
  };
  el('src-ftms').onclick = async () => {
    note('Pairing… choose your trainer, bike or treadmill.');
    try { await session.connectFtms(); note('Connected. Measured speed is streaming from your equipment.'); }
    catch (e) { note(e && e.message === 'web_bluetooth_unsupported' ? btUnsupported : 'No equipment paired.'); }
  };
  el('src-sensor').onclick = async () => {
    note('Pairing… choose your speed sensor or footpod.');
    try { await session.connectSensor(); note('Sensor connected.'); }
    catch (e) { note(e && e.message === 'web_bluetooth_unsupported' ? btUnsupported : 'No sensor paired.'); }
  };
  el('src-gps').onclick = () => {
    try {
      session.useGps();
      note('Using GPS. Hold on until the fix is accurate — best outdoors with a clear sky.');
      refreshStartGate(session.state);
    }
    catch { note('GPS is unavailable in this browser.'); }
  };
  el('src-manual').onclick = () => {
    const v = prompt('What pace are you holding, in km/h?\n(Walk ~5, easy jog ~8, run ~11, ride ~25)', '8');
    if (v === null) return;
    const kmh = Number(v);
    if (!Number.isFinite(kmh) || kmh <= 0 || kmh > 60) { note('Enter a realistic pace in km/h.'); return; }
    session.useDeclaredPace(kmh);
    note('Using a pace you set. This is recorded as declared, not measured.');
  };

  // On GPS, hold the start until the receiver is actually giving a usable fix
  // and a speed. A first fix can be hundreds of metres out and carries no speed,
  // and starting on it would credit distance the rider never covered while the
  // receiver walks its position in to the true one.
  function refreshStartGate(s) {
    const btn = el('live-start');
    if (!btn || s.running) return;
    const waiting = s.source === 'gps' && !s.gpsReady;
    // Waiting is a reason to warn, not a reason to trap. Once we have a real
    // position and have been trying a while, the rider decides — a poor fix
    // still records a route, and standing at a trailhead unable to press Start
    // is worse than a first kilometre that is roughly drawn.
    const trapped = waiting && !s.gpsCanOverride;
    btn.disabled = trapped;
    btn.textContent = !waiting ? 'Start'
      : (s.gpsCanOverride ? 'Start anyway · ±' + Math.round(s.gpsAccuracyM) + ' m'
                          : 'Waiting for GPS…');
    btn.classList.toggle('start-degraded', waiting && !!s.gpsCanOverride);

    const gate = el('live-gps-gate');
    if (gate) {
      gate.hidden = s.source !== 'gps' || s.gpsReady;
      if (!gate.hidden) {
        gate.innerHTML = '<span class="gps-spinner"></span><span>'
          + escapeHtml(s.gpsStatus || 'Waiting for GPS…')
          + (s.gpsCanOverride
              ? ' <span class="gps-gate-note">You can start anyway — early distance may be off.</span>'
              : '')
          + '</span>';
      }
    }
    if (s.source === 'gps') showGpsBar(!!s.gpsReady, s.gpsStatus);
  }

  el('live-start').onclick = () => {
    if (!session.state.source) { note('Pick how you are moving first.'); return; }
    if (session.state.source === 'gps' && !session.state.gpsReady) {
      // Only block while there is still nothing to start on. Once an override
      // is offered, pressing Start means what it says.
      if (!session.state.gpsCanOverride) {
        note(session.state.gpsStatus || 'Waiting for an accurate GPS fix.');
        return;
      }
      note('Starting on a ±' + Math.round(session.state.gpsAccuracyM) +
           ' m fix — your first stretch may be roughly drawn.');
    }
    session.start();
    if (!journeyLive.pushTimer) journeyLive.pushTimer = setInterval(pushProgress, 5000);
    sessionStartedAt = Date.now();
    // Evaluated on a short tick, but that tick only asks the server when a
    // trigger has actually fired — the cadence is the rider's, not a clock's.
    if (!journeyLive.momentTimer) journeyLive.momentTimer = setInterval(() => checkMoment(), 5000);
    if (overlayOn && !journeyLive.overlayTimer) {
      journeyLive.overlayTimer = setInterval(() => pushOverlay(session.state), 3000);
    }
    el('live-start').textContent = 'Running…';
    el('live-start').disabled = true;
  };

  el('live-finish').onclick = async () => {
    const covered = session.state.distanceKm;
    const mins = Math.round(session.state.elapsedSec / 60);
    await pushProgress();
    session.stop();
    if (covered > 0.01 && mins >= 1) {
      // Log a real workout so it flows into stats, challenges and the feed — but
      // skip journey advancement, which already happened live.
      const typeFor = { ride: 'Cycle', run: 'Run', walk: 'Walk' };
      await api('/workouts/manual', {
        method: 'POST',
        body: {
          type: typeFor[j.activity_hint] || 'Run',
          duration_min: mins,
          distance_km: +covered.toFixed(2),
          note: 'Travelled ' + j.name,
          skip_journeys: true,
          // Only ever sent when a monitor was actually streaming, so the effort
          // score and zone breakdown are measured rather than modelled.
          ...(hrSamples.length ? { hr_samples: hrSamples } : {}),
        },
      }).catch(() => {});
    }
    teardownJourneyLive();
    renderJourneyDetail(j.key);
  };

  el('live-exit').onclick = async () => {
    await pushProgress();
    teardownJourneyLive();
    renderJourneyDetail(j.key);
  };
}

// Train tab -> "Journey": pick a route (and its distance) and drop straight
// into the 3D session. Same catalogue as Explore, framed as a workout choice.
async function populateJourneyPicker() {
  const box = document.getElementById('journey-picker');
  if (!box) return;
  let list;
  try { list = await api('/journeys'); }
  catch { box.innerHTML = '<div class="muted">Could not load routes.</div>'; return; }
  if (!Array.isArray(list) || !list.length) { box.innerHTML = '<div class="muted">No routes yet.</div>'; return; }

  const card = (j) => '<button class="ghost jp-row" data-jp="' + escapeHtml(j.key) + '">'
    + '<span class="jp-main"><span class="jp-name">' + escapeHtml(j.name) + '</span>'
    + '<span class="jp-sub">' + fmtKm(j.total_km) + ' km · ' + escapeHtml(j.terrain || '')
    + (j.elevation_m ? ' · ' + j.elevation_m + ' m' : '') + '</span></span>'
    + '<span class="jp-pct">' + (j.joined ? (j.percent + '%') : 'start') + '</span></button>';

  const scripture = list.filter(j => j.world === 'biblical');
  const middleEarth = list.filter(j => j.world === 'middle-earth');
  const narnia = list.filter(j => j.world === 'narnia');
  const tales = list.filter(j => j.world === 'fantasy');
  box.innerHTML = '<h2 style="margin-top:0">Choose a route</h2>'
    + '<div class="muted" style="margin-bottom:10px">Your real speed moves you through it — smart bike, treadmill, GPS, or a pace you set.</div>'
    + (scripture.length ? '<h3 class="journey-group">Walk the scriptures</h3>' + scripture.map(card).join('') : '')
    + (middleEarth.length ? '<h3 class="journey-group">Middle-earth routes</h3>' + middleEarth.map(card).join('') : '')
    + (narnia.length ? '<h3 class="journey-group">Narnia routes</h3>' + narnia.map(card).join('') : '')
    + (tales.length ? '<h3 class="journey-group">Tales &amp; long roads</h3>' + tales.map(card).join('') : '');

  box.querySelectorAll('[data-jp]').forEach((b) => {
    b.onclick = async () => {
      const key = b.dataset.jp;
      const j = list.find(x => x.key === key);
      if (j && !j.joined) { try { await api('/journeys/' + encodeURIComponent(key) + '/join', { method: 'POST' }); } catch {} }
      renderJourneyLive(key);
    };
  });
}
