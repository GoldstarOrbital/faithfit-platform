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

function teardownJourneyLive() {
  if (!journeyLive) return;
  try { journeyLive.session.stop(); } catch {}
  try { if (journeyLive.world) journeyLive.world.dispose(); } catch {}
  if (journeyLive.pushTimer) clearInterval(journeyLive.pushTimer);
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
    '      <div class="live-hud-right">',
    '        <div><span id="live-dist">' + fmtKm(startKm) + '</span><small> / ' + fmtKm(j.total_km) + ' km</small></div>',
    '        <div class="live-hud-src" id="live-src">Not connected</div>',
    '      </div>',
    '    </div>',
    '    <div class="live-3d-fallback" id="live-fallback" hidden></div>',
    '    <div class="live-waypoint" id="live-waypoint" hidden></div>',
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

  const session = window.FitFaithSensors.createSession({
    onUpdate(s) {
      const total = startKm + s.distanceKm;
      const shownSpeed = (s.source === 'manual') ? s.declaredPaceKmh : s.speedKmh;
      el('live-speed').textContent = (shownSpeed != null) ? Number(shownSpeed).toFixed(1) : '--';
      el('live-dist').textContent = fmtKm(total);
      el('live-src').textContent = s.sourceLabel;
      if (world) { world.setDistance(total); world.setSpeed(shownSpeed || 0); }
      el('live-bar').style.width = Math.min(100, Math.round((total / j.total_km) * 100)) + '%';
    },
  });

  journeyLive = { session, world, pushTimer: null, lastPushedKm: 0, key: j.key };

  function showWaypoint(w) {
    const box = el('live-waypoint');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<div class="live-wp-km">' + fmtKm(w.km_mark) + ' km</div>'
      + '<div class="live-wp-title">' + escapeHtml(w.title) + '</div>'
      + (w.narrative ? '<div class="live-wp-narrative">' + escapeHtml(w.narrative) + '</div>' : '')
      + (w.scripture_ref
        ? '<div class="verse-card"><div class="verse-ref">' + escapeHtml(w.scripture_ref) + '</div>'
          + (w.scripture_text ? '<div class="verse-text">' + escapeHtml(w.scripture_text) + '</div>' : '') + '</div>'
        : '');
    setTimeout(() => { box.hidden = true; }, 14000);
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

  const btUnsupported = 'This browser has no Web Bluetooth — try Chrome or Edge.';
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
  const tales = list.filter(j => j.world !== 'biblical');
  box.innerHTML = '<h2 style="margin-top:0">Choose a route</h2>'
    + '<div class="muted" style="margin-bottom:10px">Your real speed moves you through it — smart bike, treadmill, GPS, or a pace you set.</div>'
    + (scripture.length ? '<h3 class="journey-group">Walk the scriptures</h3>' + scripture.map(card).join('') : '')
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
