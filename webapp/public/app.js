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
  if (state.tab === 'stats') return renderStats(main);
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
  const [posts, users, suggested, rec] = await Promise.all([api('/feed'), api('/users'), api('/users/suggested').catch(() => []), api('/recommendations').catch(() => null)]);
  main.innerHTML = `
    <div class="stories">
      ${users.map(u => `<div class="story" data-user="${u.id}"><div class="story-ring"><div class="story-avatar">${initials(u.display_name)}</div></div><div class="story-label">${u.display_name.split(' ')[0]}</div></div>`).join('')}
    </div>
    ${rec ? `
    <div class="card glass foryou-card">
      <div class="foryou-head">✦ For you</div>
      ${rec.verse ? `<div class="verse-card" style="margin-bottom:10px"><div class="verse-ref">${rec.verse.reference}</div><div class="verse-text">${escapeHtml(rec.verse.text)}</div></div>` : ''}
      <div class="foryou-grid">
        ${rec.podcast ? `<div class="foryou-item"><div class="foryou-label">🎙️ Listen</div><div class="foryou-title">${escapeHtml(rec.podcast.title)}</div><div class="muted" style="font-size:0.74rem">${escapeHtml(rec.podcast.show)}</div>${rec.podcast.audio_url ? `<audio controls preload="none" src="${escapeHtml(rec.podcast.audio_url)}" style="width:100%;margin-top:6px;height:32px"></audio>` : ''}</div>` : ''}
        ${rec.challenge ? `<div class="foryou-item foryou-challenge" data-join-key="${rec.challenge.key}"><div class="foryou-label">🏆 Try a challenge</div><div class="foryou-title">${escapeHtml(rec.challenge.name)}</div><div class="muted" style="font-size:0.74rem">${escapeHtml(rec.challenge.description || '')}</div><button class="follow-btn" style="margin-top:8px" data-join-key="${rec.challenge.key}">Join</button></div>` : ''}
      </div>
    </div>` : ''}
    ${suggested && suggested.length ? `
    <div class="card glass suggest-card">
      <div class="suggest-head">People to follow</div>
      <div class="suggest-rail">
        ${suggested.map(u => `
          <div class="suggest-item" data-user="${u.id}">
            <div class="avatar-sm suggest-avatar">${initials(u.display_name)}</div>
            <div class="suggest-name">${escapeHtml(u.display_name)}</div>
            <div class="suggest-sub">${u.followers_count} follower${u.followers_count===1?'':'s'}</div>
            <button class="follow-btn" data-follow="${u.id}">Follow</button>
          </div>`).join('')}
      </div>
    </div>` : ''}
    <div id="posts"></div>
  `;
  main.querySelectorAll('[data-join-key]').forEach(el => { if (el.tagName === 'BUTTON') el.onclick = async (e) => {
    e.stopPropagation();
    await api(`/challenges/${el.dataset.joinKey}/join`, { method: 'POST' });
    el.textContent = 'Joined ✓'; el.classList.add('following');
  }; });
  main.querySelectorAll('.story[data-user]').forEach(el => el.onclick = () => renderUserProfile(el.dataset.user));
  main.querySelectorAll('.suggest-item').forEach(el => el.onclick = (e) => { if (!e.target.closest('[data-follow]')) renderUserProfile(el.dataset.user); });
  main.querySelectorAll('[data-follow]').forEach(btn => btn.onclick = async (e) => {
    e.stopPropagation();
    const r = await api(`/users/${btn.dataset.follow}/follow`, { method: 'POST' });
    btn.textContent = r.following ? 'Following' : 'Follow';
    btn.classList.toggle('following', r.following);
  });
  const myId = state.me && state.me.user && state.me.user.id;
  const visLabel = { private: '🔒 Only me', followers: '👥 Followers', public: '🌍 Public' };
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = posts.map((p, i) => {
    const isMine = p.author_id === myId;
    return `
    <div class="card glass" data-post="${p.id}">
      <div class="post-head">
        <div class="avatar-sm post-user" data-user="${p.author_id}">${initials(p.author)}</div>
        <div style="flex:1">
          <div class="post-author post-user" data-user="${p.author_id}">${p.author}</div>
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

  postsEl.querySelectorAll('.post-user[data-user]').forEach(el => el.onclick = () => renderUserProfile(el.dataset.user));
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

// A tappable public profile for any member — social presence beyond the feed.
async function renderUserProfile(userId) {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  main.innerHTML = `<div class="card glass" style="text-align:center">Loading…</div>`;
  let data;
  try { data = await api(`/users/${userId}`); } catch { main.innerHTML = '<div class="card glass">Could not load profile.</div>'; return; }
  const u = data.user;
  const followBtn = data.is_me ? '' :
    `<button class="follow-btn ${data.is_following ? 'following' : ''}" id="profile-follow">${data.is_following ? 'Following' : 'Follow'}</button>`;

  main.innerHTML = `
    <button class="ghost back-btn" id="profile-back">← Back</button>
    <div class="card glass">
      <div class="profile-header">
        <div class="avatar">${initials(u.display_name)}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h2 style="margin:0">${escapeHtml(u.display_name)}</h2>${followBtn}
          </div>
          <div class="profile-stats">
            <div><div class="v">${data.stats.workouts}</div><div class="l">Workouts</div></div>
            <div><div class="v" id="pf-followers">${data.stats.followers}</div><div class="l">Followers</div></div>
            <div><div class="v">${data.stats.following}</div><div class="l">Following</div></div>
          </div>
        </div>
      </div>
      ${u.bio_verse_ref ? `<div class="verse-card"><div class="verse-ref">${u.bio_verse_ref}</div><div class="verse-text">${escapeHtml(u.bio_verse_text || '')}</div></div>` : ''}
    </div>
    <div id="profile-posts">${data.posts.length ? '' : '<p class="muted">No posts to show yet.</p>'}</div>
  `;

  const pp = document.getElementById('profile-posts');
  if (data.posts.length) pp.innerHTML = data.posts.map((p, i) => `
    <div class="card glass">
      <div class="post-time" style="margin-bottom:8px">${timeAgo(p.created_at)} ago</div>
      ${p.content ? `<div class="post-content">${escapeHtml(p.content)}</div>` : ''}
      ${p.workout_type ? `<div class="route-banner">${routeSvg(i)}<span class="badge-overlay">${p.workout_type}</span></div>
        <div class="stat-row">
          <div class="stat"><div class="v">${p.distance_km ?? '—'}</div><div class="l">km</div></div>
          <div class="stat"><div class="v">${p.calories ?? '—'}</div><div class="l">kcal</div></div>
          <div class="stat"><div class="v">${p.avg_hr ?? '—'}</div><div class="l">avg hr</div></div>
        </div>` : ''}
      ${p.verse_reference ? `<div class="verse-card"><div class="verse-ref">${p.verse_reference}</div><div class="verse-text">${escapeHtml(p.verse_text || '')}</div></div>` : ''}
    </div>`).join('');

  document.getElementById('profile-back').onclick = () => { state.tab = 'home'; render(); };
  const fb = document.getElementById('profile-follow');
  if (fb) fb.onclick = async () => {
    const r = await api(`/users/${userId}/follow`, { method: 'POST' });
    fb.textContent = r.following ? 'Following' : 'Follow';
    fb.classList.toggle('following', r.following);
    document.getElementById('pf-followers').textContent = r.followers_count;
  };
}

// Simple, dependency-free SVG bar chart (theme-colored).
function barChart(data, valueKey, unit) {
  const w = 320, h = 120, pad = 4;
  const max = Math.max(1, ...data.map(d => d[valueKey]));
  const bw = (w - pad * 2) / data.length;
  const bars = data.map((d, i) => {
    const bh = (d[valueKey] / max) * (h - 22);
    const x = pad + i * bw, y = h - 18 - bh;
    return `<rect x="${x + bw * 0.15}" y="${y}" width="${bw * 0.7}" height="${Math.max(1, bh)}" rx="2" fill="url(#barGrad)"/>` +
      (i % Math.ceil(data.length / 6) === 0 ? `<text x="${x + bw / 2}" y="${h - 4}" font-size="8" fill="currentColor" opacity="0.6" text-anchor="middle">${d.label}</text>` : '');
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;color:var(--muted)">
    <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--emerald-2)"/><stop offset="1" stop-color="var(--forest)"/></linearGradient></defs>
    ${bars}
  </svg>`;
}

async function renderStats(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  main.innerHTML = `<div class="card glass" style="text-align:center">Loading your stats…</div>`;
  let summary, trends, breakdown, challenges;
  try {
    [summary, trends, breakdown, challenges] = await Promise.all([
      api('/stats/summary'), api('/stats/trends?weeks=12'), api('/stats/activity-breakdown'), api('/challenges'),
    ]);
  } catch { main.innerHTML = '<div class="card glass">Could not load stats.</div>'; return; }

  const mine = challenges.filter(c => c.joined);
  const tile = (v, l) => `<div class="stat-tile"><div class="stat-tile-v">${v}</div><div class="stat-tile-l">${l}</div></div>`;
  const wk = summary.this_week, mo = summary.this_month, life = summary.lifetime, rec = summary.records;
  const actMax = Math.max(1, ...breakdown.map(b => b.count));

  main.innerHTML = `
    <h2>Your Stats</h2>
    <div class="card glass streak-banner">
      <div><div class="streak-num">${summary.streak_days}</div><div class="muted">day streak 🔥</div></div>
      <div><div class="streak-num">${summary.active_days}</div><div class="muted">active days</div></div>
      <div><div class="streak-num">${life.workouts}</div><div class="muted">workouts</div></div>
    </div>

    <div class="card glass">
      <div class="stats-period-head">This week</div>
      <div class="stat-tiles">${tile(wk.distance_km, 'km')}${tile(wk.duration_min, 'min')}${tile(wk.calories, 'kcal')}${tile(wk.workouts, 'sessions')}</div>
      <div class="stats-period-head" style="margin-top:14px">This month</div>
      <div class="stat-tiles">${tile(mo.distance_km, 'km')}${tile(mo.duration_min, 'min')}${tile(mo.calories, 'kcal')}${tile(mo.workouts, 'sessions')}</div>
    </div>

    <div class="card glass">
      <div class="stats-period-head">Distance · last 12 weeks</div>
      ${barChart(trends, 'distance_km')}
    </div>

    <div class="card glass">
      <div class="stats-period-head">Personal records</div>
      <div class="pr-grid">
        <div class="pr"><span class="pr-l">Longest distance</span><span class="pr-v">${rec.longest_distance_km != null ? rec.longest_distance_km + ' km' : '—'}</span></div>
        <div class="pr"><span class="pr-l">Longest session</span><span class="pr-v">${rec.longest_duration_min != null ? rec.longest_duration_min + ' min' : '—'}</span></div>
        <div class="pr"><span class="pr-l">Fastest pace</span><span class="pr-v">${rec.fastest_pace_min_km != null ? rec.fastest_pace_min_km + ' /km' : '—'}</span></div>
        <div class="pr"><span class="pr-l">Most calories</span><span class="pr-v">${rec.most_calories || '—'}</span></div>
      </div>
    </div>

    ${breakdown.length ? `<div class="card glass">
      <div class="stats-period-head">By activity</div>
      ${breakdown.map(b => `<div class="act-row"><span class="act-name">${b.type}</span>
        <span class="act-bar"><span style="width:${(b.count/actMax)*100}%"></span></span>
        <span class="act-count">${b.count}× · ${b.distance_km > 0 ? b.distance_km + 'km' : b.duration_min + 'min'}</span></div>`).join('')}
    </div>` : ''}

    <div class="card glass">
      <div class="stats-period-head">My challenges</div>
      ${mine.length ? mine.map(c => challengeRow(c)).join('') : '<p class="muted">You haven\'t joined a challenge yet — see Explore › Challenges.</p>'}
    </div>
  `;
}

function challengeRow(c) {
  const unit = c.metric === 'distance_km' ? 'km' : c.metric === 'duration_min' ? 'min' : '';
  return `<div class="challenge-row ${c.completed ? 'done' : ''}">
    <div class="challenge-top"><span class="challenge-name">${c.completed ? '✓ ' : ''}${c.name}</span>
      <span class="challenge-prog">${(+c.progress).toFixed(c.metric==='distance_km'?1:0)}/${c.target} ${unit}</span></div>
    <div class="challenge-track"><span style="width:${c.percent}%"></span></div>
  </div>`;
}

async function renderExplore(main) {
  main.innerHTML = `
    <div class="section-tabs section-tabs-scroll">
      <button data-etab="challenges" class="${state.exploreTab==='challenges'?'active':''}">Challenges</button>
      <button data-etab="groups" class="${state.exploreTab==='groups'?'active':''}">Groups</button>
      <button data-etab="breathe" class="${state.exploreTab==='breathe'?'active':''}">Breathe</button>
      <button data-etab="motivation" class="${state.exploreTab==='motivation'?'active':''}">Motivation</button>
      <button data-etab="podcasts" class="${state.exploreTab==='podcasts'?'active':''}">Podcasts</button>
    </div>
    <div id="explore-body"></div>
  `;
  main.querySelectorAll('[data-etab]').forEach(b => b.onclick = () => { state.exploreTab = b.dataset.etab; renderExplore(main); });
  const body = document.getElementById('explore-body');

  if (state.exploreTab === 'challenges') {
    const challenges = await api('/challenges');
    body.innerHTML = `<h2>Challenges</h2>
      <p class="muted" style="margin-top:-6px;margin-bottom:12px">Themed journeys through scripture and story. Join one — your workouts move you forward.</p>` +
      challenges.map(c => `
        <div class="card glass challenge-card ${c.completed ? 'done' : ''}">
          <div class="challenge-hd">
            <div><div class="challenge-name">${escapeHtml(c.name)}</div>
              ${c.scripture_ref ? `<div class="challenge-ref">${escapeHtml(c.scripture_ref)}</div>` : ''}</div>
            <button class="follow-btn ${c.joined ? 'following' : ''}" data-challenge="${c.key}" data-joined="${c.joined}">${c.completed ? '✓ Done' : c.joined ? 'Joined' : 'Join'}</button>
          </div>
          <div class="challenge-flavor">${escapeHtml(c.flavor || c.description || '')}</div>
          ${c.joined ? `<div class="challenge-track"><span style="width:${c.percent}%"></span></div>
            <div class="muted" style="font-size:0.74rem;margin-top:4px">${(+c.progress).toFixed(c.metric==='distance_km'?1:0)} / ${c.target} ${c.metric==='distance_km'?'km':c.metric==='duration_min'?'min':'workouts'} · ${c.percent}%</div>` :
            `<div class="muted" style="font-size:0.76rem">Goal: ${c.target} ${c.metric==='distance_km'?'km':c.metric==='duration_min'?'minutes':'workouts'} · ${c.participants} joined</div>`}
        </div>`).join('');
    body.querySelectorAll('[data-challenge]').forEach(btn => btn.onclick = async () => {
      const joined = btn.dataset.joined === 'true';
      await api(`/challenges/${btn.dataset.challenge}/${joined ? 'leave' : 'join'}`, { method: 'POST' });
      renderExplore(main);
    });
  } else if (state.exploreTab === 'groups') {
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
    const podcasts = await api('/podcasts?episodes=4');
    const fmtDur = s => s ? `${Math.round(s / 60)} min` : '';
    const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
    body.innerHTML = `<h2>Podcasts</h2>
      <p class="muted" style="margin-top:-6px;margin-bottom:12px">Real, current episodes from independent Christian shows — refreshed from each show's RSS feed.</p>` +
      podcasts.map(p => `
        <div class="card glass">
          <div class="podcast-row" style="border-bottom:none">
            <div class="podcast-art">🎙️</div>
            <div class="podcast-meta"><div class="podcast-title">${escapeHtml(p.title)}</div><div class="podcast-sub">${escapeHtml(p.host)}</div></div>
          </div>
          <div class="muted" style="margin:2px 0 10px">${escapeHtml(p.description || '')}</div>
          ${p.episodes && p.episodes.length ? p.episodes.map(e => `
            <div class="episode">
              <div class="episode-title">${escapeHtml(e.title)}</div>
              <div class="episode-meta">${[fmtDate(e.published_at), fmtDur(e.duration_sec)].filter(Boolean).join(' · ')}</div>
              ${e.audio_url
                ? `<audio controls preload="none" src="${escapeHtml(e.audio_url)}" style="width:100%;margin-top:6px"></audio>`
                : (e.link ? `<a href="${escapeHtml(e.link)}" target="_blank" rel="noopener">Listen ↗</a>` : '')}
            </div>`).join('')
            : `<div class="muted">Episodes loading — check back shortly.</div>`}
        </div>
      `).join('');
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
    <div class="card glass">
      <h2>Your data</h2>
      <div class="muted" style="margin-bottom:10px">Full transparency — download everything FaithFit stores about your account as a JSON file.</div>
      <a class="ghost" id="data-export" href="/api/me/export" download="faithfit-my-data.json" style="display:block;text-align:center;text-decoration:none">⬇ Download my data</a>
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

let workoutMode = 'live'; // 'live' | 'manual'

async function renderWorkout(main) {
  if (!state.activityTypes) { try { state.activityTypes = await api('/activity-types'); } catch { state.activityTypes = [{type:'Run',icon:'🏃'}]; } }
  const opts = state.activityTypes.map(a => `<option value="${a.type}">${a.icon} ${a.type}</option>`).join('');
  const liveActive = workoutMode === 'live';

  main.innerHTML = `
    ${!state.activeWorkout ? `<div class="section-tabs" style="margin-bottom:14px">
      <button class="${liveActive?'active':''}" id="mode-live">● Live track</button>
      <button class="${!liveActive?'active':''}" id="mode-manual">✎ Log manually</button>
    </div>` : ''}
    ${(liveActive || state.activeWorkout) ? `
    <div class="workout-screen">
      <select id="workout-type" ${state.activeWorkout ? 'disabled' : ''}>${opts}</select>
      <div class="hr-ring"><div class="hr-display" id="hr-display">${state.hr || '--'}</div><div class="hr-label">BPM ${state.bleConnected ? '· 📶 live' : '· simulated'}</div></div>
      <div class="timer-display" id="timer-display">${formatElapsed(state.elapsed)}</div>
      <button class="start-stop-btn ${state.activeWorkout ? 'stop' : 'start'}" id="start-stop">${state.activeWorkout ? 'Stop' : 'Start'}</button>
      <div id="gps-status" class="muted"></div>
      <div id="map" style="width:100%;height:180px;border-radius:16px;overflow:hidden;display:none"></div>
      <div id="verse-preview" style="width:100%"></div>
    </div>` : `
    <div class="card glass">
      <h2>Log a workout</h2>
      <p class="muted" style="margin-top:-6px;margin-bottom:8px">Add an activity you did off-app.</p>
      <label class="field-label">Activity</label>
      <select id="m-type">${opts}</select>
      <label class="field-label">Duration (minutes)</label>
      <input class="input" id="m-duration" type="number" min="0" step="1" placeholder="e.g. 30" />
      <label class="field-label">Distance (km) — optional</label>
      <input class="input" id="m-distance" type="number" min="0" step="0.01" placeholder="e.g. 5.0" />
      <label class="field-label">Calories — optional</label>
      <input class="input" id="m-calories" type="number" min="0" step="1" placeholder="auto-estimated if blank" />
      <label class="field-label">Note — optional</label>
      <input class="input" id="m-note" type="text" maxlength="200" placeholder="How did it go?" />
      <div id="m-status" class="muted" style="margin-top:8px"></div>
      <button class="primary" id="m-save" style="width:100%;margin-top:12px">Save workout</button>
    </div>`}
  `;

  const ml = document.getElementById('mode-live'), mm = document.getElementById('mode-manual');
  if (ml) ml.onclick = () => { workoutMode = 'live'; renderWorkout(main); };
  if (mm) mm.onclick = () => { workoutMode = 'manual'; renderWorkout(main); };

  const ss = document.getElementById('start-stop');
  if (ss) ss.onclick = () => state.activeWorkout ? stopWorkout() : startWorkout();
  if (state.activeWorkout && state.gpsPoints.length) initMap(true);

  const save = document.getElementById('m-save');
  if (save) save.onclick = async () => {
    const status = document.getElementById('m-status');
    const body = {
      type: document.getElementById('m-type').value,
      duration_min: document.getElementById('m-duration').value,
      distance_km: document.getElementById('m-distance').value,
      calories: document.getElementById('m-calories').value,
      note: document.getElementById('m-note').value,
    };
    status.textContent = 'Saving…';
    const res = await fetch('/api/workouts/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = data.error === 'need_duration_or_distance' ? 'Enter a duration or distance.' : 'Could not save — check your inputs.'; return; }
    let msg = 'Workout logged! ✓';
    if (data.completed_challenges && data.completed_challenges.length) msg += ` Challenge complete: ${data.completed_challenges.join(', ')} 🏆`;
    status.textContent = msg;
    ['m-duration','m-distance','m-calories','m-note'].forEach(id => document.getElementById(id).value = '');
  };
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
