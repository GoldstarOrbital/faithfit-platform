const state = {
  tab: 'home', me: null, exploreTab: 'groups',
  activeWorkout: null, hrTimer: null, elapsed: 0, hr: 0,
  gpsWatchId: null, gpsPoints: [], leafletMap: null, leafletLine: null,
  bleDevice: null, bleServer: null, bleConnected: false,
  breathePhase: 'idle',
};

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { renderSignIn(); throw new Error('not_signed_in'); }
  return res.json();
}

async function loadMe() { try { state.me = await api('/me'); } catch { state.me = null; } }

function setTab(tab) {
  if (state.activeWorkout && tab !== 'workout') { if (!confirm('Leave this screen? Your workout is still running.')) return; }
  state.tab = tab;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

async function render() {
  const main = document.getElementById('main');
  if (!state.me) return renderSignIn();
  if (state.tab === 'home') return renderHome(main);
  if (state.tab === 'workout') return renderWorkout(main);
  if (state.tab === 'explore') return renderExplore(main);
  if (state.tab === 'profile') return renderProfile(main);
}

function initials(name) { return (name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase(); }
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso + (iso.includes('Z') ? '' : 'Z')).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}

async function renderSignIn() {
  const users = await api('/users');
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="card glass">
      <h2>Choose a demo profile</h2>
      <p class="muted">No password needed — pick a user to sign in as.</p>
      ${users.map(u => `<button class="ghost" style="width:100%;margin-bottom:8px;text-align:left;display:flex;align-items:center;gap:10px" data-signin="${u.id}"><span class="avatar-sm">${initials(u.display_name)}</span><span>${u.display_name}<br><span class="muted">${u.bio || ''}</span></span></button>`).join('')}
    </div>`;
  main.querySelectorAll('[data-signin]').forEach(btn => {
    btn.onclick = async () => { await api('/session', { method: 'POST', body: { user_id: btn.dataset.signin } }); await loadMe(); render(); };
  });
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
}

function routeSvg(seed) {
  const pts = [];
  let x = 10, y = 55 + (seed % 20);
  for (let i = 0; i < 8; i++) { x += 20 + (i % 3) * 5; y += Math.sin(i + seed) * 18; pts.push(`${x},${Math.max(10, Math.min(100, y))}`); }
  return `<svg viewBox="0 0 200 110" preserveAspectRatio="none"><polyline points="${pts.join(' ')}" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/></svg>`;
}

async function renderHome(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  const [posts, users] = await Promise.all([api('/feed'), api('/users')]);
  main.innerHTML = `
    <div class="stories">
      ${users.map(u => `<div class="story"><div class="story-ring"><div class="story-avatar">${initials(u.display_name)}</div></div><div class="story-label">${u.display_name.split(' ')[0]}</div></div>`).join('')}
    </div>
    <div id="posts"></div>
  `;
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = posts.map((p, i) => `
    <div class="card glass" data-post="${p.id}">
      <div class="post-head">
        <div class="avatar-sm">${initials(p.author)}</div>
        <div style="flex:1">
          <div class="post-author">${p.author}</div>
          <div class="post-time">${timeAgo(p.created_at)} ago</div>
        </div>
      </div>
      <div class="post-content">${escapeHtml(p.content || '')}</div>
      ${p.workout_type ? `
        <div class="route-banner">${routeSvg(i)}<span class="badge-overlay">${p.workout_type}</span></div>
        <div class="stat-row">
          <div class="stat"><div class="v">${p.distance_km ?? '—'}</div><div class="l">km</div></div>
          <div class="stat"><div class="v">${p.pace_min_per_km ?? '—'}</div><div class="l">min/km</div></div>
          <div class="stat"><div class="v">${p.calories ?? '—'}</div><div class="l">kcal</div></div>
          <div class="stat"><div class="v">${p.avg_hr ?? '—'}</div><div class="l">avg hr</div></div>
        </div>` : ''}
      ${p.verse_reference ? `<div class="verse-card"><div class="verse-ref">${p.verse_reference}</div><div class="verse-text">${escapeHtml(p.verse_text || '')}</div></div>` : ''}
      <div class="action-row">
        <button class="action-btn ${p.liked_by_me ? 'liked' : ''}" data-like="${p.id}">${p.liked_by_me ? '❤️' : '🤍'} <span class="n">${p.like_count}</span> kudos</button>
        <button class="action-btn" data-comment-toggle="${p.id}">💬 <span class="n">${p.comments.length}</span></button>
        <button class="action-btn">↗ Share</button>
      </div>
      <div class="comments" id="comments-${p.id}" style="display:none">
        ${p.comments.map(c => `<div class="comment"><b>${c.author}</b>${escapeHtml(c.content)}</div>`).join('')}
        <div class="comment-input-row">
          <input type="text" placeholder="Add a comment…" id="comment-input-${p.id}" />
          <button data-send-comment="${p.id}">Post</button>
        </div>
      </div>
    </div>
  `).join('') || '<p class="muted">No posts yet.</p>';

  postsEl.querySelectorAll('[data-like]').forEach(btn => btn.onclick = async () => {
    await api(`/posts/${btn.dataset.like}/like`, { method: 'POST' });
    renderHome(main);
  });
  postsEl.querySelectorAll('[data-comment-toggle]').forEach(btn => btn.onclick = () => {
    const el = document.getElementById(`comments-${btn.dataset.commentToggle}`);
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
  });
  postsEl.querySelectorAll('[data-send-comment]').forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.sendComment;
    const input = document.getElementById(`comment-input-${id}`);
    if (!input.value.trim()) return;
    await api(`/posts/${id}/comments`, { method: 'POST', body: { content: input.value } });
    renderHome(main);
  });
}

async function renderExplore(main) {
  main.innerHTML = `
    <div class="section-tabs">
      <button data-etab="groups" class="${state.exploreTab==='groups'?'active':''}">Groups</button>
      <button data-etab="breathe" class="${state.exploreTab==='breathe'?'active':''}">Breathe</button>
      <button data-etab="motivation" class="${state.exploreTab==='motivation'?'active':''}">Motivation</button>
      <button data-etab="podcasts" class="${state.exploreTab==='podcasts'?'active':''}">Podcasts</button>
    </div>
    <div id="explore-body"></div>
  `;
  main.querySelectorAll('[data-etab]').forEach(b => b.onclick = () => { state.exploreTab = b.dataset.etab; renderExplore(main); });
  const body = document.getElementById('explore-body');

  if (state.exploreTab === 'groups') {
    const { groups, quests } = await api('/explore');
    body.innerHTML = `
      <h2>Groups</h2>
      ${groups.map(g => `<div class="card glass"><strong>${g.name}</strong><div class="muted">${g.description}</div></div>`).join('')}
      <h2>Quests</h2>
      ${quests.map(q => `<div class="card glass"><strong>${q.name}</strong><div class="muted">${q.description} · theme: ${q.theme}</div></div>`).join('')}
    `;
  } else if (state.exploreTab === 'breathe') {
    body.innerHTML = `
      <div class="card glass" style="text-align:center">
        <h2>Box Breathing</h2>
        <p class="muted">Inhale 4s · Hold 4s · Exhale 4s · Hold 4s</p>
        <div class="breathe-circle" id="breathe-circle">Start</div>
        <button class="primary" id="breathe-toggle" style="margin-top:16px">Begin session</button>
      </div>
    `;
    let breatheInterval = null, phaseIdx = 0, seconds = 0;
    const phases = [
      { label: 'Inhale', cls: 'in' }, { label: 'Hold', cls: 'in' },
      { label: 'Exhale', cls: 'out' }, { label: 'Hold', cls: 'out' },
    ];
    document.getElementById('breathe-toggle').onclick = async (e) => {
      const circle = document.getElementById('breathe-circle');
      if (breatheInterval) {
        clearInterval(breatheInterval); breatheInterval = null;
        e.target.textContent = 'Begin session'; circle.textContent = 'Start'; circle.className = 'breathe-circle';
        await api('/breathing/complete', { method: 'POST', body: { pattern: 'box', duration_sec: seconds } });
        return;
      }
      e.target.textContent = 'End session'; seconds = 0; phaseIdx = 0;
      const tick = () => {
        const p = phases[phaseIdx % 4];
        circle.textContent = p.label; circle.className = 'breathe-circle ' + p.cls;
        phaseIdx++; seconds += 4;
      };
      tick();
      breatheInterval = setInterval(tick, 4000);
    };
  } else if (state.exploreTab === 'motivation') {
    const q = await api('/motivation');
    body.innerHTML = `
      <div class="card glass quote-card">
        <div class="q">“${escapeHtml(q.text)}”</div>
        <div class="a">— ${escapeHtml(q.attribution)}</div>
      </div>
      <button class="ghost" style="width:100%" id="another-quote">Show another</button>
    `;
    document.getElementById('another-quote').onclick = () => renderExplore(main);
  } else if (state.exploreTab === 'podcasts') {
    const podcasts = await api('/podcasts');
    body.innerHTML = `<h2>Podcasts</h2><div class="card glass">` + podcasts.map(p => `
      <div class="podcast-row">
        <div class="podcast-art">🎙️</div>
        <div class="podcast-meta"><div class="podcast-title">${p.title}</div><div class="podcast-sub">${p.host} · ${p.duration_min} min</div></div>
        <div class="play-btn">▶</div>
      </div>
    `).join('') + `</div>`;
  }
}

async function renderProfile(main) {
  const me = await api('/me');
  state.me = me;
  main.innerHTML = `
    <div class="card glass">
      <div class="profile-header">
        <div class="avatar">${initials(me.user.display_name)}</div>
        <div>
          <div style="font-weight:700;font-size:1.05rem">${me.user.display_name}</div>
          <div class="muted">Level ${me.xp?.level ?? 1} · ${me.xp?.xp ?? 0} XP</div>
          <div class="profile-stats">
            <div><div class="v">${me.stats.workouts}</div><div class="l">Workouts</div></div>
            <div><div class="v">${me.stats.followers}</div><div class="l">Followers</div></div>
            <div><div class="v">${me.stats.following}</div><div class="l">Following</div></div>
          </div>
        </div>
      </div>
      <div class="badge-row">
        ${me.badges.length ? me.badges.map(b => `<span class="badge-pill">${b.icon} ${b.name}</span>`).join('') : '<span class="muted">No badges yet — complete a workout!</span>'}
      </div>
    </div>
    <div class="card glass">
      <h2>Connected Devices</h2>
      <div class="muted" id="ble-status">${state.bleConnected ? `Connected: ${state.bleDevice?.name || 'Heart rate monitor'}` : 'No Bluetooth heart rate monitor connected.'}</div>
      <button class="ghost" style="width:100%;margin-top:10px" id="ble-connect">${state.bleConnected ? 'Disconnect' : 'Pair Bluetooth Heart Rate Monitor'}</button>
      <div class="muted" style="margin-top:6px">Requires Chrome/Edge on a device with Bluetooth. Standard BLE Heart Rate Service (0x180D) — works with most chest straps.</div>
    </div>
    <div class="card glass">
      <h2>Privacy</h2>
      <div class="toggle-row">
        <span>Share biometrics for workout tracking</span>
        <label class="switch"><input type="checkbox" id="c-biometric" ${me.consents.includes('biometric_ingest') ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="toggle-row">
        <span>Personalize scripture with my biometrics</span>
        <label class="switch"><input type="checkbox" id="c-scripture" ${me.consents.includes('scripture_personalization') ? 'checked' : ''}><span class="slider"></span></label>
      </div>
    </div>
    <button class="ghost" id="signout" style="width:100%">Switch profile</button>
  `;
  document.getElementById('c-biometric').onchange = (e) => api('/consent', { method: 'POST', body: { scope: 'biometric_ingest', granted: e.target.checked } });
  document.getElementById('c-scripture').onchange = (e) => api('/consent', { method: 'POST', body: { scope: 'scripture_personalization', granted: e.target.checked } });
  document.getElementById('signout').onclick = () => { document.cookie = 'faithfit_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; location.reload(); };
  document.getElementById('ble-connect').onclick = () => state.bleConnected ? disconnectBle() : connectBle();
}

// ---- Web Bluetooth: real heart rate monitor pairing (standard GATT Heart Rate Service) ----
async function connectBle() {
  if (!navigator.bluetooth) { alert('Web Bluetooth isn\'t supported in this browser. Try Chrome or Edge on desktop/Android.'); return; }
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const characteristic = await service.getCharacteristic('heart_rate_measurement');
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', (e) => {
      const value = e.target.value;
      const flags = value.getUint8(0);
      const hr = (flags & 0x1) ? value.getUint16(1, true) : value.getUint8(1);
      state.hr = hr;
      const hrEl = document.getElementById('hr-display');
      if (hrEl) hrEl.textContent = hr;
    });
    state.bleDevice = device; state.bleServer = server; state.bleConnected = true;
    device.addEventListener('gattserverdisconnected', () => { state.bleConnected = false; render(); });
    render();
  } catch (err) {
    console.error(err);
    if (err.name !== 'NotFoundError') alert('Could not connect: ' + err.message);
  }
}
function disconnectBle() {
  if (state.bleServer) state.bleServer.disconnect();
  state.bleConnected = false; state.bleDevice = null;
  render();
}

async function renderWorkout(main) {
  main.innerHTML = `
    <div class="workout-screen">
      <select id="workout-type" ${state.activeWorkout ? 'disabled' : ''}>
        <option>Run</option><option>Strength</option><option>Cycle</option><option>Yoga</option>
      </select>
      <div class="hr-ring"><div class="hr-display" id="hr-display">${state.hr || '--'}</div><div class="hr-label">BPM ${state.bleConnected ? '· 📶 live' : '· simulated'}</div></div>
      <div class="timer-display" id="timer-display">${formatElapsed(state.elapsed)}</div>
      <button class="start-stop-btn ${state.activeWorkout ? 'stop' : 'start'}" id="start-stop">${state.activeWorkout ? 'Stop' : 'Start'}</button>
      <div id="gps-status" class="muted"></div>
      <div id="map" style="width:100%;height:180px;border-radius:16px;overflow:hidden;display:none"></div>
      <div id="verse-preview" style="width:100%"></div>
    </div>
  `;
  document.getElementById('start-stop').onclick = () => state.activeWorkout ? stopWorkout() : startWorkout();
  if (state.activeWorkout && state.gpsPoints.length) initMap(true);
}

function initMap(alreadyTracking) {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  mapEl.style.display = 'block';
  const start = state.gpsPoints[0] || [37.7749, -122.4194];
  state.leafletMap = L.map(mapEl, { zoomControl: false, attributionControl: false }).setView(start, 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.leafletMap);
  state.leafletLine = L.polyline(state.gpsPoints, { color: '#7c6bff', weight: 4 }).addTo(state.leafletMap);
}

// ---- Real GPS tracking via Geolocation API ----
function startGps() {
  const statusEl = () => document.getElementById('gps-status');
  if (!navigator.geolocation) { if (statusEl()) statusEl().textContent = 'GPS not supported in this browser.'; return; }
  state.gpsPoints = [];
  state.gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const pt = [pos.coords.latitude, pos.coords.longitude];
      state.gpsPoints.push(pt);
      if (statusEl()) statusEl().textContent = `GPS locked · ${state.gpsPoints.length} points · ±${Math.round(pos.coords.accuracy)}m`;
      if (!state.leafletMap && document.getElementById('map')) initMap(false);
      if (state.leafletMap) { state.leafletLine.addLatLng(pt); state.leafletMap.panTo(pt); }
    },
    (err) => { if (statusEl()) statusEl().textContent = 'GPS permission denied or unavailable — logging without route.'; },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
  );
}
function stopGps() { if (state.gpsWatchId != null) navigator.geolocation.clearWatch(state.gpsWatchId); state.gpsWatchId = null; }

function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[0]-a[0]), dLon = toRad(b[1]-a[1]);
  const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function gpsDistanceKm() {
  let d = 0;
  for (let i = 1; i < state.gpsPoints.length; i++) d += haversineKm(state.gpsPoints[i-1], state.gpsPoints[i]);
  return d;
}

async function startWorkout() {
  const type = document.getElementById('workout-type').value;
  const w = await api('/workouts/start', { method: 'POST', body: { type } });
  state.activeWorkout = w.id;
  state.elapsed = 0;
  if (!state.bleConnected) state.hr = Math.floor(100 + Math.random() * 20);
  startGps();
  renderWorkout(document.getElementById('main'));
  state.hrTimer = setInterval(async () => {
    state.elapsed += 1;
    if (!state.bleConnected) { state.hr = Math.floor(110 + Math.random() * 60); document.getElementById('hr-display').textContent = state.hr; }
    document.getElementById('timer-display').textContent = formatElapsed(state.elapsed);
    if (state.elapsed % 5 === 0) {
      const result = await api(`/workouts/${state.activeWorkout}/sample`, { method: 'POST', body: { heart_rate: state.hr, stress_level: Math.floor(Math.random() * 4) } });
      const vp = document.getElementById('verse-preview');
      if (vp) vp.innerHTML = `<div class="verse-card" style="margin-top:12px"><div class="verse-ref">${result.verse.reference}</div><div class="verse-text">${escapeHtml(result.verse.snippet || '')}</div></div>`;
    }
  }, 1000);
}

async function stopWorkout() {
  clearInterval(state.hrTimer);
  stopGps();
  const distanceKm = gpsDistanceKm();
  const summary = await api(`/workouts/${state.activeWorkout}/stop`, { method: 'POST', body: { gps_distance_km: distanceKm, gps_points: state.gpsPoints.length } });
  state.activeWorkout = null;
  const distMsg = distanceKm > 0 ? ` · ${distanceKm.toFixed(2)} km via real GPS` : '';
  alert(`Workout complete! ${summary.calories} kcal, avg HR ${summary.avg_hr ?? '--'}${distMsg}`);
  state.gpsPoints = []; state.leafletMap = null;
  renderWorkout(document.getElementById('main'));
}

function formatElapsed(s) { const m = Math.floor(s / 60), sec = s % 60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

document.querySelectorAll('nav button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

(async () => { await loadMe(); render(); })();
