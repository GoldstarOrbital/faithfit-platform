const state = {
  tab: 'home', me: null, exploreTab: null,
  activeWorkout: null, hrTimer: null, elapsed: 0, hr: 0,
  gpsWatchId: null, gpsPoints: [], leafletMap: null, leafletLine: null,
  gpsReady: false, gpsAccuracyM: null, gpsGoodFixes: 0, gpsStatus: null,
  gpsWaitedMs: 0, gpsCanOverride: false,
  // Set when GPS can never work here (permission denied, unsupported), so the
  // gate stops waiting for an answer that is not coming.
  gpsFatal: false,
  // Live workout telemetry. Times and altitudes run parallel to gpsPoints so the
  // Leaflet polyline keeps its [lat,lng] shape.
  gpsTimes: [], gpsAlt: [], elevGainM: 0, altRef: null,
  splits: [], lastSplitKm: 0, lastSplitElapsed: 0, hrSamples: [],
  bleDevice: null, bleServer: null, bleConnected: false,
  breathePhase: 'idle',
  homeCache: null, feedScope: 'community', reelTargetId: null, reelsView: 'for_you', searchPostId: null, storyTargetId: null,
};

let gpsStartedAt = null, gpsTicker = null;

// A tab switch and the notification/profile bootstrap can ask for the same
// read in the same event loop turn. Share that request instead of opening two
// sockets. This is deliberately in-flight only: private member data is never
// held in a client-side stale cache, and POST/DELETE mutations are untouched.
const _apiInFlight = new Map();

async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const existing = _apiInFlight.get(path);
    if (existing) return existing;
    const request = apiRequest(path, opts);
    _apiInFlight.set(path, request);
    try {
      return await request;
    } finally {
      if (_apiInFlight.get(path) === request) _apiInFlight.delete(path);
    }
  }
  return apiRequest(path, opts);
}

async function apiRequest(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 12000);
  let res;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 401) { renderSignIn(); throw new Error('not_signed_in'); }
  const payload = await res.json();
  if (!res.ok && opts.throwOnError) {
    const message = payload.hint || payload.error || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return payload;
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
  const face = (id && hasAvatar)
    ? `<div class="${cls} avatar-photo" data-avatar-user="${id}">${initials(name)}</div>`
    : `<div class="${cls}">${initials(name)}</div>`;
  if (!id) return face;
  // The ring is drawn on the wrapper; the level chip is added once the batch
  // lookup returns. Until then it is an inert circle, never a guessed level.
  return `<span class="xp-ring" data-xp-user="${id}">${face}</span>`;
}

// How much of the ring is lit, and what tier it is drawn in. Tiers are what
// makes a long-standing account look different at a glance rather than merely
// being further round the same circle.
function xpTier(level) {
  if (level >= 25) return 'legend';
  if (level >= 15) return 'gold';
  if (level >= 8) return 'brass';
  if (level >= 3) return 'meadow';
  return 'new';
}

// Fill in the rings for every avatar under `root`, in one request.
const _xpCache = new Map();
async function hydrateXpRings(root) {
  const nodes = [...(root || document).querySelectorAll('[data-xp-user]')];
  if (!nodes.length) return;
  const ids = [...new Set(nodes.map(n => n.dataset.xpUser))];
  const missing = ids.filter(id => !_xpCache.has(id));
  if (missing.length) {
    try {
      const r = await api('/xp/levels?ids=' + encodeURIComponent(missing.join(',')));
      for (const id of missing) _xpCache.set(id, (r.levels && r.levels[id]) || null);
    } catch { missing.forEach(id => _xpCache.set(id, null)); }
  }
  for (const node of nodes) {
    const lv = _xpCache.get(node.dataset.xpUser);
    if (!lv) continue;
    node.style.setProperty('--xp-pct', lv.percent + '%');
    node.dataset.tier = xpTier(lv.level);
    node.title = 'Level ' + lv.level + ' · ' + lv.xp + ' XP · ' + lv.to_next + ' to next';
    if (!node.querySelector('.xp-level')) {
      const chip = document.createElement('span');
      chip.className = 'xp-level';
      chip.textContent = lv.level;
      node.appendChild(chip);
    } else {
      node.querySelector('.xp-level').textContent = lv.level;
    }
  }
}
// After inserting HTML built with avatarHtml(), call this once per container to
// lazily fetch and paint the real photos (keeps list/feed responses avatar-free).
function hydrateAvatars(root) {
  hydrateXpRings(root);
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
  identity_linked_elsewhere: 'That account is already linked to a different Functioning Faith profile.',
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
      <p class="muted" style="font-size:0.72rem;text-align:center;margin:14px 0 0">
        By continuing, you agree to our <a href="/terms.html" target="_blank" rel="noopener">Terms</a> and acknowledge our <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
      </p>
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
    if (res.ok) {
      await loadMe();
      // New accounts go through the church onboarding step first, so a member's
      // church (and its videos) are set up before they ever reach the feed.
      if (isRegister) return renderChurchOnboarding();
      if (new URLSearchParams(location.search).get('open')) return openNotificationDestination(location.href);
      return render();
    }
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

// The route actually recorded, drawn to fit the banner.
//
// This replaces a generated squiggle that was derived from the post's index —
// it looked like a route and was read as one, but no part of it came from
// anywhere the author had been. Nothing is drawn now unless there are real
// coordinates to draw.
function realRouteSvg(points) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const lats = points.map(p => p[0]), lngs = points.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  // Longitude degrees shrink with latitude; without this correction an
  // east-west route is drawn wider than it was ridden.
  const midLat = (minLat + maxLat) / 2;
  const spanY = Math.max(1e-6, maxLat - minLat);
  const spanX = Math.max(1e-6, (maxLng - minLng) * Math.cos(midLat * Math.PI / 180));

  const W = 200, H = 110, PAD = 12;
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const offX = (W - spanX * scale) / 2, offY = (H - spanY * scale) / 2;

  const xy = points.map(([lat, lng]) => {
    const x = offX + ((lng - minLng) * Math.cos(midLat * Math.PI / 180)) * scale;
    const y = offY + (maxLat - lat) * scale;      // north at the top
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  const first = xy[0].split(','), last = xy[xy.length - 1].split(',');

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">'
    + '<polyline points="' + xy.join(' ') + '" fill="none" stroke="rgba(51,37,26,.22)" '
    +   'stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<polyline points="' + xy.join(' ') + '" fill="none" stroke="var(--meadow, #6f8f43)" '
    +   'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<circle cx="' + first[0] + '" cy="' + first[1] + '" r="3.4" fill="var(--meadow, #6f8f43)" stroke="#fdf8ea" stroke-width="1.6"/>'
    + '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.4" fill="var(--hearth, #d99a3f)" stroke="#fdf8ea" stroke-width="1.6"/>'
    + '</svg>';
}

function closeMomentLayer() { document.getElementById('moment-layer')?.remove(); }

function openStoryViewer(story, allStories = [story]) {
  closeMomentLayer();
  const layer = document.createElement('div');
  layer.id = 'moment-layer';
  layer.className = 'moment-layer';
  const index = Math.max(0, allStories.findIndex(s => s.id === story.id));
  const next = allStories[(index + 1) % allStories.length];
  layer.innerHTML = `<div class="moment-backdrop" data-story-close></div><article class="moment-viewer" role="dialog" aria-modal="true" aria-label="${escapeHtml(story.author || 'Community moment')}">
    <div class="moment-viewer-head"><div><b>${escapeHtml(story.author || 'Community member')}</b><div class="muted">24-hour moment · ${timeAgo(story.created_at)} ago</div></div><button class="ghost" type="button" data-story-close aria-label="Close moment">✕</button></div>
    ${story.photo_data ? `<img class="moment-photo" src="${escapeHtml(story.photo_data)}" alt="${escapeHtml(story.photo_category || 'Community moment')}" />` : ''}
    ${story.content ? `<div class="moment-copy">${escapeHtml(story.content)}</div>` : ''}
    <div class="moment-reactions" aria-label="Encourage this member">${['❤️','🙏','🔥','💪','👏'].map(emoji => `<button type="button" class="moment-reaction ${story.my_reaction === emoji ? 'is-active' : ''}" data-story-reaction="${emoji}" aria-pressed="${story.my_reaction === emoji ? 'true' : 'false'}">${emoji}</button>`).join('')}<span class="muted" data-story-reaction-count>${story.reaction_count || 0}</span></div>
    <div class="moment-viewer-actions">${story.user_id === state.me?.user?.id ? '<button class="ghost" data-story-delete>Delete moment</button>' : ''}${allStories.length > 1 ? `<button class="primary" data-story-next>Next moment →</button>` : ''}</div>
  </article>`;
  document.body.appendChild(layer);
  api(`/stories/${encodeURIComponent(story.id)}/view`, { method: 'POST' }).catch(() => {});
  layer.querySelectorAll('[data-story-close]').forEach(el => el.onclick = closeMomentLayer);
  layer.querySelector('[data-story-delete]')?.addEventListener('click', async () => {
    await api(`/stories/${encodeURIComponent(story.id)}`, { method: 'DELETE' });
    closeMomentLayer(); state.homeCache = null; renderHome(document.getElementById('main'));
  });
  layer.querySelectorAll('[data-story-reaction]').forEach(button => button.onclick = async () => {
    const result = await api(`/stories/${encodeURIComponent(story.id)}/reaction`, { method: 'POST', body: { emoji: button.dataset.storyReaction }, throwOnError: true }).catch(() => null);
    if (!result) return;
    story.my_reaction = result.emoji; story.reaction_count = result.reaction_count;
    layer.querySelectorAll('[data-story-reaction]').forEach(item => {
      const active = item.dataset.storyReaction === result.emoji;
      item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const count = layer.querySelector('[data-story-reaction-count]'); if (count) count.textContent = result.reaction_count;
  });
  layer.querySelector('[data-story-next]')?.addEventListener('click', () => openStoryViewer(next, allStories));
  layer.addEventListener('keydown', e => { if (e.key === 'Escape') closeMomentLayer(); });
  layer.tabIndex = -1; layer.focus();
}

function openMomentComposer(main) {
  closeMomentLayer();
  const layer = document.createElement('div');
  layer.id = 'moment-layer'; layer.className = 'moment-layer';
  layer.innerHTML = `<div class="moment-backdrop" data-moment-close></div><article class="moment-composer" role="dialog" aria-modal="true" aria-label="Share a 24-hour moment">
    <div class="moment-viewer-head"><div><b>Share a 24-hour moment</b><div class="muted">A small, real update for your people. It expires automatically.</div></div><button class="ghost" type="button" data-moment-close aria-label="Close">✕</button></div>
    <textarea class="input" id="moment-content" maxlength="280" rows="4" placeholder="A thought, a win, a verse, or what you are practicing today…"></textarea>
    <input type="file" id="moment-photo-file" accept="image/*" hidden><button class="ghost" id="moment-photo-pick" type="button">📷 Add photo</button><div id="moment-photo-preview" class="moment-photo-preview"></div>
    <div id="moment-photo-cat-wrap" style="display:none"><label class="field-label">What's in this photo?</label><label class="moment-radio"><input type="radio" name="moment-photo-cat" value="nature"> 🌿 Nature</label><label class="moment-radio"><input type="radio" name="moment-photo-cat" value="animal"> 🐾 Animal</label><label class="moment-radio"><input type="radio" name="moment-photo-cat" value="group"> 👥 Group of people</label></div>
    <label class="field-label">Who can see it?</label><select class="input" id="moment-visibility"><option value="public">🌍 Everyone</option><option value="followers">👥 Followers</option><option value="private">🔒 Only me</option></select>
    <div id="moment-status" class="muted" aria-live="polite"></div><button class="primary" id="moment-submit" type="button">Share moment</button>
  </article>`;
  document.body.appendChild(layer);
  let photoData = null;
  layer.querySelectorAll('[data-moment-close]').forEach(el => el.onclick = closeMomentLayer);
  layer.querySelector('#moment-photo-pick').onclick = () => layer.querySelector('#moment-photo-file').click();
  layer.querySelector('#moment-photo-file').onchange = async () => {
    const file = layer.querySelector('#moment-photo-file').files[0]; if (!file) return;
    try { photoData = await resizeImageFile(file, 1200, 0.8); layer.querySelector('#moment-photo-preview').innerHTML = `<img src="${escapeHtml(photoData)}" alt="Photo preview" />`; layer.querySelector('#moment-photo-cat-wrap').style.display = ''; }
    catch { layer.querySelector('#moment-status').textContent = 'Could not process that image.'; }
  };
  layer.querySelector('#moment-submit').onclick = async () => {
    const button = layer.querySelector('#moment-submit'), status = layer.querySelector('#moment-status');
    const category = layer.querySelector('input[name="moment-photo-cat"]:checked')?.value || null;
    if (photoData && !category) { status.textContent = 'Pick a category for the photo.'; return; }
    button.disabled = true; button.textContent = 'Sharing…';
    try { await api('/stories', { method: 'POST', body: { content: layer.querySelector('#moment-content').value.trim(), photo_data: photoData, photo_category: category, visibility: layer.querySelector('#moment-visibility').value }, throwOnError: true }); closeMomentLayer(); state.homeCache = null; renderHome(main); }
    catch (err) { button.disabled = false; button.textContent = 'Share moment'; status.textContent = err.hint || 'Could not share this moment.'; }
  };
  layer.tabIndex = -1; layer.focus();
}

async function renderHome(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  const cacheMatchesScope = state.homeCache && state.homeCache.scope === state.feedScope;
  const critical = cacheMatchesScope && state.homeCache.posts ? [state.homeCache, state.homeCache.users] : await Promise.all([api(`/feed?scope=${encodeURIComponent(state.feedScope)}&limit=20`), api('/users')]);
  const feedData = critical[0];
  const posts = Array.isArray(feedData) ? feedData : (feedData.posts || []);
  const users = critical[1];
  const secondary = state.homeCache && state.homeCache.secondary;
  const [suggested, rec, devo, churchVideos, storiesData] = secondary || [[], null, null, null, null];
  const activeStories = (storiesData && Array.isArray(storiesData.stories)) ? storiesData.stories : [];
  const storyAuthors = [...new Map(activeStories.map(s => [s.user_id, s])).values()];
  if (!cacheMatchesScope) state.homeCache = { posts, users, nextCursor: Array.isArray(feedData) ? null : feedData.next_cursor, secondary: null, scope: state.feedScope };
  const firstName = escapeHtml((state.me && state.me.user && state.me.user.display_name || 'friend').split(' ')[0]);
  main.innerHTML = `
    <section class="home-hero">
      <div>
        <div class="home-kicker">YOUR RHYTHM · TODAY</div>
        <h1>Keep moving, ${firstName}</h1>
        <p>Small steps. Stronger faith. A community moving with you.</p>
      </div>
      <div class="home-hero-mark">✦</div>
    </section>
    <div class="home-actions">
      <button class="home-action home-action-primary" data-home-tab="workout"><span>＋</span><b>Log activity</b><small>Keep your streak alive</small></button>
      <button class="home-action" data-home-tab="explore" data-home-explore="journeys"><span>↗</span><b>Explore routes</b><small>Ride Bible &amp; fantasy worlds</small></button>
    </div>
    <div class="card glass home-composer">
      <div class="composer-heading"><div><div class="foryou-head">Share with your people</div><div class="muted">A thought, a win, or a verse from today.</div></div><span class="composer-spark">✦</span></div>
      <textarea id="home-post-content" class="input" maxlength="1000" rows="3" placeholder="What is moving you today?"></textarea>
      <div class="composer-footer"><select id="home-post-visibility" class="input" aria-label="Who can see this update"><option value="public">🌍 Everyone</option><option value="followers">👥 Followers</option><option value="private">🔒 Only me</option></select><button class="primary" id="home-post-submit" type="button">Share update</button></div>
      <button class="ghost moment-launch" type="button" data-open-moment>＋ Share a 24-hour moment</button>
      <div id="home-post-status" class="muted" aria-live="polite"></div>
    </div>
    ${rec && rec.verse ? `
    <div class="card glass mission-card">
      <div class="mission-kicker"><span>✦ SCRIPTURE IN MOTION</span><span class="mission-live">TODAY</span></div>
      <h2>Move with ${escapeHtml(rec.theme || 'purpose')}</h2>
      <div class="mission-verse"><div class="verse-ref">${escapeHtml(rec.verse.reference)}</div><div class="verse-text">${escapeHtml(rec.verse.text)}</div></div>
      <p class="mission-prompt">Take a short movement break, notice your breath, and let this verse shape the next mile—not as a performance test, but as a practice of presence.</p>
      <div class="mission-actions"><button class="primary" data-home-tab="workout">Begin the mission</button><a class="ghost mission-read" href="https://www.bible.com/search/bible?query=${encodeURIComponent(rec.verse.reference)}" target="_blank" rel="noopener">Read in Bible ↗</a></div>
      <div class="mission-grounding">Functioning Faith coaching is generated from your activity context; Scripture text is always shown from the verified library.</div>
    </div>` : ''}
    <div class="social-section-label"><span>${state.feedScope === 'following' ? 'Following' : 'Community'}</span><span>${users.length ? users.length + ' nearby' : 'Your people'}</span></div>
    <div class="feed-switch" role="tablist" aria-label="Feed view">
      <button type="button" role="tab" aria-selected="${state.feedScope === 'community'}" class="${state.feedScope === 'community' ? 'active' : ''}" data-feed-scope="community">Community</button>
      <button type="button" role="tab" aria-selected="${state.feedScope === 'following'}" class="${state.feedScope === 'following' ? 'active' : ''}" data-feed-scope="following">Following</button>
    </div>
    <div class="stories">
      <button class="story story-create" type="button" data-open-moment><div class="story-ring"><span class="story-plus">＋</span></div><div class="story-label">Your moment</div></button>
      ${storyAuthors.map(s => `<button class="story ${s.viewed ? '' : 'story-unread'}" type="button" data-story-id="${escapeHtml(s.id)}"><div class="story-ring">${avatarHtml({ id: s.user_id, display_name: s.author, has_avatar: s.author_has_avatar }, 'story-avatar')}</div><div class="story-label">${escapeHtml((s.author || 'Friend').split(' ')[0])}</div></button>`).join('')}
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
      ${rec.verse ? `<div class="verse-card verse-tappable" style="margin-bottom:10px" data-verse-ref="${escapeHtml(rec.verse.reference)}"><div class="verse-ref">${rec.verse.reference}</div><div class="verse-text">${escapeHtml(rec.verse.text)}</div><div class="verse-convo" data-convo-for="${escapeHtml(rec.verse.reference)}">💬 Start the conversation</div></div>` : ''}
      <div class="foryou-grid">
        ${rec.podcast ? `<div class="foryou-item"><div class="foryou-label">🎙️ Listen</div><div class="foryou-title">${escapeHtml(rec.podcast.title)}</div><div class="muted" style="font-size:0.74rem">${escapeHtml(rec.podcast.show)}</div>${rec.podcast.audio_url ? `<audio controls preload="none" src="${escapeHtml(rec.podcast.audio_url)}" style="width:100%;margin-top:6px;height:32px"></audio>` : ''}</div>` : ''}
        ${rec.challenge ? `<div class="foryou-item foryou-challenge" data-join-key="${rec.challenge.key}"><div class="foryou-label">🏆 Try a challenge</div><div class="foryou-title">${escapeHtml(rec.challenge.name)}</div><div class="muted" style="font-size:0.74rem">${escapeHtml(rec.challenge.description || '')}</div><button class="follow-btn" style="margin-top:8px" data-join-key="${rec.challenge.key}">Join</button></div>` : ''}
      </div>
    </div>` : ''}
    ${churchVideosHtml(churchVideos)}
    ${suggested && suggested.length ? `
    <div class="card glass suggest-card">
      <div class="suggest-head">People to follow</div>
      <div class="suggest-rail">
        ${suggested.map(u => `
          <div class="suggest-item" data-user="${u.id}">
            ${avatarHtml(u, 'avatar-sm suggest-avatar')}
            <div class="suggest-name">${escapeHtml(u.display_name)}</div>
            <div class="suggest-sub">${escapeHtml(u.reason || `${u.followers_count} follower${u.followers_count===1?'':'s'}`)}</div>
            <button class="follow-btn" data-follow="${u.id}">Follow</button>
          </div>`).join('')}
      </div>
    </div>` : ''}
    <div id="posts"></div>
    <div id="feed-more"></div>
  `;
  main.querySelectorAll('[data-home-tab]').forEach(btn => btn.onclick = () => {
    if (btn.dataset.homeExplore) state.exploreTab = btn.dataset.homeExplore;
    setTab(btn.dataset.homeTab);
  });
  hydrateAvatars(main);
  wireChurchVideoThumbs(main);
  wireVerseCards(main);
  main.querySelectorAll('[data-join-key]').forEach(el => { if (el.tagName === 'BUTTON') el.onclick = async (e) => {
    e.stopPropagation();
    await api(`/challenges/${el.dataset.joinKey}/join`, { method: 'POST' });
    el.textContent = 'Joined ✓'; el.classList.add('following');
  }; });
  main.querySelectorAll('[data-open-moment]').forEach(el => el.onclick = () => openMomentComposer(main));
  main.querySelectorAll('[data-story-id]').forEach(el => el.onclick = () => {
    const story = activeStories.find(s => s.id === el.dataset.storyId);
    if (story) openStoryViewer(story, activeStories);
  });
  if (state.storyTargetId) {
    const target = activeStories.find(s => s.id === state.storyTargetId);
    if (target) { state.storyTargetId = null; setTimeout(() => openStoryViewer(target, activeStories), 50); }
  }
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
        ${p.route ? `<div class="route-banner">${realRouteSvg(p.route)}<span class="badge-overlay">${p.workout_type}</span></div>` : ''}
        <div class="stat-row">
          <div class="stat"><div class="v">${p.distance_km ?? '—'}</div><div class="l">km</div></div>
          <div class="stat"><div class="v">${p.pace_min_per_km ?? '—'}</div><div class="l">min/km</div></div>
          <div class="stat"><div class="v">${p.calories ?? '—'}</div><div class="l">kcal</div></div>
          <div class="stat"><div class="v">${p.avg_hr ?? '—'}</div><div class="l">avg hr</div></div>
        </div>` : ''}
      ${p.photo_data ? `<div class="post-photo"><img src="${p.photo_data}" alt="${escapeHtml(p.photo_category || 'photo')}" style="width:100%;border-radius:10px;margin-top:8px;display:block" /><div class="muted" style="font-size:0.72rem;margin-top:4px">${{nature:'🌿 Nature',animal:'🐾 Animal',group:'👥 Group of people'}[p.photo_category] || ''}</div></div>` : ''}
      ${p.verse_reference ? `<div class="verse-card verse-tappable" data-verse-ref="${escapeHtml(p.verse_reference)}"><div class="verse-ref">${p.verse_reference}</div><div class="verse-text">${escapeHtml(p.verse_text || '')}</div><div class="verse-convo" data-convo-for="${escapeHtml(p.verse_reference)}">💬 Start the conversation</div></div>` : ''}
      <div class="action-row">
        <button class="action-btn ${p.liked_by_me ? 'liked' : ''}" data-like="${p.id}">${p.liked_by_me ? '❤️' : '🤍'} <span class="n">${p.like_count}</span> kudos</button>
        <button class="action-btn ${p.saved_by_me ? 'saved' : ''}" data-save-post="${p.id}" aria-pressed="${p.saved_by_me ? 'true' : 'false'}">${p.saved_by_me ? '🔖 Saved' : '🔖 Save'}</button>
        <button class="action-btn" data-comment-toggle="${p.id}">💬 <span class="n">${p.comment_count || 0}</span></button>
        <button class="action-btn" data-share="${p.id}" data-vis="${p.visibility || 'public'}">↗ Share</button>
        ${p.photo_data ? `<button class="action-btn" data-report="${p.id}">🚩 Report</button>` : ''}
      </div>
      <div class="comments" id="comments-${p.id}" style="display:none">
        <div class="comments-loading muted">Open to load the conversation.</div>
      </div>
    </div>
  `; }).join('') || '<p class="muted">No posts yet.</p>';
  if (state.searchPostId) {
    const target = postsEl.querySelector(`[data-post="${CSS.escape(state.searchPostId)}"]`);
    state.searchPostId = null;
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  hydrateAvatars(postsEl);
  const moreEl = main.querySelector('#feed-more');
  if (moreEl && state.homeCache.nextCursor) {
    moreEl.innerHTML = '<button class="ghost feed-more-btn" type="button">Load more from the community</button>';
    moreEl.querySelector('button').onclick = async () => {
      const button = moreEl.querySelector('button'); button.disabled = true; button.textContent = 'Loading…';
      try {
        const page = await api(`/feed?scope=${encodeURIComponent(state.feedScope)}&limit=20&before=${encodeURIComponent(state.homeCache.nextCursor)}`);
        state.homeCache.posts = state.homeCache.posts.concat(page.posts || []);
        state.homeCache.nextCursor = page.next_cursor || null;
        renderHome(main);
      } catch { button.disabled = false; button.textContent = 'Could not load more — try again'; }
    };
  }
  wireVerseCards(postsEl);
  postsEl.querySelectorAll('[data-report]').forEach(btn => btn.onclick = async () => {
    const reason = prompt('Why are you reporting this photo? (e.g. shows a single person)');
    if (reason === null) return;
    await api(`/posts/${btn.dataset.report}/report`, { method: 'POST', body: { reason } });
    btn.textContent = '🚩 Reported'; btn.disabled = true;
  });
  postsEl.querySelectorAll('.post-user[data-user]').forEach(el => el.onclick = () => renderUserProfile(el.dataset.user));
  postsEl.querySelectorAll('[data-like]').forEach(btn => btn.onclick = async () => {
    await api(`/posts/${btn.dataset.like}/like`, { method: 'POST' });
    state.homeCache = null;
    renderHome(main);
  });
  postsEl.querySelectorAll('[data-save-post]').forEach(btn => btn.onclick = async () => {
    const result = await api(`/posts/${encodeURIComponent(btn.dataset.savePost)}/save`, { method: 'POST', body: {}, throwOnError: true }).catch(() => null);
    if (!result) return;
    btn.classList.toggle('saved', !!result.saved);
    btn.setAttribute('aria-pressed', result.saved ? 'true' : 'false');
    btn.textContent = result.saved ? '🔖 Saved' : '🔖 Save';
  });
  postsEl.querySelectorAll('[data-comment-toggle]').forEach(btn => btn.onclick = () => {
    const el = document.getElementById(`comments-${btn.dataset.commentToggle}`);
    const opening = el.style.display === 'none';
    el.style.display = opening ? 'flex' : 'none';
    if (opening && el.dataset.loaded !== '1') {
      el.innerHTML = '<div class="comments-loading muted">Loading conversation…</div>';
      api(`/posts/${btn.dataset.commentToggle}/comments`).then(({ comments }) => {
        if (!document.body.contains(el)) return;
        el.innerHTML = comments.map(c => `<div class="comment"><b>${escapeHtml(c.author)}</b>${escapeHtml(c.content)}</div>`).join('') + `<div class="comment-input-row"><input type="text" placeholder="Add a comment…" id="comment-input-${btn.dataset.commentToggle}" /><button data-send-comment="${btn.dataset.commentToggle}">Post</button></div>`;
        el.dataset.loaded = '1';
        wireCommentSubmit(el);
      }).catch(() => { el.innerHTML = '<div class="muted">Could not load conversation.</div>'; });
    }
  });
  main.querySelectorAll('[data-feed-scope]').forEach(btn => btn.onclick = () => {
    if (state.feedScope === btn.dataset.feedScope) return;
    state.feedScope = btn.dataset.feedScope; state.homeCache = null; renderHome(main);
  });
  const composerSubmit = main.querySelector('#home-post-submit');
  if (composerSubmit) composerSubmit.onclick = async () => {
    const content = main.querySelector('#home-post-content').value.trim();
    const status = main.querySelector('#home-post-status');
    if (!content) { status.textContent = 'Write something first, even if it is small.'; return; }
    composerSubmit.disabled = true; composerSubmit.textContent = 'Sharing…'; status.textContent = '';
    try {
      await api('/posts', { method: 'POST', body: { content, visibility: main.querySelector('#home-post-visibility').value }, throwOnError: true });
      state.homeCache = null; renderHome(main);
    } catch (err) {
      composerSubmit.disabled = false; composerSubmit.textContent = 'Share update';
      status.textContent = err.status === 429 ? 'You have shared a few updates recently — try again in a minute.' : 'Could not share this update.';
    }
  };
  function wireCommentSubmit(root) { root.querySelectorAll('[data-send-comment]').forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.sendComment; const input = document.getElementById(`comment-input-${id}`);
    if (!input.value.trim()) return;
    await api(`/posts/${id}/comments`, { method: 'POST', body: { content: input.value } });
    state.homeCache = null; renderHome(main);
  }); }
  postsEl.querySelectorAll('[data-vis]').forEach(sel => {
    if (sel.tagName !== 'SELECT') return;
    sel.onchange = async () => {
      await fetch(`/api/posts/${sel.dataset.vis}/visibility`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: sel.value }),
      });
      state.homeCache = null;
      renderHome(main);
    };
  });
  postsEl.querySelectorAll('[data-share]').forEach(btn => btn.onclick = async () => {
    if (btn.dataset.vis !== 'public') { alert('Set this workout to Public to get a shareable link.'); return; }
    const url = `${location.origin}/w/${btn.dataset.share}`;
    try { await navigator.clipboard.writeText(url); btn.textContent = '✓ Link copied'; setTimeout(() => renderHome(main), 1200); }
    catch { prompt('Copy this share link:', url); }
  });
  if (!state.homeCache.secondary) {
    const cache = state.homeCache;
    Promise.all([
      api('/users/suggested').catch(() => []),
      api('/recommendations').catch(() => null),
      api('/devotionals/today').catch(() => null),
      api('/church/videos').catch(() => null),
      api('/stories').catch(() => ({ stories: [] })),
    ]).then(data => {
      if (state.homeCache !== cache) return;
      cache.secondary = data;
      if (state.tab === 'home' && document.getElementById('main') === main) renderHome(main);
    });
  }
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
    `<button class="follow-btn ${data.is_following ? 'following' : ''}" id="profile-follow">${data.is_following ? 'Following' : 'Follow'}</button><button class="ghost profile-message" id="profile-message">Message</button><button class="primary profile-invite" id="profile-invite">Invite to workout</button>`;

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
            <button class="profile-stat-button" data-member-list="followers"><div class="v" id="pf-followers">${data.stats.followers}</div><div class="l">Followers</div></button>
            <button class="profile-stat-button" data-member-list="following"><div class="v">${data.stats.following}</div><div class="l">Following</div></button>
          </div>
        </div>
      </div>
      ${u.bio_verse_ref ? `<div class="verse-card"><div class="verse-ref">${u.bio_verse_ref}</div><div class="verse-text">${escapeHtml(u.bio_verse_text || '')}</div></div>` : ''}
      ${u.bio_link_url ? `<a href="${escapeHtml(u.bio_link_url)}" target="_blank" rel="noopener noreferrer" class="ghost" style="display:inline-block;margin-top:10px;text-decoration:none">${escapeHtml(u.bio_link_label || 'Link ↗')}</a>` : ''}
    </div>
    ${!data.is_me ? `<div class="profile-safety"><button class="ghost" id="profile-block">${data.is_blocked ? 'Unblock member' : 'Block member'}</button><button class="ghost" id="profile-report">Report member</button></div>` : ''}
    <div id="profile-posts">${data.posts.length ? '' : '<p class="muted">No posts to show yet.</p>'}</div>
  `;
  hydrateAvatars(main);

  const pp = document.getElementById('profile-posts');
  if (data.posts.length) pp.innerHTML = data.posts.map((p, i) => `
    <div class="card glass">
      <div class="post-time" style="margin-bottom:8px">${timeAgo(p.created_at)} ago</div>
      ${p.content ? `<div class="post-content">${escapeHtml(p.content)}</div>` : ''}
      ${p.photo_data ? `<img src="${p.photo_data}" alt="${escapeHtml(p.photo_category || 'photo')}" style="width:100%;border-radius:10px;margin-top:8px;display:block" />` : ''}
      ${p.workout_type ? `${p.route ? `<div class="route-banner">${realRouteSvg(p.route)}<span class="badge-overlay">${p.workout_type}</span></div>` : ''}
        <div class="stat-row">
          <div class="stat"><div class="v">${p.distance_km ?? '—'}</div><div class="l">km</div></div>
          <div class="stat"><div class="v">${p.calories ?? '—'}</div><div class="l">kcal</div></div>
          <div class="stat"><div class="v">${p.avg_hr ?? '—'}</div><div class="l">avg hr</div></div>
        </div>` : ''}
      ${p.verse_reference ? `<div class="verse-card verse-tappable" data-verse-ref="${escapeHtml(p.verse_reference)}"><div class="verse-ref">${p.verse_reference}</div><div class="verse-text">${escapeHtml(p.verse_text || '')}</div><div class="verse-convo" data-convo-for="${escapeHtml(p.verse_reference)}">💬 Start the conversation</div></div>` : ''}
    </div>`).join('');

  document.getElementById('profile-back').onclick = () => { state.tab = 'home'; render(); };
  main.querySelectorAll('[data-member-list]').forEach(btn => btn.onclick = () => renderMemberList(main, userId, btn.dataset.memberList, u.display_name));
  wireVerseCards(main);
  const mb = document.getElementById('profile-message');
  if (mb) mb.onclick = () => openDmWith(userId);
  const inviteBtn = document.getElementById('profile-invite');
  if (inviteBtn) inviteBtn.onclick = () => openWorkoutInvite(userId, u.display_name);
  const blockBtn = document.getElementById('profile-block');
  if (blockBtn) blockBtn.onclick = async () => {
    const blocked = blockBtn.textContent.startsWith('Unblock');
    await api(`/users/${userId}/block`, { method: blocked ? 'DELETE' : 'POST' });
    blockBtn.textContent = blocked ? 'Block member' : 'Unblock member';
  };
  const reportBtn = document.getElementById('profile-report');
  if (reportBtn) reportBtn.onclick = async () => {
    const reason = prompt('Why are you reporting this member?');
    if (!reason) return;
    await api(`/users/${userId}/report`, { method: 'POST', body: { reason }, throwOnError: true });
    reportBtn.textContent = 'Report sent'; reportBtn.disabled = true;
  };
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

function goalUnit(metric) {
  return metric === 'distance_km' ? 'km' : metric === 'duration_min' ? 'min' : metric === 'calories' ? 'kcal' : 'sessions';
}

function trainingLog(performance) {
  const max = Math.max(1, ...performance.days.map(d => d.load));
  return `<div class="training-log" aria-label="28 day training log">${performance.days.map(d => {
    const level = d.load === 0 ? 0 : Math.min(4, Math.ceil((d.load / max) * 4));
    return `<span class="training-day level-${level}" title="${d.date}: ${d.workouts} workout${d.workouts === 1 ? '' : 's'}, ${d.load} load"><i></i></span>`;
  }).join('')}</div>`;
}

async function renderStats(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  main.innerHTML = `<div class="card glass" style="text-align:center">Loading your stats…</div>`;
  let summary, trends, breakdown, challenges, performance, goals, weeklyRecap;
  try {
    [summary, trends, breakdown, challenges, performance, goals, weeklyRecap] = await Promise.all([
      api('/stats/summary'), api('/stats/trends?weeks=12'), api('/stats/activity-breakdown'), api('/challenges'), api('/stats/performance'), api('/goals'), api('/stats/recap'),
    ]);
  } catch { main.innerHTML = '<div class="card glass">Could not load stats.</div>'; return; }

  const mine = challenges.filter(c => c.joined);
  const tile = (v, l) => `<div class="stat-tile"><div class="stat-tile-v">${v}</div><div class="stat-tile-l">${l}</div></div>`;
  const wk = summary.this_week, mo = summary.this_month, life = summary.lifetime, rec = summary.records;
  const actMax = Math.max(1, ...breakdown.map(b => b.count));

  main.innerHTML = `
    <h2>Your Stats</h2>
    <div class="card glass weekly-recap-card">
      <div class="premium-card-head"><div><div class="stats-period-head">Your week in motion</div><div class="muted">A private recap of the last seven days.</div></div><span class="premium-badge">RECAP</span></div>
      <div class="recap-grid"><div><b>${weeklyRecap.workouts}</b><span>workouts</span></div><div><b>${weeklyRecap.distance_km}</b><span>km</span></div><div><b>${weeklyRecap.minutes}</b><span>minutes</span></div><div><b>${weeklyRecap.active_days}</b><span>active days</span></div></div>
      <p class="recap-copy">${weeklyRecap.kudos || weeklyRecap.replies ? `Your community sent ${weeklyRecap.kudos} kudos and ${weeklyRecap.replies} repl${weeklyRecap.replies === 1 ? 'y' : 'ies'} this week.` : 'Your next small step is welcome here.'}</p>
      <div class="recap-actions"><button class="ghost" id="share-weekly-recap" type="button">Share recap</button><span id="weekly-recap-status" class="muted" aria-live="polite"></span></div>
    </div>
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

    <div class="card glass premium-progress-card">
      <div class="premium-card-head"><div><div class="stats-period-head">Progress lab</div><div class="muted">Your last 28 days, translated into momentum.</div></div><span class="premium-badge">PROGRESS</span></div>
      <div class="load-grid">
        <div><b>${performance.load7}</b><span>7-day load</span></div>
        <div><b>${performance.freshness}</b><span>freshness</span></div>
        <div><b>${performance.consistency}%</b><span>consistency</span></div>
      </div>
      ${trainingLog(performance)}
      <div class="training-log-legend"><span><i class="level-0"></i> Rest</span><span><i class="level-2"></i> Training</span><span><i class="level-4"></i> Heavy</span><span class="muted">28-day log</span></div>
      <div class="muted" style="font-size:.7rem;margin-top:8px">Load uses recorded effort when available and workout minutes otherwise. Freshness is a transparent training heuristic, not medical advice.</div>
    </div>

    <div class="card glass goals-card">
      <div class="premium-card-head"><div><div class="stats-period-head">Custom goals</div><div class="muted">Weekly, monthly, or annual targets.</div></div><button class="ghost" id="goal-new">＋ Goal</button></div>
      ${goals.length ? goals.map(g => `<div class="goal-row"><div class="goal-row-head"><strong>${escapeHtml(g.title)}</strong><button class="icon-btn" data-goal-delete="${g.id}" aria-label="Delete goal">×</button></div><div class="goal-row-meta"><span>${g.progress} / ${g.target} ${goalUnit(g.metric)}</span><span>${g.period}${g.activity_type ? ' · ' + escapeHtml(g.activity_type) : ''}</span></div><div class="challenge-track"><span style="width:${g.percent}%"></span></div></div>`).join('') : '<p class="muted">Set a target that gives your next month a little shape.</p>'}
      <form id="goal-form" class="goal-form" hidden>
        <input class="input" id="goal-title" maxlength="80" placeholder="e.g. Run with patience" required>
        <div class="goal-form-grid"><select class="input" id="goal-metric"><option value="distance_km">Distance</option><option value="duration_min">Time</option><option value="workouts">Workouts</option><option value="calories">Calories</option></select><input class="input" id="goal-target" type="number" min="1" step="any" placeholder="Target" required><select class="input" id="goal-period"><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option></select></div>
        <div class="goal-form-actions"><button type="button" class="ghost" id="goal-cancel">Cancel</button><button type="submit" class="primary">Save goal</button></div><div id="goal-error" class="form-error" hidden></div>
      </form>
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

    <div class="card glass" id="effort-card">
      <div class="stats-period-head">Effort · time in zone</div>
      <div class="muted">Loading…</div>
    </div>

    <div class="card glass">
      <div class="stats-period-head">My challenges</div>
      ${mine.length ? mine.map(c => challengeRow(c)).join('') : '<p class="muted">You haven\'t joined a challenge yet — see Explore › Challenges.</p>'}
    </div>
  `;

  const recapButton = main.querySelector('#share-weekly-recap');
  if (recapButton) recapButton.onclick = async () => {
    const status = main.querySelector('#weekly-recap-status'); recapButton.disabled = true; recapButton.textContent = 'Sharing…';
    try { await api('/posts', { method: 'POST', body: { content: weeklyRecap.share_text, visibility: 'public' }, throwOnError: true }); status.textContent = 'Shared to Community ✓'; recapButton.textContent = 'Shared'; }
    catch { recapButton.disabled = false; recapButton.textContent = 'Share recap'; status.textContent = 'Could not share right now.'; }
  };

  const goalForm = main.querySelector('#goal-form');
  main.querySelector('#goal-new').onclick = () => { goalForm.hidden = false; main.querySelector('#goal-title').focus(); };
  main.querySelector('#goal-cancel').onclick = () => { goalForm.hidden = true; };
  goalForm.onsubmit = async (e) => {
    e.preventDefault();
    const err = main.querySelector('#goal-error'); err.hidden = true;
    try { await api('/goals', { method: 'POST', body: { title: main.querySelector('#goal-title').value, metric: main.querySelector('#goal-metric').value, target: Number(main.querySelector('#goal-target').value), period: main.querySelector('#goal-period').value } }); await renderStats(main); }
    catch { err.textContent = 'Could not save that goal.'; err.hidden = false; }
  };
  main.querySelectorAll('[data-goal-delete]').forEach(btn => btn.onclick = async () => { await api('/goals/' + encodeURIComponent(btn.dataset.goalDelete), { method: 'DELETE' }); await renderStats(main); });

  // Your own training log. Everything you have recorded, whether or not you
  // ever posted it.
  const logMount = document.createElement('div');
  logMount.id = 'workout-log';
  main.appendChild(logMount);
  renderWorkoutLog(logMount);
  renderEffortSection();
}

function challengeRow(c) {
  const unit = c.metric === 'distance_km' ? 'km' : c.metric === 'duration_min' ? 'min' : '';
  return `<div class="challenge-row ${c.completed ? 'done' : ''}">
    <div class="challenge-top"><span class="challenge-name">${c.completed ? '✓ ' : ''}${c.name}</span>
      <span class="challenge-prog">${(+c.progress).toFixed(c.metric==='distance_km'?1:0)}/${c.target} ${unit}</span></div>
    <div class="challenge-track"><span style="width:${c.percent}%"></span></div>
  </div>`;
}


// Everything Explore contains, in one place. The Explore tab opens on this
// index so the whole catalogue is visible at a glance; you pick a section and
// go into it, rather than landing in one and scrolling a strip to find the rest.
const EXPLORE_SECTIONS = [
  { key: 'journeys',    name: 'Journeys',    blurb: 'Ride or run a 3D route through scripture and story.',
    icon: '<path d="M4 19c3-1 4-5 8-5s5-4 8-5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="9" r="1.6"/>' },
  { key: 'challenges',  name: 'Challenges',  blurb: 'Themed distance and effort goals to join.',
    icon: '<path d="M7 4h10v4a5 5 0 01-10 0V4z"/><path d="M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3"/><path d="M10 15h4v3h-4z"/><path d="M8 21h8"/>' },
  { key: 'videos',      name: 'Videos',      blurb: 'Kids, fitness, and short teaching films.',
    icon: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5l5 2.5-5 2.5z"/>' },
  { key: 'reels',       name: 'Reels',       blurb: 'Scroll short encouragement, movement, faith, and food.',
    icon: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 3l2 4h4l-2-4M9 11h6M9 15h4"/>' },
  { key: 'podcasts',    name: 'Podcasts',    blurb: 'Full episodes from public faith and fitness feeds.',
    icon: '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6"/>' },
  { key: 'scripture',   name: 'Scripture',   blurb: 'Search the Bible and join the conversation on a verse.',
    icon: '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M12 7v6M9.5 9.5h5"/>' },
  { key: 'groups',      name: 'Groups',      blurb: 'Your churches and clubs, their chat and meetups.',
    icon: '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3.2 2.8-5 6-5s6 1.8 6 5"/><path d="M16 6.2a3 3 0 010 5.6M17 14.2c2.4.5 4 2.2 4 4.8"/>' },
  { key: 'leaderboard', name: 'Leaderboard', blurb: 'Where you stand this week.',
    icon: '<rect x="4" y="12" width="4" height="8"/><rect x="10" y="7" width="4" height="13"/><rect x="16" y="10" width="4" height="10"/>' },
  { key: 'breathe',     name: 'Breathe',     blurb: 'A guided breathing pause with scripture.',
    icon: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5" opacity="0.55"/><circle cx="12" cy="12" r="10.5" opacity="0.28"/>' },
  { key: 'motivation',  name: 'Motivation',  blurb: 'Short encouragement for the middle of a hard week.',
    icon: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>' },
];

function exploreIcon(paths) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" '
    + 'stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
}

function renderExploreIndex(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  main.innerHTML = '<div class="explore-hero"><h2>Explore</h2>'
    + '<p class="muted">Everything Functioning Faith has beyond your own training. Pick a section.</p></div>'
    + '<div class="explore-grid">'
    + EXPLORE_SECTIONS.map(sec => '<button class="explore-tile" data-esec="' + sec.key + '">'
        + '<span class="explore-tile-icon">' + exploreIcon(sec.icon) + '</span>'
        + '<span class="explore-tile-name">' + escapeHtml(sec.name) + '</span>'
        + '<span class="explore-tile-blurb">' + escapeHtml(sec.blurb) + '</span>'
      + '</button>').join('')
    + '</div>';
  main.querySelectorAll('[data-esec]').forEach(b => {
    b.onclick = () => { state.exploreTab = b.dataset.esec; renderExplore(main); };
  });
}

async function renderExplore(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');

  // No section chosen: show the index of everything available.
  if (!state.exploreTab) return renderExploreIndex(main);

  const current = EXPLORE_SECTIONS.find(x => x.key === state.exploreTab);
  main.innerHTML = `
    <div class="explore-crumb">
      <button class="ghost back-btn" id="explore-back">← Explore</button>
      <span class="explore-crumb-name">${escapeHtml(current ? current.name : state.exploreTab)}</span>
    </div>
    <div class="section-tabs section-tabs-scroll">
      ${EXPLORE_SECTIONS.map(sec => `<button data-etab="${sec.key}" class="${state.exploreTab===sec.key?'active':''}">${escapeHtml(sec.name)}</button>`).join('')}
    </div>
    <div id="explore-body"></div>
  `;
  document.getElementById('explore-back').onclick = () => { state.exploreTab = null; renderExplore(main); };
  main.querySelectorAll('[data-etab]').forEach(b => b.onclick = () => { state.exploreTab = b.dataset.etab; renderExplore(main); });
  const body = document.getElementById('explore-body');

  if (state.exploreTab === 'journeys') {
    await renderJourneysTab(body);
  } else if (state.exploreTab === 'challenges') {
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
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><h2 style="margin-bottom:0">Groups</h2><button class="primary" id="new-group-btn">+ Create group</button></div>
      <div class="card glass" id="new-group-form" style="display:none;margin-top:12px">
        <h3 style="margin-top:0">Start your community</h3>
        <input class="input" id="ng-name" maxlength="80" placeholder="Group name" />
        <input class="input" id="ng-username" maxlength="30" placeholder="Group username (e.g. sunrise-runners)" />
        <input class="input" id="ng-sport" maxlength="50" placeholder="Sport or activity (run, cycling, yoga…)" />
        <input class="input" id="ng-church" maxlength="120" placeholder="Church or ministry (optional)" />
        <input class="input" id="ng-location" maxlength="120" placeholder="Location (city, park, gym…)" />
        <textarea class="input" id="ng-description" maxlength="500" rows="3" placeholder="What is this group about?"></textarea>
        <div id="ng-status" class="muted" style="margin:6px 0"></div><button class="primary" id="ng-submit" style="width:100%">Create group</button>
      </div>
      <div class="card glass" id="recommended-groups"><div class="muted">Finding groups for you…</div></div>
      ${groups.map(g => `<div class="card glass" data-group="${g.id}" style="cursor:pointer"><strong>${escapeHtml(g.name)}</strong><div class="muted">@${escapeHtml(g.username || '')} · ${g.member_count || 0} members${g.sport ? ' · ' + escapeHtml(g.sport) : ''}${g.location_name ? ' · ' + escapeHtml(g.location_name) : ''}</div><div class="muted">${escapeHtml(g.description || '')}</div></div>`).join('')}
      <h2>Quests</h2>
      ${quests.map(q => `<div class="card glass"><strong>${q.name}</strong><div class="muted">${q.description} · theme: ${q.theme}</div></div>`).join('')}
    `;
    document.getElementById('new-group-btn').onclick = () => { const f = document.getElementById('new-group-form'); f.style.display = f.style.display === 'none' ? 'block' : 'none'; };
    document.getElementById('ng-submit').onclick = async () => {
      const status = document.getElementById('ng-status'); status.textContent = 'Creating…';
      const r = await api('/groups', { method: 'POST', body: { name: document.getElementById('ng-name').value, username: document.getElementById('ng-username').value, sport: document.getElementById('ng-sport').value, church_name: document.getElementById('ng-church').value, location_name: document.getElementById('ng-location').value, description: document.getElementById('ng-description').value } });
      if (r.error) { status.textContent = r.hint || r.error; return; }
      renderGroupDetail(r.group.id);
    };
    api('/groups/recommended').then(r => { const el = document.getElementById('recommended-groups'); if (!r.groups.length) { el.remove(); return; } el.innerHTML = `<div class="field-label">${r.chosen_by === 'gloo' ? '✦ Gloo picks for you' : 'Suggested groups'}</div>` + r.groups.slice(0, 3).map(g => `<div class="comment" data-group="${g.id}" style="cursor:pointer"><b>${escapeHtml(g.name)}</b><div class="muted">@${escapeHtml(g.username || '')} · ${escapeHtml(g.reason || '')}</div></div>`).join(''); el.querySelectorAll('[data-group]').forEach(x => x.onclick = () => renderGroupDetail(x.dataset.group)); }).catch(() => document.getElementById('recommended-groups')?.remove());
    body.querySelectorAll('[data-group]').forEach(el => el.onclick = () => renderGroupDetail(el.dataset.group));
  } else if (state.exploreTab === 'breathe') {
    await renderBreathe(body);
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
  } else if (state.exploreTab === 'reels') {
    await renderReelsTab(body);
  } else if (state.exploreTab === 'scripture') {
    await renderScriptureTab(body);
  }
}

// --- Reel sound ------------------------------------------------------------
// Sound is a preference, not a per-video chore. Once someone turns it on it
// stays on for every reel after it, and it survives leaving the tab.
//
// The first reel of a first visit still starts muted, and that is not a choice
// we get to make: browsers block autoplay with sound until the page has had a
// real user gesture, and a video that silently refuses to start is worse than
// one that starts quiet. After the first tap the preference carries.
function reelsSoundOn() {
  try { return localStorage.getItem('ff-reels-sound') === 'on'; } catch { return false; }
}
function setReelsSound(on) {
  try { localStorage.setItem('ff-reels-sound', on ? 'on' : 'off'); } catch { /* private mode */ }
}
// Drive an already-playing embed without rebuilding it, so toggling sound does
// not restart the video from the beginning.
function reelCommand(iframe, func) {
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args: [] }), '*');
    return true;
  } catch { return false; }
}
function reelSoundButton(on) {
  return '<button type="button" class="reel-sound" data-reel-sound aria-pressed="' + (on ? 'true' : 'false') +
         '" aria-label="' + (on ? 'Mute' : 'Unmute') + '">' + (on ? '🔊' : '🔇') + '</button>';
}

async function renderMemberList(main, userId, kind, displayName) {
  main.innerHTML = `<button class="ghost back-btn" id="member-list-back">← Back to ${escapeHtml(displayName)}'s profile</button><div class="card glass"><span class="eyebrow">Community</span><h2>${kind === 'followers' ? 'Followers' : 'Following'}</h2><p class="muted">People connected to ${escapeHtml(displayName)}.</p></div><div id="member-list" class="member-list"><div class="card glass muted">Loading…</div></div>`;
  let data;
  try { data = await api(`/users/${encodeURIComponent(userId)}/${kind}`); } catch { data = { members: [] }; }
  const list = main.querySelector('#member-list');
  list.innerHTML = data.members.length ? data.members.map(member => `<div class="member-list-row" data-member-id="${escapeHtml(member.id)}">
    ${avatarHtml(member, 'avatar-sm')}<div class="member-list-copy"><b>${escapeHtml(member.display_name)}</b>${member.bio_verse_ref ? `<span class="muted">${escapeHtml(member.bio_verse_ref)}</span>` : ''}</div>
    <button class="follow-btn ${member.is_following ? 'following' : ''}" data-member-follow="${escapeHtml(member.id)}">${member.is_following ? 'Following' : 'Follow'}</button>
  </div>`).join('') : '<div class="card glass"><p class="muted">No members to show here yet.</p></div>';
  hydrateAvatars(list);
  main.querySelector('#member-list-back').onclick = () => renderUserProfile(userId);
  list.querySelectorAll('[data-member-id]').forEach(row => row.onclick = e => { if (!e.target.closest('[data-member-follow]')) renderUserProfile(row.dataset.memberId); });
  list.querySelectorAll('[data-member-follow]').forEach(btn => btn.onclick = async e => {
    e.stopPropagation(); const result = await api(`/users/${encodeURIComponent(btn.dataset.memberFollow)}/follow`, { method: 'POST' });
    btn.textContent = result.following ? 'Following' : 'Follow'; btn.classList.toggle('following', result.following);
  });
}
function reelActionButton(kind, active, count) {
  const icon = kind === 'like' ? '♥' : '🔖';
  const label = kind === 'like' ? (active ? 'Unlike reel' : 'Like reel') : (active ? 'Remove reel from saves' : 'Save reel');
  return `<button type="button" class="reel-action ${active ? 'is-active' : ''}" data-reel-action="${kind}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${label}"><span class="reel-action-icon">${icon}</span><span data-reel-count>${Number(count) || 0}</span></button>`;
}
function reelShareButton() {
  return '<button type="button" class="reel-action" data-reel-action="share" aria-label="Share reel"><span class="reel-action-icon">↗</span><span>Share</span></button>';
}

// Standalone short-form feed: Reels is intentionally separate from Videos so
// it behaves like a scrollable social surface, not another category shelf.
async function renderReelsTab(body) {
  body.innerHTML = `<div class="reels-hero"><div class="video-kicker">FUNCTIONING FAITH REELS</div><h2>Small moments. Big encouragement.</h2><p>One mixed feed for faith, movement, meals, family, and your church. Swipe up for the next moment.</p>
    <div class="reels-feed-note">Shorts + food + church content · Gloo-curated when available</div>
    <div class="reel-view-switch" role="tablist" aria-label="Reel feed"><button type="button" role="tab" aria-selected="${state.reelsView === 'for_you'}" class="${state.reelsView === 'for_you' ? 'active' : ''}" data-reels-view="for_you">For you</button><button type="button" role="tab" aria-selected="${state.reelsView === 'saved'}" class="${state.reelsView === 'saved' ? 'active' : ''}" data-reels-view="saved">Saved</button></div></div>
    <div id="reels-list"><div class="muted">Loading reels…</div></div>`;
  body.querySelectorAll('[data-reels-view]').forEach(btn => btn.onclick = () => { state.reelsView = btn.dataset.reelsView; renderReelsTab(body); });
  let payload = { videos: [] };
  if (state.reelsView === 'saved') {
    try { payload = await api('/reels/saved'); } catch { payload.videos = []; }
  } else {
    try { payload = await api('/reels'); } catch { try { payload.videos = await api('/videos?category=reels'); } catch { payload.videos = []; } }
  }
  const starters = [
    { video_id: 'nENP1nWCJGU', title: 'Meal Prep: 5 Recipes + 10 Meals for Variety', channel_title: 'Fit Men Cook', category: 'food', is_short: 1 },
    { video_id: 'pDgEBQx7wKY', title: 'Budget Meal Prep with Nutrient-Dense Ingredients', channel_title: 'Downshiftology', category: 'food', is_short: 1 },
    { video_id: 'KjytadfepNQ', title: 'Full Body Strength, Stretching, Core & Cardio', channel_title: 'Shaped · Faith & Fitness', category: 'fitness' },
    { video_id: '6vAqOIoaKdQ', title: 'Quick Exercises for Physical & Spiritual Strength', channel_title: 'Shaped · Faith & Fitness', category: 'fitness' },
    { video_id: 'VoyPK-sqoyQ', title: 'Living With a Warrior Mentality', channel_title: 'Passion City Church', category: 'motivational' },
    { video_id: 'Ezs5GWi6KWk', title: 'The Fullest and Freest Version of You', channel_title: 'Passion City Church', category: 'motivational' },
    { video_id: 'ak06MSETeo4', title: 'What Is the Bible? · Animated Explainer', channel_title: 'BibleProject', category: 'christian' },
    { video_id: 'xsIRy1IlI_0', title: 'Fruit of the Spirit Brain Break', channel_title: 'Ready Set Fitness Kids', category: 'kids' },
  ].map(v => ({ ...v, thumbnail_url: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg` }));
  let videos = [...(payload.videos || []), ...(state.reelsView === 'saved' ? [] : starters)];
  const seen = new Set();
  videos = videos.filter(v => v.video_id && !seen.has(v.video_id))
    .map(v => { seen.add(v.video_id); return v; })
    .sort(() => Math.random() - 0.5);
  const list = document.getElementById('reels-list');
  if (!videos.length) { list.innerHTML = `<div class="card glass"><p class="muted">${state.reelsView === 'saved' ? 'Your saved Reels will appear here. Tap 🔖 on anything you want to come back to.' : 'No reels in this filter yet. Fresh videos will appear here as the library refreshes.'}</p></div>`; return; }
  const labels = { food: 'Food + fitness', kids: 'Kids + family', fitness: 'Faith + movement', christian: 'Scripture + formation', motivational: 'Purpose + perseverance', veggietales: 'Kids + family', nickbare: 'Training + discipline', church: 'Your church' };
  list.innerHTML = videos.map(v => `<article class="reel-card" data-reel-card="${escapeHtml(v.video_id)}">
    <div class="reel-frame video-thumb-wrap" data-reel-frame="${escapeHtml(v.video_id)}"><img loading="lazy" src="${escapeHtml(v.thumbnail_url || `https://i.ytimg.com/vi/${encodeURIComponent(v.video_id)}/hqdefault.jpg`)}" alt="${escapeHtml(v.title || 'Functioning Faith reel')}" /><span class="reel-play">▶</span>${reelSoundButton(reelsSoundOn())}</div>
    <div class="reel-actions" aria-label="Reel actions">${reelActionButton('like', v.liked_by_me, v.like_count)}${reelActionButton('save', v.saved_by_me, v.save_count)}${reelShareButton()}</div>
    <div class="reel-overlay"><span class="video-audience">${escapeHtml(labels[v.category] || 'Faith + movement')}</span><div class="reel-title">${escapeHtml(v.title || 'Short encouragement')}</div><div class="muted">${escapeHtml(v.channel_title || '')}</div></div>
  </article>`).join('');
  let activeCard = null;
  const activate = card => {
    if (activeCard && activeCard !== card) {
      activeCard.classList.remove('is-active');
      const oldFrame = activeCard.querySelector('[data-reel-frame]');
      if (oldFrame) oldFrame.innerHTML = `<img loading="lazy" src="${escapeHtml(oldFrame.dataset.thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(activeCard.dataset.reelCard)}/hqdefault.jpg`)}" alt="" /><span class="reel-play">▶</span>${reelSoundButton(reelsSoundOn())}`;
    }
    activeCard = card;
    card.classList.add('is-active');
    const frame = card.querySelector('[data-reel-frame]');
    if (frame.querySelector('iframe')) return;
    const id = card.dataset.reelCard;
    frame.dataset.thumbnail = frame.querySelector('img')?.src || '';
    // The embed is built muted or unmuted to match the standing preference, so
    // a reel someone scrolls to already sounds the way the last one did.
    const on = reelsSoundOn();
    frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=${on ? 0 : 1}&playsinline=1&controls=1&rel=0&modestbranding=1&enablejsapi=1" title="Functioning Faith reel" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>${reelSoundButton(on)}`;
  };

  // One delegated handler for every sound button, present and future — the
  // frames are rebuilt as reels scroll, so per-element handlers would be lost.
  list.addEventListener('click', (e) => {
    const action = e.target.closest('[data-reel-action]');
    if (action) {
      e.stopPropagation();
      e.preventDefault();
      const card = action.closest('[data-reel-card]');
      const id = card?.dataset.reelCard;
      if (!id) return;
      const kind = action.dataset.reelAction;
      if (kind === 'share') {
        const url = `${location.origin}/?open=reel&video_id=${encodeURIComponent(id)}`;
        const finish = () => { action.classList.add('is-confirmed'); setTimeout(() => action.classList.remove('is-confirmed'), 900); };
        if (navigator.share) navigator.share({ title: 'Functioning Faith Reel', url }).then(finish).catch(() => {});
        else if (navigator.clipboard) navigator.clipboard.writeText(url).then(finish).catch(() => {});
        else { window.prompt('Copy this reel link', url); }
      } else {
        api(`/reels/${encodeURIComponent(id)}/reaction`, { method: 'POST', body: { kind }, throwOnError: true }).then(result => {
          action.classList.toggle('is-active', !!result.active);
          action.setAttribute('aria-pressed', result.active ? 'true' : 'false');
          action.setAttribute('aria-label', kind === 'like'
            ? (result.active ? 'Unlike reel' : 'Like reel')
            : (result.active ? 'Remove reel from saves' : 'Save reel'));
          const count = action.querySelector('[data-reel-count]');
          if (count) count.textContent = result.count;
        }).catch(() => {});
      }
      return;
    }
    const btn = e.target.closest('[data-reel-sound]');
    if (!btn) return;
    // Don't let the tap fall through to the card and re-activate it.
    e.stopPropagation();
    e.preventDefault();

    const on = !reelsSoundOn();
    setReelsSound(on);

    // Update the reel that is playing right now without restarting it.
    const iframe = btn.parentElement && btn.parentElement.querySelector('iframe');
    if (iframe) reelCommand(iframe, on ? 'unMute' : 'mute');

    // And bring every button on screen into agreement, so the control never
    // contradicts what is actually audible.
    list.querySelectorAll('[data-reel-sound]').forEach(b => {
      b.textContent = on ? '🔊' : '🔇';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'Mute' : 'Unmute');
    });
  });

  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting && entry.intersectionRatio >= 0.65) activate(entry.target); }), { root: list, threshold: [0.65] });
  list.querySelectorAll('[data-reel-card]').forEach(card => { observer.observe(card); card.onclick = () => activate(card); });
  if (state.reelTargetId) {
    const target = list.querySelector(`[data-reel-card="${CSS.escape(state.reelTargetId)}"]`);
    state.reelTargetId = null;
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => activate(target), 250); }
  }
}

// ---- Curated video library -------------------------------------------------
// Fallback entries are official/public YouTube videos, embedded through
// YouTube's player rather than copied into Functioning Faith. The API-backed library can
// add fresh episodes later; these keep the experience useful without a key.
async function renderVideosTab(body) {
  if (!state.videoCategory) state.videoCategory = 'kids';
  const CATS = [
    { key: 'kids', label: 'Kids' },
    { key: 'fitness', label: 'Fitness' },
    { key: 'food', label: 'Food + fitness' },
    { key: 'motivational', label: 'Motivation' },
    { key: 'christian', label: 'Christian voices' },
    { key: 'veggietales', label: 'VeggieTales' },
    { key: 'nickbare', label: 'Nick Bare' },
  ];
  const CURATED = {
    kids: [
      { video_id: 'lefQCGjC02U', title: 'Memory Move It! · Bible Brain Break', channel_title: 'Ready Set Fitness Kids', audience: 'Family-friendly movement' },
      { video_id: 'xsIRy1IlI_0', title: 'Fruit of the Spirit Brain Break', channel_title: 'Ready Set Fitness Kids', audience: 'Family-friendly movement' },
    ],
    fitness: [
      { video_id: 'KjytadfepNQ', title: 'Full Body Strength, Stretching, Core & Cardio', channel_title: 'Shaped · Faith & Fitness', audience: 'Faith + fitness' },
      { video_id: 'Hhkd1_3beZk', title: 'Full Body Strength · Christian Workout', channel_title: 'Christian Coach', audience: 'Faith + fitness' },
      { video_id: '6vAqOIoaKdQ', title: 'Quick Exercises for Physical & Spiritual Strength', channel_title: 'Shaped · Faith & Fitness', audience: 'Faith + fitness' },
    ],
    food: [
      { video_id: 'nENP1nWCJGU', title: 'Meal Prep: 5 Recipes + 10 Meals for Variety', channel_title: 'Fit Men Cook', audience: 'Food + fitness' },
      { video_id: 'pDgEBQx7wKY', title: 'Budget Meal Prep with Nutrient-Dense Ingredients', channel_title: 'Downshiftology', audience: 'Food + fitness' },
    ],
    motivational: [
      { video_id: 'VoyPK-sqoyQ', title: 'Living With a Warrior Mentality', channel_title: 'Passion City Church · Louie Giglio', audience: 'Purpose + perseverance' },
      { video_id: 'Ezs5GWi6KWk', title: 'The Fullest and Freest Version of You', channel_title: 'Passion City Church · Louie Giglio', audience: 'Purpose + perseverance' },
    ],
    christian: [
      { video_id: 'ak06MSETeo4', title: 'What Is the Bible? · Animated Explainer', channel_title: 'BibleProject', audience: 'Scripture + formation' },
      { video_id: 'NtKb7CJDUZc', title: 'Jesus Said 2000 Words That Changed History', channel_title: 'BibleProject', audience: 'Scripture + formation' },
      { video_id: 'L-AaKTgtXeo', title: 'The Crossroads of Faith · Acts 5', channel_title: 'Passion City Church', audience: 'Christian speech' },
    ],
    veggietales: [
      { video_id: 'z-NBRPDWhqU', title: 'VeggieTales Compilation · Truth & Honesty', channel_title: 'VeggieTales Official', audience: 'Kids + family' },
    ],
    nickbare: [
      { video_id: 'kXsc40m4iRU', title: 'If I Had to Start Training All Over Again', channel_title: 'The Nick Bare Podcast', audience: 'Training + discipline' },
    ],
  };
  let configured = true;
  try { ({ configured } = await api('/youtube/configured')); } catch { configured = false; }

  body.innerHTML = `<div class="video-hero"><div class="video-kicker">FUNCTIONING FAITH WATCH</div><h2>Train your body. Feed your soul.</h2><p>Hand-picked movement, kids content, Christian voices, and stories that help the whole family keep going.</p></div>
    <div class="section-tabs section-tabs-scroll" style="margin-bottom:12px">
      ${CATS.map(c => `<button data-vcat="${c.key}" class="${state.videoCategory === c.key ? 'active' : ''}">${c.label}</button>`).join('')}
    </div>
    <div class="video-source-note">${configured ? 'Fresh from connected YouTube sources · ' : 'Featured official/public sources · '}tap a card to play inline</div>
    <div id="videos-list"><div class="muted">Loading…</div></div>`;

  body.querySelectorAll('[data-vcat]').forEach(b => b.onclick = () => { state.videoCategory = b.dataset.vcat; renderVideosTab(body); });

  const listEl = document.getElementById('videos-list');
  let videos = [];
  if (configured) {
    try { videos = await api(`/videos?category=${encodeURIComponent(state.videoCategory)}`); } catch { videos = []; }
  }
  if (!videos.length) videos = (CURATED[state.videoCategory] || []).map(v => ({ ...v, thumbnail_url: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg` }));

  if (!videos.length) {
    listEl.innerHTML = `<div class="card glass"><p class="muted">No videos are available in this category yet. Check back shortly.</p></div>`;
    return;
  }

  const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

  listEl.innerHTML = videos.map(v => `
    <div class="card glass" data-video-card="${escapeHtml(v.video_id)}">
      <div class="video-thumb-wrap" style="position:relative;cursor:pointer;border-radius:var(--radius);overflow:hidden">
        ${v.thumbnail_url ? `<img src="${escapeHtml(v.thumbnail_url)}" alt="" style="width:100%;display:block">` : ''}
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:2.4rem;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,0.6)">▶</div>
      </div>
      <div style="margin-top:10px"><b>${escapeHtml(v.title || '(untitled)')}</b></div>
      <div class="muted" style="font-size:0.8rem;margin:3px 0 3px">${escapeHtml(v.channel_title || '')}${v.published_at ? ' · ' + fmtDate(v.published_at) : ''}</div>
      ${v.audience ? `<div class="video-audience">${escapeHtml(v.audience)}</div>` : ''}
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
      <div class="muted" style="margin-bottom:6px">@${escapeHtml(g.username || '')}${g.sport ? ' · ' + escapeHtml(g.sport) : ''}${g.location_name ? ' · ' + escapeHtml(g.location_name) : ''}</div>
      ${g.church_name ? `<div class="muted" style="margin-bottom:6px">⛪ ${escapeHtml(g.church_name)}</div>` : ''}
      <div style="margin-bottom:10px">${escapeHtml(g.description || '')}</div>
      <div class="muted" style="margin-bottom:10px">${data.member_count} member${data.member_count === 1 ? '' : 's'}</div>
      <button class="follow-btn ${data.is_member ? 'following' : ''}" id="group-join-leave">${data.is_member ? 'Leave group' : 'Join group'}</button>
      ${data.is_admin ? `<div style="display:flex;gap:8px;margin-top:10px"><button class="ghost" id="group-invite-btn">Invite members</button><button class="ghost" id="group-sync-btn">✦ Sync with Gloo</button></div><div id="group-invite-box" style="display:none;margin-top:10px"></div><div id="group-sync-status" class="muted" style="margin-top:6px"></div>` : ''}
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

  if (data.is_admin) {
    document.getElementById('group-invite-btn').onclick = async () => {
      const box = document.getElementById('group-invite-box');
      const invite = await api(`/groups/${groupId}/invites`, { method: 'POST' });
      box.style.display = 'block';
      box.innerHTML = `<div class="muted" style="margin-bottom:6px">Share this link or scan the QR code:</div><input class="input" readonly value="${escapeHtml(invite.link)}" onclick="this.select()" /><img src="${escapeHtml(invite.qr_url)}" alt="Group invite QR code" style="width:180px;height:180px;border-radius:12px;margin-top:8px;background:#fff;padding:8px;display:block" /><button class="ghost" id="copy-group-invite" style="margin-top:8px">Copy invite link</button>`;
      document.getElementById('copy-group-invite').onclick = async () => { await navigator.clipboard?.writeText(invite.link); document.getElementById('copy-group-invite').textContent = 'Copied ✓'; };
    };
    document.getElementById('group-sync-btn').onclick = async () => {
      const status = document.getElementById('group-sync-status'); status.textContent = 'Gloo is refreshing the group profile…';
      const r = await api(`/groups/${groupId}/gloo-sync`, { method: 'POST' });
      status.textContent = r.error ? (r.hint || r.error) : `Synced with Gloo${r.welcome ? ': ' + r.welcome : ' ✓'}`;
      if (!r.error) setTimeout(() => renderGroupDetail(groupId), 900);
    };
  }

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

async function renderSavedPosts(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  main.innerHTML = '<button class="ghost back-btn" id="saved-posts-back">← Back to profile</button><div class="card glass"><span class="eyebrow">Your collection</span><h2>Saved posts</h2><p class="muted">Private bookmarks for workouts, prayers, and encouragement you want to return to.</p></div><div id="saved-posts-list"><div class="card glass muted">Loading saved posts…</div></div>';
  let data;
  try { data = await api('/posts/saved'); } catch { data = { posts: [] }; }
  const list = main.querySelector('#saved-posts-list');
  list.innerHTML = data.posts.length ? data.posts.map(p => `<article class="card glass saved-post-card" data-saved-card="${escapeHtml(p.id)}">
    <div class="post-head"><div class="avatar-sm">${initials(p.author)}</div><div><b>${escapeHtml(p.author)}</b><div class="post-time">Saved ${timeAgo(p.saved_at)} ago · posted ${timeAgo(p.created_at)} ago</div></div></div>
    ${p.content ? `<div class="post-content">${escapeHtml(p.content)}</div>` : ''}
    ${p.photo_data ? `<img src="${escapeHtml(p.photo_data)}" alt="${escapeHtml(p.photo_category || 'Saved community photo')}" style="width:100%;border-radius:12px;margin-top:8px;display:block" />` : ''}
    ${p.workout_type ? `<div class="stat-row"><div class="stat"><div class="v">${p.distance_km ?? '—'}</div><div class="l">km</div></div><div class="stat"><div class="v">${p.calories ?? '—'}</div><div class="l">kcal</div></div><div class="stat"><div class="v">${p.avg_hr ?? '—'}</div><div class="l">avg HR</div></div></div>` : ''}
    ${p.verse_reference ? `<div class="verse-card"><div class="verse-ref">${escapeHtml(p.verse_reference)}</div><div class="verse-text">${escapeHtml(p.verse_text || '')}</div></div>` : ''}
    <button class="action-btn saved" data-unsave-post="${escapeHtml(p.id)}">🔖 Remove from saved</button>
  </article>`).join('') : '<div class="card glass"><p class="muted">Nothing saved yet. Tap 🔖 Save on a community post to keep it here.</p></div>';
  main.querySelector('#saved-posts-back').onclick = () => renderProfile(main);
  main.querySelectorAll('[data-unsave-post]').forEach(btn => btn.onclick = async () => {
    const result = await api(`/posts/${encodeURIComponent(btn.dataset.unsavePost)}/save`, { method: 'POST', body: {}, throwOnError: true }).catch(() => null);
    if (result && !result.saved) btn.closest('[data-saved-card]')?.remove();
  });
}

async function renderProfile(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  const me = await api('/me');
  state.me = me;

  let connections = { identities: [], connectors: [] }, providers = [], stravaConfigured = false, wearableProviders = [];
  try {
    const [connRes, provRes, stravaRes, wearableRes] = await Promise.all([
      api('/auth/connections'), api('/auth/providers'), api('/connectors/strava/configured'), api('/connectors/configured'),
    ]);
    connections = connRes; providers = provRes.providers || []; stravaConfigured = !!stravaRes.configured; wearableProviders = wearableRes.providers || [];
  } catch (e) { console.error('connections load failed', e); }

  const linkedProviders = new Map(connections.identities.map(i => [i.provider, i]));
  const stravaConn = connections.connectors.find(c => c.provider === 'strava');
  const wearableRows = wearableProviders.map(p => {
    const conn = connections.connectors.find(c => c.provider === p.name);
    if (conn) return `<div class="integration-row"><div><strong>${escapeHtml(p.label)}</strong><div class="muted">Connected · last synced ${conn.last_synced_at ? `${timeAgo(conn.last_synced_at)} ago` : 'never'}</div></div><div style="display:flex;gap:6px"><button class="ghost" data-wearable-sync="${p.name}">Sync</button><button class="ghost" data-wearable-disconnect="${p.name}">Disconnect</button></div></div>`;
    return `<div class="integration-row"><div><strong>${escapeHtml(p.label)}</strong><div class="muted">Sleep, recovery, heart rate, and activity import</div></div>${p.configured ? `<a class="ghost" href="/api/connectors/${p.name}/start" style="text-decoration:none">Connect</a>` : '<span class="muted" style="font-size:.72rem">Admin setup needed</span>'}</div>`;
  }).join('');

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
    <div class="card glass profile-panel" data-profile-group="overview">
      <div class="profile-header">
        <span class="xp-ring xp-ring-lg" data-xp-user="${me.user.id}"><div class="avatar" id="p-avatar" style="${me.user.avatar_data ? `background-image:url(${me.user.avatar_data});background-size:cover;background-position:center` : ''}">${me.user.avatar_data ? '' : initials(me.user.display_name)}</div></span>
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
      <div class="accomplishments-head"><div><h3>Accomplishments</h3><div class="muted">Every milestone, earned or still ahead.</div></div><span id="badge-count" class="premium-badge">Loading</span></div>
      <div id="badge-shelf" class="badge-shelf"><span class="muted">Loading accomplishments…</span></div>
      <button class="ghost" id="saved-posts-open" style="width:100%;margin-top:12px">🔖 View saved posts</button>
    </div>
    <div class="card glass profile-panel" data-profile-group="overview">
      <h2>Workout invites</h2>
      <div id="partner-invites" class="muted">Loading…</div>
    </div>
    <div class="card glass profile-panel" data-profile-group="settings">
      <h2>Profile Details</h2>
      <div class="muted" style="margin-bottom:10px">Your bio can only be a Bible verse — pick one from our verified library. Other fields are optional.</div>
      <div id="verse-preview" class="verse-preview">${me.user.bio_verse_ref ? `📖 <strong>${me.user.bio_verse_ref}</strong> — "${me.user.bio_verse_text}"` : 'No verse selected yet.'}</div>
      <label class="field-label">Bio verse</label>
      <select id="p-verse"><option value="">— Select a verse —</option></select>
      <label class="field-label">Job</label>
      <input id="p-job" type="text" maxlength="80" placeholder="e.g. Nurse" value="${me.user.job || ''}">
      <label class="field-label">Church</label>
      <input id="p-church" type="text" maxlength="80" placeholder="e.g. Grace Community Church" value="${me.user.church || ''}">
      <label class="field-label">Tradition (optional)</label>
      <select id="p-tradition">
        <option value=""${!me.user.tradition ? ' selected' : ''}>— Prefer not to say —</option>
        <option value="evangelical"${me.user.tradition === 'evangelical' ? ' selected' : ''}>Evangelical</option>
        <option value="catholic"${me.user.tradition === 'catholic' ? ' selected' : ''}>Catholic</option>
        <option value="mainline"${me.user.tradition === 'mainline' ? ' selected' : ''}>Mainline Protestant</option>
        <option value="not_faith_specific"${me.user.tradition === 'not_faith_specific' ? ' selected' : ''}>Not faith-specific</option>
      </select>
      <div class="muted" style="font-size:.74rem;margin:-2px 0 8px">
        Shapes how scripture is chosen for you mid-workout and how the companion
        answers your questions. Left blank, nothing is assumed.
      </div>
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
      ${renderHeartRateFields(me.user)}
      <button class="primary" id="p-save" style="width:100%;margin-top:10px">Save Profile</button>
      <div id="p-status" class="muted" style="margin-top:6px"></div>
    </div>
    <div class="card glass profile-panel" data-profile-group="settings">
      <h2>Find your church</h2>
      <div class="muted" style="margin-bottom:10px">Search real churches near you using OpenStreetMap — pick the one you attend.</div>
      <div id="church-current">${me.user.church_name ? `📍 <strong>${escapeHtml(me.user.church_name)}</strong>${me.user.church_address ? ` — ${escapeHtml(me.user.church_address)}` : ''} <button class="ghost" id="church-clear" style="margin-left:8px">Clear</button>` : '<span class="muted">No church selected yet.</span>'}</div>
      <button class="ghost" id="church-find" style="width:100%;margin-top:10px">📍 Find churches near me</button>
      <div id="church-status" class="muted" style="margin-top:6px"></div>
      <div id="church-results" style="margin-top:10px"></div>
      <div id="youtube-link-section" style="margin-top:14px"></div>
      <div id="church-website-section" style="margin-top:14px"></div>
    </div>
    <div class="card glass profile-panel" data-profile-group="settings">
      <h2>This week's sermon transcript</h2>
      <div class="muted" style="margin-bottom:10px">The real caption transcript from your church's most recent full-service video, read aloud with your browser's built-in text-to-speech.</div>
      <div id="sermon-summary-section"></div>
    </div>
    <div class="card glass profile-panel" data-profile-group="integrations">
      <h2>Connected accounts</h2>
      ${providers.length ? providerRows : '<div class="muted">No sign-in providers are configured on this server.</div>'}
      ${stravaConfigured ? `<div class="muted" style="margin:10px 0 4px;font-weight:600">Strava</div>${stravaRow}` : ''}
    </div>
    <div class="card glass profile-panel" data-profile-group="integrations">
      <h2>Connected Devices</h2>
      <div class="wearable-callout"><strong>Wearables sync</strong><div class="muted">Garmin devices work through Strava. Fitbit and Oura can connect directly when enabled by the server. Imported activities become workouts; available sleep and recovery signals stay in your private stats.</div></div>
      <div class="integration-list">${wearableRows || '<div class="muted">No direct Fitbit/Oura connectors are configured yet.</div>'}</div>
      ${stravaConfigured ? '<div class="integration-row"><div><strong>Garmin / other watch bridge</strong><div class="muted">Connect Garmin, Apple Watch, COROS, Suunto, or Wahoo to Strava, then sync here.</div></div><a class="ghost" href="/api/connectors/strava/start" style="text-decoration:none">Connect Strava</a></div>' : ''}
      <div class="muted" id="ble-status">${state.bleConnected ? `Connected: ${state.bleDevice?.name || 'Heart rate monitor'}` : 'No Bluetooth heart rate monitor connected.'}</div>
      <button class="ghost" style="width:100%;margin-top:10px" id="ble-connect">${state.bleConnected ? 'Disconnect' : 'Pair Bluetooth Heart Rate Monitor'}</button>
      <div class="muted" style="margin-top:6px">Requires Chrome/Edge on a device with Bluetooth. Standard BLE Heart Rate Service (0x180D) — works with most chest straps.</div>
    </div>
    <div class="card glass profile-panel" data-profile-group="settings">
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
    <div class="card glass profile-panel" data-profile-group="settings">
      <h2>Your data</h2>
      <div class="muted" style="margin-bottom:10px">Full transparency — download everything Functioning Faith stores about your account as a JSON file.</div>
      <a class="ghost" id="data-export" href="/api/me/export" download="functioning-faith-my-data.json" style="display:block;text-align:center;text-decoration:none">⬇ Download my data</a>
      <div class="settings-danger-zone"><strong>Delete account</strong><div class="muted">Permanently removes your profile, workouts, posts, messages, connections, and personal data.</div><button class="ghost danger" id="delete-account" type="button">Delete my account</button></div>
    </div>
    <div class="card glass profile-panel" data-profile-group="integrations" id="creator-overlay">
      <h2>Creator overlay</h2>
      <div class="muted" style="margin-bottom:10px">Add this as a browser source in OBS or Streamlabs. While you ride a journey, your route, pace, heart-rate zone and the scripture you are given appear over your stream.</div>
      <div id="ov-body" class="muted">Loading…</div>
    </div>
    <div class="card glass profile-panel" data-profile-group="integrations" id="dev-webhooks">
      <h2>Developer webhooks</h2>
      <div class="muted" style="margin-bottom:10px">Get your account's events pushed to your own HTTPS endpoint the moment they happen.</div>
      <div id="wh-list" class="muted">Loading…</div>
      <div class="wh-new">
        <input id="wh-url" type="url" placeholder="https://your-service.example/functioning-faith" />
        <button class="primary" id="wh-add">Add endpoint</button>
      </div>
      <div class="muted wh-note" id="wh-note">Endpoints must be HTTPS and publicly reachable. Every request is signed — verify <code>X-Functioning-Faith-Signature</code> as HMAC-SHA256 over <code>timestamp + "." + rawBody</code>.</div>
    </div>
    <div class="card glass profile-panel" data-profile-group="integrations" id="dev-keys">
      <h2>API keys</h2>
      <div class="muted" style="margin-bottom:10px">Ask Functioning Faith for scripture from your own software — a game, a wearable, your church's app. <a href="/developers" target="_blank" rel="noopener">Read the docs &#8599;</a></div>
      <div id="ak-list" class="muted">Loading&hellip;</div>
      <div class="wh-new">
        <input id="ak-name" type="text" maxlength="80" placeholder="What is this key for?" />
        <button class="primary" id="ak-add">Create key</button>
      </div>
      <div class="muted wh-note" id="ak-status" aria-live="polite"></div>
      <div class="muted wh-note">A key is shown once and stored only as a hash. Lose it and you rotate it, you don't recover it.</div>
    </div>
    <div class="card glass profile-panel" data-profile-group="integrations" id="push-card">
      <h2>Notifications</h2>
      <div class="muted" style="margin-bottom:10px">Reach you when the app is closed — a verse each morning, and replies to your reflections.</div>
      <div id="push-body" class="muted">Loading&hellip;</div>
      <div class="reminder-divider"></div>
      <div id="reminders-body" class="muted">Loading motivation reminders…</div>
    </div>
    <button class="ghost" id="signout" style="width:100%">Sign out</button>
  `;
  const profileNav = document.createElement('div');
  profileNav.className = 'profile-nav card glass';
  profileNav.innerHTML = `
    <div class="profile-nav-heading"><div><span class="eyebrow">Your space</span><h2>Profile</h2></div><span class="muted">Manage your faith, fitness, and connections.</span></div>
    <div class="profile-nav-tabs" role="tablist" aria-label="Profile sections">
      <button class="profile-nav-tab active" data-profile-view="overview" role="tab">Overview</button>
      <button class="profile-nav-tab" data-profile-view="settings" role="tab">Settings</button>
      <button class="profile-nav-tab" data-profile-view="integrations" role="tab">Integrations</button>
    </div>`;
  main.prepend(profileNav);
  const showProfileView = (view) => {
    main.querySelectorAll('.profile-panel').forEach(panel => {
      panel.hidden = panel.dataset.profileGroup !== view;
    });
    main.querySelectorAll('[data-profile-view]').forEach(tab => {
      const active = tab.dataset.profileView === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    profileNav.dataset.activeView = view;
  };
  profileNav.querySelectorAll('[data-profile-view]').forEach(tab => {
    tab.onclick = () => showProfileView(tab.dataset.profileView);
  });
  showProfileView('overview');
  document.getElementById('saved-posts-open').onclick = () => renderSavedPosts(main);
  // The profile screen builds its avatar inline rather than through
  // avatarHtml, so its ring needs filling explicitly.
  hydrateXpRings(main);
  renderAccomplishments();
  renderWebhooks();
  renderApiKeys();
  renderPush();
  renderReminders();
  renderOverlayCard();
  document.getElementById('p-defvis').onchange = async (e) => {
    await api('/profile', { method: 'PUT', body: { default_visibility: e.target.value } });
    await loadMe();
  };
  document.getElementById('c-biometric').onchange = (e) => api('/consent', { method: 'POST', body: { scope: 'biometric_ingest', granted: e.target.checked } });
  document.getElementById('c-scripture').onchange = (e) => api('/consent', { method: 'POST', body: { scope: 'scripture_personalization', granted: e.target.checked } });
  document.getElementById('delete-account').onclick = async () => {
    if (!confirm('Delete your Functioning Faith account and personal data permanently? This cannot be undone.')) return;
    const button = document.getElementById('delete-account'); button.disabled = true; button.textContent = 'Deleting…';
    try { await api('/me', { method: 'DELETE', throwOnError: true }); state.me = null; signInMode = 'login'; location.href = '/'; }
    catch { button.disabled = false; button.textContent = 'Delete failed — try again'; }
  };
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
        tradition: document.getElementById('p-tradition').value || null,
        fitness_group: document.getElementById('p-group').value,
        gym: document.getElementById('p-gym').value,
        bio_link_url: document.getElementById('p-bio-link').value.trim() || null,
        age: document.getElementById('p-age').value || null,
        show_age: document.getElementById('p-showage').checked,
        ...heartRateFieldValues(),
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

async function renderAccomplishments() {
  const shelf = document.getElementById('badge-shelf');
  const count = document.getElementById('badge-count');
  if (!shelf) return;
  try {
    const badges = await api('/badges');
    const earned = badges.filter(b => b.earned).length;
    if (count) count.textContent = `${earned}/${badges.length || 0} earned`;
    shelf.innerHTML = badges.length ? badges.map(b => `
      <div class="accomplishment ${b.earned ? 'earned' : 'locked'}">
        <div class="accomplishment-icon">${b.icon || '✦'}</div>
        <div class="accomplishment-copy"><strong>${escapeHtml(b.name)}</strong><span>${escapeHtml(b.description || '')}</span>
        ${!b.earned && b.target ? `<div class="badge-progress"><i style="width:${b.percent}%"></i></div><small>${b.progress}/${b.target}</small>` : ''}
        ${b.earned ? '<small class="earned-label">Earned</small>' : ''}</div>
      </div>`).join('') : '<span class="muted">Your next accomplishment is waiting.</span>';
  } catch { shelf.innerHTML = '<span class="muted">Could not load accomplishments.</span>'; }
}

// ---- Workout invites: planned DM invites plus post-workout confirmations ----
async function loadPartnerInvites() {
  const el = document.getElementById('partner-invites');
  if (!el) return;
  try {
    const [planned, partnerRows] = await Promise.all([api('/workout-invites/pending'), api('/workout-partners/pending')]);
    if (!planned.length && !partnerRows.length) { el.innerHTML = '<span class="muted">No pending workout invites.</span>'; return; }
    el.innerHTML = planned.map(r => `
      <div class="toggle-row invite-list-row" data-planned-invite="${r.id}">
        <span><strong>${escapeHtml(r.sender_name)}</strong> invited you to a ${escapeHtml(r.workout_type.toLowerCase())}${r.scheduled_at ? ` · ${escapeHtml(new Date(r.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}` : ''}</span>
        <span style="display:flex;gap:6px"><button class="follow-btn" data-planned-accept="${r.id}">Accept</button><button class="ghost" data-planned-decline="${r.id}">Decline</button></span>
      </div>`).join('') + partnerRows.map(r => `
      <div class="toggle-row" data-invite="${r.id}">
        <span>${escapeHtml(r.tagged_by_name)} tagged you${r.workout_type ? ` on a ${escapeHtml(r.workout_type)}` : ''} — confirm for bonus XP</span>
        <span style="display:flex;gap:6px">
          <button class="follow-btn" data-accept="${r.id}">Accept</button>
          <button class="ghost" data-decline="${r.id}">Decline</button>
        </span>
      </div>`).join('');
    el.querySelectorAll('[data-planned-accept],[data-planned-decline]').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.plannedAccept || btn.dataset.plannedDecline;
      await api(`/workout-invites/${id}/respond`, { method: 'POST', body: { accept: !!btn.dataset.plannedAccept } });
      loadPartnerInvites();
    });
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

  // Shared with the signup onboarding step (see runChurchSearch below) so the
  // free Overpass search + auto video linking behave identically in both places.
  findBtn.onclick = () => runChurchSearch({
    statusEl, resultsEl,
    onPicked: async () => { await loadMe(); render(); },
  });

  if (clearBtn) clearBtn.onclick = async () => {
    await api('/profile', { method: 'PUT', body: { church_osm_id: null } });
    await loadMe();
    render();
  };

  wireYoutubeLink(me);
  wireChurchWebsite(me);
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

// ---- Church official website: a free, key-free way to embed real sermon
// videos — most churches already embed a YouTube/Vimeo player on their own
// site, so we just read that real embed instead of needing YOUTUBE_API_KEY. ----
async function wireChurchWebsite(me) {
  const section = document.getElementById('church-website-section');
  if (!section || !me.user.church_osm_id) { if (section) section.innerHTML = ''; return; }

  const osmId = me.user.church_osm_id;
  section.innerHTML = `
    <div class="field-label">Your church's official website</div>
    <div class="muted" style="margin-bottom:6px">If your church embeds sermon videos on its own site, add the link here — free, no setup required.</div>
    <input id="church-website-url" type="url" placeholder="https://yourchurch.org">
    <button class="ghost" id="church-website-save" style="margin-top:6px">Save</button>
    <div id="church-website-status" class="muted" style="margin-top:6px"></div>
    <div id="church-website-videos" style="margin-top:8px"></div>
  `;

  const statusEl = document.getElementById('church-website-status');
  const videosEl = document.getElementById('church-website-videos');

  const loadVideos = async () => {
    try {
      const { embeds } = await api(`/churches/${encodeURIComponent(osmId)}/website-videos`);
      if (!embeds || !embeds.length) { videosEl.innerHTML = '<span class="muted">No embedded videos found on that page yet.</span>'; return; }
      videosEl.innerHTML = embeds.map(e => `
        <div class="card glass" style="padding:8px;margin-bottom:8px">
          <div style="position:relative;padding-top:56.25%;border-radius:8px;overflow:hidden">
            <iframe src="${e.provider === 'vimeo' ? `https://player.vimeo.com/video/${encodeURIComponent(e.videoId)}` : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(e.videoId)}`}" title="Church video" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
          </div>
        </div>`).join('');
    } catch { videosEl.innerHTML = ''; }
  };

  document.getElementById('church-website-save').onclick = async () => {
    const url = document.getElementById('church-website-url').value.trim();
    statusEl.textContent = 'Saving…';
    const res = await api(`/churches/${encodeURIComponent(osmId)}/website`, { method: 'POST', body: { website_url: url || null } });
    if (res.error) { statusEl.textContent = res.hint || res.error; return; }
    statusEl.textContent = url ? 'Saved. Looking for videos…' : 'Removed.';
    if (url) await loadVideos();
  };

  await loadVideos();
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

let workoutMode = 'live'; // 'live' | 'manual' | 'journey'

async function renderWorkout(main) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  if (!state.activityTypes) { try { state.activityTypes = await api('/activity-types'); } catch { state.activityTypes = [{type:'Run',icon:'🏃'}]; } }
  const opts = state.activityTypes.map(a => `<option value="${a.type}">${a.icon} ${a.type}</option>`).join('');
  const liveActive = workoutMode === 'live';
  const journeyActive = workoutMode === 'journey' && !state.activeWorkout;

  main.innerHTML = `
    ${!state.activeWorkout ? `<div class="section-tabs" style="margin-bottom:14px">
      <button class="${workoutMode==='live'?'active':''}" id="mode-live">● Live track</button>
      <button class="${workoutMode==='manual'?'active':''}" id="mode-manual">✎ Log manually</button>
      <button class="${workoutMode==='journey'?'active':''}" id="mode-journey">🗺️ Journey</button>
    </div>` : ''}
    ${journeyActive ? `<div id="journey-picker" class="card glass"><div class="muted">Loading routes…</div></div>` : ''}
    ${(liveActive || state.activeWorkout) ? `
    <div class="workout-screen">
      <select id="workout-type" ${state.activeWorkout ? 'disabled' : ''}>${opts}</select>
      <div class="hr-ring"><div class="hr-display" id="hr-display">${state.bleConnected && state.hr ? state.hr : '--'}</div><div class="hr-label">BPM ${state.bleConnected ? '· 📶 live' : `· <button type="button" class="hr-connect-link" id="hr-connect">connect a monitor</button>`}</div></div>
      <div class="timer-display" id="timer-display">${formatElapsed(state.elapsed)}</div>
      <div class="live-metrics" id="live-metrics">
        <div class="lm-cell"><div class="lm-value" id="lm-distance">--</div><div class="lm-label">km</div></div>
        <div class="lm-cell"><div class="lm-value" id="lm-pace">--</div><div class="lm-label">pace /km</div></div>
        <div class="lm-cell"><div class="lm-value" id="lm-avgpace">--</div><div class="lm-label">avg /km</div></div>
        <div class="lm-cell"><div class="lm-value" id="lm-zone">--</div><div class="lm-label">HR zone</div></div>
        <div class="lm-cell"><div class="lm-value" id="lm-elev">--</div><div class="lm-label">elev m</div></div>
        <div class="lm-cell"><div class="lm-value" id="lm-cal">--</div><div class="lm-label">kcal est.</div></div>
      </div>
      <div class="lm-splits" id="lm-splits"></div>
      ${!state.activeWorkout ? '<div class="gps-gate card glass" id="gps-gate"><div class="muted" id="gps-status">' + escapeHtml(state.gpsStatus || 'Waiting for an accurate GPS lock before you go.') + '</div></div>' : '<div id="gps-status" class="muted"></div>'}
      <button class="start-stop-btn ${state.activeWorkout ? 'stop' : 'start'}" id="start-stop" ${!state.activeWorkout && !(state.gpsReady || state.gpsCanOverride) ? 'disabled' : ''}>${state.activeWorkout ? 'Stop' : (state.gpsReady ? 'Go' : state.gpsCanOverride ? 'Start anyway' : 'Locating...')}</button>
      ${!state.activeWorkout ? '<div class="card glass" id="gloo-coach-card"><div class="muted">Your faith-aligned starting cue will appear here.</div><button class="ghost" id="gloo-coach" type="button">Get a starting cue</button></div>' : ''}
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
  const mj = document.getElementById('mode-journey');
  if (mj) mj.onclick = () => { workoutMode = 'journey'; renderWorkout(main); };
  if (journeyActive) populateJourneyPicker();
  if (ml) ml.onclick = () => { workoutMode = 'live'; renderWorkout(main); };
  if (mm) mm.onclick = () => { workoutMode = 'manual'; renderWorkout(main); };

  const ss = document.getElementById('start-stop');
  if (ss) ss.onclick = () => state.activeWorkout ? stopWorkout() : startWorkout();
  const coachButton = document.getElementById('gloo-coach');
  if (coachButton) coachButton.onclick = requestWorkoutCoach;
  const hrConnect = document.getElementById('hr-connect');
  if (hrConnect) hrConnect.onclick = () => connectBle();
  if (state.activeWorkout && state.gpsPoints.length) initMap(true);
  if (liveActive && !state.activeWorkout) startGps();

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
const GPS_ACCURACY_M = 50;
const GPS_MIN_FIXES = 2;
// Eight seconds, not fifteen. This only ever applies when the fix is poor or
// absent — a good fix unlocks the button as soon as it arrives. Fifteen
// seconds of a dead "Locating..." button reads as a broken app.
const GPS_OVERRIDE_AFTER_MS = 8000;

function assessGps() {
  const waited = gpsStartedAt ? Date.now() - gpsStartedAt : 0;
  const acc = state.gpsAccuracyM;
  state.gpsWaitedMs = waited;
  // Waiting out a timer only makes sense while an answer might still arrive.
  // When the browser has already told us GPS will never work here — permission
  // denied, or no geolocation at all — counting down eight seconds to reach a
  // conclusion we already have just holds someone at the door for no reason.
  state.gpsCanOverride = state.gpsFatal || waited >= GPS_OVERRIDE_AFTER_MS;

  if (state.gpsFatal) {
    // The error handler wrote a message that explains the actual cause. Do not
    // replace it with "waiting for a fix" — that describes a wait that is not
    // happening and cannot end.
    state.gpsReady = false;
    return;
  }
  if (acc == null) {
    state.gpsReady = false;
    state.gpsStatus = state.gpsCanOverride
      ? 'GPS unavailable — you can start anyway; route tracking may be limited.'
      : 'Waiting for an accurate GPS fix...';
    return;
  }
  if (acc > GPS_ACCURACY_M) {
    state.gpsReady = false;
    state.gpsStatus = state.gpsCanOverride
      ? 'GPS is ±' + Math.round(acc) + ' m — you can start anyway.'
      : 'Getting an accurate fix... currently +/-' + Math.round(acc) + ' m';
    return;
  }
  if (state.gpsGoodFixes < GPS_MIN_FIXES) {
    state.gpsReady = false;
    state.gpsStatus = state.gpsCanOverride
      ? 'GPS is still settling — you can start anyway.'
      : 'Confirming your location... (' + state.gpsGoodFixes + '/' + GPS_MIN_FIXES + ' good fixes)';
    return;
  }
  state.gpsReady = true;
  state.gpsStatus = 'GPS ready - +/-' + Math.round(acc) + ' m';
}

function startGps() {
  const statusEl = () => document.getElementById('gps-status');
  if (state.gpsWatchId != null) return;
  if (!navigator.geolocation) {
    state.gpsFatal = true;
    state.gpsCanOverride = true;
    state.gpsStatus = 'GPS is not supported in this browser — you can start anyway; route tracking is unavailable.';
    if (statusEl()) statusEl().textContent = state.gpsStatus;
    updateGpsGate();
    return;
  }
  state.gpsReady = false; state.gpsAccuracyM = null; state.gpsGoodFixes = 0;
  state.gpsFatal = false;
  state.gpsCanOverride = false; state.gpsWaitedMs = 0; gpsStartedAt = Date.now();
  state.gpsStatus = 'Requesting a high-accuracy GPS fix...';
  state.gpsPoints = [];
  if (gpsTicker) clearInterval(gpsTicker);
  gpsTicker = setInterval(() => { if (!state.activeWorkout) { assessGps(); updateGpsGate(); } }, 1000);
  state.gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const accuracy = Number(pos.coords.accuracy);
      state.gpsAccuracyM = Number.isFinite(accuracy) ? accuracy : null;
      if (state.gpsAccuracyM != null && state.gpsAccuracyM <= GPS_ACCURACY_M) state.gpsGoodFixes += 1;
      else state.gpsGoodFixes = Math.max(0, state.gpsGoodFixes - 1);
      assessGps();
      const pt = [pos.coords.latitude, pos.coords.longitude];
      state.gpsPoints.push(pt);
      state.gpsTimes.push(Date.now());
      // Altitude is often null indoors or on cheap receivers; only accumulate
      // climb when the device actually reports it, and ignore jitter under 1m.
      const alt = (pos.coords.altitude != null && isFinite(pos.coords.altitude)) ? pos.coords.altitude : null;
      state.gpsAlt.push(alt);
      if (alt != null) {
        if (state.altRef == null) state.altRef = alt;
        // Count ascent once it clears 2m above the running reference, then move
        // the reference up. Gradual climbs accumulate; receiver noise does not.
        if (alt - state.altRef > 2) { state.elevGainM += alt - state.altRef; state.altRef = alt; }
        else if (alt < state.altRef) state.altRef = alt;
      }
      if (statusEl()) statusEl().textContent = state.gpsStatus;
      updateGpsGate();
      if (!state.leafletMap && document.getElementById('map')) initMap(false);
      if (state.leafletMap) { state.leafletLine.addLatLng(pt); state.leafletMap.panTo(pt); }
    },
    (err) => {
      // Code 1 is PERMISSION_DENIED: settled, and no amount of waiting changes
      // it. Codes 2 and 3 (position unavailable, timeout) can still resolve on
      // a later fix, so those keep the normal countdown and the watch stays up.
      const denied = !!(err && err.code === 1);
      if (denied) {
        state.gpsFatal = true;
        state.gpsAccuracyM = null;
        state.gpsGoodFixes = 0;
      }
      // A transient miss must NOT discard the reading we already have.
      // Throwing away a real ±12 m fix because the next acquisition timed out
      // sent the gate back to "waiting for a fix", so on a slow receiver the
      // accuracy on screen kept vanishing instead of visibly tightening.
      state.gpsStatus = denied
        ? 'Location permission denied — you can start anyway; route tracking is unavailable.'
        : (state.gpsAccuracyM != null
            ? 'Still refining — last fix ±' + Math.round(state.gpsAccuracyM) + ' m.'
            : 'GPS is unavailable here — you can start anyway; route tracking may be limited.');
      assessGps();
      updateGpsGate();
    },
    // A cold satellite lock routinely takes 15-45 seconds; timing out at 8
    // interrupted the receiver before it ever settled, over and over.
    // maximumAge 0 so the browser must actually acquire, rather than hand back
    // a coarse cached position while we are trying to get an accurate one.
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
  );
}
function updateGpsGate() {
  const button = document.getElementById('start-stop');
  if (button && !state.activeWorkout) {
    const canStart = state.gpsReady || state.gpsCanOverride;
    button.disabled = !canStart;
    button.textContent = state.gpsReady ? 'Go' : state.gpsCanOverride ? 'Start anyway' : 'Locating...';
    button.classList.toggle('start-degraded', !state.gpsReady && state.gpsCanOverride);
  }
  const status = document.getElementById('gps-status');
  if (status && state.gpsStatus) status.innerHTML = escapeHtml(state.gpsStatus)
    + (state.gpsCanOverride && !state.gpsReady ? '<span class="gps-gate-note">Your first stretch may be roughly drawn.</span>' : '');
}
function stopGps() {
  if (state.gpsWatchId != null) navigator.geolocation.clearWatch(state.gpsWatchId);
  if (gpsTicker) { clearInterval(gpsTicker); gpsTicker = null; }
  gpsStartedAt = null; state.gpsWatchId = null; state.gpsReady = false;
  state.gpsGoodFixes = 0; state.gpsCanOverride = false; state.gpsWaitedMs = 0;
  state.gpsFatal = false;
}

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

// --- Live workout figures ---------------------------------------------------
// What you actually want on screen mid-effort: distance covered, how fast you
// are going now, how fast you have been overall, and what your heart is doing.
//
// Every figure is measured or it is blank. Distance and pace come from GPS
// fixes; with no GPS lock they read "--" rather than being modelled from time.
// Heart rate and zones come only from a paired monitor. The one estimate on the
// screen, calories, is labelled as an estimate.

function paceStr(minPerKm) {
  if (!isFinite(minPerKm) || minPerKm <= 0 || minPerKm > 60) return '--';
  const m = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - m) * 60);
  return m + ':' + String(sec === 60 ? 0 : sec).padStart(2, '0');
}

function liveDistanceKm() {
  let d = 0;
  for (let i = 1; i < state.gpsPoints.length; i++) d += haversineKm(state.gpsPoints[i - 1], state.gpsPoints[i]);
  return d;
}

// Speed over the last ~30 seconds of fixes, which is what "current pace" means
// on a run. A single fix pair is far too noisy to show anyone.
function rollingPaceMinPerKm() {
  const n = state.gpsPoints.length;
  if (n < 3) return null;
  const cutoff = Date.now() - 30000;
  let i = n - 1;
  while (i > 0 && state.gpsTimes[i] > cutoff) i--;
  if (n - 1 - i < 2) return null;
  let km = 0;
  for (let k = i + 1; k < n; k++) km += haversineKm(state.gpsPoints[k - 1], state.gpsPoints[k]);
  const mins = (state.gpsTimes[n - 1] - state.gpsTimes[i]) / 60000;
  if (km < 0.005 || mins <= 0) return null;
  return mins / km;
}

// The user's max heart rate, stated or estimated from birth year (Tanaka).
// Without either there is no reference, so no zone is claimed.
function clientMaxHr() {
  const me = state.me || {};
  const stated = Number(me.max_hr);
  if (isFinite(stated) && stated >= 120 && stated <= 230) return stated;
  const by = Number(me.birth_year);
  if (Number.isInteger(by) && by >= 1900) {
    const age = new Date().getFullYear() - by;
    if (age >= 10 && age <= 110) return Math.round(208 - 0.7 * age);
  }
  return null;
}

function hrZoneClient(hr, maxHr) {
  if (!hr || !maxHr) return null;
  const pct = hr / maxHr;
  if (pct < 0.60) return 1;
  if (pct < 0.70) return 2;
  if (pct < 0.80) return 3;
  if (pct < 0.90) return 4;
  return 5;
}

function updateLiveMetrics() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const km = liveDistanceKm();
  const hasGps = state.gpsPoints.length >= 2;

  set('lm-distance', hasGps ? km.toFixed(2) : '--');
  set('lm-elev', state.gpsAlt.some(a => a != null) ? Math.round(state.elevGainM) : '--');

  const roll = rollingPaceMinPerKm();
  set('lm-pace', roll ? paceStr(roll) : '--');
  const avg = (hasGps && km > 0.02 && state.elapsed > 0) ? (state.elapsed / 60) / km : null;
  set('lm-avgpace', avg ? paceStr(avg) : '--');

  const hr = state.bleConnected && state.hr > 0 ? state.hr : null;
  const maxHr = clientMaxHr();
  const zone = hrZoneClient(hr, maxHr);
  set('lm-zone', zone ? ('Z' + zone) : '--');
  const zoneEl = document.getElementById('lm-zone');
  if (zoneEl) zoneEl.className = 'lm-value' + (zone ? ' zone-' + zone : '');

  // Calories: a rough MET-style figure from duration and pace. Marked as an
  // estimate on screen because that is exactly what it is.
  const mins = state.elapsed / 60;
  const kcal = hasGps && km > 0 ? Math.round(km * 62) : Math.round(mins * 7);
  set('lm-cal', mins > 0.2 ? String(kcal) : '--');

  // Automatic kilometre splits, the way a run watch beeps them.
  if (hasGps && km >= state.lastSplitKm + 1) {
    const sec = state.elapsed - state.lastSplitElapsed;
    if (sec > 0) {
      state.lastSplitKm += 1;
      state.lastSplitElapsed = state.elapsed;
      state.splits.push({ km: state.lastSplitKm, sec });
      renderSplits();
    }
  }
}

function renderSplits() {
  const box = document.getElementById('lm-splits');
  if (!box) return;
  if (!state.splits.length) { box.innerHTML = ''; return; }
  const best = Math.min(...state.splits.map(s => s.sec));
  box.innerHTML = '<div class="lm-splits-head">Splits</div>'
    + state.splits.slice().reverse().map(sp =>
        '<div class="lm-split' + (sp.sec === best ? ' best' : '') + '">'
        + '<span>km ' + sp.km + '</span>'
        + '<span>' + paceStr(sp.sec / 60) + ' /km</span></div>').join('');
}

async function requestWorkoutCoach() {
  const button = document.getElementById('gloo-coach');
  const card = document.getElementById('gloo-coach-card');
  const type = document.getElementById('workout-type');
  if (!button || !card || !type) return;
  button.disabled = true; button.textContent = 'Thinking...';
  try {
    const cue = await api('/workouts/coach', { method: 'POST', body: { type: type.value }, throwOnError: true });
    card.innerHTML = `<div class="muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em">Gloo starting cue</div><h3 style="margin:5px 0">${escapeHtml(cue.focus)}</h3><p style="margin:0 0 6px">${escapeHtml(cue.cue)}</p><div class="muted" style="font-size:.82rem">Finish line: ${escapeHtml(cue.finish_line)}</div><button class="ghost" id="gloo-coach" type="button" style="margin-top:8px">Refresh cue</button>`;
    document.getElementById('gloo-coach').onclick = requestWorkoutCoach;
  } catch {
    button.disabled = false; button.textContent = 'Try again';
  }
  main.querySelectorAll('[data-wearable-sync]').forEach(btn => btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Syncing…';
    try { const result = await api(`/connectors/${btn.dataset.wearableSync}/sync`, { method: 'POST' }); btn.textContent = `Synced ${result.imported || 0}`; setTimeout(() => renderProfile(main), 900); }
    catch { btn.disabled = false; btn.textContent = 'Retry'; }
  });
  main.querySelectorAll('[data-wearable-disconnect]').forEach(btn => btn.onclick = async () => { await api(`/connectors/${btn.dataset.wearableDisconnect}/disconnect`, { method: 'POST' }); renderProfile(main); });
}

async function startWorkout() {
  if (!state.gpsReady && !state.gpsCanOverride) {
    state.gpsStatus = 'Wait for GPS ready before you go.';
    updateGpsGate();
    return;
  }
  const type = document.getElementById('workout-type').value;
  const w = await api('/workouts/start', { method: 'POST', body: { type } });
  state.activeWorkout = w.id;
  state.lastVerseId = w.start_verse ? w.start_verse.youversion_id : null;
  state.lastVerse = w.start_verse || null;
  state.elapsed = 0;
  state.gpsTimes = []; state.gpsAlt = []; state.elevGainM = 0; state.altRef = null;
  state.splits = []; state.lastSplitKm = 0; state.lastSplitElapsed = 0;
  // Heart rate comes ONLY from a paired monitor. With no strap connected we show
  // nothing and send nothing — the app never invents a physiological value.
  if (!state.bleConnected) state.hr = 0;
  startGps();
  renderWorkout(document.getElementById('main'));
  const opening = document.getElementById('verse-preview');
  if (opening && w.start_verse) opening.innerHTML = renderMomentVerseCard({
    verse: w.start_verse, moment_label: w.start_moment_label, caption: 'Your opening word for this session',
  });
  state.hrTimer = setInterval(async () => {
    state.elapsed += 1;
    document.getElementById('timer-display').textContent = formatElapsed(state.elapsed);
    updateLiveMetrics();
    if (state.elapsed % 5 === 0) {
      const hr = state.bleConnected && state.hr > 0 ? state.hr : null;
      const result = await api(`/workouts/${state.activeWorkout}/sample`, { method: 'POST', body: { heart_rate: hr } });
      const vp = document.getElementById('verse-preview');
      // The server returns verse:null for ordinary telemetry samples. Keep the
      // current card stable until a meaningful effort transition earns a new one.
      if (result.verse) {
        state.lastVerseId = result.verse_id || null;
        state.lastVerse = result.verse;
        if (vp) vp.innerHTML = renderMomentVerseCard(result);
      }
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
      ${renderEffortResult(s)}
      ${ctx.verse ? `<div class="verse-card" style="margin:10px 0"><div class="verse-ref">${ctx.verse.reference}</div><div class="verse-text">${escapeHtml(ctx.verse.snippet || '')}</div></div>` : ''}
      <label class="field-label">Add a caption or reflection</label>
      <textarea class="input" id="share-caption" rows="3" placeholder="How did it go? What did this verse mean today?"></textarea>
      <button class="ghost" id="gloo-reflect" type="button" style="margin-top:6px">Reflect with Gloo</button>
      <div id="gloo-reflection" class="muted" style="margin-top:8px"></div>
      <label class="field-label">Who can see this?</label>
      <select class="input" id="share-vis">
        ${['public','followers','private'].map(v => `<option value="${v}" ${v===defVis?'selected':''}>${visLabel[v]}</option>`).join('')}
      </select>
      ${(state.gpsPoints && state.gpsPoints.length > 1) ? `
      <div class="share-route" id="share-route-wrap">
        <label class="share-route-toggle">
          <input type="checkbox" id="share-route" />
          <span>Show the route I took</span>
        </label>
        <div class="share-route-preview" id="share-route-preview"></div>
        <label class="field-label" style="margin-top:8px">Hide the start and end</label>
        <select class="input" id="share-route-privacy">
          <option value="0">Show the whole route</option>
          <option value="200" selected>Hide the first and last 200 m</option>
          <option value="500">Hide the first and last 500 m</option>
        </select>
        <div class="muted share-route-note">A route usually starts and ends where you live. Hiding the ends keeps the shape of your run without pointing at your door.</div>
      </div>` : ''}
      <label class="field-label">Photo — optional</label>
      <div class="muted" style="margin-bottom:6px">Nature, animals, or groups of people only — no solo photos (use your profile picture for that).</div>
      <input type="file" id="share-photo-file" accept="image/*" style="display:none">
      <button class="ghost" id="share-photo-pick" type="button">📷 Add photo</button>
      <div id="share-photo-preview" style="margin-top:8px"></div>
      <div id="share-photo-cat-wrap" style="display:none;margin-top:8px">
        <label class="field-label">What's in this photo?</label>
        <label style="display:block"><input type="radio" name="share-photo-cat" value="workout"> Workout / gear</label>
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

  document.getElementById('gloo-reflect').onclick = async () => {
    const button = document.getElementById('gloo-reflect');
    const output = document.getElementById('gloo-reflection');
    button.disabled = true; button.textContent = 'Reflecting...';
    try {
      const r = await api(`/workouts/${ctx.workoutId}/reflection`, { method: 'POST', body: { reflection: document.getElementById('share-caption').value }, throwOnError: true });
      output.innerHTML = `<b>${escapeHtml(r.summary)}</b><br><span>Next step: ${escapeHtml(r.next_step)}</span>`;
    } catch { output.textContent = 'Gloo reflection is unavailable right now.'; }
    button.disabled = false; button.textContent = 'Reflect with Gloo';
  };

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

  // Show the author exactly what others would see, trim included.
  const routeToggle = document.getElementById('share-route');
  if (routeToggle) {
    const previewEl = document.getElementById('share-route-preview');
    const privacyEl = document.getElementById('share-route-privacy');
    const drawPreview = () => {
      if (!routeToggle.checked) { previewEl.innerHTML = ''; return; }
      const trimmed = trimRouteClient(state.gpsPoints, Number(privacyEl.value) || 0);
      previewEl.innerHTML = trimmed
        ? '<div class="route-banner">' + realRouteSvg(trimmed) + '</div>'
        : '<div class="muted" style="font-size:.78rem">That trim would leave nothing of this route to show. Choose a smaller one, or leave the route off.</div>';
    };
    routeToggle.onchange = drawPreview;
    privacyEl.onchange = drawPreview;
  }

  main.querySelector('#share-skip').onclick = () => { state.lastVerseId = null; state.lastVerse = null; setTab('home'); };
  main.querySelector('#share-post').onclick = async () => {
    const content = main.querySelector('#share-caption').value.trim();
    const visibility = main.querySelector('#share-vis').value;
    const resultEl = main.querySelector('#share-result');
    const partnerIds = sharePartners.getSelected();
    let photoCategory = null;
    if (sharePhotoDataUrl) {
      const checked = main.querySelector('input[name="share-photo-cat"]:checked');
      if (!checked) { resultEl.textContent = 'Pick a category for your photo.'; return; }
      photoCategory = checked.value;
    }
    const routeEl = document.getElementById('share-route');
    const showRoute = !!(routeEl && routeEl.checked);
    const routePrivacy = showRoute ? Number((document.getElementById('share-route-privacy') || {}).value || 0) : 0;

    const res = await api('/posts', { method: 'POST', body: {
      content, workout_id: ctx.workoutId, verse_id: ctx.verseId, visibility,
      photo_data: sharePhotoDataUrl, photo_category: photoCategory,
      show_route: showRoute, route_privacy_m: routePrivacy } });
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

const dmBtn = document.getElementById('dm-btn');
if (dmBtn) dmBtn.onclick = () => { if (state.me) renderInbox(); };
setInterval(() => { if (state.me) refreshDmBadge(); }, 30000);

const searchBtn = document.getElementById('search-btn');
if (searchBtn) searchBtn.onclick = () => { if (state.me) openSearch(); };

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  // Pressing Explore in the tab bar returns to the index of sections, so the
  // full catalogue is one tap from anywhere. Deep links from Home set
  // state.exploreTab first and call setTab directly, so they are unaffected.
  if (b.dataset.tab === 'explore') state.exploreTab = null;
  setTab(b.dataset.tab);
});

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
    // The messages button lives beside the bell and is revealed on the same
    // signal — that a signed-in session exists — rather than waiting for its
    // own poll to come round.
    refreshDmBadge();
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
// Icon per notification type — makes a dense list scannable at a glance.
const NOTIF_ICONS = {
  follow: '👣',
  kudos: '❤️',
  comment: '💬',
  challenge_complete: '🏆',
  workout_partner_tag: '🤝',
  workout_partner_confirmed: '⚡',
  event_rsvp: '📍',
  group_message: '💭',
  devotional: '🎬',
  streak: '🔥',
  effort: '💪',
  story_reaction: '💛',
  reflection: '📖',
  verse: '📖',
  badge: '🎖️',
  quest: '🗺️',
  journey: '🧭',
};
function notifIcon(type) { return NOTIF_ICONS[type] || '✦'; }

function notificationUrl(n) {
  const raw = n && n.url ? n.url : (() => { try { return JSON.parse((n && n.payload) || '{}').url; } catch { return null; } })();
  try {
    const u = new URL(raw || '/', location.origin);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : '/';
  } catch { return '/'; }
}
async function openNotificationDestination(url) {
  let u;
  try { u = new URL(url || '/', location.origin); } catch { return; }
  if (u.origin !== location.origin) return;
  const p = u.searchParams, kind = p.get('open');
  history.replaceState({}, '', u.pathname + (u.hash || ''));
  if (kind === 'group' && p.get('group_id')) return renderGroupDetail(p.get('group_id'));
  if (kind === 'dm') { await renderInbox(); if (p.get('thread_id')) return renderThread(p.get('thread_id')); return; }
  if (kind === 'workout' && p.get('workout_id')) return renderWorkoutDetail(p.get('workout_id'));
  if (kind === 'verse' && p.get('ref')) return renderVerseThread(p.get('ref'));
  if (kind === 'journeys') { if (p.get('journey_key')) return renderJourneyDetail(p.get('journey_key')); state.tab = 'explore'; state.exploreTab = 'journeys'; return render(); }
  if (kind === 'reel' && p.get('video_id')) { state.tab = 'explore'; state.exploreTab = 'reels'; state.reelTargetId = p.get('video_id'); return render(); }
  if (kind === 'story' && p.get('story_id')) { state.tab = 'home'; state.homeCache = null; state.storyTargetId = p.get('story_id'); return render(); }
  if (kind === 'challenges') { state.tab = 'explore'; state.exploreTab = 'challenges'; return render(); }
  if (kind === 'profile' && p.get('user_id')) return renderUserProfile(p.get('user_id'));
  if (kind === 'profile') { state.tab = 'profile'; return render(); }
  if (kind === 'stats') { state.tab = 'stats'; return render(); }
  state.tab = 'home';
  render().then(() => {
    if (kind === 'post' && p.get('post_id')) setTimeout(() => document.querySelector(`[data-post="${CSS.escape(p.get('post_id'))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  });
}

// Render the panel body. Split out from the toggle so "mark all read" can
// refresh in place instead of the old close-then-reopen double-toggle hack.
async function renderNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  let data;
  try { data = await api('/notifications'); } catch { return; }
  const { notifications, unread_count } = data;
  const fmtPayload = (n) => {
    try {
      const p = JSON.parse(n.payload || '{}');
      return p.message || [p.title, p.body].filter(Boolean).join(' — ') || n.type;
    } catch { return n.type; }
  };
  panel.innerHTML = `
    <div class="notif-panel-head">
      <h3>Notifications</h3>
      ${unread_count > 0 ? `<button id="notif-mark-all">Mark all read</button>` : ''}
    </div>
    ${notifications.length ? notifications.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-notif="${n.id}">
        <span class="notif-icon">${notifIcon(n.type)}</span>
        <div class="notif-body">
          <div class="notif-text">${escapeHtml(fmtPayload(n))}</div>
          <div class="notif-time">${timeAgo(n.delivered_at)} ago</div>
        </div>
      </div>`).join('') : '<div class="notif-empty">Nothing new yet — get moving and your encouragement will show up here.</div>'}
  `;
  const markAllBtn = document.getElementById('notif-mark-all');
  if (markAllBtn) markAllBtn.onclick = async (e) => {
    e.stopPropagation();
    await api('/notifications/read-all', { method: 'POST' });
    await renderNotifPanel();
    refreshNotifBadge();
  };
  panel.querySelectorAll('[data-notif]').forEach(item => {
    item.onclick = async () => {
      if (item.classList.contains('unread')) {
        await api(`/notifications/${item.dataset.notif}/read`, { method: 'POST' });
        item.classList.remove('unread');
      }
      refreshNotifBadge();
      const n = notifications.find(x => x.id === item.dataset.notif);
      if (n) { panel.style.display = 'none'; openNotificationDestination(notificationUrl(n)); }
    };
  });
}

async function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.innerHTML = '<div class="notif-empty">Loading…</div>';
  panel.style.display = 'block';
  await renderNotifPanel();
}

function wireNotifBell() {
  const bellBtn = document.getElementById('notif-bell');
  if (!bellBtn || bellBtn.dataset.wired) return;
  bellBtn.dataset.wired = '1';
  bellBtn.onclick = (e) => { e.stopPropagation(); toggleNotifPanel(); };
  // The panel is a SIBLING of the header now, so an outside-click check against
  // the bell's wrapper alone would close the panel on every click inside it.
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const wrap = document.getElementById('notif-wrap');
    if (!panel || panel.style.display !== 'block') return;
    if (panel.contains(e.target)) return;
    if (wrap && wrap.contains(e.target)) return;
    panel.style.display = 'none';
  });
}
// Wire immediately if the DOM is already parsed (this script is loaded at the
// end of <body>), otherwise wait for DOMContentLoaded.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireNotifBell);
else wireNotifBell();

(async () => {
  await loadMe();
  if (state.me) {
    consumeSignedInRedirectParams();
    if (new URLSearchParams(location.search).get('open')) {
      openNotificationDestination(location.href);
      return;
    }
    const token = new URLSearchParams(location.search).get('group_invite');
    if (token) {
      try {
        const info = await api('/groups/invites/' + encodeURIComponent(token));
        if (confirm(`Join @${info.group.username || info.group.name}?`)) {
          await api('/groups/invites/' + encodeURIComponent(token) + '/join', { method: 'POST' });
          history.replaceState({}, '', location.pathname);
          state.tab = 'explore';
          setTimeout(() => renderGroupDetail(info.group.id), 0);
          return;
        }
      } catch { /* invalid or expired invite */ }
    }
  }
  render();
})();

// ---------------------------------------------------------------- Journeys ----
// A Zwift-style virtual adventure mode: real kilometres move a marker along a
// legendary route, and waypoints unlock narrative + scripture.

const JOURNEY_WORLD_LABEL = {
  biblical: 'Bible',
  'middle-earth': 'Middle-earth',
  narnia: 'Narnia',
  fantasy: 'Original fantasy',
};

// Deterministic 32-bit hash of the journey key, so a route's drawn shape is
// distinct per journey but stable across every render.
function journeySeed(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
function journeyRng(seed) {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

// Sample a winding path across the canvas. The squiggle is derived from the seed
// so each route looks like its own place, and is stable across renders.
function journeyPathPoints(key, w, h) {
  const rnd = journeyRng(journeySeed(key));
  const amp = 0.16 + rnd() * 0.20;
  const freq = 1.6 + rnd() * 2.4;
  const phase = rnd() * Math.PI * 2;
  const drift = (rnd() - 0.5) * 0.18;
  const pad = 18;
  const pts = [];
  const N = 140;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = pad + t * (w - pad * 2);
    const wobble = Math.sin(phase + t * Math.PI * freq) * amp + Math.sin(phase * 2 + t * Math.PI * freq * 2.3) * amp * 0.35;
    const y = h / 2 + wobble * (h / 2 - pad) + drift * (t - 0.5) * h;
    pts.push([x, Math.max(pad, Math.min(h - pad, y))]);
  }
  return pts;
}

// Elevation profile for terrain === 'climb': a rising curve, so a climb up Sinai
// actually looks like a climb.
function journeyClimbPoints(key, w, h) {
  const seed = journeySeed(key);
  const rnd = journeyRng(seed);
  const rough = 0.03 + rnd() * 0.05;
  const bias = 1.25 + rnd() * 0.7;
  const pad = 18;
  const pts = [];
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const base = Math.pow(t, 1 / bias);
    const noise = Math.sin(t * 17 + (seed % 7)) * rough * (1 - t);
    const y = (h - pad) - Math.max(0, Math.min(1, base + noise)) * (h - pad * 2);
    pts.push([pad + t * (w - pad * 2), y]);
  }
  return pts;
}

function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}
// Point at fraction t (0..1) of the polyline's arc length.
function pointAtFraction(pts, t) {
  const target = polyLength(pts) * Math.max(0, Math.min(1, t));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + seg >= target) {
      const f = seg === 0 ? 0 : (target - acc) / seg;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}
// Split the polyline into the travelled prefix and the remaining suffix.
function splitAtFraction(pts, t) {
  const p = pointAtFraction(pts, t);
  const target = polyLength(pts) * Math.max(0, Math.min(1, t));
  let acc = 0, idx = pts.length - 1;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + seg >= target) { idx = i; break; }
    acc += seg;
  }
  return { done: pts.slice(0, idx).concat([p]), left: [p].concat(pts.slice(idx)) };
}
const toJourneyPath = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

// The centrepiece: a stylised route map (or elevation profile for climbs) with
// waypoint dots, the travelled portion in emerald and the rest a faded hairline.
function journeyMapSvg(journey, waypoints, progressKm) {
  const W = 320, H = 150;
  const isClimb = journey.terrain === 'climb';
  const pts = isClimb ? journeyClimbPoints(journey.key, W, H) : journeyPathPoints(journey.key, W, H);
  const total = Number(journey.total_km) || 1;
  const prog = Number(progressKm) || 0;
  const frac = Math.max(0, Math.min(1, prog / total));
  const parts = splitAtFraction(pts, frac);
  const here = pointAtFraction(pts, frac);
  const gid = 'jgrad-' + journeySeed(journey.key);

  const area = isClimb
    ? '<path d="' + toJourneyPath(pts) + ' L' + (W - 18).toFixed(1) + ',' + (H - 18).toFixed(1) + ' L18,' + (H - 18).toFixed(1) + ' Z" fill="url(#' + gid + ')" opacity="0.6"/>'
    : '';

  const dots = (waypoints || []).map(w => {
    const p = pointAtFraction(pts, Math.max(0, Math.min(1, w.km_mark / total)));
    const on = w.km_mark <= prog;
    return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (on ? 4.6 : 3.4) + '"'
      + ' fill="' + (on ? 'var(--gold)' : 'var(--parch-1)') + '"'
      + ' stroke="' + (on ? 'var(--gold-2)' : 'var(--hairline)') + '" stroke-width="1.4">'
      + '<title>' + escapeHtml(w.title) + ' · ' + w.km_mark + ' km</title></circle>';
  }).join('');

  return '<svg class="journey-map" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img"'
    + ' aria-label="Route map for ' + escapeHtml(journey.name) + '">'
    + '<defs><linearGradient id="' + gid + '" x1="0" y1="1" x2="0" y2="0">'
    + '<stop offset="0%" stop-color="var(--forest)" stop-opacity="0.06"/>'
    + '<stop offset="100%" stop-color="var(--emerald)" stop-opacity="0.42"/>'
    + '</linearGradient></defs>'
    + (isClimb ? '<line x1="18" y1="' + (H - 18) + '" x2="' + (W - 18) + '" y2="' + (H - 18) + '" stroke="var(--hairline)" stroke-width="1"/>' : '')
    + area
    + '<path d="' + toJourneyPath(parts.left) + '" fill="none" stroke="var(--hairline)" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 6" opacity="0.85"/>'
    + '<path d="' + toJourneyPath(parts.done) + '" fill="none" stroke="var(--emerald-2)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + dots
    + '<circle cx="' + here[0].toFixed(1) + '" cy="' + here[1].toFixed(1) + '" r="8" fill="none" stroke="var(--gold)" stroke-width="1.2" opacity="0.6"/>'
    + '<circle cx="' + here[0].toFixed(1) + '" cy="' + here[1].toFixed(1) + '" r="4.8" fill="var(--emerald-2)" stroke="var(--gold)" stroke-width="1.6"/>'
    + '</svg>';
}

const fmtKm = n => (Math.round(Number(n) * 10) / 10).toFixed(1);

const JOURNEY_COVER = {
  biblical: '/assets/journeys/bible-cover.png',
  'middle-earth': '/assets/journeys/middle-earth-cover.png',
  narnia: '/assets/journeys/narnia-cover.png',
  fantasy: '/assets/journeys/fantasy-cover.png'
};

function journeyCover(journey) {
  const cover = JOURNEY_COVER[journey.world] || JOURNEY_COVER.fantasy;
  const progress = Math.max(0, Math.min(100, Number(journey.percent) || 0));
  return '<div class="journey-cover">'
    + '<img src="' + cover + '" alt="" loading="lazy">'
    + '<div class="journey-cover-shade"></div>'
    + '<div class="journey-cover-top"><span>' + (JOURNEY_WORLD_LABEL[journey.world] || escapeHtml(journey.world)) + '</span><span>' + fmtKm(journey.total_km) + ' km</span></div>'
    + '<div class="journey-cover-bottom"><span>' + (journey.completed ? '✓ Completed' : (journey.joined ? 'In progress' : 'Ready to ride')) + '</span><span>' + progress + '%</span></div>'
    + '</div>';
}

async function renderJourneysTab(body) {
  body.innerHTML = '<div class="card glass" style="text-align:center">Loading journeys…</div>';
  let journeys;
  try { journeys = await api('/journeys'); }
  catch { body.innerHTML = '<div class="card glass">Could not load journeys.</div>'; return; }

  const card = j => {
    const prog = Number(j.progress_km) || 0;
    const meta = fmtKm(j.total_km) + ' km · ' + escapeHtml(j.terrain || '')
      + (j.elevation_m ? ' · ' + j.elevation_m + ' m' : '')
      + ' · ' + j.waypoint_count + ' waypoints · ' + j.travellers + ' travelling';
    return '<div class="card glass journey-card ' + (j.completed ? 'done' : '') + '" data-journey="' + escapeHtml(j.key) + '">'
      + journeyCover(j)
      + '<div class="journey-hd"><div>'
      + '<div class="journey-name">' + escapeHtml(j.name) + '</div>'
      + '<div class="journey-sub">' + escapeHtml(j.subtitle || '') + '</div></div>'
      + '<span class="journey-world">' + (JOURNEY_WORLD_LABEL[j.world] || escapeHtml(j.world)) + '</span></div>'
      + '<div class="journey-meta">' + meta + '</div>'
      + (j.joined
        ? '<div class="challenge-track"><span style="width:' + j.percent + '%"></span></div>'
          + '<div class="journey-progress">' + fmtKm(prog) + ' / ' + fmtKm(j.total_km) + ' km · ' + j.percent + '%'
          + (j.next_waypoint ? ' · next in ' + fmtKm(j.next_waypoint.km_remaining) + ' km' : '') + '</div>'
        : '<div class="journey-flavor">' + escapeHtml(j.description || '') + '</div>')
      + '</div>';
  };

  const biblical = journeys.filter(j => j.world === 'biblical');
  const middleEarth = journeys.filter(j => j.world === 'middle-earth');
  const narnia = journeys.filter(j => j.world === 'narnia');
  const fantasy = journeys.filter(j => j.world === 'fantasy');
  body.innerHTML = '<h2>Journeys</h2>'
    + '<p class="muted" style="margin-top:-6px;margin-bottom:14px">Pick a route. Every kilometre you cover in the real world moves you along it — and waypoints open as you pass them.</p>'
    + (biblical.length ? '<h3 class="journey-group">Walk the scriptures</h3>' + biblical.map(card).join('') : '')
    + (middleEarth.length ? '<h3 class="journey-group">Middle-earth routes</h3>' + middleEarth.map(card).join('') : '')
    + (narnia.length ? '<h3 class="journey-group">Narnia routes</h3>' + narnia.map(card).join('') : '')
    + (fantasy.length ? '<h3 class="journey-group">Tales &amp; long roads</h3>' + fantasy.map(card).join('') : '');
  body.querySelectorAll('[data-journey]').forEach(el => el.onclick = () => renderJourneyDetail(el.dataset.journey));
}

async function renderJourneyDetail(key) {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
  const back = () => {
    document.querySelectorAll('nav button').forEach(b => b.style.display = '');
    state.tab = 'explore'; state.exploreTab = 'journeys'; render();
  };
  const shell = inner => {
    main.innerHTML = '<button class="ghost back-btn" id="journey-back">← Back</button>' + inner;
    document.getElementById('journey-back').onclick = back;
  };
  shell('<div class="card glass" style="text-align:center">Loading…</div>');

  let data;
  try { data = await api('/journeys/' + encodeURIComponent(key)); }
  catch { shell('<div class="card glass">Could not load this journey.</div>'); return; }
  if (!data || !data.journey) { shell('<div class="card glass">Could not load this journey.</div>'); return; }

  const j = data.journey;
  const prog = data.joined ? (Number(data.progress_km) || 0) : 0;
  let segmentData = { segments: [] };
  try { segmentData = await api('/journeys/' + encodeURIComponent(key) + '/segments'); } catch {}

  const hero = '<div class="card glass journey-hero ' + (data.completed ? 'done' : '') + '">'
    + '<div class="journey-hd"><div>'
    + '<h2 class="journey-title">' + escapeHtml(j.name) + '</h2>'
    + '<div class="journey-sub">' + escapeHtml(j.subtitle || '') + '</div></div>'
    + '<span class="journey-world">' + (JOURNEY_WORLD_LABEL[j.world] || escapeHtml(j.world)) + '</span></div>'
    + '<div class="journey-world-wrap" id="journey-world-wrap">'
    +   '<canvas id="journey-world"></canvas>'
    +   '<div class="journey-world-hud"><span class="jw-live-dot"></span><span class="jw-live-label">COURSE PREVIEW</span><span id="jw-km">' + fmtKm(prog) + '</span>'
    +     '<small> / ' + fmtKm(j.total_km) + ' km</small></div>'
    +   '<div class="journey-world-stats"><span><b>' + (j.elevation_m || 0) + '</b><small>m ascent</small></span><span><b>' + escapeHtml(j.terrain || 'route') + '</b><small>terrain</small></span></div>'
    +   '<div class="journey-minimap"><div class="journey-minimap-label">COURSE MAP</div>' + journeyMapSvg(j, data.waypoints, prog) + '</div>'
    +   '<div class="journey-world-fallback" id="journey-world-fallback" hidden></div>'
    + '</div>'
    + (j.terrain === 'climb'
      ? '<div class="journey-legend">Elevation profile · ' + (j.elevation_m || 0) + ' m of ascent over ' + fmtKm(j.total_km) + ' km</div>'
      : '<div class="journey-legend">Route map · ' + fmtKm(j.total_km) + ' km · ' + escapeHtml(j.terrain || '') + '</div>')
    + '<div class="journey-flavor">' + escapeHtml(j.description || '') + '</div>'
    + (j.scripture_ref ? '<div class="journey-ref">' + escapeHtml(j.scripture_ref) + '</div>' : '')
    + (data.joined
      ? '<div class="challenge-track"><span style="width:' + data.percent + '%"></span></div>'
        + '<div class="journey-progress big">' + fmtKm(prog) + ' / ' + fmtKm(j.total_km) + ' km · ' + data.percent + '%</div>'
        + '<div class="journey-next">' + (data.completed
          ? '🏁 Journey complete — the whole road behind you.'
          : data.next_waypoint
            ? 'Next: ' + escapeHtml(data.next_waypoint.title) + ' in ' + fmtKm(data.next_waypoint.km_remaining) + ' km'
            : 'Keep going — the last stretch is ahead.') + '</div>'
      : '<div class="journey-meta">' + fmtKm(j.total_km) + ' km · ' + escapeHtml(j.terrain || '')
        + (j.elevation_m ? ' · ' + j.elevation_m + ' m' : '')
        + ' · best on a ' + escapeHtml(j.activity_hint || 'any') + '</div>')
    + (data.next_waypoint ? '<div class="journey-next-card"><span class="jw-next-kicker">NEXT WAYPOINT</span><strong>' + escapeHtml(data.next_waypoint.title) + '</strong><span>' + fmtKm(data.next_waypoint.km_remaining) + ' km ahead</span></div>' : '')
    + '<div class="journey-actions">'
    + (data.joined && !data.completed
      ? '<button class="primary journey-ride-btn" id="journey-ride">▶ Travel this route</button>' : '')
    + '<button class="follow-btn ' + (data.joined ? 'following' : '') + '" id="journey-join">'
    + (data.joined ? 'Leave journey' : 'Begin this journey') + '</button>'
    + '</div>'
    + '</div>';

  const wps = data.waypoints.map(w => w.unlocked
    ? '<div class="card glass journey-wp unlocked">'
      + '<div class="journey-wp-hd"><span class="journey-wp-km">' + fmtKm(w.km_mark) + ' km</span>'
      + '<span class="journey-wp-title">' + escapeHtml(w.title) + '</span></div>'
      + (w.narrative ? '<div class="journey-wp-narrative">' + escapeHtml(w.narrative) + '</div>' : '')
      + (w.scripture_ref
        ? '<div class="verse-card verse-tappable" data-verse-ref="' + escapeHtml(w.scripture_ref) + '">'
          + '<div class="verse-ref">' + escapeHtml(w.scripture_ref) + '</div>'
          + (w.scripture_text ? '<div class="verse-text">' + escapeHtml(w.scripture_text) + '</div>' : '')
          + '<div class="verse-convo">\ud83d\udcac Talk about this</div>'
          + '</div>'
        : '')
      + '</div>'
    : '<div class="card glass journey-wp locked">'
      + '<div class="journey-wp-hd"><span class="journey-wp-km">' + fmtKm(w.km_mark) + ' km</span>'
      + '<span class="journey-wp-title">🔒 Not yet reached</span></div></div>'
  ).join('');

  const segmentPanel = segmentData.segments && segmentData.segments.length
    ? '<div class="card glass segment-panel"><div class="premium-card-head"><div><div class="stats-period-head">Live segments</div><div class="muted">Race your best effort and the road leaderboard.</div></div><span class="premium-badge">RACE DAY</span></div>'
      + segmentData.segments.map(s => '<div class="segment-row"><div class="segment-row-head"><strong>' + escapeHtml(s.from) + ' → ' + escapeHtml(s.to) + '</strong><span>' + fmtKm(s.to_km - s.from_km) + ' km</span></div>'
        + '<div class="segment-row-meta">' + (s.your_best_sec ? 'Your best ' + Math.floor(s.your_best_sec / 60) + ':' + String(Math.round(s.your_best_sec % 60)).padStart(2, '0') : 'No personal time yet') + '</div>'
        + (s.leaderboard && s.leaderboard.length ? '<div class="segment-mini-board">' + s.leaderboard.slice(0, 3).map(r => '<span><b>#' + r.position + '</b> ' + escapeHtml(r.display_name) + ' · ' + Math.floor(r.best_sec / 60) + ':' + String(r.best_sec % 60).padStart(2, '0') + '</span>').join('') + '</div>' : '<div class="muted" style="font-size:.7rem">Be the first rider on this segment.</div>')
        + '</div>').join('') + '</div>'
    : '';

  shell(hero + segmentPanel + '<h3 class="journey-group">Waypoints</h3>' + wps);
  main.querySelectorAll('[data-verse-ref]').forEach(el => {
    el.onclick = () => renderVerseThread(el.dataset.verseRef);
  });
  document.getElementById('journey-join').onclick = async () => {
    await api('/journeys/' + encodeURIComponent(j.key) + '/' + (data.joined ? 'leave' : 'join'), { method: 'POST' });
    renderJourneyDetail(j.key);
  };
  const rideBtn = document.getElementById('journey-ride');
  if (rideBtn) rideBtn.onclick = () => renderJourneyLive(j.key);

  // Render the world where you actually stand on the route. It idles at your
  // current distance; "Travel this route" is the same world, driven by real speed.
  (async () => {
    const canvas = document.getElementById('journey-world');
    if (!canvas || !window.FunctioningFaithJourney3D) return;
    let world = null;
    try { world = await window.FunctioningFaithJourney3D.create(canvas, { journey: j, waypoints: data.waypoints, onError: () => {} }); }
    catch { world = null; }
    if (!world) {
      canvas.hidden = true;
      const fb = document.getElementById('journey-world-fallback');
      if (fb) { fb.hidden = false; fb.innerHTML = '<div class="journey-map-wrap tall">' + journeyMapSvg(j, data.waypoints, prog) + '</div>'; }
      return;
    }
    world.setDistance(prog);
    world.setSpeed(0);
    // Tear down when the view is replaced, so we never leak a WebGL context.
    const wrap = document.getElementById('journey-world-wrap');
    const obs = new MutationObserver(() => {
      if (!document.body.contains(wrap)) { try { world.dispose(); } catch {} obs.disconnect(); }
    });
    obs.observe(document.getElementById('main'), { childList: true, subtree: true });
  })();
}

// =========================================================================
// Effort & physiological-moment UI
// Rule for everything below: if we don't have real heart-rate data, we say so.
// No zone is ever shown that wasn't computed from a real reading.
// =========================================================================

const ZONE_TONE = {
  1: 'var(--parch-sink)',
  2: 'var(--forest)',
  3: 'var(--emerald-2)',
  4: 'var(--emerald)',
  5: 'var(--seal)',
};

/** Live verse card, captioned with WHY this verse arrived right now. */
function renderMomentVerseCard(result) {
  const caption = [result.moment_label, result.caption].filter(Boolean).join(' · ');
  return `<div class="verse-card" style="margin-top:12px">
    ${caption ? `<div class="verse-moment">${escapeHtml(caption)}</div>` : ''}
    <div class="verse-ref">${escapeHtml(result.verse.reference)}</div>
    <div class="verse-text">${escapeHtml(result.verse.snippet || '')}</div>
  </div>`;
}

/** Post-workout effort block — the moment the encouragement matters most. */
function renderEffortResult(summary) {
  const e = summary && summary.effort;
  if (!e) return '';
  if (!e.zone_data) {
    const why = e.hr_sample_count > 0
      ? 'Add your max heart rate (or birth year) in your profile to turn these readings into zones.'
      : 'Zone insights need a paired heart-rate monitor — pair a Bluetooth chest strap before your next session.';
    return `<div class="effort-block"><div class="effort-none">No zone data for this session. ${escapeHtml(why)}</div></div>`;
  }
  const total = e.total_zoned_sec || 1;
  const est = e.max_hr_source === 'estimate'
    ? `<div class="effort-foot">Zones based on an estimated max HR of ${e.max_hr_reference} bpm (${escapeHtml(e.max_hr_formula || 'estimate')}). Enter your measured max HR for exact zones.</div>`
    : '';
  return `<div class="effort-block">
    ${summary.encouragement ? `<div class="effort-line">${escapeHtml(summary.encouragement)}</div>` : ''}
    <div class="effort-meta">${e.effort_score} effort points · peak zone ${e.peak_zone} · avg ${e.avg_hr} bpm</div>
    ${zoneBar(e.time_in_zone, total)}
    ${est}
  </div>`;
}

/** Stacked horizontal time-in-zone bar: zone 1 coolest, zone 5 hottest. */
function zoneBar(zones, total) {
  if (!zones || !total) return '';
  const seg = [1, 2, 3, 4, 5]
    .filter(z => (zones[z] || 0) > 0)
    .map(z => `<span class="zone-seg" style="width:${((zones[z] / total) * 100).toFixed(2)}%;background:${ZONE_TONE[z]}" title="Zone ${z} · ${Math.round(zones[z] / 60)} min"></span>`)
    .join('');
  const key = [1, 2, 3, 4, 5]
    .filter(z => (zones[z] || 0) > 0)
    .map(z => `<span class="zone-key"><i style="background:${ZONE_TONE[z]}"></i>Z${z} ${Math.round(zones[z] / 60)}m</span>`)
    .join('');
  return `<div class="zone-bar">${seg}</div><div class="zone-legend">${key}</div>`;
}

/** Effort section on the Stats screen. */
async function renderEffortSection() {
  const card = document.getElementById('effort-card');
  if (!card) return;
  let data;
  try { data = await api('/stats/effort?limit=10'); }
  catch { card.innerHTML = `<div class="stats-period-head">Effort · time in zone</div><div class="muted">Could not load effort data.</div>`; return; }

  if (!data.zone_data) {
    card.innerHTML = `<div class="stats-period-head">Effort · time in zone</div>
      <div class="effort-none">${escapeHtml(data.hint || 'Zone insights need a paired heart-rate monitor.')}</div>`;
    return;
  }

  const scores = data.effort_trend.map(t => t.effort_score);
  let trendLine = '';
  if (scores.length >= 2) {
    const half = Math.ceil(scores.length / 2);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const older = mean(scores.slice(0, half)), newer = mean(scores.slice(half));
    const delta = newer - older;
    const dir = delta > 1 ? 'climbing' : delta < -1 ? 'easing off' : 'holding steady';
    trendLine = `<div class="effort-meta">Effort trend: <strong>${dir}</strong> — averaging ${newer.toFixed(0)} points a session, from ${older.toFixed(0)}.</div>`;
  }

  const est = data.max_hr_source === 'estimate'
    ? `<div class="effort-foot">Based on an estimated max HR of ${data.max_hr} bpm (${escapeHtml(data.max_hr_formula || 'estimate')}) — not a measurement.</div>` : '';

  card.innerHTML = `<div class="stats-period-head">Effort · time in zone</div>
    <div class="muted" style="margin-bottom:8px">Last ${data.sessions.length} session${data.sessions.length === 1 ? '' : 's'} with heart-rate data.</div>
    ${zoneBar(data.totals, data.total_sec)}
    ${trendLine}
    <div class="effort-sessions">
      ${data.sessions.map(s => `<div class="effort-row">
        <span class="effort-row-d">${new Date(s.end_time).toLocaleDateString()}</span>
        ${zoneBar(s.zones, Object.values(s.zones).reduce((a, b) => a + b, 0) || 1)}
        <span class="effort-row-s">${s.effort_score ?? '—'}</span>
      </div>`).join('')}
    </div>
    ${est}`;
}

/** Profile inputs for the reference figures zones are computed from. */
function renderHeartRateFields(user) {
  return `
    <div class="hr-fields">
      <div class="muted" style="margin:12px 0 4px">Heart-rate zones — optional. Used to work out how hard each session really was. We never guess these.</div>
      <label class="field-label">Max heart rate (bpm)</label>
      <input id="p-maxhr" type="number" min="120" max="230" placeholder="e.g. 188 — from a lab or max-effort test" value="${user.max_hr ?? ''}">
      <label class="field-label">Resting heart rate (bpm)</label>
      <input id="p-restinghr" type="number" min="30" max="120" placeholder="e.g. 52" value="${user.resting_hr ?? ''}">
      <label class="field-label">Birth year</label>
      <input id="p-birthyear" type="number" min="1900" max="${new Date().getFullYear() - 10}" placeholder="Used only to estimate max HR if you haven't measured it" value="${user.birth_year ?? ''}">
      <div class="muted" style="margin-top:4px">${user.max_hr
        ? 'Using your entered max HR.'
        : user.birth_year
          ? `Estimating your max HR with the Tanaka formula (208 − 0.7 × age) ≈ ${Math.round(208 - 0.7 * (new Date().getFullYear() - user.birth_year))} bpm. An estimate, not a measurement.`
          : 'Without either of these we show no zones at all, rather than made-up ones.'}</div>
    </div>`;
}

function heartRateFieldValues() {
  const val = (id) => {
    const el = document.getElementById(id);
    if (!el) return undefined;
    const v = el.value.trim();
    return v === '' ? null : Number(v);
  };
  const out = {};
  for (const [key, id] of [['max_hr', 'p-maxhr'], ['resting_hr', 'p-restinghr'], ['birth_year', 'p-birthyear']]) {
    const v = val(id);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

// ============================================================================
// Scripture as conversation, not broadcast.
// Every verse the app surfaces is an invitation to talk, not a broadcast: verse
// cards are tappable into a single canonical thread per verse.
// ============================================================================

// Turn any rendered .verse-tappable card into a doorway to that verse's
// conversation, and label it with the live reflection count.
function wireVerseCards(root) {
  const scope = root || document;
  const cards = [...scope.querySelectorAll('.verse-tappable[data-verse-ref]')];
  if (!cards.length) return;
  cards.forEach(card => {
    if (!card.querySelector('.verse-share-actions')) {
      const actions = document.createElement('div');
      actions.className = 'verse-share-actions';
      actions.innerHTML = '<button class="ghost" type="button" data-verse-share>Share link</button><button class="ghost" type="button" data-verse-dm>Send via DM</button>';
      card.appendChild(actions);
    }
    card.onclick = (e) => {
      e.stopPropagation();
      if (e.target.closest('.verse-share-actions')) return;
      renderVerseThread(card.dataset.verseRef);
    };
  });
  scope.querySelectorAll('[data-verse-share]').forEach(btn => btn.onclick = async e => {
    e.stopPropagation();
    await shareVerseLink(btn.closest('[data-verse-ref]').dataset.verseRef);
  });
  scope.querySelectorAll('[data-verse-dm]').forEach(btn => btn.onclick = async e => {
    e.stopPropagation();
    await openVerseDmPicker(btn.closest('[data-verse-ref]').dataset.verseRef);
  });
  const refs = [...new Set(cards.map(c => c.dataset.verseRef))];
  api(`/verses/thread-summary?refs=${encodeURIComponent(refs.join('|'))}`).then(summary => {
    scope.querySelectorAll('[data-convo-for]').forEach(el => {
      const s = summary && summary[el.dataset.convoFor];
      if (!s) return;
      el.textContent = s.reflection_count > 0
        ? `\u{1F4AC} ${s.reflection_count} reflection${s.reflection_count === 1 ? '' : 's'}`
        : '\u{1F4AC} Start the conversation';
    });
  }).catch(() => {});
}

// Explore -> Scripture: what people are talking about, plus a real Bible search
// so any verse in the verified library can become a conversation.
async function renderScriptureTab(body) {
  body.innerHTML = `
    <h2>Scripture together</h2>
    <p class="muted" style="margin-top:-6px;margin-bottom:12px">Scripture as conversation, not broadcast. Open a verse and talk about it with everyone else reading it.</p>
    <div class="card glass">
      <div class="field-label">Find a verse to talk about</div>
      <div class="comment-input-row">
        <input type="text" id="scripture-q" placeholder="Search the Bible &mdash; a word, phrase, or reference&hellip;" />
        <button id="scripture-search">Search</button>
      </div>
      <div id="scripture-results" style="margin-top:8px"></div>
    </div>
    <h2 style="margin-top:18px">Being discussed</h2>
    <div id="scripture-discussed"><p class="muted">Loading&hellip;</p></div>
  `;

  const discussedEl = document.getElementById('scripture-discussed');
  try {
    const threads = await api('/verses/discussed');
    discussedEl.innerHTML = threads.length ? threads.map(t => `
      <div class="card glass verse-thread-row" data-open-ref="${escapeHtml(t.reference)}">
        <div class="verse-ref">${escapeHtml(t.reference)}</div>
        <div class="verse-text">${escapeHtml((t.text || '').slice(0, 160))}${(t.text || '').length > 160 ? '&hellip;' : ''}</div>
        ${t.prompt ? `<div class="muted" style="font-size:0.78rem;margin-top:6px">&ldquo;${escapeHtml(t.prompt)}&rdquo;</div>` : ''}
        <div class="verse-convo">\u{1F4AC} ${t.reflection_count} reflection${t.reflection_count === 1 ? '' : 's'} &middot; last activity ${timeAgo(t.last_activity)} ago</div>
      </div>`).join('')
      : '<div class="card glass muted" style="text-align:center">No verse conversations yet. Search for a verse above and start the first one.</div>';
    discussedEl.querySelectorAll('[data-open-ref]').forEach(el => el.onclick = () => renderVerseThread(el.dataset.openRef));
  } catch {
    discussedEl.innerHTML = '<p class="muted">Could not load verse conversations.</p>';
  }

  const resultsEl = document.getElementById('scripture-results');
  const runSearch = async () => {
    const q = document.getElementById('scripture-q').value.trim();
    if (!q) return;
    resultsEl.innerHTML = '<span class="muted">Searching&hellip;</span>';
    try {
      const data = await api(`/bible/search?q=${encodeURIComponent(q)}&limit=10`);
      if (!data.results || !data.results.length) { resultsEl.innerHTML = '<span class="muted">Nothing found in the verified library for that.</span>'; return; }
      resultsEl.innerHTML = `
        <div class="muted" style="font-size:0.76rem;margin-bottom:6px">${data.total} match${data.total === 1 ? '' : 'es'} &mdash; showing ${data.results.length}</div>
        ${data.results.map(v => {
          const ref = `${v.book} ${v.chapter}:${v.verse}`;
          return `<div class="card glass verse-thread-row" data-open-ref="${escapeHtml(ref)}" style="padding:10px">
            <div class="verse-ref">${escapeHtml(ref)}</div>
            <div class="verse-text">${escapeHtml(v.text)}</div>
            <div class="verse-convo">\u{1F4AC} Open the conversation</div>
          </div>`;
        }).join('')}`;
      resultsEl.querySelectorAll('[data-open-ref]').forEach(el => el.onclick = () => renderVerseThread(el.dataset.openRef));
    } catch {
      resultsEl.innerHTML = '<span class="muted">Search failed. Try again shortly.</span>';
    }
  };
  document.getElementById('scripture-search').onclick = runSearch;
  document.getElementById('scripture-q').onkeydown = (e) => { if (e.key === 'Enter') runSearch(); };
}

// The verse conversation screen: the real verse, the opener's prompt, and the
// reflection thread (replies indented one level).
// Is values-aligned AI actually available? Asked once and remembered, so the
// companion box is simply absent rather than offering something that 503s.
let aiStatus = null;
async function aiAvailable() {
  if (aiStatus === null) {
    try { aiStatus = await api('/ai/status'); } catch { aiStatus = { gloo: { configured: false } }; }
  }
  return !!(aiStatus.gloo && aiStatus.gloo.configured);
}

/**
 * The scripture companion on a verse thread.
 *
 * Renders the answer, then the real text of every additional verse it cited —
 * fetched by the server from YouVersion, never written by the model. If the
 * server could not verify what came back, nothing is shown but a plain note.
 */
async function wireCompanion(reference) {
  const box = document.getElementById('companion');
  if (!box) return;
  if (!(await aiAvailable())) return;      // stays hidden
  box.hidden = false;

  const input = document.getElementById('companion-q');
  const btn = document.getElementById('companion-ask');
  const out = document.getElementById('companion-out');

  const ask = async () => {
    const question = input.value.trim();
    if (!question) return;
    btn.disabled = true;
    out.innerHTML = `<div class="companion-answer muted">Thinking&hellip;</div>`;
    let res;
    try {
      res = await api(`/verses/${encodeURIComponent(reference)}/ask`,
                      { method: 'POST', body: { question } });
    } catch {
      res = { error: 'unreachable' };
    }
    btn.disabled = false;

    if (!res || res.error) {
      out.innerHTML = `<div class="companion-answer muted">` +
        (res && res.error === 'no_verified_answer'
          ? 'No answer came back that could be checked against real scripture, so nothing is shown.'
          : 'The companion is unavailable right now.') + `</div>`;
      return;
    }

    out.innerHTML = `
      <div class="companion-answer">
        <div class="companion-q">${escapeHtml(question)}</div>
        <p>${escapeHtml(res.answer)}</p>
        ${(res.also || []).map(a => `
          <div class="companion-ref">
            <div class="verse-ref">${escapeHtml(a.reference)}</div>
            <div class="verse-text">${escapeHtml(a.text)}</div>
          </div>`).join('')}
        <div class="muted companion-meta">
          ${res.tradition ? escapeHtml(String(res.tradition).replace(/_/g, ' ')) + ' &middot; ' : ''}
          verse text from YouVersion${res.also && res.also.length
            ? ' &middot; ' + res.also.length + ' cross-reference' + (res.also.length > 1 ? 's' : '') + ' verified'
            : ''}
        </div>
      </div>`;
    input.value = '';
  };

  btn.onclick = ask;
  input.onkeydown = (e) => { if (e.key === 'Enter') ask(); };
}

async function renderVerseThread(reference) {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
  const backHtml = `<button class="ghost back-btn" id="verse-back">&larr; Back</button>`;
  const goBack = () => {
    // Always restore the bottom nav so nobody is stranded on this screen.
    document.querySelectorAll('nav button').forEach(b => b.style.display = '');
    render();
  };
  main.innerHTML = `${backHtml}<div class="card glass" style="text-align:center">Loading&hellip;</div>`;
  document.getElementById('verse-back').onclick = goBack;

  let data;
  try {
    data = await api(`/verses/${encodeURIComponent(reference)}/thread`);
  } catch {
    main.innerHTML = `${backHtml}<div class="card glass">Could not load this verse.</div>`;
    document.getElementById('verse-back').onclick = goBack;
    return;
  }
  if (data.error) {
    main.innerHTML = `${backHtml}<div class="card glass"><p class="muted">${escapeHtml(data.hint || 'That verse is not in our verified library.')}</p></div>`;
    document.getElementById('verse-back').onclick = goBack;
    return;
  }

  const v = data.verse;
  const verseRef = v.book + ' ' + v.chapter + ':' + v.verse;
  const paint = (thread, reflections) => {
    const reflectionHtml = (r, isReply) => `
      <div class="comment reflection ${isReply ? 'reflection-reply' : ''}" data-reflection="${r.id}">
        <b>${escapeHtml(r.author || 'Someone')}</b>${escapeHtml(r.content)}
        <div class="reflection-actions">
          <button class="action-btn ${r.liked_by_me ? 'liked' : ''}" data-rlike="${r.id}">${r.liked_by_me ? '❤️' : '\u{1F90D}'} <span class="n">${r.like_count}</span></button>
          ${isReply ? '' : `<button class="action-btn" data-rreply="${r.id}">&#8617; Reply</button>`}
          <span class="muted" style="font-size:0.72rem">${timeAgo(r.created_at)} ago</span>
        </div>
        ${isReply ? '' : `<div class="reply-box" id="reply-box-${r.id}" style="display:none">
          <div class="comment-input-row">
            <input type="text" id="reply-input-${r.id}" placeholder="Reply&hellip;" />
            <button data-rsend="${r.id}">Send</button>
          </div>
        </div>`}
        ${(r.replies || []).map(child => reflectionHtml(child, true)).join('')}
      </div>`;

    main.innerHTML = `
      ${backHtml}
      <div class="card glass">
        <div class="verse-card">
          <div class="verse-ref">${escapeHtml(v.book)} ${v.chapter}:${v.verse}</div>
          <div class="verse-text" id="yv-text">${escapeHtml(v.text)}</div>
          <div class="yv-bar">
            <label class="yv-label" for="yv-translation">Translation</label>
            <select id="yv-translation" class="yv-select"><option value="">WEB (verified locally)</option></select>
            <a class="yv-open" id="yv-open" target="_blank" rel="noopener noreferrer" hidden>Open in YouVersion &#8599;</a>
          </div>
          <div class="muted yv-note" id="yv-note"></div>
        </div>
        <!-- The companion answers the question that stalls a thread. Its answer
             is shown to the asker only; it never posts into the conversation. -->
        <div class="companion" id="companion" hidden>
          <div class="companion-row">
            <input type="text" id="companion-q" maxlength="500"
                   placeholder="Ask about this verse&hellip;" />
            <button id="companion-ask">Ask</button>
          </div>
          <div class="muted companion-hint">
            Answered in your tradition. Every verse it cites is shown from
            YouVersion &mdash; nothing is quoted from memory.
          </div>
          <div id="companion-out"></div>
        </div>
        ${thread && thread.prompt ? `<div class="verse-prompt">&ldquo;${escapeHtml(thread.prompt)}&rdquo;<div class="muted" style="font-size:0.74rem;margin-top:4px">opened by ${escapeHtml(thread.opened_by_name || 'Someone')}</div></div>` : ''}
        ${!thread ? `
          <p class="muted" style="margin-top:10px">No one has opened a conversation on this verse yet. Ask the first question.</p>
          <div class="comment-input-row">
            <input type="text" id="verse-open-prompt" placeholder="What does this verse stir in you?" />
            <button id="verse-open-btn">Open</button>
          </div>
          <div class="muted" id="verse-open-status" style="font-size:0.78rem;margin-top:6px"></div>
        ` : `
          <div class="reflections" style="margin-top:12px">
            ${reflections.length ? reflections.map(r => reflectionHtml(r, false)).join('') : '<p class="muted">No reflections yet &mdash; share the first one.</p>'}
            <div class="comment-input-row">
              <input type="text" id="reflection-input" placeholder="Share a reflection&hellip;" />
              <button id="reflection-send">Post</button>
            </div>
          </div>`}
      </div>`;
    document.getElementById('verse-back').onclick = goBack;
    wireCompanion(verseRef);

    if (!thread) {
      document.getElementById('verse-open-btn').onclick = async () => {
        const statusEl = document.getElementById('verse-open-status');
        statusEl.textContent = 'Opening…';
        const prompt = document.getElementById('verse-open-prompt').value.trim();
        const res = await api(`/verses/${encodeURIComponent(reference)}/thread`, { method: 'POST', body: { prompt: prompt || null } });
        if (res.error) { statusEl.textContent = res.hint || res.error; return; }
        renderVerseThread(reference);
      };
      return;
    }

    main.querySelectorAll('[data-rreply]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      const box = document.getElementById(`reply-box-${btn.dataset.rreply}`);
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
    main.querySelectorAll('[data-rlike]').forEach(btn => btn.onclick = async (e) => {
      e.stopPropagation();
      const r = await api(`/verses/reflections/${btn.dataset.rlike}/like`, { method: 'POST' });
      if (r.error) return;
      btn.classList.toggle('liked', r.liked);
      btn.innerHTML = `${r.liked ? '❤️' : '\u{1F90D}'} <span class="n">${r.like_count}</span>`;
    });
    main.querySelectorAll('[data-rsend]').forEach(btn => btn.onclick = async () => {
      const pid = btn.dataset.rsend;
      const input = document.getElementById(`reply-input-${pid}`);
      if (!input.value.trim()) return;
      await api(`/verses/threads/${thread.id}/reflections`, { method: 'POST', body: { content: input.value, parent_id: pid } });
      renderVerseThread(reference);
    });
    const sendBtn = document.getElementById('reflection-send');
    if (sendBtn) sendBtn.onclick = async () => {
      const input = document.getElementById('reflection-input');
      if (!input.value.trim()) return;
      const res = await api(`/verses/threads/${thread.id}/reflections`, { method: 'POST', body: { content: input.value } });
      if (res.error) return;
      renderVerseThread(reference);
    };
  };

  paint(data.thread, data.reflections || []);
  // The translation switcher belongs to this screen, and verseRef is only in
  // scope here — it was wired to the wrong call site first time.
  wireTranslationSwitcher(verseRef);
}

// ============================================================================
// Church at signup, with videos already embedded.
// ============================================================================

// Shared free-Overpass church search + pick, used by BOTH the signup onboarding
// step and the profile church finder. On pick we save the church to the profile
// and immediately try to auto-populate its videos (no extra user steps).
function runChurchSearch({ statusEl, resultsEl, onPicked }) {
  if (!navigator.geolocation) { statusEl.textContent = "Location isn't supported in this browser."; return; }
  statusEl.textContent = 'Getting your location…';
  resultsEl.innerHTML = '';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      statusEl.textContent = 'Searching nearby churches…';
      try {
        const { latitude, longitude } = pos.coords;
        const results = await api(`/churches/search?lat=${latitude}&lng=${longitude}&radius_km=8`);
        if (!Array.isArray(results) || !results.length) { statusEl.textContent = 'No churches found nearby — try a different location.'; return; }
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
          statusEl.textContent = "Saved. Looking for your church's videos…";
          let auto = null;
          try { auto = await api(`/churches/${encodeURIComponent(c.osm_id)}/auto-link`, { method: 'POST' }); } catch {}
          statusEl.textContent = (auto && auto.message) || 'Saved.';
          if (onPicked) await onPicked(c, auto);
        });
      } catch {
        statusEl.textContent = 'Could not reach the church directory. Try again shortly.';
      }
    },
    () => { statusEl.textContent = 'Location permission denied or unavailable — try again or check your browser settings.'; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Signup step 2: find your church. Always skippable - nobody gets trapped here.
async function renderChurchOnboarding() {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
  const enterApp = () => {
    document.querySelectorAll('nav button').forEach(b => b.style.display = '');
    state.tab = 'home';
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'home'));
    render();
  };

  main.innerHTML = `
    <div class="card glass">
      <h2>Find your church</h2>
      <p class="muted">We'll look up real churches near you (free, from OpenStreetMap) and pull in their videos automatically &mdash; so your feed has your church in it from day one.</p>
      <button class="primary" id="onb-find" style="width:100%">Use my location</button>
      <div class="muted" id="onb-status" style="margin-top:8px"></div>
      <div id="onb-results" style="margin-top:8px"></div>
      <div id="onb-done" style="display:none;margin-top:10px"></div>
      <button class="ghost" id="onb-skip" style="width:100%;margin-top:12px">Skip for now</button>
      <p class="muted" style="font-size:0.76rem;margin-top:8px;text-align:center">You can add or change your church any time from your profile.</p>
    </div>`;

  document.getElementById('onb-skip').onclick = enterApp;
  document.getElementById('onb-find').onclick = () => runChurchSearch({
    statusEl: document.getElementById('onb-status'),
    resultsEl: document.getElementById('onb-results'),
    onPicked: async () => {
      await loadMe();
      const doneEl = document.getElementById('onb-done');
      document.getElementById('onb-results').innerHTML = '';
      doneEl.style.display = 'block';
      doneEl.innerHTML = `<button class="primary" id="onb-continue" style="width:100%">Continue to Functioning Faith</button>`;
      document.getElementById('onb-continue').onclick = enterApp;
      document.getElementById('onb-skip').textContent = 'Continue';
    },
  });
}

// "From your church" home-feed section. Click-to-embed thumbnails keep the feed
// light; when nothing is linked (or YouTube isn't configured) we say so plainly
// and never show placeholder or invented videos.
function churchVideosHtml(data) {
  if (!data || !data.church_name) return '';
  if (!data.videos || !data.videos.length) {
    return `
    <div class="card glass foryou-card">
      <div class="foryou-head">⛪ From ${escapeHtml(data.church_name)}</div>
      <p class="muted" style="margin:0">${data.youtube_configured === false
        ? "No videos yet &mdash; add your church's website on your profile and we'll show the sermon videos it already embeds."
        : "No videos found for your church yet. You can link its channel from your profile."}</p>
    </div>`;
  }
  return `
    <div class="card glass foryou-card">
      <div class="foryou-head">⛪ From ${escapeHtml(data.church_name)}</div>
      <div class="church-video-grid">
        ${data.videos.map(v => `
          <div class="church-video" data-cv-provider="${escapeHtml(v.provider)}" data-cv-id="${escapeHtml(v.video_id)}">
            <div class="church-video-frame">
              ${v.thumbnail_url
                ? `<img src="${escapeHtml(v.thumbnail_url)}" alt="${escapeHtml(v.title || 'Church video')}" />`
                : `<div class="church-video-blank">&#9654;</div>`}
              <span class="church-video-play">&#9654;</span>
            </div>
            ${v.title ? `<div class="church-video-title">${escapeHtml(v.title)}</div>` : ''}
          </div>`).join('')}
      </div>
      <div class="muted" style="font-size:0.72rem;margin-top:6px">${data.source === 'website' ? "Embedded on your church's own website." : `From your church's channel${data.channel_title ? ` (${escapeHtml(data.channel_title)})` : ''}.`}</div>
    </div>`;
}

// Click-to-embed: only swap in the real iframe once a user asks for it.
function wireChurchVideoThumbs(root) {
  (root || document).querySelectorAll('.church-video[data-cv-id]').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.cvId;
      const src = el.dataset.cvProvider === 'vimeo'
        ? `https://player.vimeo.com/video/${encodeURIComponent(id)}`
        : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`;
      const frame = el.querySelector('.church-video-frame');
      if (!frame) return;
      frame.innerHTML = `<iframe src="${src}" title="Church video" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
      el.onclick = null;
    };
  });
}


// --- API keys panel --------------------------------------------------------
// The key is rendered once, at creation, and never fetched again — the server
// only keeps a hash. It is put in a selectable field rather than an alert so it
// can actually be copied on a phone.
async function renderApiKeys() {
  const box = document.getElementById('ak-list');
  if (!box) return;

  let keys = [];
  try { keys = (await api('/dev/keys')).keys || []; }
  catch (e) { box.innerHTML = '<div class="muted">Could not load your keys. ' + escapeHtml(e.message || 'Try again.') + '</div>'; return; }

  const live = keys.filter(k => !k.revoked);
  box.innerHTML = live.length ? live.map(k => `
    <div class="wh-row">
      <div>
        <b>${escapeHtml(k.name || 'Untitled key')}</b>
        <div class="muted" style="font-size:.76rem">
          <code>${escapeHtml(k.key_prefix)}…</code> ·
          ${k.last_used_at ? 'last used ' + timeAgo(k.last_used_at) + ' ago' : 'never used'}
        </div>
      </div>
      <div>
        <button class="action-btn" data-akrotate="${k.id}">Rotate</button>
        <button class="action-btn" data-akdel="${k.id}">Revoke</button>
      </div>
    </div>`).join('')
    : '<div class="muted">No keys yet.</div>';

  const reveal = (res) => {
    const el = document.createElement('div');
    el.className = 'ak-reveal';
    el.innerHTML =
        '<div class="muted" style="font-size:.76rem;margin-bottom:4px">'
      + escapeHtml(res.warning || 'Copy this now — it cannot be shown again.') + '</div>'
      + '<div class="ak-reveal-actions"><input readonly value="' + escapeHtml(res.key) + '" />'
      + '<button class="ghost" type="button" id="ak-copy">Copy</button></div>';
    box.prepend(el);
    const input = el.querySelector('input');
    input.focus(); input.select();
    const copy = el.querySelector('#ak-copy');
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText(res.key); copy.textContent = 'Copied'; }
      catch { input.focus(); input.select(); copy.textContent = 'Select and copy'; }
    };
  };

  box.querySelectorAll('[data-akrotate]').forEach(b => b.onclick = async () => {
    try {
      const res = await api('/dev/keys/' + b.dataset.akrotate + '/rotate', { method: 'POST', throwOnError: true });
      await renderApiKeys();
      if (res && res.key) reveal(res);
    } catch (e) { const s = document.getElementById('ak-status'); if (s) s.textContent = e.message || 'Could not rotate key.'; }
  });
  box.querySelectorAll('[data-akdel]').forEach(b => b.onclick = async () => {
    await api('/dev/keys/' + b.dataset.akdel, { method: 'DELETE' }).catch(() => {});
    renderApiKeys();
  });

  const add = document.getElementById('ak-add');
  if (add) add.onclick = async () => {
    const nameEl = document.getElementById('ak-name');
    const status = document.getElementById('ak-status');
    add.disabled = true;
    if (status) status.textContent = 'Creating secure key…';
    try {
      const res = await api('/dev/keys', { method: 'POST', body: { name: nameEl.value.trim() || undefined }, throwOnError: true });
      nameEl.value = '';
      await renderApiKeys();
      if (res && res.key) reveal(res);
      if (status) status.textContent = 'Key created. Copy it now — it cannot be recovered later.';
    } catch (e) { if (status) status.textContent = e.message || 'Could not create key. Please try again.'; }
    finally { add.disabled = false; }
  };
}

async function shareVerseLink(reference) {
  try {
    const data = await api(`/verses/${encodeURIComponent(reference)}/share`);
    await navigator.clipboard.writeText(`${location.origin}${data.url}`);
    showToast(`${data.reference} link copied`);
  } catch { showToast('Could not create that verse link.', true); }
}

async function openVerseDmPicker(reference) {
  try {
    const users = (await api('/users')).filter(u => !state.me?.user?.id || u.id !== state.me.user.id).slice(0, 24);
    if (!users.length) return showToast('No friends are available to message yet.', true);
    const choices = users.map((u, i) => `${i + 1}. ${u.display_name}`).join('\n');
    const answer = prompt(`Send ${reference} to:\n\n${choices}\n\nEnter a number:`);
    const index = Number(answer) - 1; const recipient = users[index];
    if (!recipient) return;
    const opened = await api(`/dms/with/${encodeURIComponent(recipient.id)}`, { method: 'POST' });
    await api(`/dms/${encodeURIComponent(opened.thread_id)}/verse`, { method: 'POST', body: { reference } });
    showToast(`${reference} sent to ${recipient.display_name}`);
  } catch { showToast('Could not send that verse.', true); }
}

// --- Notifications panel ---------------------------------------------------
// Web Push: the browser's own permission prompt, the browser's own delivery.
// Every category is opt-in separately and nothing is subscribed by default.
async function renderReminders() {
  const box = document.getElementById('reminders-body');
  if (!box) return;
  let rows = [];
  try { rows = await api('/reminders'); } catch { box.textContent = 'Could not load motivation reminders.'; return; }
  const localValue = iso => { const d = new Date(String(iso || '').replace(' ', 'T') + 'Z'); return isNaN(d) ? '' : d.toISOString().slice(0, 16); };
  box.innerHTML = `<div class="field-label">Motivation reminders</div><div class="muted" style="margin-bottom:8px">Write your own encouragement and choose when it should meet you. It appears in the app and, with reminders enabled, on your home screen.</div>
    <div class="reminder-form"><input class="input" id="rm-title" maxlength="80" placeholder="Title · e.g. Keep your promise" /><textarea class="input" id="rm-body" maxlength="240" rows="2" placeholder="Your motivation or reminder…"></textarea><div class="reminder-form-row"><input class="input" id="rm-time" type="datetime-local" /><select class="input" id="rm-repeat"><option value="once">Once</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></div><button class="primary" id="rm-add">Schedule motivation</button></div>
    <div id="rm-status" class="muted" style="margin-top:7px"></div><div class="reminder-list">${rows.length ? rows.map(r => `<div class="reminder-row ${r.enabled ? '' : 'disabled'}"><div><b>${escapeHtml(r.title)}</b><div class="muted">${escapeHtml(r.body)} · ${r.repeat_rule} · ${new Date(String(r.scheduled_at).replace(' ', 'T') + 'Z').toLocaleString()}</div></div><div class="reminder-actions"><button class="ghost" data-rm-toggle="${r.id}">${r.enabled ? 'Pause' : 'Resume'}</button><button class="ghost danger" data-rm-delete="${r.id}">Delete</button></div></div>`).join('') : '<div class="muted">No scheduled motivation yet.</div>'}</div>`;
  const status = msg => { const el = document.getElementById('rm-status'); if (el) el.textContent = msg; };
  document.getElementById('rm-add').onclick = async () => {
    const r = await api('/reminders', { method: 'POST', body: { title: document.getElementById('rm-title').value, body: document.getElementById('rm-body').value, scheduled_at: document.getElementById('rm-time').value, repeat_rule: document.getElementById('rm-repeat').value } });
    if (r.error) { status(r.hint || r.error); return; }
    status('Motivation scheduled.'); renderReminders();
  };
  box.querySelectorAll('[data-rm-toggle]').forEach(btn => btn.onclick = async () => { const row = rows.find(x => x.id === btn.dataset.rmToggle); await api('/reminders/' + row.id, { method: 'PATCH', body: { enabled: !row.enabled } }); renderReminders(); });
  box.querySelectorAll('[data-rm-delete]').forEach(btn => btn.onclick = async () => { await api('/reminders/' + btn.dataset.rmDelete, { method: 'DELETE' }); renderReminders(); });
}

async function renderPush() {
  const box = document.getElementById('push-body');
  if (!box) return;

  let cfg;
  try { cfg = await api('/push/config'); }
  catch { box.innerHTML = '<div class="muted">Could not load notification settings.</div>'; return; }

  if (!cfg.enabled) {
    box.innerHTML = '<div class="muted">Push notifications are not configured on this deployment. ' +
                    'The in-app bell still works.</div>';
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    box.innerHTML = '<div class="muted">This browser cannot receive push notifications. ' +
                    'On iPhone, add Functioning Faith to your Home Screen first.</div>';
    return;
  }

  const mine = cfg.subscriptions || [];
  const subscribedHere = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    return sub && mine.some(m => m.endpoint === sub.endpoint) ? sub : null;
  };
  const here = await subscribedHere();
  const cats = here ? (mine.find(m => m.endpoint === here.endpoint) || {}).categories || [] : cfg.defaults;

  box.innerHTML = here
    ? Object.entries(cfg.categories).map(([key, label]) => `
        <label class="toggle-row" style="cursor:pointer">
          <span>${escapeHtml(label)}</span>
          <input type="checkbox" data-pcat="${key}" ${cats.includes(key) ? 'checked' : ''} />
        </label>`).join('')
      + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'
      + '<button class="ghost" id="push-test">Send a test</button>'
      + '<button class="ghost" id="push-daily">Send today\'s verse</button>'
      + '<button class="ghost" id="push-off">Turn off on this device</button></div>'
      + '<div class="muted" id="push-status" style="font-size:.78rem;margin-top:8px"></div>'
    : '<button class="primary" id="push-on">Enable notifications</button>'
      + '<div class="muted" id="push-status" style="font-size:.78rem;margin-top:8px"></div>';

  const status = (m) => { const s = document.getElementById('push-status'); if (s) s.textContent = m; };

  const on = document.getElementById('push-on');
  if (on) on.onclick = async () => {
    status('Asking your browser…');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { status('Permission denied. Your browser blocks it until you change that.'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.public_key),
      });
      await api('/push/subscribe', { method: 'POST',
        body: { subscription: sub.toJSON(), categories: cfg.defaults } });
      renderPush();
    } catch (e) { status('Could not enable: ' + (e && e.message ? e.message : 'unknown error')); }
  };

  box.querySelectorAll('[data-pcat]').forEach(cb => cb.onchange = async () => {
    const chosen = [...box.querySelectorAll('[data-pcat]')].filter(x => x.checked).map(x => x.dataset.pcat);
    await api('/push/categories', { method: 'POST', body: { endpoint: here.endpoint, categories: chosen } })
      .catch(() => {});
    status('Saved.');
  });

  const test = document.getElementById('push-test');
  if (test) test.onclick = async () => {
    status('Sending…');
    const r = await api('/push/test', { method: 'POST' }).catch(() => null);
    status(r && r.sent ? 'Sent — it should appear now.' : 'Nothing was sent. Check the category is on.');
  };

  const dailyBtn = document.getElementById('push-daily');
  if (dailyBtn) dailyBtn.onclick = async () => {
    status('Choosing a verse…');
    const r = await api('/push/daily-now', { method: 'POST' }).catch(() => null);
    status(r && r.reference ? 'Sent ' + r.reference + '.'
                            : (r && r.hint) || 'Nothing to send right now.');
  };

  const off = document.getElementById('push-off');
  if (off) off.onclick = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
               await sub.unsubscribe().catch(() => {}); }
    renderPush();
  };
}

// The VAPID public key travels as base64url; PushManager wants raw bytes.
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// --- Developer webhooks panel ---------------------------------------------
// Registration, delivery health and a test event, so a developer can wire up
// and debug an integration without leaving the site.
async function renderWebhooks() {
  const box = document.getElementById('wh-list');
  if (!box) return;
  const note = (m) => { const n = document.getElementById('wh-note'); if (n) n.textContent = m; };

  let hooks = [];
  try { hooks = (await api('/webhooks')).webhooks || []; }
  catch { box.innerHTML = '<div class="muted">Could not load your endpoints.</div>'; return; }

  box.innerHTML = hooks.length ? hooks.map(h => {
    const health = h.last_delivered_at
      ? (h.last_error ? 'Last delivery failed: ' + escapeHtml(h.last_error) : 'Delivering normally')
      : 'No deliveries yet';
    return '<div class="wh-row' + (h.active ? '' : ' off') + '">'
      + '<div class="wh-url">' + escapeHtml(h.url) + '</div>'
      + '<div class="wh-meta">' + (h.active ? 'Active' : 'Disabled') + ' \u00b7 ' + escapeHtml(health)
      + (h.failure_count ? ' \u00b7 ' + h.failure_count + ' consecutive failures' : '') + '</div>'
      + '<div class="wh-actions">'
      +   '<button class="ghost" data-wh-test="' + h.id + '">Send test</button>'
      +   '<button class="ghost" data-wh-toggle="' + h.id + '" data-active="' + (h.active ? '1' : '0') + '">'
      +     (h.active ? 'Disable' : 'Enable') + '</button>'
      +   '<button class="ghost" data-wh-rotate="' + h.id + '">Rotate secret</button>'
      +   '<button class="ghost danger" data-wh-del="' + h.id + '">Remove</button>'
      + '</div></div>';
  }).join('') : '<div class="muted">No endpoints yet.</div>';

  box.querySelectorAll('[data-wh-test]').forEach(b => b.onclick = async () => {
    try { await api('/webhooks/' + b.dataset.whTest + '/test', { method: 'POST' });
          note('Test event dispatched. Check your endpoint, then reload for delivery status.'); }
    catch { note('Could not dispatch a test event.'); }
  });
  box.querySelectorAll('[data-wh-toggle]').forEach(b => b.onclick = async () => {
    await api('/webhooks/' + b.dataset.whToggle, { method: 'PATCH', body: { active: b.dataset.active !== '1' } }).catch(() => {});
    renderWebhooks();
  });
  box.querySelectorAll('[data-wh-rotate]').forEach(b => b.onclick = async () => {
    try {
      const r = await api('/webhooks/' + b.dataset.whRotate + '/rotate', { method: 'POST' });
      // Shown once. There is no endpoint that will ever return it again.
      note('New signing secret (copy it now, it will not be shown again): ' + r.webhook.secret);
    } catch { note('Could not rotate the secret.'); }
  });
  box.querySelectorAll('[data-wh-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this endpoint? Deliveries to it stop immediately.')) return;
    await api('/webhooks/' + b.dataset.whDel, { method: 'DELETE' }).catch(() => {});
    renderWebhooks();
  });

  const addBtn = document.getElementById('wh-add');
  if (addBtn) addBtn.onclick = async () => {
    const url = (document.getElementById('wh-url').value || '').trim();
    if (!url) { note('Enter an HTTPS URL to send events to.'); return; }
    try {
      const r = await api('/webhooks', { method: 'POST', body: { url } });
      document.getElementById('wh-url').value = '';
      note('Endpoint added. Signing secret (copy it now, it will not be shown again): ' + r.webhook.secret);
      renderWebhooks();
    } catch (e) {
      const msg = {
        https_required: 'Endpoints must use HTTPS.',
        private_address_not_allowed: 'That address is on a private network and cannot be reached.',
        invalid_url: 'That does not look like a URL.',
        too_many_webhooks: 'You already have the maximum of 10 endpoints.',
      };
      note(msg[e && e.error] || 'Could not add that endpoint.');
    }
  };
}


// --- Creator overlay panel --------------------------------------------------
// The URL carries a capability token, so it is treated like a secret: shown on
// request, and rotatable the moment a streamer suspects it has leaked.
async function renderOverlayCard() {
  const box = document.getElementById('ov-body');
  if (!box) return;
  let token = null;
  try { token = (await api('/overlay/token')).token; } catch { box.textContent = 'Could not load.'; return; }

  if (!token) {
    box.innerHTML = '<button class="primary" id="ov-enable">Enable overlay</button>';
    document.getElementById('ov-enable').onclick = async () => {
      await api('/overlay/token', { method: 'POST' }).catch(() => {});
      renderOverlayCard();
    };
    return;
  }

  const url = location.origin + '/overlay.html?t=' + encodeURIComponent(token);
  box.innerHTML = '<div class="ov-url" id="ov-url">' + escapeHtml(url) + '</div>'
    + '<div class="ov-actions">'
    +   '<button class="ghost" id="ov-copy">Copy URL</button>'
    +   '<button class="ghost" id="ov-open">Preview</button>'
    +   '<button class="ghost" id="ov-rotate">Rotate</button>'
    +   '<button class="ghost danger" id="ov-off">Turn off</button>'
    + '</div>'
    + '<div class="muted ov-hint">Anyone with this URL can watch your live session, so treat it like a password. Rotating it breaks any copy you have already shared. Recommended source size: 1920×1080, transparent background.</div>';

  document.getElementById('ov-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); document.getElementById('ov-copy').textContent = 'Copied'; }
    catch { /* clipboard blocked: the URL is on screen to select by hand */ }
  };
  document.getElementById('ov-open').onclick = () => window.open(url, '_blank', 'noopener');
  document.getElementById('ov-rotate').onclick = async () => {
    if (!confirm('Rotate the overlay URL? Any source already using the old one stops working.')) return;
    await api('/overlay/token', { method: 'POST' }).catch(() => {});
    renderOverlayCard();
  };
  document.getElementById('ov-off').onclick = async () => {
    if (!confirm('Turn the overlay off and delete its URL?')) return;
    await api('/overlay/token', { method: 'DELETE' }).catch(() => {});
    renderOverlayCard();
  };
}


// --- Search -----------------------------------------------------------------
// One field across the whole app: people, routes, challenges, groups, videos,
// podcasts and scripture. Results are grouped so it is obvious what a hit is,
// and every row goes somewhere rather than being a dead label.

let searchTimer = null;

const SEARCH_ICONS = {
  people:     '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c0-4.2 3.8-6.2 7.5-6.2s7.5 2 7.5 6.2"/>',
  posts:      '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  journeys:   '<path d="M4 19c3-1 4-5 8-5s5-4 8-5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="9" r="1.6"/>',
  challenges: '<path d="M7 4h10v4a5 5 0 01-10 0V4z"/><path d="M10 15h4v3h-4z"/><path d="M8 21h8"/>',
  groups:     '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3.2 2.8-5 6-5s6 1.8 6 5"/>',
  videos:     '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
  podcasts:   '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  scripture:  '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M12 7v6M9.5 9.5h5"/>',
};

function openSearch() {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
  main.innerHTML = `
    <div class="search-head">
      <button class="ghost back-btn" id="search-back">← Back</button>
    </div>
    <div class="search-field">
      <svg class="search-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
      <input class="input" id="search-input" type="search" autocomplete="off"
             placeholder="Search people, routes, verses…" />
    </div>
    <div id="search-results"><div class="muted search-hint">Search across everything: a person, a route, a challenge, a group, a video, or a verse — try a name, or a phrase like “run with endurance”.</div></div>
  `;
  document.getElementById('search-back').onclick = () => {
    document.querySelectorAll('nav button').forEach(b => b.style.display = '');
    render();
  };
  const input = document.getElementById('search-input');
  input.oninput = () => {
    clearTimeout(searchTimer);
    // Wait for a pause in typing rather than querying on every keystroke.
    searchTimer = setTimeout(() => runSearch(input.value), 220);
  };
  input.focus();
}

async function runSearch(q) {
  const box = document.getElementById('search-results');
  if (!box) return;
  const term = String(q || '').trim();
  if (term.length < 2) {
    box.innerHTML = '<div class="muted search-hint">Keep typing — two characters or more.</div>';
    return;
  }
  let data;
  try { data = await api('/search?q=' + encodeURIComponent(term)); }
  catch { box.innerHTML = '<div class="muted search-hint">Could not search just now.</div>'; return; }

  if (!data.total) {
    box.innerHTML = '<div class="muted search-hint">Nothing matched “' + escapeHtml(term) + '”.</div>';
    return;
  }

  box.innerHTML = data.groups.map(g => '<div class="search-group">'
    + '<div class="search-group-head">' + escapeHtml(g.label) + '</div>'
    + g.items.map(it => '<button class="search-row" data-type="' + g.type + '" data-id="' + escapeHtml(String(it.id)) + '">'
        + '<span class="search-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        + (SEARCH_ICONS[g.type] || '') + '</svg></span>'
        + '<span class="search-row-main"><span class="search-row-title">' + escapeHtml(it.title || '') + '</span>'
        + (it.subtitle ? '<span class="search-row-sub">' + escapeHtml(it.subtitle) + '</span>' : '')
        + '</span></button>').join('')
    + '</div>').join('');

  box.querySelectorAll('.search-row').forEach(row => {
    row.onclick = () => openSearchResult(row.dataset.type, row.dataset.id);
  });
}

function openSearchResult(type, id) {
  document.querySelectorAll('nav button').forEach(b => b.style.display = '');
  const main = document.getElementById('main');
  switch (type) {
    case 'people':     return renderUserProfile(id);
    case 'posts':      state.tab = 'home'; state.feedScope = 'community'; state.homeCache = null; state.searchPostId = id; return render();
    case 'journeys':   return renderJourneyDetail(id);
    case 'scripture':  return renderVerseThread(id);
    case 'challenges': state.tab = 'explore'; state.exploreTab = 'challenges'; return render();
    case 'groups':     state.tab = 'explore'; state.exploreTab = 'groups'; return render();
    case 'videos':     state.tab = 'explore'; state.exploreTab = 'videos'; return render();
    case 'podcasts':   state.tab = 'explore'; state.exploreTab = 'podcasts'; return render();
    default:           return render();
  }
}


// --- Guided breathing --------------------------------------------------------
// A paced session rather than a label that swaps every few seconds: the circle
// moves for the whole length of each phase, so there is something to breathe
// *with*. Timing is driven off the clock rather than an interval count, because
// setInterval drifts and a breathing guide that drifts is worse than none.


// Where the orb starts and ends for each phase.
//
// A phase cannot decide its own size in isolation: a hold has to stay exactly
// where the previous phase left the orb, and consecutive inhales -- the double
// breath's "sip more air" -- have to carry on from the first rather than
// snapping back to the bottom. So consecutive phases of the same kind share one
// span, divided between them in proportion to their length.
const breatheLevelCache = new WeakMap();
function breatheLevels(pattern) {
  const cached = breatheLevelCache.get(pattern);
  if (cached) return cached;

  const SMALL = 0.62, BIG = 1;
  const ph = pattern.phases;
  const out = new Array(ph.length);
  let level = SMALL;
  let i = 0;
  while (i < ph.length) {
    if (ph[i].kind === 'hold') { out[i] = { from: level, to: level }; i++; continue; }
    let j = i, total = 0;
    while (j < ph.length && ph[j].kind === ph[i].kind) { total += ph[j].sec; j++; }
    const target = ph[i].kind === 'in' ? BIG : SMALL;
    const span = target - level;
    let acc = 0;
    for (let k = i; k < j; k++) {
      const from = level + span * (acc / total);
      acc += ph[k].sec;
      out[k] = { from, to: level + span * (acc / total) };
    }
    level = target;
    i = j;
  }
  breatheLevelCache.set(pattern, out);
  return out;
}

// Where the breath is at time t, as pure arithmetic. Kept out of the render
// loop so the pacing can be verified without a visible tab: requestAnimationFrame
// is throttled when the page is hidden, which makes the animation impossible to
// measure from the outside but says nothing about whether the maths is right.
function breatheFrameAt(pattern, t) {
  const cycle = pattern.cycle_sec;
  const into = t % cycle;
  let acc = 0, phase = pattern.phases[0], progress = 0;
  for (const ph of pattern.phases) {
    if (into < acc + ph.sec) { phase = ph; progress = (into - acc) / ph.sec; break; }
    acc += ph.sec;
  }
  // Cosine easing so the turn at the top and bottom of each breath is soft.
  const ease = (x) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, x))) / 2;
  const idx = pattern.phases.indexOf(phase);
  const level = breatheLevels(pattern)[idx];
  const scale = level.from + (level.to - level.from) * ease(progress);
  return {
    kind: phase.kind, label: phase.label, scale, progress,
    remain: Math.ceil(phase.sec - (into - acc)),
    breaths: Math.floor(t / cycle),
  };
}

let breatheSession = null;

function stopBreathe(save) {
  if (!breatheSession) return;
  cancelAnimationFrame(breatheSession.raf);
  const elapsed = Math.round((Date.now() - breatheSession.startedAt) / 1000);
  const key = breatheSession.pattern.key;
  breatheSession = null;
  if (save && elapsed >= 20) {
    api('/breathing/complete', { method: 'POST', body: { pattern: key, duration_sec: elapsed } }).catch(() => {});
  }
  return elapsed;
}

async function renderBreathe(body) {
  stopBreathe(false);
  let patterns = [];
  try { patterns = (await api('/breathing/patterns')).patterns || []; }
  catch { body.innerHTML = '<div class="card glass">Could not load the breathing patterns.</div>'; return; }

  body.innerHTML = '<h2 style="margin-top:0">Breathe</h2>'
    + '<p class="muted" style="margin-top:-6px;margin-bottom:14px">Seven guided patterns. Pick one for where you are — before effort, after it, or at the end of the day.</p>'
    + '<div class="breathe-list">'
    + patterns.map(p => '<button class="breathe-card" data-bkey="' + escapeHtml(p.key) + '">'
        + '<div class="breathe-card-top"><span class="breathe-card-name">' + escapeHtml(p.name) + '</span>'
        + '<span class="breathe-card-rate">' + p.breaths_per_min + '/min</span></div>'
        + '<div class="breathe-card-tag">' + escapeHtml(p.tagline) + '</div>'
        + '<div class="breathe-card-shape">' + p.phases.map(ph =>
            '<span class="bp bp-' + ph.kind + '" style="flex:' + ph.sec + '">' + ph.sec + '</span>').join('')
          + '</div></button>').join('')
    + '</div>';

  body.querySelectorAll('[data-bkey]').forEach(b => {
    b.onclick = () => { breatheCameFrom = {}; startBreathe(body, patterns.find(p => p.key === b.dataset.bkey)); };
  });

  wireHeartCheck(body, patterns);
}

// Context carried from a heart check-in into the pattern it suggested, so the
// verse can take account of a measured delta. Cleared whenever a pattern is
// opened directly — it must never outlive the reading it came from.
let breatheCameFrom = {};

/**
 * The heart check.
 *
 * A heart rate that climbs at a desk, with no effort to explain it, is the
 * third place this app offers scripture. It reports what the strap measured
 * against the member's own resting rate — and nothing else. It does not name a
 * feeling, because it cannot know one, and being told the wrong feeling at a
 * moment like that is worse than being told nothing.
 */
async function wireHeartCheck(body, patterns) {
  const card = document.createElement('div');
  card.className = 'card glass heart-check';
  card.innerHTML =
      '<h3 style="margin:0 0 4px">Heart check</h3>'
    + '<p class="muted" style="font-size:.82rem;margin:0 0 10px">'
    + 'Sitting still and your heart rate is up? Connect a monitor and see what it '
    + 'actually reads against your own resting rate.</p>'
    + '<button class="ghost" id="hc-start">Connect monitor</button>'
    + '<div id="hc-out" style="margin-top:10px"></div>';
  body.appendChild(card);

  const out = document.getElementById('hc-out');
  document.getElementById('hc-start').onclick = async () => {
    const S = window.FunctioningFaithSensors;
    if (!S || !S.connectHr) { out.innerHTML = '<p class="muted">Heart-rate pairing is not available in this browser.</p>'; return; }
    out.innerHTML = '<p class="muted">Pairing…</p>';

    const samples = [];
    try {
      await S.connectHr((r) => { if (r && r.hr) samples.push(r.hr); });
    } catch {
      out.innerHTML = '<p class="muted">No monitor connected.</p>';
      return;
    }

    // Hold for a few seconds: one reading is a twitch, not a state, and the
    // server will refuse to classify a single sample anyway.
    out.innerHTML = '<p class="muted">Reading… hold still for a few seconds.</p>';
    await new Promise(r => setTimeout(r, 8000));
    if (samples.length < 3) { out.innerHTML = '<p class="muted">Not enough readings came through. Try again.</p>'; return; }

    let res;
    try {
      res = await api('/checkin/heart', { method: 'POST', body: {
        hr: samples[samples.length - 1], hr_measured: true,
        recent_hr: samples.slice(-10), moving: false,
      }});
    } catch { out.innerHTML = '<p class="muted">Could not complete the check.</p>'; return; }

    // Nothing measurable: say exactly what is missing rather than softening it.
    if (!res.context) {
      out.innerHTML = '<p class="muted">' + escapeHtml(res.hint || res.reason || 'Nothing to flag.') + '</p>';
      return;
    }

    out.innerHTML =
        '<div class="hc-read"><b>' + escapeHtml(res.label) + '</b>'
      +   '<span class="hc-num">' + res.hr + ' bpm</span></div>'
      + '<div class="muted" style="font-size:.8rem">' + escapeHtml(res.reason) + '</div>'
      + (res.verse ? '<div class="verse-card verse-tappable" style="margin-top:10px" data-verse-ref="'
          + escapeHtml(res.verse.reference) + '">'
          + '<div class="verse-ref">' + escapeHtml(res.verse.reference) + '</div>'
          + '<div class="verse-text">' + escapeHtml(res.verse.text) + '</div>'
          + (res.verse.note ? '<div class="moment-note">' + escapeHtml(res.verse.note) + '</div>' : '')
          + '<div class="verse-convo">💬 Talk about this</div></div>' : '')
      + (res.suggested_pattern ? '<button class="primary" id="hc-breathe" style="margin-top:10px">'
          + 'Breathe · ' + escapeHtml(res.suggested_pattern.name) + '</button>' : '');

    const v = out.querySelector('[data-verse-ref]');
    if (v) v.onclick = () => renderVerseThread(v.dataset.verseRef);

    const go = document.getElementById('hc-breathe');
    if (go) go.onclick = () => {
      // Carry the measured delta — never an interpretation of it — into the
      // breathing screen so its verse can account for why they came.
      breatheCameFrom = { aboveResting: res.above_resting };
      startBreathe(body, patterns.find(p => p.key === res.suggested_pattern.key));
    };
  };
}

function startBreathe(body, pattern) {
  if (!pattern) return;
  const cycle = pattern.cycle_sec;

  body.innerHTML = '<div class="breathe-stage">'
    + '<button class="ghost back-btn" id="br-back">← All patterns</button>'
    + '<h2 class="breathe-title">' + escapeHtml(pattern.name) + '</h2>'
    + '<div class="muted breathe-sub">' + escapeHtml(pattern.about) + '</div>'
    + '<div class="breathe-orb-wrap">'
    +   '<div class="breathe-orb" id="br-orb"><div class="breathe-orb-inner">'
    +     '<div class="breathe-phase" id="br-phase">Ready</div>'
    +     '<div class="breathe-count" id="br-count"></div>'
    +   '</div></div>'
    + '</div>'
    + '<div class="breathe-meta"><span id="br-cycles">0 breaths</span><span id="br-time">0:00</span></div>'
    + '<div class="breathe-controls">'
    +   '<button class="primary" id="br-toggle">Begin</button>'
    + '</div>'
    + (pattern.scripture_ref ? '<div class="verse-card verse-tappable breathe-verse" data-verse-ref="'
        + escapeHtml(pattern.scripture_ref) + '"><div class="verse-ref">' + escapeHtml(pattern.scripture_ref) + '</div>'
        + (pattern.scripture_text ? '<div class="verse-text">' + escapeHtml(pattern.scripture_text) + '</div>' : '')
        + '<div class="verse-convo">\ud83d\udcac Talk about this</div></div>' : '')
    + '</div>';

  document.getElementById('br-back').onclick = () => { stopBreathe(true); renderBreathe(body); };
  const wireVerseTap = () => {
    const v = body.querySelector('[data-verse-ref]');
    if (v) v.onclick = () => { stopBreathe(true); renderVerseThread(v.dataset.verseRef); };
  };
  wireVerseTap();

  // Ask for scripture chosen for what this pattern is *for*, in this member's
  // tradition, rather than the one reference the catalogue ships for everyone.
  // The authored verse above is already on screen, so if this never returns —
  // no credentials, unreachable, failed a check — nothing changes.
  (async () => {
    if (!(await aiAvailable())) return;
    let res;
    try {
      res = await api(`/breathing/${encodeURIComponent(pattern.key)}/verse`, {
        method: 'POST',
        body: { above_resting: breatheCameFrom.aboveResting || null },
      });
    } catch { return; }
    if (!res || res.error || !res.verse || res.verse.chosen_by !== 'gloo') return;
    const card = body.querySelector('.breathe-verse');
    if (!card) return;
    card.dataset.verseRef = res.verse.reference;
    card.innerHTML =
        '<div class="verse-ref">' + escapeHtml(res.verse.reference) + '</div>'
      + '<div class="verse-text">' + escapeHtml(res.verse.text) + '</div>'
      + (res.verse.note ? '<div class="moment-note">' + escapeHtml(res.verse.note) + '</div>' : '')
      + '<div class="verse-convo">💬 Talk about this</div>';
    wireVerseTap();
  })();

  const orb = document.getElementById('br-orb');
  const phaseEl = document.getElementById('br-phase');
  const countEl = document.getElementById('br-count');
  const toggle = document.getElementById('br-toggle');

  toggle.onclick = () => {
    if (breatheSession) {
      const secs = stopBreathe(true);
      toggle.textContent = 'Begin';
      phaseEl.textContent = 'Well done';
      countEl.textContent = secs >= 20 ? 'saved' : '';
      orb.style.transform = 'scale(1)';
      return;
    }
    breatheSession = { pattern, startedAt: Date.now(), raf: 0 };
    toggle.textContent = 'Finish';

    const frame = () => {
      if (!breatheSession) return;
      breatheSession.raf = requestAnimationFrame(frame);
      const t = (Date.now() - breatheSession.startedAt) / 1000;
      const f = breatheFrameAt(pattern, t);

      orb.style.transform = 'scale(' + f.scale.toFixed(3) + ')';
      orb.className = 'breathe-orb ' + f.kind;
      phaseEl.textContent = f.label;
      countEl.textContent = f.remain > 0 ? String(f.remain) : '';

      const breaths = f.breaths;
      document.getElementById('br-cycles').textContent = breaths + (breaths === 1 ? ' breath' : ' breaths');
      const m = Math.floor(t / 60), sec = Math.floor(t % 60);
      document.getElementById('br-time').textContent = m + ':' + String(sec).padStart(2, '0');
    };
    frame();
  };
}


// --- Direct messages ---------------------------------------------------------
// An inbox and a conversation. Polling rather than sockets: this is a single
// Express process on a free tier, and a five-second poll on an open thread is
// honest about what it is rather than pretending to be realtime.

let dmPoll = null;

function openWorkoutInvite(recipientId, recipientName, threadId) {
  document.querySelector('.workout-invite-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'workout-invite-modal';
  modal.innerHTML = `<div class="workout-invite-sheet card glass" role="dialog" aria-modal="true" aria-label="Invite to workout">
    <div class="modal-head"><div><span class="eyebrow">Plan together</span><h2>Invite ${escapeHtml(recipientName || 'your friend')}</h2></div><button class="ghost modal-close" type="button" aria-label="Close">×</button></div>
    <form id="workout-invite-form">
      <label class="field-label">Workout</label>
      <select id="wi-type"><option>Run</option><option>Walk</option><option>Cycle</option><option>Hike</option><option>Strength</option><option>Yoga</option><option>Swim</option><option>Other</option></select>
      <label class="field-label">When (optional)</label><input id="wi-time" type="datetime-local">
      <label class="field-label">Duration (minutes)</label><input id="wi-duration" type="number" min="5" max="1440" placeholder="45">
      <label class="field-label">Where (optional)</label><input id="wi-location" type="text" maxlength="120" placeholder="Park, gym, or video call">
      <label class="field-label">Note (optional)</label><textarea id="wi-note" maxlength="240" rows="3" placeholder="Let’s encourage each other…"></textarea>
      <div id="wi-status" class="muted" aria-live="polite"></div>
      <button class="primary" type="submit" style="width:100%;margin-top:10px">Send workout invite</button>
    </form>
  </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.modal-close').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
  modal.querySelector('#workout-invite-form').onsubmit = async e => {
    e.preventDefault();
    const status = modal.querySelector('#wi-status');
    const submit = modal.querySelector('button[type=submit]');
    submit.disabled = true; status.textContent = 'Sending…';
    try {
      const r = await api('/workout-invites', { method: 'POST', throwOnError: true, body: {
        recipient_id: recipientId, thread_id: threadId,
        workout_type: modal.querySelector('#wi-type').value,
        scheduled_at: modal.querySelector('#wi-time').value || null,
        duration_min: modal.querySelector('#wi-duration').value || null,
        location: modal.querySelector('#wi-location').value,
        note: modal.querySelector('#wi-note').value,
      }});
      status.textContent = 'Invite sent in your messages.';
      setTimeout(() => { close(); if (r.thread_id) renderThread(r.thread_id); }, 450);
    } catch (err) { status.textContent = err.message || 'Could not send the invite.'; submit.disabled = false; }
  };
  modal.querySelector('#wi-type').focus();
}

function stopDmPoll() { if (dmPoll) { clearInterval(dmPoll); dmPoll = null; } }

function dmTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (isNaN(d)) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  if (mins < 1440) return Math.floor(mins / 60) + 'h';
  return Math.floor(mins / 1440) + 'd';
}

async function refreshDmBadge() {
  const btn = document.getElementById('dm-btn');
  const badge = document.getElementById('dm-badge');
  if (!btn || !state.me) return;
  btn.style.display = '';
  try {
    const r = await api('/dms/unread');
    if (r.unread > 0) { badge.style.display = ''; badge.textContent = r.unread > 99 ? '99+' : r.unread; }
    else badge.style.display = 'none';
  } catch { /* the badge is not worth an error */ }
}

async function renderInbox() {
  stopDmPoll();
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
  main.innerHTML = '<div class="search-head"><button class="ghost back-btn" id="dm-back">← Back</button></div>'
    + '<h2 style="margin-top:0">Messages</h2><div id="dm-list" class="muted">Loading…</div>';
  document.getElementById('dm-back').onclick = () => {
    document.querySelectorAll('nav button').forEach(b => b.style.display = '');
    render();
  };

  let data;
  try { data = await api('/dms'); }
  catch { document.getElementById('dm-list').textContent = 'Could not load your messages.'; return; }

  const box = document.getElementById('dm-list');
  if (!data.threads.length) {
    box.innerHTML = '<div class="muted search-hint">No conversations yet. Open someone\u2019s profile and tap Message to start one.</div>';
    return;
  }
  box.innerHTML = data.threads.map(t => '<button class="dm-row' + (t.unread ? ' unread' : '') + '" data-thread="'
      + escapeHtml(t.thread_id) + '">'
    + avatarHtml(t.user, 'avatar-sm')
    + '<span class="dm-row-main">'
    +   '<span class="dm-row-top"><span class="dm-row-name">' + escapeHtml(t.user.display_name) + '</span>'
    +   '<span class="dm-row-time">' + dmTime(t.last_message_at) + '</span></span>'
    +   '<span class="dm-row-last">' + (t.last_from_me ? 'You: ' : '') + escapeHtml(t.last_body || '') + '</span>'
    + '</span>'
    + (t.unread ? '<span class="dm-unread">' + t.unread + '</span>' : '')
    + '</button>').join('');
  hydrateAvatars(box);
  box.querySelectorAll('[data-thread]').forEach(b => b.onclick = () => renderThread(b.dataset.thread));
}

async function openDmWith(userId) {
  try {
    const r = await api('/dms/with/' + encodeURIComponent(userId), { method: 'POST' });
    renderThread(r.thread_id);
  } catch (e) {
    alert(e && e.error === 'blocked' ? 'You cannot message this person.' : 'Could not open that conversation.');
  }
}

function renderWorkoutInviteMessage(m) {
  const d = m.metadata || {};
  const when = d.scheduled_at ? new Date(d.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Time to be decided';
  const details = [when, d.duration_min ? `${d.duration_min} min` : '', d.location].filter(Boolean).join(' · ');
  return '<div class="dm-msg workout-invite-message' + (m.from_me ? ' mine' : '') + '" data-invite-card="' + escapeHtml(d.invite_id || '') + '">' +
    '<div class="workout-invite-card"><div class="eyebrow">Workout invite</div><strong>' + escapeHtml(d.workout_type || 'Workout') + '</strong>' +
    '<div class="workout-invite-meta">' + escapeHtml(details) + '</div>' + (d.note ? '<div class="workout-invite-note">' + escapeHtml(d.note) + '</div>' : '') +
    (!m.from_me && d.invite_id ? '<div class="workout-invite-actions"><button class="primary" data-invite-accept="' + escapeHtml(d.invite_id) + '">Accept</button><button class="ghost" data-invite-decline="' + escapeHtml(d.invite_id) + '">Decline</button></div>' : '') +
    '</div><div class="dm-meta">' + dmTime(m.created_at) + '</div></div>';
}

function renderVerseMessage(m) {
  const d = m.metadata || {};
  return '<div class="dm-msg verse-dm-message' + (m.from_me ? ' mine' : '') + '">' +
    '<div class="verse-dm-card"><div class="eyebrow">Scripture shared with you</div>' +
    '<div class="verse-ref">' + escapeHtml(d.reference || 'Bible verse') + '</div>' +
    '<div class="verse-text">' + escapeHtml(d.text || '') + '</div>' +
    '<div class="verse-dm-actions"><button class="primary" data-open-shared-verse="' + escapeHtml(d.reference || '') + '">Open verse</button><button class="ghost" data-copy-shared-verse="' + escapeHtml(d.reference || '') + '">Copy link</button></div>' +
    '</div><div class="dm-meta">' + dmTime(m.created_at) + '</div></div>';
}

function wireVerseDmCards(root) {
  root.querySelectorAll('[data-open-shared-verse]').forEach(btn => btn.onclick = () => renderVerseThread(btn.dataset.openSharedVerse));
  root.querySelectorAll('[data-copy-shared-verse]').forEach(btn => btn.onclick = () => shareVerseLink(btn.dataset.copySharedVerse));
}

function wireWorkoutInviteCards(root) {
  root.querySelectorAll('[data-invite-accept],[data-invite-decline]').forEach(btn => {
    btn.onclick = async () => {
      const accept = !!btn.dataset.inviteAccept;
      try {
        await api('/workout-invites/' + encodeURIComponent(btn.dataset.inviteAccept || btn.dataset.inviteDecline) + '/respond', { method: 'POST', throwOnError: true, body: { accept } });
        btn.closest('.workout-invite-actions').innerHTML = '<span class="muted">' + (accept ? 'Accepted' : 'Declined') + '</span>';
      } catch (e) { showToast(e.message || 'Could not respond to invite.', true); }
    };
  });
}

async function renderThread(threadId) {
  stopDmPoll();
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');

  let data;
  try { data = await api('/dms/' + encodeURIComponent(threadId)); }
  catch { main.innerHTML = '<div class="card glass">This conversation is not available.</div>'; return; }

  main.innerHTML = '<div class="dm-head">'
    +   '<button class="ghost back-btn" id="dm-back">←</button>'
    +   avatarHtml(data.user, 'avatar-sm')
    +   '<span class="dm-head-name">' + escapeHtml(data.user.display_name) + '</span>'
    +   (!data.blocked ? '<button class="primary dm-invite" id="dm-invite">Invite</button><button class="ghost dm-verse" id="dm-verse">Verse</button>' : '')
    +   '<button class="ghost dm-block" id="dm-block">' + (data.blocked ? 'Unblock' : 'Block') + '</button>'
    + '</div>'
    + '<div class="dm-scroll" id="dm-scroll"></div>'
    + (data.blocked
        ? '<div class="muted dm-blocked-note">Messages are turned off between you and this person.</div>'
        : '<form class="dm-compose" id="dm-form">'
          + '<input class="input" id="dm-input" placeholder="Write a message…" maxlength="2000" autocomplete="off" />'
          + '<button class="primary" id="dm-send" type="submit">Send</button></form>');

  document.getElementById('dm-back').onclick = () => renderInbox();
  hydrateAvatars(main);

  const scroll = document.getElementById('dm-scroll');
  let lastId = null;

  const paint = (msgs) => {
    scroll.innerHTML = msgs.map(m => (m.kind === 'workout_invite' && m.metadata)
      ? renderWorkoutInviteMessage(m)
      : (m.kind === 'verse' && m.metadata) ? renderVerseMessage(m)
      : '<div class="dm-msg' + (m.from_me ? ' mine' : '') + '">'
      + '<div class="dm-bubble">' + escapeHtml(m.body) + '</div>'
      + '<div class="dm-meta">' + dmTime(m.created_at) + (m.from_me && m.read ? ' · read' : '') + '</div></div>').join('');
    if (msgs.length) lastId = msgs[msgs.length - 1].id;
    scroll.scrollTop = scroll.scrollHeight;
  };
  paint(data.messages);
  wireVerseDmCards(scroll);

  const inviteButton = document.getElementById('dm-invite');
  if (inviteButton) inviteButton.onclick = () => openWorkoutInvite(data.user.id, data.user.display_name, threadId);
  const verseButton = document.getElementById('dm-verse');
  if (verseButton) verseButton.onclick = async () => {
    const reference = prompt('Which verified verse should you send? Example: Philippians 4:13');
    if (!reference) return;
    try { await api(`/dms/${encodeURIComponent(threadId)}/verse`, { method: 'POST', body: { reference } }); const fresh = await api(`/dms/${encodeURIComponent(threadId)}`); paint(fresh.messages); wireVerseDmCards(scroll); }
    catch (e) { showToast(e.error === 'verse_not_found' ? 'That verse could not be verified.' : 'Could not send that verse.', true); }
  };
  wireWorkoutInviteCards(scroll);

  const blockBtn = document.getElementById('dm-block');
  blockBtn.onclick = async () => {
    const blocking = blockBtn.textContent === 'Block';
    if (blocking && !confirm('Block ' + data.user.display_name + '? Neither of you will be able to message the other.')) return;
    await api('/dms/block/' + encodeURIComponent(data.user.id), { method: blocking ? 'POST' : 'DELETE' }).catch(() => {});
    renderThread(threadId);
  };

  const form = document.getElementById('dm-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const input = document.getElementById('dm-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        await api('/dms/' + encodeURIComponent(threadId), { method: 'POST', body: { body: text } });
        const fresh = await api('/dms/' + encodeURIComponent(threadId));
        paint(fresh.messages);
      } catch (err) {
        input.value = text;      // put it back rather than losing what they typed
        alert(err && err.error === 'blocked' ? 'Messages are turned off between you.' : 'Could not send that.');
      }
    };
  }

  // Poll for the other side's replies while the thread is open.
  dmPoll = setInterval(async () => {
    if (!document.getElementById('dm-scroll')) { stopDmPoll(); return; }
    try {
      const fresh = await api('/dms/' + encodeURIComponent(threadId));
      const newest = fresh.messages.length ? fresh.messages[fresh.messages.length - 1].id : null;
      if (newest !== lastId) { paint(fresh.messages); wireWorkoutInviteCards(scroll); wireVerseDmCards(scroll); }
    } catch { /* keep the thread open; the next tick retries */ }
  }, 5000);
}


// Mirrors the server's route trim so the preview shows exactly what will be
// published rather than the full trace.
function trimRouteClient(points, metres) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const m = Math.max(0, Number(metres) || 0);
  if (!m) return points;
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineKm(points[i - 1], points[i]) * 1000);
  const total = cum[cum.length - 1];
  if (total <= m * 2.5) return null;
  const kept = points.filter((_, i) => cum[i] >= m && cum[i] <= total - m);
  return kept.length >= 2 ? kept : null;
}


// --- Your own workouts -------------------------------------------------------
// A workout used to be write-only: you could record one and never see it again
// unless you posted it. This is the log, and the detail behind each entry.

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
  if (m) return m + 'm ' + String(ss).padStart(2, '0') + 's';
  return ss + 's';
}

function fmtPace(minPerKm) {
  if (!Number.isFinite(minPerKm) || minPerKm <= 0) return null;
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return m + ':' + String(s === 60 ? 0 : s).padStart(2, '0');
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
  if (isNaN(d)) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return 'Today · ' + time;
  if (days === 1) return 'Yesterday · ' + time;
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' }) + ' · ' + time;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

let workoutLogCursor = null;

async function renderWorkoutLog(mount, append) {
  if (!mount) return;
  if (!append) {
    mount.innerHTML = '<h2 style="margin:18px 0 4px">Your workouts</h2>'
      + '<div class="muted" style="margin-bottom:10px;font-size:.85rem">Everything you have recorded, posted or not.</div>'
      + '<div id="wlog-list" class="muted">Loading…</div>';
    workoutLogCursor = null;
  }
  const list = document.getElementById('wlog-list');
  if (!list) return;

  let data;
  try { data = await api('/workouts' + (workoutLogCursor ? '?before=' + encodeURIComponent(workoutLogCursor) : '')); }
  catch { list.innerHTML = '<div class="muted">Could not load your workouts.</div>'; return; }

  if (!append && !data.workouts.length) {
    list.innerHTML = '<div class="muted search-hint">No workouts yet. Track one from the Train tab, or log one you did off-app.</div>';
    return;
  }

  const rows = data.workouts.map(w => {
    const bits = [];
    if (w.distance_km > 0) bits.push(fmtKm(w.distance_km) + ' km');
    bits.push(fmtDuration(w.duration_sec));
    const pace = fmtPace(w.pace_min_per_km);
    if (pace) bits.push(pace + ' /km');
    if (w.avg_hr) bits.push(w.avg_hr + ' bpm');
    return '<button class="wlog-row" data-workout="' + escapeHtml(w.id) + '">'
      + '<span class="wlog-main">'
      +   '<span class="wlog-top"><span class="wlog-type">' + escapeHtml(w.type || 'Workout') + '</span>'
      +   '<span class="wlog-when">' + escapeHtml(fmtWhen(w.start_time)) + '</span></span>'
      +   '<span class="wlog-stats">' + bits.join(' · ') + '</span>'
      + '</span>'
      + '<span class="wlog-flags">'
      +   (w.peak_zone ? '<span class="wlog-zone z' + w.peak_zone + '">Z' + w.peak_zone + '</span>' : '')
      +   (w.has_route ? '<span class="wlog-flag" title="Has a recorded route">◠</span>' : '')
      +   (w.shared ? '<span class="wlog-flag" title="Shared to your feed">✓</span>' : '')
      + '</span></button>';
  }).join('');

  if (append) {
    const more = document.getElementById('wlog-more');
    if (more) more.remove();
    list.insertAdjacentHTML('beforeend', rows);
  } else {
    list.innerHTML = rows;
  }

  workoutLogCursor = data.next_before;
  if (workoutLogCursor) {
    list.insertAdjacentHTML('beforeend',
      '<button class="ghost" id="wlog-more" style="width:100%;margin-top:8px">Show older</button>');
    document.getElementById('wlog-more').onclick = () => renderWorkoutLog(mount, true);
  }

  list.querySelectorAll('[data-workout]').forEach(b => {
    b.onclick = () => renderWorkoutDetail(b.dataset.workout);
  });
}

// A small heart-rate trace. Drawn only from samples that exist.
function hrTraceSvg(samples, maxRef) {
  if (!Array.isArray(samples) || samples.length < 3) return '';
  const hrs = samples.map(s => s.hr).filter(Number.isFinite);
  if (hrs.length < 3) return '';
  const lo = Math.min(...hrs), hi = Math.max(...hrs);
  const span = Math.max(8, hi - lo);
  const W = 300, H = 64;
  const pts = hrs.map((hr, i) => {
    const x = (i / (hrs.length - 1)) * W;
    const y = H - ((hr - lo) / span) * (H - 6) - 3;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  return '<svg class="hr-trace" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
    + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--seal,#a2472f)" '
    +   'stroke-width="1.8" stroke-linejoin="round"/></svg>'
    + '<div class="hr-trace-scale"><span>' + lo + '</span><span>'
    + (maxRef ? 'max ref ' + maxRef : '') + '</span><span>' + hi + '</span></div>';
}

function zoneBars(tiz) {
  if (!tiz) return '';
  const total = Object.values(tiz).reduce((a, b) => a + (Number(b) || 0), 0);
  if (!total) return '';
  return '<div class="zone-bars">' + [1, 2, 3, 4, 5].map(z => {
    const sec = Number(tiz[z]) || 0;
    const pct = Math.round((sec / total) * 100);
    return '<div class="zone-bar-row"><span class="zone-bar-label">Z' + z + '</span>'
      + '<span class="zone-bar-track"><span class="zone-bar-fill z' + z + '" style="width:' + pct + '%"></span></span>'
      + '<span class="zone-bar-val">' + (sec ? Math.round(sec / 60) + 'm' : '—') + '</span></div>';
  }).join('') + '</div>';
}

async function renderWorkoutDetail(id) {
  const main = document.getElementById('main');
  document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
  main.innerHTML = '<div class="card glass" style="text-align:center">Loading…</div>';

  let d;
  try { d = await api('/workouts/' + encodeURIComponent(id)); }
  catch {
    main.innerHTML = '<button class="ghost back-btn" id="wd-back">← Back</button>'
      + '<div class="card glass">That workout is not available.</div>';
    document.getElementById('wd-back').onclick = () => { state.tab = 'stats'; document.querySelectorAll('nav button').forEach(b => b.style.display = ''); render(); };
    return;
  }
  const w = d.workout;
  const pace = fmtPace(w.pace_min_per_km);

  const stat = (v, l) => '<div class="wd-stat"><div class="wd-stat-v">' + v + '</div><div class="wd-stat-l">' + l + '</div></div>';

  main.innerHTML = '<button class="ghost back-btn" id="wd-back">← Back</button>'
    + '<div class="card glass">'
    +   '<div class="wd-head"><h2 style="margin:0">' + escapeHtml(w.type || 'Workout') + '</h2>'
    +   '<span class="muted">' + escapeHtml(fmtWhen(w.start_time)) + '</span></div>'
    +   (w.note ? '<div class="wd-note">' + escapeHtml(w.note) + '</div>' : '')
    +   '<div class="wd-stats">'
    +     stat(w.distance_km > 0 ? fmtKm(w.distance_km) : '—', 'km')
    +     stat(fmtDuration(w.duration_sec), 'time')
    +     stat(pace || '—', 'pace /km')
    +     stat(w.avg_hr || '—', 'avg bpm')
    +     stat(w.max_hr || '—', 'max bpm')
    +     stat(w.effort_score != null ? w.effort_score : '—', 'effort')
    +   '</div>'
    +   (d.route ? '<div class="route-banner wd-route">' + realRouteSvg(d.route) + '</div>'
                 : '<div class="muted wd-none">No route was recorded for this one.</div>')
    +   (d.hr_samples.length
          ? '<h3 class="wd-sub">Heart rate</h3>'
            + hrTraceSvg(d.hr_samples, d.max_hr_reference ? d.max_hr_reference.value : null)
            + zoneBars(d.time_in_zone)
          : '<div class="muted wd-none">No heart-rate data — nothing was connected for this session.</div>')
    +   (d.partners.length
          ? '<h3 class="wd-sub">With</h3><div class="wd-partners">'
            + d.partners.map(p => '<span class="wd-partner">' + escapeHtml(p.display_name)
              + (p.status === 'pending' ? ' <span class="muted">(pending)</span>' : '') + '</span>').join('')
            + '</div>'
          : '')
    +   '<div class="wd-actions">'
    +     (d.post
            ? '<span class="muted" style="font-size:.82rem">Shared to your feed · ' + escapeHtml(d.post.visibility) + '</span>'
            : '<button class="primary" id="wd-share">Share this</button>')
    +     '<button class="ghost danger" id="wd-delete">Delete</button>'
    +   '</div>'
    + '</div>';

  document.getElementById('wd-back').onclick = () => {
    state.tab = 'stats';
    document.querySelectorAll('nav button').forEach(b => b.style.display = '');
    render();
  };
  const shareBtn = document.getElementById('wd-share');
  if (shareBtn) shareBtn.onclick = () => {
    // The share screen builds its own summary from the workout it is given.
    document.querySelectorAll('nav button').forEach(b => b.style.display = 'none');
    renderShareForm(main, { workoutId: w.id, summary: {
      type: w.type, distance_km: w.distance_km, duration_sec: w.duration_sec,
      calories: w.calories, avg_hr: w.avg_hr,
    }, distanceKm: w.distance_km });
  };
  document.getElementById('wd-delete').onclick = async () => {
    if (!confirm('Delete this workout? Its heart-rate data and route go with it. This cannot be undone.')) return;
    await api('/workouts/' + encodeURIComponent(w.id), { method: 'DELETE' }).catch(() => {});
    state.tab = 'stats';
    document.querySelectorAll('nav button').forEach(b => b.style.display = '');
    render();
  };
}


// --- Reading a verse in other translations -----------------------------------
// The local library is 22 books of verified public-domain text and stays the
// default, because it is checked and needs no network. The YouVersion Platform
// adds the rest of the canon and ten more English translations, from the people
// who publish them.
//
// Nothing here ever writes text of its own: a translation that will not resolve
// says so and the reading stays as it was.
async function wireTranslationSwitcher(reference) {
  const sel = document.getElementById('yv-translation');
  const textEl = document.getElementById('yv-text');
  const openEl = document.getElementById('yv-open');
  const noteEl = document.getElementById('yv-note');
  if (!sel || !textEl) return;

  const original = textEl.textContent;
  let info = null;
  try { info = await api('/bible/versions'); } catch { return; }

  // Always offer the link out, even with no key: it needs no API call.
  try {
    const probe = await api('/bible/passage?ref=' + encodeURIComponent(reference));
    if (probe && probe.youversion_url && openEl) {
      openEl.href = probe.youversion_url;
      openEl.hidden = false;
    }
  } catch { /* the link is a nicety, not a requirement */ }

  if (!info || !info.configured || !info.versions.length) {
    // No platform key: one option, and no pretence that there are more.
    sel.disabled = true;
    return;
  }

  for (const v of info.versions) {
    const opt = document.createElement('option');
    opt.value = String(v.id);
    opt.textContent = (v.abbreviation || ('#' + v.id)) + ' — ' + (v.title || '');
    sel.appendChild(opt);
  }

  sel.onchange = async () => {
    if (!sel.value) {                       // back to the verified local text
      textEl.textContent = original;
      noteEl.textContent = '';
      if (openEl) openEl.href = 'https://www.bible.com/bible/' + info.default_version_id + '/';
      return;
    }
    noteEl.textContent = 'Loading…';
    try {
      const r = await api('/bible/passage?ref=' + encodeURIComponent(reference) + '&version=' + sel.value);
      textEl.textContent = r.text;
      noteEl.textContent = (r.translation || 'Translation') + ' · via YouVersion';
      if (openEl && r.youversion_url) { openEl.href = r.youversion_url; openEl.hidden = false; }
    } catch {
      // Put the reading back rather than leaving a gap or a guess.
      textEl.textContent = original;
      sel.value = '';
      noteEl.textContent = 'That translation is not available for this verse.';
    }
  };
}
