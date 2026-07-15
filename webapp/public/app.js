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

let signInMode = 'login'; // 'login' | 'register'

async function renderSignIn() {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');

  const isRegister = signInMode === 'register';
  main.innerHTML = `
    <div class="card glass">
      <h2>${isRegister ? 'Create your account' : 'Welcome back'}</h2>
      <p class="muted">${isRegister ? 'Faith and fitness, together. Free to join.' : 'Sign in to continue your journey.'}</p>
      <form id="auth-form" autocomplete="on">
        ${isRegister ? `
        <label class="field-label">Name</label>
        <input class="input" name="display_name" type="text" placeholder="Your name" autocomplete="name" required />` : ''}
        <label class="field-label">Email</label>
        <input class="input" name="email" type="email" placeholder="you@example.com" autocomplete="email" required />
        <label class="field-label">Password</label>
        <input class="input" name="password" type="password" placeholder="${isRegister ? 'At least 8 characters' : 'Your password'}" autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="8" required />
        <p class="form-error" id="auth-error" hidden></p>
        <button class="primary" type="submit" style="width:100%;margin-top:12px">${isRegister ? 'Create account' : 'Sign in'}</button>
      </form>
      <p class="muted" style="margin-top:14px;text-align:center">
        ${isRegister ? 'Already have an account?' : "Don't have an account yet?"}
        <a href="#" id="auth-toggle">${isRegister ? 'Sign in' : 'Create one'}</a>
      </p>
      <div class="auth-divider"><span>or</span></div>
      <button class="ghost" id="demo-open" style="width:100%">Explore a demo profile</button>
    </div>`;

  const errEl = main.querySelector('#auth-error');
  const showErr = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

  main.querySelector('#auth-toggle').onclick = (e) => { e.preventDefault(); signInMode = isRegister ? 'login' : 'register'; renderSignIn(); };

  main.querySelector('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    const endpoint = isRegister ? '/auth/register' : '/auth/login';
    const res = await fetch('/api' + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) { await loadMe(); return render(); }
    const data = await res.json().catch(() => ({}));
    const messages = {
      invalid_email: 'Please enter a valid email address.',
      weak_password: 'Password must be at least 8 characters.',
      missing_display_name: 'Please enter your name.',
      email_taken: 'An account with that email already exists.',
      invalid_credentials: 'Email or password is incorrect.',
    };
    showErr(messages[data.error] || 'Something went wrong. Please try again.');
  };

  main.querySelector('#demo-open').onclick = async () => {
    const users = await api('/auth/demo-users');
    main.innerHTML = `
      <div class="card glass">
        <h2>Explore a demo profile</h2>
        <p class="muted">Example accounts with sample data — no password. Not real users.</p>
        ${users.map(u => `<button class="ghost" style="width:100%;margin-bottom:8px;text-align:left;display:flex;align-items:center;gap:10px" data-demo="${u.id}"><span class="avatar-sm">${initials(u.display_name)}</span><span>${u.display_name}<br><span class="muted">${u.bio_verse_ref || ''}</span></span></button>`).join('')}
        <button class="ghost" id="demo-back" style="width:100%;margin-top:6px">← Back to sign in</button>
      </div>`;
    main.querySelector('#demo-back').onclick = () => renderSignIn();
    main.querySelectorAll('[data-demo]').forEach(btn => {
      btn.onclick = async () => { await api('/auth/demo', { method: 'POST', body: { user_id: btn.dataset.demo } }); await loadMe(); render(); };
    });
  };
}

function routeSvg(seed) {
  const pts = [];
  let x = 10, y = 55 + (seed % 20);
  for (let i = 0; i < 8; i++) { x += 20 + (i % 3) * 5; y += Math.sin(i + seed) * 18; pts.push(`${x},${Math.max(10, Math.min(100, y))}`); }
  return `<svg viewBox="0 0 200 110" preserveAspectRatio="none"><polyline points="${pts.join(' ')}" fill="none" stroke="#c8b273" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/></svg>`;
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
  const myId = state.me && state.me.user && state.me.user.id;
  const visLabel = { private: '🔒 Only me', followers: '👥 Followers', public: '🌍 Public' };
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = posts.map((p, i) => {
    const isMine = p.author_id === myId;
    return `
    <div class="card glass" data-post="${p.id}">
      <div class="post-head">
        <div class="avatar-sm">${initials(p.author)}</div>
        <div style="flex:1">
          <div class="post-author">${p.author}</div>
          <div class="post-time">${timeAgo(p.created_at)} ago${p.visibility && p.visibility !== 'public' ? ' · ' + visLabel[p.visibility] : ''}</div>
        </div>
        ${isMine ? `<select class="vis-select" data-vis="${p.id}" title="Who can see this">
          ${['public','followers','private'].map(v => `<option value="${v}" ${p.visibility===v?'selected':''}>${visLabel[v]}</option>`).join('')}
        </select>` : ''}
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
        <button class="action-btn" data-share="${p.id}" data-vis="${p.visibility || 'public'}">↗ Share</button>
      </div>
      <div class="comments" id="comments-${p.id}" style="display:none">
        ${p.comments.map(c => `<div class="comment"><b>${c.author}</b>${escapeHtml(c.content)}</div>`).join('')}
        <div class="comment-input-row">
          <input type="text" placeholder="Add a comment…" id="comment-input-${p.id}" />
          <button data-send-comment="${p.id}">Post</button>
        </div>
      </div>
    </div>
  `; }).join('') || '<p class="muted">No posts yet.</p>';

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
  postsEl.querySelectorAll('[data-vis]').forEach(sel => {
    if (sel.tagName !== 'SELECT') return;
    sel.onchange = async () => {
      await fetch(`/api/posts/${sel.dataset.vis}/visibility`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: sel.value }),
      });
      renderHome(main);
    };
  });
  postsEl.querySelectorAll('[data-share]').forEach(btn => btn.onclick = async () => {
    if (btn.dataset.vis !== 'public') { alert('Set this workout to Public to get a shareable link.'); return; }
    const url = `${location.origin}/w/${btn.dataset.share}`;
    try { await navigator.clipboard.writeText(url); btn.textContent = '✓ Link copied'; setTimeout(() => renderHome(main), 1200); }
    catch { prompt('Copy this share link:', url); }
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
      <h2>Profile Details</h2>
      <div class="muted" style="margin-bottom:10px">Your bio can only be a Bible verse — pick one from our verified library. Other fields are optional.</div>
      <div id="verse-preview" class="verse-preview">${me.user.bio_verse_ref ? `📖 <strong>${me.user.bio_verse_ref}</strong> — "${me.user.bio_verse_text}"` : 'No verse selected yet.'}</div>
      <label class="field-label">Bio verse</label>
      <select id="p-verse"><option value="">— Select a verse —</option></select>
      <label class="field-label">Job</label>
      <input id="p-job" type="text" maxlength="80" placeholder="e.g. Nurse" value="${me.user.job || ''}">
      <label class="field-label">Church</label>
      <input id="p-church" type="text" maxlength="80" placeholder="e.g. Grace Community Church" value="${me.user.church || ''}">
      <label class="field-label">Fitness group</label>
      <input id="p-group" type="text" maxlength="80" placeholder="e.g. Sunrise 5K Fellowship" value="${me.user.fitness_group || ''}">
      <label class="field-label">Gym</label>
      <input id="p-gym" type="text" maxlength="80" placeholder="e.g. Anytime Fitness" value="${me.user.gym || ''}">
      <div class="toggle-row">
        <span>Show my age (optional)</span>
        <label class="switch"><input type="checkbox" id="p-showage" ${me.user.show_age ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <input id="p-age" type="number" min="13" max="120" placeholder="Age" value="${me.user.age ?? ''}" style="max-width:120px">
      <button class="primary" id="p-save" style="width:100%;margin-top:10px">Save Profile</button>
      <div id="p-status" class="muted" style="margin-top:6px"></div>
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
      <label class="field-label">Default visibility for new workouts</label>
      <select id="p-defvis">
        ${[['public','🌍 Public'],['followers','👥 Followers'],['private','🔒 Only me']].map(([v,l]) => `<option value="${v}" ${((me.user.default_visibility||'public')===v)?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>
    <button class="ghost" id="signout" style="width:100%">Sign out</button>
  `;
  document.getElementById('p-defvis').onchange = async (e) => {
    await api('/profile', { method: 'PUT', body: { default_visibility: e.target.value } });
    await loadMe();
  };
  document.getElementById('c-biometric').onchange = (e) => api('/consent', { method: 'POST', body: { scope: 'biometric_ingest', granted: e.target.checked } });
  document.getElementById('c-scripture').onchange = (e) => api('/consent', { method: 'POST', body: { scope: 'scripture_personalization', granted: e.target.checked } });
  document.getElementById('signout').onclick = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    state.me = null; signInMode = 'login'; location.reload();
  };
  document.getElementById('ble-connect').onclick = () => state.bleConnected ? disconnectBle() : connectBle();

  // Populate the verified-verse picker from the real Bible library (never freeform).
  const versePicker = document.getElementById('p-verse');
  try {
    const philippians = await api('/bible/passage/Philippians/4');
    const james1 = await api('/bible/passage/James/1');
    const psalm23 = await api('/bible/passage/Psalms/23');
    const romans8 = await api('/bible/passage/Romans/8');
    const options = [...philippians.verses, ...james1.verses, ...psalm23.verses, ...romans8.verses];
    options.forEach(v => {
      const ref = `${v.book} ${v.chapter}:${v.verse}`;
      const opt = document.createElement('option');
      opt.value = ref;
      opt.textContent = `${ref} — ${v.text.slice(0, 50)}${v.text.length > 50 ? '…' : ''}`;
      if (ref === me.user.bio_verse_ref) opt.selected = true;
      versePicker.appendChild(opt);
    });
  } catch (e) { console.error('verse picker load failed', e); }

  document.getElementById('p-save').onclick = async () => {
    const status = document.getElementById('p-status');
    status.textContent = 'Saving…';
    try {
      const body = {
        bio_verse_ref: versePicker.value || null,
        job: document.getElementById('p-job').value,
        church: document.getElementById('p-church').value,
        fitness_group: document.getElementById('p-group').value,
        gym: document.getElementById('p-gym').value,
        age: document.getElementById('p-age').value || null,
        show_age: document.getElementById('p-showage').checked,
      };
      const res = await api('/profile', { method: 'PUT', body });
      if (res.error) {
        status.textContent = res.hint || ('Could not save: ' + res.error);
      } else {
        status.textContent = 'Saved.';
        render();
      }
    } catch (e) {
      status.textContent = e.message || 'Could not save.';
    }
  };
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
  state.leafletLine = L.polyline(state.gpsPoints, { color: '#3d5a45', weight: 4 }).addTo(state.leafletMap);
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
      state.lastVerseId = result.verse_id || null;
      state.lastVerse = result.verse || null;
      const vp = document.getElementById('verse-preview');
      if (vp) vp.innerHTML = `<div class="verse-card" style="margin-top:12px"><div class="verse-ref">${result.verse.reference}</div><div class="verse-text">${escapeHtml(result.verse.snippet || '')}</div></div>`;
    }
  }, 1000);
}

async function stopWorkout() {
  clearInterval(state.hrTimer);
  stopGps();
  const workoutId = state.activeWorkout;
  const distanceKm = gpsDistanceKm();
  const summary = await api(`/workouts/${workoutId}/stop`, { method: 'POST', body: { gps_distance_km: distanceKm, gps_path: state.gpsPoints } });
  state.activeWorkout = null;
  state.gpsPoints = []; state.leafletMap = null;
  renderShareForm(document.getElementById('main'), { workoutId, summary, distanceKm, verseId: state.lastVerseId, verse: state.lastVerse });
}

// "Post this workout" — a deliberate step after completing, distinct from just
// finishing. Add a caption + reflection and choose who can see it.
function renderShareForm(main, ctx) {
  const defVis = (state.me && state.me.user && state.me.user.default_visibility) || 'public';
  const visLabel = { private: '🔒 Only me', followers: '👥 Followers', public: '🌍 Public (shareable link)' };
  const s = ctx.summary || {};
  const distMsg = ctx.distanceKm > 0 ? ` · ${ctx.distanceKm.toFixed(2)} km via GPS` : '';
  main.innerHTML = `
    <div class="card glass">
      <h2>Workout complete 🎉</h2>
      <p class="muted">${s.calories ?? '—'} kcal · avg HR ${s.avg_hr ?? '—'}${distMsg}</p>
      ${ctx.verse ? `<div class="verse-card" style="margin:10px 0"><div class="verse-ref">${ctx.verse.reference}</div><div class="verse-text">${escapeHtml(ctx.verse.snippet || '')}</div></div>` : ''}
      <label class="field-label">Add a caption or reflection</label>
      <textarea class="input" id="share-caption" rows="3" placeholder="How did it go? What did this verse mean today?"></textarea>
      <label class="field-label">Who can see this?</label>
      <select class="input" id="share-vis">
        ${['public','followers','private'].map(v => `<option value="${v}" ${v===defVis?'selected':''}>${visLabel[v]}</option>`).join('')}
      </select>
      <div id="share-result" class="muted" style="margin-top:10px"></div>
      <div style="display:flex; gap:10px; margin-top:14px">
        <button class="ghost" id="share-skip" style="flex:1">Skip</button>
        <button class="primary" id="share-post" style="flex:2">Post workout</button>
      </div>
    </div>`;

  main.querySelector('#share-skip').onclick = () => { state.lastVerseId = null; state.lastVerse = null; setTab('home'); };
  main.querySelector('#share-post').onclick = async () => {
    const content = main.querySelector('#share-caption').value.trim();
    const visibility = main.querySelector('#share-vis').value;
    const res = await api('/posts', { method: 'POST', body: { content, workout_id: ctx.workoutId, verse_id: ctx.verseId, visibility } });
    state.lastVerseId = null; state.lastVerse = null;
    if (res.share_url) {
      const url = `${location.origin}${res.share_url}`;
      main.querySelector('#share-result').innerHTML = `Posted! Public link: <a href="${res.share_url}" target="_blank">${url}</a>`;
      main.querySelector('#share-post').textContent = 'View feed →';
      main.querySelector('#share-post').onclick = () => setTab('home');
      main.querySelector('#share-skip').style.display = 'none';
    } else {
      setTab('home');
    }
  };
}

function formatElapsed(s) { const m = Math.floor(s / 60), sec = s % 60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

document.querySelectorAll('nav button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

(async () => { await loadMe(); render(); })();
