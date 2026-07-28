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
  if (!journeyLive) return;
  try { journeyLive.session.stop(); } catch {}
  try { if (journeyLive.world) journeyLive.world.dispose(); } catch {}
  if (journeyLive.pushTimer) clearInterval(journeyLive.pushTimer);
  if (journeyLive.momentTimer) clearInterval(journeyLive.momentTimer);
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
    '    <div class="live-3d-fallback" id="live-fallback" hidden></div>',
    '    <div class="live-waypoint" id="live-waypoint" hidden></div>',
    '    <div class="live-moment" id="live-moment" hidden></div>',
    '    <div class="live-gaps" id="live-gaps" hidden></div>',
    '    <div class="live-split" id="live-split" hidden></div>',
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
    world = await window.FitFaithJourney3D.create(canvas, { journey: j, waypoints: data.waypoints, onError: () => {} });
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

  // Segment boundaries, so a stretch between waypoints can be timed.
  let segs = [];
  try { segs = (await api('/journeys/' + encodeURIComponent(key) + '/segments')).segments || []; } catch {}
  // The segment the rider is on when the session starts, and when it began.
  let curSeg = segs.find(sg => startKm >= sg.from_km && startKm < sg.to_km) || null;
  let segStartedAt = null;      // elapsed seconds when the current segment began
  let segStartedKm = startKm;

  const session = window.FitFaithSensors.createSession({
    onUpdate(s) {
      if (s.hrMeasured && s.hr) hrSamples.push({ hr: s.hr, at: Math.round(s.elapsedSec) });
      const total = startKm + s.distanceKm;
      const shownSpeed = (s.source === 'manual') ? s.declaredPaceKmh : s.speedKmh;
      el('live-speed').textContent = (shownSpeed != null) ? Number(shownSpeed).toFixed(1) : '--';
      el('live-dist').textContent = fmtKm(total);
      el('live-src').textContent = s.sourceLabel;
      sweepOverdueCards();
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

  journeyLive = { session, world, pushTimer: null, momentTimer: null, lastPushedKm: 0, key: j.key };

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
    } catch { /* keep the session alive; the next tick retries */ }
  }

  // --- The right word at the right physiological moment --------------------
  // Ask the server where this session actually is every 45s and, when the
  // moment changes, surface scripture for it. Verses are never repeated within
  // a session, and each one opens into its own discussion.
  const seenRefs = [];
  let lastMoment = null;
  let lastVerseAt = 0;
  let zoneHintShown = false;

  async function checkMoment() {
    if (!journeyLive || !session.state.running) return;
    const s = session.state;
    // A verse every 45s would be noise, not company.
    if (Date.now() - lastVerseAt < 240000) return;
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
          seen_refs: seenRefs,
        },
      });
    } catch { return; }
    if (!r) return;

    const zoneEl = el('live-zone');
    if (zoneEl) zoneEl.textContent = (r.measured && r.zone) ? ('Z' + r.zone) : '';
    // Tell them once why a connected strap is not producing zones.
    if (r.zone_hint && !zoneHintShown) { zoneHintShown = true; note(r.zone_hint); }

    // Only speak when the moment actually turns, or on the first read.
    if (r.moment === lastMoment) return;
    lastMoment = r.moment;
    if (!r.verse) return;
    lastVerseAt = Date.now();
    seenRefs.push(r.verse.reference);
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
    try { session.useGps(); note('Using GPS. Best outdoors with a clear sky.'); }
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

  el('live-start').onclick = () => {
    if (!session.state.source) { note('Pick how you are moving first.'); return; }
    session.start();
    if (!journeyLive.pushTimer) journeyLive.pushTimer = setInterval(pushProgress, 5000);
    if (!journeyLive.momentTimer) journeyLive.momentTimer = setInterval(checkMoment, 45000);
    checkMoment();
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
