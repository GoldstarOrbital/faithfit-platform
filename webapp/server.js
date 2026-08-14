const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const cookieSession = require('cookie-session');
const db = require('./lib/db');
const { seed } = require('./lib/seed');
const apiRoutes = require('./routes/api');
const { startPodcastRefresh } = require('./lib/podcasts');
const { startNewsRefresh } = require('./lib/news');
const youtube = require('./lib/youtube');
const { startVideoLibraryRefresh } = require('./lib/videos');
const developerWebhooks = require('./lib/webhooks');
const segments = require('./lib/segments');
const overlay = require('./lib/overlay');
const usernames = require('./lib/usernames');
const dms = require('./lib/dms');
const youversion = require('./lib/youversion');
const gloo = require('./lib/gloo');
const apikeys = require('./lib/apikeys');
const push = require('./lib/push');
const daily = require('./lib/daily');
const reminders = require('./lib/reminders');
const publicApi = require('./routes/public-api');
const reels = require('./lib/reels');
const accountSecurity = require('./lib/account-security');
const developerVerification = require('./lib/developer-verification');
const media = require('./lib/media');
const retention = require('./lib/retention');
const admin = require('./lib/admin');
const visits = require('./lib/visits');
const launchNotify = require('./lib/launch-notify');
const athletes = require('./lib/athletes');
const coaches = require('./lib/coaches');
const schools = require('./lib/schools');
const mentions = require('./lib/mentions');
const workoutKudos = require('./lib/workout-kudos');

seed();
accountSecurity.init();
admin.init();
admin.ensureAdmin();
visits.init();
launchNotify.init();
athletes.init();
coaches.init();
schools.init();
mentions.init();
workoutKudos.init();
developerVerification.init();
developerVerification.startNotifications();
// Create the webhook tables and attach the dispatcher to the domain event bus.
developerWebhooks.start();
segments.init();
overlay.init();
// Every account gets a real, unique display name -- blanks are backfilled
// and any pre-existing duplicate is disambiguated (oldest account keeps the
// name) -- before the uniqueness rule is enforced at the database level.
usernames.backfillAndDedup();
usernames.ensureUniqueIndex();
dms.init();
// YouVersion Platform: lifts scripture beyond the 22 locally ingested books.
youversion.start();
// Gloo AI: values-aligned inference, shaped by each member's tradition. It
// chooses scripture and writes around it; YouVersion above supplies the text.
gloo.start();
// The public developer API: other software can ask this app for scripture that
// fits a moment, with the same guarantees the app gives its own members.
apikeys.init();
// Off-app reach. Both are inert without VAPID keys — no timer, nothing sent.
// Reels: ingest the curated catalogue from real YouTube searches, screen it,
// and keep checking that what we stored still plays.
reels.start();
push.start();
daily.start();
reminders.start();
// Ingest real podcast episodes from public RSS feeds (background, non-blocking).
startPodcastRefresh();
startNewsRefresh();
media.init();
retention.start();
// Church devotionals from YouTube — true no-op (not even a timer) unless
// Alex has set YOUTUBE_API_KEY, since it requires his own Google Cloud project.
if (youtube.isConfigured()) youtube.startDevotionalRefresh();
// Curated video library — same YOUTUBE_API_KEY gate, true no-op when unset.
if (youtube.isConfigured()) startVideoLibraryRefresh();

const app = express();
const productionMode = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const sessionSecret = process.env.SESSION_SECRET || (productionMode ? null : 'faithfit-local-session-secret');
if (!sessionSecret) throw new Error('SESSION_SECRET must be configured in production');
// Railway terminates TLS in front of the app — trust its X-Forwarded-* headers
// so req.protocol/req.secure and the OAuth redirect_uri we build are correct.
app.set('trust proxy', 1);
// Compress JavaScript, CSS, JSON, and HTML before they leave Railway. This is
// especially valuable on first load because the main client bundle is large
// enough that transfer time is visible on cellular connections.
app.use(compression());
// Baseline browser protections compatible with YouTube, Leaflet, OAuth, and
// the service-worker surfaces used by the app.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Camera and microphone remain opt-in browser permissions. They are enabled
  // only for Functioning Faith itself so the Reels studio can record a short
  // clip after a member explicitly chooses "Record".
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), bluetooth=(self)');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (productionMode) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; media-src 'self' data: https:; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com; connect-src 'self' https://*.googleapis.com https://api.gloo.us https://api.scripture.api.bible; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com https://appleid.apple.com; frame-ancestors 'self'");
  next();
});
// Photos are resized in the browser before being sent as a data URL. Keep the
// parser above the 250KB image cap so valid photo posts reach the route.
// Photos stay tiny, but a verified short MP4/WebM can be up to 4MB. The media
// validator is still the authority on type, duration, and exact byte cap.
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: false })); // Apple posts its OAuth callback as form_post
app.use(cookieSession({
  name: 'faithfit_session',
  keys: [sessionSecret],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: productionMode,
}));

// API data is private and mostly live. Keep a short browser cache only for
// read-only discovery/feed responses; never let a shared proxy cache member
// data, mutations, GPS telemetry, DMs, or notifications.
app.use('/api', (req, res, next) => {
  const shortLived = req.method === 'GET' && /^\/(feed|users(?:\/suggested)?|recommendations|devotionals\/today|church\/videos|explore|reels|videos)(?:\/|\?|$)/.test(req.path);
  res.setHeader('Cache-Control', shortLived
    ? 'private, max-age=15, stale-while-revalidate=45'
    : 'no-store');
  next();
});
app.use('/api', apiRoutes);
// Versioned and separate from /api, because this one is a public contract:
// /api may change with the app, /v1 may not.
app.use('/v1', publicApi);

// Public, unauthenticated share pages are acquisition surfaces as well as a
// member feature. Render their metadata on the server so social crawlers get a
// truthful preview without receiving private profiles, routes, health data, or
// raw photos. The interactive body still fetches the public payload after load.
const shareTemplate = fs.readFileSync(path.join(__dirname, 'public', 'share.html'), 'utf8');
const escapeMeta = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
function publicShareMeta(id) {
  const row = db.prepare(`SELECT p.id,p.content,p.created_at,u.display_name author,w.type workout_type,
      v.reference verse_reference,v.text verse_text
    FROM posts p JOIN users u ON u.id=p.user_id
    LEFT JOIN workouts w ON w.id=p.workout_id LEFT JOIN scripture_verses v ON v.id=p.verse_id
    WHERE p.id=? AND p.visibility='public'`).get(id);
  if (!row) return null;
  const activity = row.workout_type || 'faith + fitness update';
  const title = `${row.author}'s ${activity} | Functioning Faith`;
  const summary = String(row.content || row.verse_text || `A shared ${activity.toLowerCase()} from the Functioning Faith community.`)
    .replace(/\s+/g, ' ').trim().slice(0, 180);
  return { ...row, title, summary };
}
function publicOrigin(req) {
  return String(process.env.PUBLIC_APP_URL || 'https://faithfit-demo-production.up.railway.app').replace(/\/$/, '');
}
function renderedSharePage(req, meta) {
  const origin = publicOrigin(req), url = `${origin}/w/${encodeURIComponent(meta.id)}`;
  return shareTemplate
    .replaceAll('{{SHARE_TITLE}}', escapeMeta(meta.title))
    .replaceAll('{{SHARE_DESCRIPTION}}', escapeMeta(meta.summary))
    .replaceAll('{{SHARE_URL}}', escapeMeta(url))
    .replaceAll('{{SHARE_CARD_URL}}', escapeMeta(`${url}/card.svg`));
}
app.get('/w/:id/card.svg', (req, res) => {
  const meta = publicShareMeta(req.params.id);
  if (!meta) return res.status(404).type('text/plain').send('Not found');
  const title = escapeMeta(meta.workout_type ? `${meta.author} completed a ${meta.workout_type}` : `${meta.author} shared a faith + fitness moment`);
  const copy = escapeMeta(meta.summary.slice(0, 116));
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${title}">
    <rect width="1200" height="630" fill="#f6efdf"/><path d="M0 470 C260 380 380 570 620 465 S930 365 1200 450 V630 H0Z" fill="#e7c477" opacity=".48"/>
    <circle cx="106" cy="110" r="51" fill="none" stroke="#2b1e14" stroke-width="13" stroke-dasharray="145 176" transform="rotate(96 106 110)"/><path d="M119 69V151M89 103H139" stroke="#d9ab55" stroke-width="13" stroke-linecap="round"/>
    <text x="180" y="125" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="700" fill="#2b1e14">Functioning Faith</text>
    <text x="90" y="270" font-family="Arial,Helvetica,sans-serif" font-size="60" font-weight="700" fill="#2b1e14">${title}</text>
    <foreignObject x="90" y="315" width="1020" height="170"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:1.35;color:#574535">${copy}</div></foreignObject>
    <text x="90" y="560" font-family="Arial,Helvetica,sans-serif" font-size="30" fill="#574535">Faith and fitness, together</text>
  </svg>`);
});
app.get('/w/:id', (req, res) => {
  const meta = publicShareMeta(req.params.id);
  if (!meta) return res.status(404).type('html').send('<!doctype html><title>Not available | Functioning Faith</title><main><h1>Not available</h1><p>This share is private or no longer available.</p></main>');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(renderedSharePage(req, meta));
});
// Keep the human-friendly docs URL aligned with the links inside the app.
app.get('/developers', (req, res) => res.sendFile(path.join(__dirname, 'public', 'developers.html')));

// The real front door. Explicit route (ahead of express.static's implicit
// index.html fallthrough below) purely so visit-tracking has somewhere to
// attach that fires once per real page load -- never on the API calls or
// asset requests that page load then makes.
app.get('/', (req, res, next) => {
  // The owner's own browsing (testing features, checking the live site)
  // would otherwise inflate "unique visitors" with traffic that isn't a
  // real prospective member. Anyone signed in as an admin is skipped --
  // no visitor cookie set, no row recorded -- everyone else is tracked
  // exactly as before, signed in or not.
  const uid = req.session && req.session.userId;
  if (uid && admin.isAdmin(uid)) return next();
  return visits.track(req, res, next);
}, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath, stat) {
    // Every cacheable script/style in index.html carries a version query. It
    // is therefore safe to retain it for a year and avoid re-downloading the
    // app bundle on every visit. The service worker itself must always update.
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (res.req && res.req.query && res.req.query.v && /\.(?:js|css|png|svg|woff2?|mp4|ogg)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'functioning-faith-webapp' }));

const PORT = process.env.PORT || 3000;
const httpServer = app.listen(PORT, () => console.log(`Functioning Faith webapp listening on ${PORT}`));

// Railway (and any container platform) sends SIGTERM to the OLD instance the
// moment a new deploy is ready to cut over -- completely normal, on every
// single deploy. Without a handler, Node's default action for SIGTERM is to
// terminate immediately, which the npm wrapper around `node server.js`
// reports as "npm error signal SIGTERM" / "command failed". That npm-level
// error is what Railway's crash detection was alerting on -- a false
// positive on ordinary redeploy traffic, not an actual application crash.
// Confirmed by reading the previous deployment's own logs: the sequence was
// "Stopping Container" -> SIGTERM -> npm logging it as a failure, with
// nothing resembling a real exception anywhere above it.
// Exiting 0 in response to SIGTERM makes this a normal, clean shutdown
// instead of a signal-killed one.
function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down cleanly`);
  httpServer.close(() => process.exit(0));
  // Railway gives a limited grace period before SIGKILL; do not wait
  // indefinitely on close() (e.g. a slow-draining keep-alive connection).
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
