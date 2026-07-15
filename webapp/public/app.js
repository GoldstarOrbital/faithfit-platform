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

async function loadMe() {
  try { state.me = await api('/me'); } catch { state.me = null; }
  if (state.me) { startNotifPolling(); }
  else if (typeof notifPollTimer !== 'undefined' && notifPollTimer) { clearInterval(notifPollTimer); notifPollTimer = null; }
}

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
// Renders a real profile photo (fetched lazily from the dedicated avatar endpoint)
// when a user has one, falling back to the plain-initials circle otherwise. `cls`
// lets callers reuse the existing avatar/avatar-sm/story-avatar/suggest-avatar sizing.
const _avatarCache = new Map();
function avatarHtml(user, cls) {
  const id = user && (user.id || user.user_id || user.author_id);
  const name = (user && (user.display_name || user.author)) || '';
  const hasAvatar = !!(user && (user.has_avatar || user.author_has_avatar));
  if (id && hasAvatar) {
    return `<div class="${cls} avatar-photo" data-avatar-user="${id}">${initials(name)}</div>`;
  }
  return `<div class="${cls}">${initials(name)}</div>`;
}
// After inserting HTML built with avatarHtml(), call this once per container to
// lazily fetch and paint the real photos (keeps list/feed responses avatar-free).
function hydrateAvatars(root) {
  (root || document).querySelectorAll('[data-avatar-user]').forEach(async (el) => {
    const uid = el.dataset.avatarUser;
    if (!uid) return;
    try {
      let dataUrl = _avatarCache.get(uid);
      if (dataUrl === undefined) {
        const r = await api(`/users/${uid}/avatar`);
        dataUrl = r && r.avatar_data ? r.avatar_data : null;
        _avatarCache.set(uid, dataUrl);
      }
      if (dataUrl) {
        el.style.backgroundImage = `url(${dataUrl})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      }
    } catch {}
  });
}
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso + (iso.includes('Z') ? '' : 'Z')).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}

let signInMode = 'login'; // 'login' | 'register'

const OAUTH_ERROR_MESSAGES = {
  session_expired: 'That sign-in link expired — please try again.',
  state_mismatch: 'Sign-in could not be verified — please try again.',
  sign_in_failed: 'Sign-in failed — please try again or use email + password.',
  access_denied: 'Sign-in was cancelled.',
  identity_linked_elsewhere: 'That account is already linked to a different FitFaith profile.',
};

async function renderSignIn() {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');

  let providers = [];
  try { providers = (await api('/auth/providers')).providers; } catch {}

  const params = new URLSearchParams(location.search);
  const oauthError = params.get('oauth_error');
  if (oauthError) history.replaceState(null, '', location.pathname);

  const isRegister = signInMode === 'register';
  main.innerHTML = `
    <div class="card glass">
      <h2>${isRegister ? 'Create your account' : 'Welcome back'}</h2>
      <p class="muted">${isRegister ? 'Faith and fitness, together. Free to join.' : 'Sign in to continue your journey.'}</p>
      ${oauthError ? `<p class="form-error">${OAUTH_ERROR_MESSAGES[oauthError] || 'Sign-in failed — please try again.'}</p>` : ''}
      ${providers.length ? `
        <div class="oauth-row">
          ${providers.map(p => `<a class="ghost oauth-btn" href="/api/auth/oauth/${p.name}/start">Continue with ${p.label}</a>`).join('')}
        </div>
        <div class="auth-divider"><span>or</span></div>
      ` : ''}
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
  const [posts, users, suggested, rec, devo] = await Promise.all([api('/feed'), api('/users'), api('/users/suggested').catch(() => []), api('/recommendations').catch(() => null), api('/devotionals/today').catch(() => null)]);
  main.innerHTML = `
    <div class="stories">
      ${users.map(u => `<div class="story" data-user="${u.id}"><div class="story-ring">${avatarHtml(u, 'story-avatar')}</div><div class="story-label">${u.display_name.split(' ')[0]}</div></div>`).join('')}
    </div>
    ${devo && devo.devotional ? `
    <div class="card glass foryou-card">
      <div class="foryou-head">🎬 Today's devotional from ${escapeHtml(devo.devotional.church_name || 'your church')}</div>
      <div class="foryou-title" style="margin-bottom:6px">${escapeHtml(devo.devotional.title || '')}</div>
      <div style="position:relative;padding-top:56.25%;border-radius:10px;overflow:hidden">
        <iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(devo.devotional.video_id)}" title="Today's devotional" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
      </div>
    </div>` : ''}
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
            ${avatarHtml(u, 'avatar-sm suggest-avatar')}
            <div class="suggest-name">${escapeHtml(u.display_name)}</div>
            <div class="suggest-sub">${u.followers_count} follower${u.followers_count===1?'':'s'}</div>
            <button class="follow-btn" data-follow="${u.id}">Follow</button>
          </div>`).join('')}
      </div>
    </div>` : ''}
    <div id="posts"></div>
  `;
  hydrateAvatars(main);
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
        <div class="post-user" data-user="${p.author_id}">${avatarHtml({ id: p.author_id, display_name: p.author, has_avatar: p.author_has_avatar }, 'avatar-sm')}</div>
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
      ${p.photo_data ? `<div class="post-photo"><img src="${p.photo_data}" alt="${escapeHtml(p.photo_category || 'photo')}" style="width:100%;border-radius:10px;margin-top:8px;display:block" /><div class="muted" style="font-size:0.72rem;margin-top:4px">${{nature:'🌿 Nature',animal:'🐾 Animal',group:'👥 Group of people'}[p.photo_category] || ''}</div></div>` : ''}
      ${p.verse_reference ? `<div class="verse-card"><div class="verse-ref">${p.verse_reference}</div><div class="verse-text">${escapeHtml(p.verse_text || '')}</div></div>` : ''}
      <div class="action-row">
        <button class="action-btn ${p.liked_by_me ? 'liked' : ''}" data-like="${p.id}">${p.liked_by_me ? '❤️' : '🤍'} <span class="n">${p.like_count}</span> kudos</button>
        <button class="action-btn" data-comment-toggle="${p.id}">💬 <span class="n">${p.comments.length}</span></button>
        <button class="action-btn" data-share="${p.id}" data-vis="${p.visibility || 'public'}">↗ Share</button>
        ${p.photo_data ? `<button class="action-btn" data-report="${p.id}">🚩 Report</button>` : ''}
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

  hydrateAvatars(postsEl);
  postsEl.querySelectorAll('[data-report]').forEach(btn => btn.onclick = async () => {
    const reason = prompt('Why are you reporting this photo? (e.g. shows a single person)');
    if (reason === null) return;
    await api(`/posts/${btn.dataset.report}/report`, { method: 'POST', body: { reason } });
    btn.textContent = '🚩 Reported'; btn.disabled = true;
  });
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
        ${avatarHtml(u, 'avatar')}
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
      ${u.bio_link_url ? `<a href="${escapeHtml(u.bio_link_url)}" target="_blank" rel="noopener noreferrer" class="ghost" style="display:inline-block;margin-top:10px;text-decoration:none">${escapeHtml(u.bio_link_label || 'Link ↗')}</a>` : ''}
    </div>
    <div id="profile-posts">${data.posts.length ? '' : '<p class="muted">No posts to show yet.</p>'}</div>
  `;
  hydrateAvatars(main);

  const pp = document.getElementById('profile-posts');
  if (data.posts.length) pp.innerHTML = data.posts.map((p, i) => `
    <div class="card glass">
      <div class="post-time" style="margin-bottom:8px">${timeAgo(p.created_at)} ago</div>
      ${p.content ? `<div class="post-content">${escapeHtml(p.content)}</div>` : ''}
      ${p.photo_data ? `<img src="${p.photo_data}" alt="${escapeHtml(p.photo_category || 'photo')}" style="width:100%;border-radius:10px;margin-top:8px;display:block" />` : ''}
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
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  main.innerHTML = `
    <div class="section-tabs section-tabs-scroll">
      <button data-etab="challenges" class="${state.exploreTab==='challenges'?'active':''}">Challenges</button>
      <button data-etab="leaderboard" class="${state.exploreTab==='leaderboard'?'active':''}">Leaderboard</button>
      <button data-etab="groups" class="${state.exploreTab==='groups'?'active':''}">Groups</button>
      <button data-etab="breathe" class="${state.exploreTab==='breathe'?'active':''}">Breathe</button>
      <button data-etab="motivation" class="${state.exploreTab==='motivation'?'active':''}">Motivation</button>
      <button data-etab="podcasts" class="${state.exploreTab==='podcasts'?'active':''}">Podcasts</button>
      <button data-etab="videos" class="${state.exploreTab==='videos'?'active':''}">Videos</button>
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
  } else if (state.exploreTab === 'leaderboard') {
    if (!state.leaderboardMetric) state.leaderboardMetric = 'distance_km';
    const metricLabels = { distance_km: 'Distance', duration_min: 'Duration', workouts: 'Workouts' };
    const fmtValue = (row) => state.leaderboardMetric === 'distance_km' ? `${row.value.toFixed(1)} km`
      : state.leaderboardMetric === 'duration_min' ? `${row.value} min`
      : `${row.value} workout${row.value === 1 ? '' : 's'}`;
    const rows = await api(`/leaderboard?metric=${state.leaderboardMetric}&period=week`);
    body.innerHTML = `
      <h2>Weekly Leaderboard</h2>
      <p class="muted" style="margin-top:-6px;margin-bottom:12px">You and everyone you follow, ranked by this week's activity.</p>
      <div class="section-tabs" style="margin-bottom:12px">
        ${Object.entries(metricLabels).map(([m, l]) => `<button data-metric="${m}" class="${state.leaderboardMetric===m?'active':''}">${l}</button>`).join('')}
      </div>
      ${rows.length ? rows.map(row => `
        <div class="card glass lb-row ${row.is_me ? 'lb-me' : ''} ${row.rank <= 3 ? 'lb-top' : ''}">
          <div class="lb-rank">${row.rank <= 3 ? ['🥇','🥈','🥉'][row.rank-1] : row.rank}</div>
          ${avatarHtml(row, 'avatar-sm')}
          <div class="lb-name">${escapeHtml(row.display_name)}${row.is_me ? ' <span class="muted">(you)</span>' : ''}</div>
          <div class="lb-value">${fmtValue(row)}</div>
        </div>`).join('') : '<div class="card glass muted" style="text-align:center">Follow a few people to see them on your leaderboard.</div>'}
    `;
    hydrateAvatars(body);
    body.querySelectorAll('[data-metric]').forEach(btn => btn.onclick = () => { state.leaderboardMetric = btn.dataset.metric; renderExplore(main); });
  } else if (state.exploreTab === 'groups') {
    const { groups, quests } = await api('/explore');
    body.innerHTML = `
      <h2>Groups</h2>
      ${groups.map(g => `<div class="card glass" data-group="${g.id}" style="cursor:pointer"><strong>${escapeHtml(g.name)}</strong><div class="muted">${escapeHtml(g.description || '')}</div></div>`).join('')}
      <h2>Quests</h2>
      ${quests.map(q => `<div class="card glass"><strong>${q.name}</strong><div class="muted">${q.description} · theme: ${q.theme}</div></div>`).join('')}
    `;
    body.querySelectorAll('[data-group]').forEach(el => el.onclick = () => renderGroupDetail(el.dataset.group));
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
  } else if (state.exploreTab === 'videos') {
    await renderVideosTab(body);
  }
}

// ---- Curated video library (real YouTube channels, gated behind YOUTUBE_API_KEY) ----
async function renderVideosTab(body) {
  if (!state.videoCategory) state.videoCategory = 'kids';
  const CATS = [
    { key: 'kids', label: 'Kids' },
    { key: 'fitness', label: 'Fitness' },
    { key: 'motivational', label: 'Motivational' },
  ];
  let configured = true;
  try { ({ configured } = await api('/youtube/configured')); } catch { configured = false; }

  body.innerHTML = `<h2>Videos</h2>
    <p class="muted" style="margin-top:-6px;margin-bottom:12px">Real, curated videos from verified YouTube channels, embedded through YouTube's own player.</p>
    <div class="section-tabs" style="margin-bottom:12px">
      ${CATS.map(c => `<button data-vcat="${c.key}" class="${state.videoCategory === c.key ? 'active' : ''}">${c.label}</button>`).join('')}
    </div>
    <div id="videos-list"><div class="muted">Loading…</div></div>`;

  body.querySelectorAll('[data-vcat]').forEach(b => b.onclick = () => { state.videoCategory = b.dataset.vcat; renderVideosTab(body); });

  const listEl = document.getElementById('videos-list');
  if (!configured) {
    listEl.innerHTML = `<div class="card glass"><p class="muted">The video library needs a YouTube Data API key configured on the server (YOUTUBE_API_KEY) before real videos can be shown here. No placeholder videos are shown in the meantime.</p></div>`;
    return;
  }

  let videos = [];
  try { videos = await api(`/videos?category=${encodeURIComponent(state.videoCategory)}`); } catch { videos = []; }

  if (!videos.length) {
    listEl.innerHTML = `<div class="card glass"><p class="muted">No videos found for this category yet — the library refreshes periodically in the background. Check back shortly.</p></div>`;
    return;
  }

  const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

  listEl.innerHTML = videos.map(v => `
    <div class="card glass" data-video-card="${escapeHtml(v.video_id)}">
      <div class="video-thumb-wrap" style="position:relative;cursor:pointer;border-radius:var(--radius);overflow:hidden">
        ${v.thumbnail_url ? `<img src="${escapeHtml(v.thumbnail_url)}" alt="" style="width:100%;display:block">` : ''}
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:2.4rem;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,0.6)">▶</div>
      </div>
      <div style="margin-top:8px"><b>${escapeHtml(v.title || '(untitled)')}</b></div>
      <div class="muted" style="font-size:0.8rem;margin:2px 0 8px">${escapeHtml(v.channel_title || '')}${v.published_at ? ' · ' + fmtDate(v.published_at) : ''}</div>
      <a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.video_id)}" target="_blank" rel="noopener" class="muted" style="font-size:0.8rem">Watch on YouTube ↗</a>
    </div>
  `).join('');

  // Click-to-embed: keeps initial load light (no iframes until requested), and
  // gracefully falls back to the "Watch on YouTube" link if embedding is disabled.
  listEl.querySelectorAll('[data-video-card]').forEach(card => {
    const wrap = card.querySelector('.video-thumb-wrap');
    wrap.onclick = () => {
      const vid = card.dataset.videoCard;
      wrap.innerHTML = `<div style="position:relative;padding-top:56.25%">
        <iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(vid)}?autoplay=1" title="video" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
      </div>`;
    };
  });
}

// Group detail: chat (5s polling) + upcoming meetups with RSVP.
async function renderGroupDetail(groupId) {
  const main = document.getElementById('main');
  if (state.groupPollTimer) { clearInterval(state.groupPollTimer); state.groupPollTimer = null; }
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
  main.innerHTML = `<button class="ghost back-btn" id="group-back">← Back</button><div class="card glass" style="text-align:center">Loading…</div>`;
  document.getElementById('group-back').onclick = () => {
    if (state.groupPollTimer) { clearInterval(state.groupPollTimer); state.groupPollTimer = null; }
    state.tab = 'explore'; render();
  };
  let data;
  try { data = await api(`/groups/${groupId}`); } catch { main.innerHTML = '<div class="card glass">Could not load group.</div>'; return; }
  const g = data.group;
  let lastTs = data.messages.length ? data.messages[data.messages.length - 1].created_at : null;

  const activityOpts = async () => {
    if (!state.activityTypes) { try { state.activityTypes = await api('/activity-types'); } catch { state.activityTypes = [{ type: 'Run', icon: '🏃' }]; } }
    return state.activityTypes.map(a => `<option value="${a.type}">${a.icon} ${a.type}</option>`).join('');
  };

  const fmtEventTime = iso => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

  const renderEvents = (events) => events.map(e => `
    <div class="card glass challenge-card" data-event="${e.id}">
      <div class="challenge-hd">
        <div><div class="challenge-name">${escapeHtml(e.title)}</div>
          <div class="challenge-ref">${e.activity_type ? escapeHtml(e.activity_type) + ' · ' : ''}${fmtEventTime(e.event_time)}${e.location_name ? ' · ' + escapeHtml(e.location_name) : ''}</div></div>
      </div>
      ${e.description ? `<div class="challenge-flavor">${escapeHtml(e.description)}</div>` : ''}
      <div class="muted" style="font-size:0.76rem;margin-bottom:8px">${e.going_count} going · ${e.interested_count} interested</div>
      <div class="action-row" style="border-top:none;padding-top:0;margin-top:0">
        <button class="follow-btn ${e.my_rsvp === 'going' ? 'following' : ''}" data-rsvp="${e.id}" data-status="going">I'm going</button>
        <button class="follow-btn ${e.my_rsvp === 'interested' ? 'following' : ''}" data-rsvp="${e.id}" data-status="interested">Interested</button>
      </div>
    </div>`).join('') || '<p class="muted">No upcoming meetups yet.</p>';

  main.innerHTML = `
    <button class="ghost back-btn" id="group-back">← Back</button>
    <div class="card glass">
      <h2 style="margin-top:0">${escapeHtml(g.name)}</h2>
      <div class="muted" style="margin-bottom:10px">${escapeHtml(g.description || '')}</div>
      <div class="muted" style="margin-bottom:10px">${data.member_count} member${data.member_count === 1 ? '' : 's'}</div>
      <button class="follow-btn ${data.is_member ? 'following' : ''}" id="group-join-leave">${data.is_member ? 'Leave group' : 'Join group'}</button>
    </div>
    <div class="card glass">
      <h2>Upcoming meetups</h2>
      <div id="group-events">${renderEvents(data.events)}</div>
      ${data.is_member ? `<button class="ghost" style="width:100%;margin-top:10px" id="plan-meetup-toggle">+ Plan a meetup</button>
      <div id="meetup-form" style="display:none;margin-top:10px">
        <input type="text" id="mf-title" placeholder="Title" />
        <select id="mf-activity"><option value="">Activity type…</option></select>
        <input type="datetime-local" id="mf-time" class="input" style="margin-bottom:8px" />
        <input type="text" id="mf-location" placeholder="Location name" />
        <input type="text" id="mf-description" placeholder="Description (optional)" />
        <button class="primary" style="width:100%" id="mf-submit">Create meetup</button>
      </div>` : ''}
    </div>
    <div class="card glass">
      <h2>Chat</h2>
      ${data.is_member ? `
        <div class="comments" id="group-messages" style="display:flex;max-height:340px;overflow-y:auto">
          ${data.messages.map(m => `<div class="comment"><b>${escapeHtml(m.author)}</b>${escapeHtml(m.content)}<span class="muted" style="margin-left:6px;font-size:0.7rem">${timeAgo(m.created_at)} ago</span></div>`).join('')}
        </div>
        <div class="comment-input-row">
          <input type="text" placeholder="Message the group…" id="group-msg-input" />
          <button id="group-msg-send">Send</button>
        </div>` : `<p class="muted">Join the group to see and send messages.</p>`}
    </div>
  `;

  document.getElementById('group-back').onclick = () => {
    if (state.groupPollTimer) { clearInterval(state.groupPollTimer); state.groupPollTimer = null; }
    state.tab = 'explore'; render();
  };

  document.getElementById('group-join-leave').onclick = async () => {
    await api(`/groups/${groupId}/${data.is_member ? 'leave' : 'join'}`, { method: 'POST' });
    renderGroupDetail(groupId);
  };

  const wireRsvp = () => {
    document.querySelectorAll('[data-rsvp]').forEach(btn => btn.onclick = async () => {
      const eventId = btn.dataset.rsvp, status = btn.dataset.status;
      const card = btn.closest('[data-event]');
      const wasActive = btn.classList.contains('following');
      const r = await api(`/events/${eventId}/rsvp`, { method: 'POST', body: { status: wasActive ? null : status } });
      card.querySelectorAll('[data-rsvp]').forEach(b => b.classList.remove('following'));
      if (!wasActive) btn.classList.add('following');
      card.querySelector('.muted').textContent = `${r.going_count} going · ${r.interested_count} interested`;
    });
  };
  wireRsvp();

  if (data.is_member) {
    const messagesEl = document.getElementById('group-messages');
    const sendMsg = async () => {
      const input = document.getElementById('group-msg-input');
      if (!input.value.trim()) return;
      const msg = await api(`/groups/${groupId}/messages`, { method: 'POST', body: { content: input.value } });
      input.value = '';
      messagesEl.insertAdjacentHTML('beforeend', `<div class="comment"><b>${escapeHtml(msg.author)}</b>${escapeHtml(msg.content)}<span class="muted" style="margin-left:6px;font-size:0.7rem">${timeAgo(msg.created_at)} ago</span></div>`);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      lastTs = msg.created_at;
    };
    document.getElementById('group-msg-send').onclick = sendMsg;
    document.getElementById('group-msg-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
    messagesEl.scrollTop = messagesEl.scrollHeight;

    state.groupPollTimer = setInterval(async () => {
      try {
        const fresh = await api(`/groups/${groupId}/messages${lastTs ? `?after=${encodeURIComponent(lastTs)}` : ''}`);
        if (fresh.length) {
          fresh.forEach(m => {
            messagesEl.insertAdjacentHTML('beforeend', `<div class="comment"><b>${escapeHtml(m.author)}</b>${escapeHtml(m.content)}<span class="muted" style="margin-left:6px;font-size:0.7rem">${timeAgo(m.created_at)} ago</span></div>`);
          });
          lastTs = fresh[fresh.length - 1].created_at;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      } catch { /* ignore transient poll errors */ }
    }, 5000);
  }

  if (data.is_member) {
    document.getElementById('mf-activity').innerHTML += await activityOpts();
    document.getElementById('plan-meetup-toggle').onclick = () => {
      const f = document.getElementById('meetup-form');
      f.style.display = f.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('mf-submit').onclick = async () => {
      const title = document.getElementById('mf-title').value.trim();
      const eventTime = document.getElementById('mf-time').value;
      if (!title || !eventTime) { alert('Title and date/time are required.'); return; }
      try {
        await api(`/groups/${groupId}/events`, {
          method: 'POST',
          body: {
            title,
            activity_type: document.getElementById('mf-activity').value || null,
            event_time: new Date(eventTime).toISOString(),
            location_name: document.getElementById('mf-location').value.trim() || null,
            description: document.getElementById('mf-description').value.trim() || null,
          },
        });
        renderGroupDetail(groupId);
      } catch { alert('Could not create meetup.'); }
    };
  }
}

async function renderProfile(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  const me = await api('/me');
  state.me = me;

  let connections = { identities: [], connectors: [] }, providers = [], stravaConfigured = false;
  try {
    const [connRes, provRes, stravaRes] = await Promise.all([
      api('/auth/connections'), api('/auth/providers'), api('/connectors/strava/configured'),
    ]);
    connections = connRes; providers = provRes.providers || []; stravaConfigured = !!stravaRes.configured;
  } catch (e) { console.error('connections load failed', e); }

  const linkedProviders = new Map(connections.identities.map(i => [i.provider, i]));
  const stravaConn = connections.connectors.find(c => c.provider === 'strava');

  const providerRows = providers.map(p => {
    const idn = linkedProviders.get(p.name);
    if (idn) {
      return `<div class="toggle-row"><span>Linked · ${escapeHtml(idn.email || p.label)}</span><button class="ghost" data-unlink="${p.name}">Unlink</button></div>`;
    }
    return `<div class="toggle-row"><span>${p.label}</span><a class="ghost" href="/api/auth/oauth/${p.name}/start?link=1">Link ${p.label}</a></div>`;
  }).join('');

  let stravaRow = '';
  if (stravaConfigured) {
    if (stravaConn) {
      const lastSync = stravaConn.last_synced_at ? `${timeAgo(stravaConn.last_synced_at)} ago` : 'never';
      stravaRow = `
        <div class="toggle-row"><span>Connected · last synced ${lastSync}</span></div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="ghost" id="strava-sync" style="flex:1">Sync now</button>
          <button class="ghost" id="strava-disconnect" style="flex:1">Disconnect</button>
        </div>
        <div id="strava-sync-status" class="muted" style="margin-top:6px"></div>`;
    } else {
      stravaRow = `<a class="ghost" href="/api/connectors/strava/start" style="display:block;text-align:center;text-decoration:none">Connect Strava</a>`;
    }
  }

  main.innerHTML = `
    <div class="card glass">
      <div class="profile-header">
        <div class="avatar" id="p-avatar" style="${me.user.avatar_data ? `background-image:url(${me.user.avatar_data});background-size:cover;background-position:center` : ''}">${me.user.avatar_data ? '' : initials(me.user.display_name)}</div>
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
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
        <input type="file" id="p-avatar-file" accept="image/*" style="display:none">
        <button class="ghost" id="p-avatar-upload">📷 ${me.user.avatar_data ? 'Change photo' : 'Add profile photo'}</button>
        ${me.user.avatar_data ? `<button class="ghost" id="p-avatar-remove">Remove</button>` : ''}
        <span id="p-avatar-status" class="muted"></span>
      </div>
      <div class="badge-row">
        ${me.badges.length ? me.badges.map(b => `<span class="badge-pill">${b.icon} ${b.name}</span>`).join('') : '<span class="muted">No badges yet — complete a workout!</span>'}
      </div>
    </div>
    <div class="card glass">
      <h2>Workout invites</h2>
      <div id="partner-invites" class="muted">Loading…</div>
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
      <label class="field-label">Bio link (LinkedIn or fundraiser only)</label>
      <input id="p-bio-link" type="url" placeholder="https://www.linkedin.com/in/you or a GoFundMe/JustGiving/Classy/Fundly/GiveSendGo link" value="${me.user.bio_link_url || ''}">
      <div class="toggle-row">
        <span>Show my age (optional)</span>
        <label class="switch"><input type="checkbox" id="p-showage" ${me.user.show_age ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <input id="p-age" type="number" min="13" max="120" placeholder="Age" value="${me.user.age ?? ''}" style="max-width:120px">
      <button class="primary" id="p-save" style="width:100%;margin-top:10px">Save Profile</button>
      <div id="p-status" class="muted" style="margin-top:6px"></div>
    </div>
    <div class="card glass">
      <h2>Find your church</h2>
      <div class="muted" style="margin-bottom:10px">Search real churches near you using OpenStreetMap — pick the one you attend.</div>
      <div id="church-current">${me.user.church_name ? `📍 <strong>${escapeHtml(me.user.church_name)}</strong>${me.user.church_address ? ` — ${escapeHtml(me.user.church_address)}` : ''} <button class="ghost" id="church-clear" style="margin-left:8px">Clear</button>` : '<span class="muted">No church selected yet.</span>'}</div>
      <button class="ghost" id="church-find" style="width:100%;margin-top:10px">📍 Find churches near me</button>
      <div id="church-status" class="muted" style="margin-top:6px"></div>
      <div id="church-results" style="margin-top:10px"></div>
      <div id="youtube-link-section" style="margin-top:14px"></div>
    </div>
    <div class="card glass">
      <h2>This week's sermon transcript</h2>
      <div class="muted" style="margin-bottom:10px">The real caption transcript from your church's most recent full-service video, read aloud with your browser's built-in text-to-speech.</div>
      <div id="sermon-summary-section"></div>
    </div>
    <div class="card glass">
      <h2>Connected accounts</h2>
      ${providers.length ? providerRows : '<div class="muted">No sign-in providers are configured on this server.</div>'}
      ${stravaConfigured ? `<div class="muted" style="margin:10px 0 4px;font-weight:600">Strava</div>${stravaRow}` : ''}
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
      <div class="muted" style="margin-bottom:10px">Full transparency — download everything FitFaith stores about your account as a JSON file.</div>
      <a class="ghost" id="data-export" href="/api/me/export" download="fitfaith-my-data.json" style="display:block;text-align:center;text-decoration:none">⬇ Download my data</a>
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

  main.querySelectorAll('[data-unlink]').forEach(btn => {
    btn.onclick = async () => {
      await api(`/auth/identities/${btn.dataset.unlink}/unlink`, { method: 'POST' });
      renderProfile(main);
    };
  });
  const stravaSyncBtn = document.getElementById('strava-sync');
  if (stravaSyncBtn) {
    stravaSyncBtn.onclick = async () => {
      const statusEl = document.getElementById('strava-sync-status');
      statusEl.textContent = 'Syncing…';
      try {
        const res = await api('/connectors/strava/sync', { method: 'POST' });
        statusEl.textContent = res.error ? `Sync failed: ${res.detail || res.error}` : `Synced — imported ${res.imported} of ${res.checked} activities.`;
        renderProfile(main);
      } catch (e) { statusEl.textContent = 'Sync failed.'; }
    };
  }
  const stravaDisconnectBtn = document.getElementById('strava-disconnect');
  if (stravaDisconnectBtn) {
    stravaDisconnectBtn.onclick = async () => {
      await api('/connectors/strava/disconnect', { method: 'POST' });
      renderProfile(main);
    };
  }

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
        bio_link_url: document.getElementById('p-bio-link').value.trim() || null,
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

  wireChurchFinder(me);
  wireAvatarUpload();
  loadPartnerInvites();
}

// ---- Profile picture upload: resize client-side to max 400x400 JPEG @0.8 quality
// via an off-screen canvas, then PUT as a base64 data URL (server enforces 250KB cap). ----
function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    }; img.onerror = reject; img.src = reader.result; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function wireAvatarUpload() {
  const fileInput = document.getElementById('p-avatar-file');
  const uploadBtn = document.getElementById('p-avatar-upload');
  const removeBtn = document.getElementById('p-avatar-remove');
  const statusEl = document.getElementById('p-avatar-status');
  if (!uploadBtn) return;
  uploadBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    statusEl.textContent = 'Uploading…';
    try {
      const dataUrl = await resizeImageFile(file, 400, 0.8);
      const res = await api('/profile', { method: 'PUT', body: { avatar_data: dataUrl } });
      if (res.error) { statusEl.textContent = res.hint || res.error; return; }
      _avatarCache.clear();
      statusEl.textContent = 'Saved.';
      await loadMe();
      renderProfile(document.getElementById('main'));
    } catch (e) {
      statusEl.textContent = 'Could not process that image.';
    }
  };
  if (removeBtn) removeBtn.onclick = async () => {
    statusEl.textContent = 'Removing…';
    await api('/profile', { method: 'PUT', body: { avatar_data: null } });
    _avatarCache.clear();
    await loadMe();
    renderProfile(document.getElementById('main'));
  };
}

// ---- Workout invites: pending "worked out with…" partner tags awaiting my response ----
async function loadPartnerInvites() {
  const el = document.getElementById('partner-invites');
  if (!el) return;
  try {
    const rows = await api('/workout-partners/pending');
    if (!rows.length) { el.innerHTML = '<span class="muted">No pending workout invites.</span>'; return; }
    el.innerHTML = rows.map(r => `
      <div class="toggle-row" data-invite="${r.id}">
        <span>${escapeHtml(r.tagged_by_name)} tagged you${r.workout_type ? ` on a ${escapeHtml(r.workout_type)}` : ''} — confirm for bonus XP</span>
        <span style="display:flex;gap:6px">
          <button class="follow-btn" data-accept="${r.id}">Accept</button>
          <button class="ghost" data-decline="${r.id}">Decline</button>
        </span>
      </div>`).join('');
    el.querySelectorAll('[data-accept]').forEach(btn => btn.onclick = async () => {
      await api(`/workout-partners/${btn.dataset.accept}/respond`, { method: 'POST', body: { accept: true } });
      await loadMe();
      loadPartnerInvites();
    });
    el.querySelectorAll('[data-decline]').forEach(btn => btn.onclick = async () => {
      await api(`/workout-partners/${btn.dataset.decline}/respond`, { method: 'POST', body: { accept: false } });
      loadPartnerInvites();
    });
  } catch { el.innerHTML = '<span class="muted">Could not load invites.</span>'; }
}

// ---- Location-based church selection (real data via OpenStreetMap Overpass) ----
function wireChurchFinder(me) {
  const statusEl = document.getElementById('church-status');
  const resultsEl = document.getElementById('church-results');
  const findBtn = document.getElementById('church-find');
  const clearBtn = document.getElementById('church-clear');

  findBtn.onclick = () => {
    if (!navigator.geolocation) { statusEl.textContent = 'Location isn\'t supported in this browser.'; return; }
    statusEl.textContent = 'Getting your location…';
    resultsEl.innerHTML = '';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        statusEl.textContent = 'Searching nearby churches…';
        try {
          const { latitude, longitude } = pos.coords;
          const results = await api(`/churches/search?lat=${latitude}&lng=${longitude}&radius_km=8`);
          if (!results.length) { statusEl.textContent = 'No churches found nearby — try a different location.'; return; }
          statusEl.textContent = `Found ${results.length} nearby.`;
          resultsEl.innerHTML = results.map(c => `
            <div class="card glass" style="padding:10px;margin-bottom:6px">
              <div style="font-weight:600">${escapeHtml(c.name)}</div>
              ${c.address ? `<div class="muted" style="font-size:0.8rem">${escapeHtml(c.address)}</div>` : ''}
              <button class="follow-btn" style="margin-top:6px" data-pick='${JSON.stringify(c).replace(/'/g, "&#39;")}'>Select</button>
            </div>`).join('');
          resultsEl.querySelectorAll('[data-pick]').forEach(btn => btn.onclick = async () => {
            const c = JSON.parse(btn.dataset.pick);
            statusEl.textContent = 'Saving…';
            const res = await api('/profile', { method: 'PUT', body: {
              church_osm_id: c.osm_id, church_name: c.name, church_lat: c.lat, church_lng: c.lng, church_address: c.address,
            } });
            if (res.error) { statusEl.textContent = res.hint || ('Could not save: ' + res.error); return; }
            await loadMe();
            render();
          });
        } catch (e) {
          statusEl.textContent = 'Could not reach the church directory. Try again shortly.';
        }
      },
      () => { statusEl.textContent = 'Location permission denied or unavailable — try again or check your browser settings.'; },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (clearBtn) clearBtn.onclick = async () => {
    await api('/profile', { method: 'PUT', body: { church_osm_id: null } });
    await loadMe();
    render();
  };

  wireYoutubeLink(me);
  wireSermonSummary();
}

// ---- Church daily devotionals: link a real YouTube channel to a selected church ----
async function wireYoutubeLink(me) {
  const section = document.getElementById('youtube-link-section');
  if (!section || !me.user.church_osm_id) { if (section) section.innerHTML = ''; return; }
  try {
    const { configured } = await api('/youtube/configured');
    if (!configured) { section.innerHTML = ''; return; }
  } catch (e) { section.innerHTML = ''; return; }

  section.innerHTML = `
    <div class="field-label">Link your church's YouTube channel</div>
    <div class="muted" style="margin-bottom:6px">Helps everyone at this church see today's devotional on their feed.</div>
    <input id="yt-search" type="text" placeholder="Search for your church's channel…">
    <button class="ghost" id="yt-search-btn" style="margin-top:6px">Search</button>
    <div id="yt-results" style="margin-top:8px"></div>
  `;
  document.getElementById('yt-search-btn').onclick = async () => {
    const q = document.getElementById('yt-search').value.trim();
    const resultsEl = document.getElementById('yt-results');
    if (!q) return;
    resultsEl.innerHTML = '<span class="muted">Searching…</span>';
    try {
      const results = await api(`/youtube/search-channels?q=${encodeURIComponent(q)}`);
      if (!results.length) { resultsEl.innerHTML = '<span class="muted">No channels found.</span>'; return; }
      resultsEl.innerHTML = results.map(c => `
        <div class="card glass" style="padding:10px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
          <div style="flex:1">${escapeHtml(c.title)}</div>
          <button class="follow-btn" data-link='${JSON.stringify(c).replace(/'/g, "&#39;")}'>Link</button>
        </div>`).join('');
      resultsEl.querySelectorAll('[data-link]').forEach(btn => btn.onclick = async () => {
        const c = JSON.parse(btn.dataset.link);
        await api(`/churches/${encodeURIComponent(me.user.church_osm_id)}/link-youtube`, {
          method: 'POST', body: { channel_id: c.channelId, channel_title: c.title },
        });
        resultsEl.innerHTML = '<span class="muted">Linked ✓</span>';
      });
    } catch (e) {
      resultsEl.innerHTML = '<span class="muted">Search failed.</span>';
    }
  };
}

// ---- Sermon transcript read-aloud: this week's service, real captions only.
// No LLM/AI summarization — this app never calls the Claude/Anthropic API or
// any other paid LLM. This just fetches the real caption track for this
// week's service video and reads the actual transcript aloud via the
// browser's free, built-in text-to-speech (Web Speech API) — standard
// browser TTS quality, not an AI voice.
const SERMON_ERROR_MESSAGES = {
  no_church: 'Select a church on your profile first.',
  no_youtube_channel: "Link your church's YouTube channel first (above).",
  youtube_not_configured: 'YouTube isn\'t configured on this server yet.',
  no_service_found: 'No full-service video was found for this week yet — check back after your church posts one.',
  no_transcript: "No captions were available for this week's service video.",
  video_lookup_failed: 'Could not look up this week\'s service video. Try again shortly.',
};

function renderSermonIdle(section, msg) {
  section.innerHTML = `
    ${msg ? `<div class="muted" style="margin-bottom:8px">${escapeHtml(msg)}</div>` : ''}
    <button class="ghost" id="sermon-generate-btn" style="width:100%">Get this week's sermon transcript</button>
  `;
  document.getElementById('sermon-generate-btn').onclick = () => fetchSermonTranscript(section);
}

function renderSermonResult(section, videoTitle, transcript) {
  section.innerHTML = `
    <div class="muted" style="margin-bottom:6px">${escapeHtml(videoTitle || 'This week\'s service')}</div>
    <div style="white-space:pre-wrap;line-height:1.6;margin-bottom:10px;max-height:220px;overflow-y:auto">${escapeHtml(transcript)}</div>
    <div class="muted" style="font-size:0.75rem;margin-bottom:6px">This is the real caption transcript for the service — not a summary. Read aloud using your browser's built-in text-to-speech, not an AI voice.</div>
    <div style="display:flex;gap:8px">
      <button class="ghost" id="sermon-listen-btn" style="flex:1">▶ Listen (read aloud)</button>
      <button class="ghost" id="sermon-stop-btn" style="flex:1;display:none">⏸ Stop</button>
    </div>
  `;
  const listenBtn = document.getElementById('sermon-listen-btn');
  const stopBtn = document.getElementById('sermon-stop-btn');
  listenBtn.onclick = () => {
    if (!window.speechSynthesis) { alert('Text-to-speech isn\'t supported in this browser.'); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(transcript);
    utter.onend = utter.onerror = () => { listenBtn.style.display = ''; stopBtn.style.display = 'none'; };
    state.sermonUtterance = utter;
    window.speechSynthesis.speak(utter);
    listenBtn.style.display = 'none';
    stopBtn.style.display = '';
  };
  stopBtn.onclick = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    listenBtn.style.display = '';
    stopBtn.style.display = 'none';
  };
}

async function fetchSermonTranscript(section) {
  section.innerHTML = '<div class="muted">Looking up this week\'s service and its captions…</div>';
  let result;
  try { result = await api('/church/service/summarize', { method: 'POST' }); }
  catch (e) { renderSermonIdle(section, 'Something went wrong. Try again shortly.'); return; }
  if (result && result.error) {
    renderSermonIdle(section, SERMON_ERROR_MESSAGES[result.error] || result.hint || 'Could not fetch a transcript.');
    return;
  }
  renderSermonResult(section, result.video_title, result.transcript);
}

async function wireSermonSummary() {
  const section = document.getElementById('sermon-summary-section');
  if (!section) return;
  let existing;
  try { existing = await api('/church/service/this-week'); } catch { existing = { service: null }; }
  if (existing && existing.service && existing.service.transcript) {
    renderSermonResult(section, existing.service.title, existing.service.transcript);
  } else {
    renderSermonIdle(section);
  }
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
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
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
      <label class="field-label">Worked out with… — optional</label>
      <input class="input" id="m-partner-search" type="text" placeholder="Search people…" autocomplete="off" />
      <div id="m-partner-list"></div>
      <div id="m-partner-chips" style="margin-top:6px"></div>
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

  const manualPartners = document.getElementById('m-partner-search') ? wirePartnerPicker('m-partner-search', 'm-partner-list', 'm-partner-chips') : null;

  const save = document.getElementById('m-save');
  if (save) save.onclick = async () => {
    const status = document.getElementById('m-status');
    const body = {
      type: document.getElementById('m-type').value,
      duration_min: document.getElementById('m-duration').value,
      distance_km: document.getElementById('m-distance').value,
      calories: document.getElementById('m-calories').value,
      note: document.getElementById('m-note').value,
      partner_user_ids: manualPartners ? manualPartners.getSelected() : [],
    };
    status.textContent = 'Saving…';
    const res = await fetch('/api/workouts/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = data.error === 'need_duration_or_distance' ? 'Enter a duration or distance.' : 'Could not save — check your inputs.'; return; }
    let msg = 'Workout logged! ✓';
    if (data.completed_challenges && data.completed_challenges.length) msg += ` Challenge complete: ${data.completed_challenges.join(', ')} 🏆`;
    status.textContent = msg;
    ['m-duration','m-distance','m-calories','m-note'].forEach(id => document.getElementById(id).value = '');
    if (manualPartners) manualPartners.reset();
  };
}

// ---- "Worked out with…" partner picker: search /api/users client-side (small demo
// dataset), click a result to add it as a chip, chips carry the selected user ids. ----
let _partnerUsersCache = null;
function wirePartnerPicker(searchId, listId, chipsId) {
  const searchEl = document.getElementById(searchId);
  const listEl = document.getElementById(listId);
  const chipsEl = document.getElementById(chipsId);
  const selected = new Map(); // id -> display_name

  const renderChips = () => {
    chipsEl.innerHTML = [...selected.entries()].map(([id, name]) =>
      `<span class="badge-pill" data-remove-partner="${id}" style="cursor:pointer">${escapeHtml(name)} ✕</span>`).join(' ');
    chipsEl.querySelectorAll('[data-remove-partner]').forEach(el => el.onclick = () => { selected.delete(el.dataset.removePartner); renderChips(); });
  };

  searchEl.oninput = async () => {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) { listEl.innerHTML = ''; return; }
    if (!_partnerUsersCache) { try { _partnerUsersCache = await api('/users'); } catch { _partnerUsersCache = []; } }
    const myId = state.me && state.me.user && state.me.user.id;
    const matches = _partnerUsersCache.filter(u => u.id !== myId && !selected.has(u.id) && u.display_name.toLowerCase().includes(q)).slice(0, 6);
    listEl.innerHTML = matches.map(u => `<div class="toggle-row" data-pick-partner="${u.id}" data-name="${escapeHtml(u.display_name)}" style="cursor:pointer"><span>${escapeHtml(u.display_name)}</span><span class="muted">Add</span></div>`).join('');
    listEl.querySelectorAll('[data-pick-partner]').forEach(el => el.onclick = () => {
      selected.set(el.dataset.pickPartner, el.dataset.name);
      searchEl.value = ''; listEl.innerHTML = '';
      renderChips();
    });
  };

  return {
    getSelected: () => [...selected.keys()],
    reset: () => { selected.clear(); renderChips(); },
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
      <label class="field-label">Photo — optional</label>
      <div class="muted" style="margin-bottom:6px">Nature, animals, or groups of people only — no solo photos (use your profile picture for that).</div>
      <input type="file" id="share-photo-file" accept="image/*" style="display:none">
      <button class="ghost" id="share-photo-pick" type="button">📷 Add photo</button>
      <div id="share-photo-preview" style="margin-top:8px"></div>
      <div id="share-photo-cat-wrap" style="display:none;margin-top:8px">
        <label class="field-label">What's in this photo?</label>
        <label style="display:block"><input type="radio" name="share-photo-cat" value="nature"> 🌿 Nature</label>
        <label style="display:block"><input type="radio" name="share-photo-cat" value="animal"> 🐾 Animal</label>
        <label style="display:block"><input type="radio" name="share-photo-cat" value="group"> 👥 Group of people</label>
      </div>
      <label class="field-label">Worked out with… — optional</label>
      <input class="input" id="share-partner-search" type="text" placeholder="Search people…" autocomplete="off" />
      <div id="share-partner-list"></div>
      <div id="share-partner-chips" style="margin-top:6px"></div>
      <div id="share-result" class="muted" style="margin-top:10px"></div>
      <div style="display:flex; gap:10px; margin-top:14px">
        <button class="ghost" id="share-skip" style="flex:1">Skip</button>
        <button class="primary" id="share-post" style="flex:2">Post workout</button>
      </div>
    </div>`;

  const sharePartners = wirePartnerPicker('share-partner-search', 'share-partner-list', 'share-partner-chips');

  let sharePhotoDataUrl = null;
  document.getElementById('share-photo-pick').onclick = () => document.getElementById('share-photo-file').click();
  document.getElementById('share-photo-file').onchange = async () => {
    const file = document.getElementById('share-photo-file').files[0];
    if (!file) return;
    try {
      sharePhotoDataUrl = await resizeImageFile(file, 1200, 0.8);
      document.getElementById('share-photo-preview').innerHTML = `<img src="${sharePhotoDataUrl}" style="max-width:100%;border-radius:10px" />`;
      document.getElementById('share-photo-cat-wrap').style.display = '';
    } catch { document.getElementById('share-result').textContent = 'Could not process that image.'; }
  };

  main.querySelector('#share-skip').onclick = () => { state.lastVerseId = null; state.lastVerse = null; setTab('home'); };
  main.querySelector('#share-post').onclick = async () => {
    const content = main.querySelector('#share-caption').value.trim();
    const visibility = main.querySelector('#share-vis').value;
    const resultEl = main.querySelector('#share-result');
    const partnerIds = sharePartners.getSelected();
    let photoCategory = null;
    if (sharePhotoDataUrl) {
      const checked = main.querySelector('input[name="share-photo-cat"]:checked');
      if (!checked) { resultEl.textContent = 'Pick a category for your photo (nature, animal, or group).'; return; }
      photoCategory = checked.value;
    }
    const res = await api('/posts', { method: 'POST', body: { content, workout_id: ctx.workoutId, verse_id: ctx.verseId, visibility, photo_data: sharePhotoDataUrl, photo_category: photoCategory } });
    if (res.error) { resultEl.textContent = res.hint || res.error; return; }
    if (partnerIds.length && ctx.workoutId) {
      await api(`/workouts/${ctx.workoutId}/tag-partners`, { method: 'POST', body: { partner_user_ids: partnerIds } }).catch(() => {});
    }
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

function showToast(message, isError) {
  if (!message) return;
  const el = document.createElement('div');
  el.className = 'toast-banner' + (isError ? ' toast-error' : '');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 250); }, 3600);
}
function consumeSignedInRedirectParams() {
  const params = new URLSearchParams(location.search);
  const connected = params.get('connected');
  const linked = params.get('linked');
  const oauthError = params.get('oauth_error');
  const stravaError = params.get('strava_error');
  if (!connected && !linked && !oauthError && !stravaError) return;
  let message = null, isError = false;
  if (connected === 'strava') message = 'Strava connected — syncing your activities.';
  if (linked) message = `Linked ${linked.charAt(0).toUpperCase() + linked.slice(1)} account.`;
  if (oauthError) { message = OAUTH_ERROR_MESSAGES[oauthError] || 'Sign-in failed — please try again.'; isError = true; }
  if (stravaError) { message = 'Strava connection failed — please try again.'; isError = true; }
  history.replaceState(null, '', location.pathname);
  showToast(message, isError);
}

// ---- notifications bell: unread badge + dropdown panel, polled every 30s ----
let notifPollTimer = null;
async function refreshNotifBadge() {
  if (!state.me) return;
  try {
    const { unread_count } = await api('/notifications');
    const badge = document.getElementById('notif-badge');
    const wrap = document.getElementById('notif-wrap');
    if (wrap) wrap.style.display = '';
    if (badge) {
      if (unread_count > 0) { badge.textContent = unread_count > 99 ? '99+' : String(unread_count); badge.style.display = ''; }
      else badge.style.display = 'none';
    }
  } catch {}
}
function startNotifPolling() {
  if (notifPollTimer) clearInterval(notifPollTimer);
  refreshNotifBadge();
  notifPollTimer = setInterval(refreshNotifBadge, 30000);
}
async function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.innerHTML = '<div class="muted" style="padding:8px">Loading…</div>';
  panel.style.display = 'block';
  const { notifications, unread_count } = await api('/notifications');
  const fmtPayload = (n) => { try { return JSON.parse(n.payload || '{}').message || n.type; } catch { return n.type; } };
  panel.innerHTML = `
    <div class="notif-panel-head">
      <h3>Notifications</h3>
      ${unread_count > 0 ? `<button id="notif-mark-all">Mark all read</button>` : ''}
    </div>
    ${notifications.length ? notifications.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-notif="${n.id}">
        <div>${escapeHtml(fmtPayload(n))}</div>
        <div class="notif-time">${timeAgo(n.delivered_at)} ago</div>
      </div>`).join('') : '<div class="muted" style="padding:8px">No notifications yet.</div>'}
  `;
  const markAllBtn = document.getElementById('notif-mark-all');
  if (markAllBtn) markAllBtn.onclick = async () => { await api('/notifications/read-all', { method: 'POST' }); toggleNotifPanel(); toggleNotifPanel(); refreshNotifBadge(); };
  panel.querySelectorAll('[data-notif]').forEach(item => {
    item.onclick = async () => {
      await api(`/notifications/${item.dataset.notif}/read`, { method: 'POST' });
      item.classList.remove('unread');
      refreshNotifBadge();
    };
  });
}
document.addEventListener('DOMContentLoaded', () => {
  const bellBtn = document.getElementById('notif-bell');
  if (bellBtn) bellBtn.onclick = (e) => { e.stopPropagation(); toggleNotifPanel(); };
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const wrap = document.getElementById('notif-wrap');
    if (panel && panel.style.display === 'block' && wrap && !wrap.contains(e.target)) panel.style.display = 'none';
  });
});

(async () => {
  await loadMe();
  if (state.me) consumeSignedInRedirectParams();
  render();
})();
