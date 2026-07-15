const state = { tab: 'home', me: null, activeWorkout: null, hrTimer: null, elapsed: 0, hr: 0 };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { renderSignIn(); throw new Error('not_signed_in'); }
  return res.json();
}

async function loadMe() {
  try { state.me = await api('/me'); } catch { state.me = null; }
}

function setTab(tab) {
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

async function renderSignIn() {
  const users = await api('/users');
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="card">
      <h2>Choose a demo profile</h2>
      <p class="muted">No password needed — this is a local demo. Pick a user to sign in as.</p>
      ${users.map(u => `<button class="ghost" style="width:100%;margin-bottom:8px;text-align:left" data-signin="${u.id}">${u.display_name} <span class="muted">— ${u.bio || ''}</span></button>`).join('')}
    </div>`;
  main.querySelectorAll('[data-signin]').forEach(btn => {
    btn.onclick = async () => {
      await api('/session', { method: 'POST', body: { user_id: btn.dataset.signin } });
      await loadMe();
      render();
    };
  });
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
}

async function renderHome(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  const posts = await api('/feed');
  main.innerHTML = `<h2>Home Feed</h2>` + posts.map(p => `
    <div class="card">
      <div class="post-author">${p.author}</div>
      <div class="post-content">${escapeHtml(p.content || '')}</div>
      ${p.workout_type ? `<div class="workout-chip">🏃 ${p.workout_type} · ${p.calories || '—'} kcal · avg HR ${p.avg_hr || '—'}</div>` : ''}
      ${p.verse_reference ? `<div class="verse-card"><div class="verse-ref">${p.verse_reference}</div><div class="verse-text">${escapeHtml(p.verse_text || '')}</div></div>` : ''}
      <div class="muted" style="margin-top:6px">${new Date(p.created_at).toLocaleString()}</div>
    </div>
  `).join('') || '<p class="muted">No posts yet.</p>';
}

async function renderExplore(main) {
  const { groups, quests } = await api('/explore');
  main.innerHTML = `
    <h2>Groups</h2>
    ${groups.map(g => `<div class="card"><strong>${g.name}</strong><div class="muted">${g.description}</div></div>`).join('')}
    <h2>Quests</h2>
    ${quests.map(q => `<div class="card"><strong>${q.name}</strong><div class="muted">${q.description} (theme: ${q.theme})</div></div>`).join('')}
  `;
}

async function renderProfile(main) {
  const me = await api('/me');
  state.me = me;
  main.innerHTML = `
    <div class="card">
      <div class="profile-header">
        <div class="avatar">${(me.user.display_name || '?')[0]}</div>
        <div>
          <div style="font-weight:700">${me.user.display_name}</div>
          <div class="muted">Level ${me.xp?.level ?? 1} · ${me.xp?.xp ?? 0} XP</div>
        </div>
      </div>
      <div class="badge-row">
        ${me.badges.length ? me.badges.map(b => `<span class="badge-pill">${b.icon} ${b.name}</span>`).join('') : '<span class="muted">No badges yet — complete a workout!</span>'}
      </div>
    </div>
    <div class="card">
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
}

async function renderWorkout(main) {
  main.innerHTML = `
    <div class="workout-screen">
      <select id="workout-type" ${state.activeWorkout ? 'disabled' : ''}>
        <option>Run</option><option>Strength</option><option>Cycle</option><option>Yoga</option>
      </select>
      <div class="hr-display" id="hr-display">${state.hr || '--'}</div>
      <div class="hr-label">BPM</div>
      <div class="timer-display" id="timer-display">${formatElapsed(state.elapsed)}</div>
      <button class="start-stop-btn ${state.activeWorkout ? 'stop' : 'start'}" id="start-stop">${state.activeWorkout ? 'Stop' : 'Start'}</button>
      <div id="verse-preview"></div>
    </div>
  `;
  document.getElementById('start-stop').onclick = () => state.activeWorkout ? stopWorkout() : startWorkout();
}

async function startWorkout() {
  const type = document.getElementById('workout-type').value;
  const w = await api('/workouts/start', { method: 'POST', body: { type } });
  state.activeWorkout = w.id;
  state.elapsed = 0;
  state.hr = Math.floor(100 + Math.random() * 20);
  renderWorkout(document.getElementById('main'));
  state.hrTimer = setInterval(async () => {
    state.elapsed += 1;
    state.hr = Math.floor(110 + Math.random() * 60);
    document.getElementById('hr-display').textContent = state.hr;
    document.getElementById('timer-display').textContent = formatElapsed(state.elapsed);
    if (state.elapsed % 5 === 0) {
      const result = await api(`/workouts/${state.activeWorkout}/sample`, { method: 'POST', body: { heart_rate: state.hr, stress_level: Math.floor(Math.random() * 4) } });
      const vp = document.getElementById('verse-preview');
      if (vp) vp.innerHTML = `<div class="verse-card" style="margin-top:16px"><div class="verse-ref">${result.verse.reference}</div><div class="verse-text">${escapeHtml(result.verse.snippet || '')}</div></div>`;
    }
  }, 1000);
}

async function stopWorkout() {
  clearInterval(state.hrTimer);
  const summary = await api(`/workouts/${state.activeWorkout}/stop`, { method: 'POST' });
  state.activeWorkout = null;
  alert(`Workout complete! ${summary.calories} kcal, avg HR ${summary.avg_hr ?? '--'}`);
  renderWorkout(document.getElementById('main'));
}

function formatElapsed(s) { const m = Math.floor(s / 60), sec = s % 60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

document.querySelectorAll('nav button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

(async () => { await loadMe(); render(); })();
