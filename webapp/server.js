const express = require('express');
const compression = require('compression');
const path = require('path');
const cookieSession = require('cookie-session');
const { seed } = require('./lib/seed');
const apiRoutes = require('./routes/api');
const { startPodcastRefresh } = require('./lib/podcasts');
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

seed();
// Create the webhook tables and attach the dispatcher to the domain event bus.
developerWebhooks.start();
segments.init();
overlay.init();
// Names are unique from here on; existing duplicates are reported, not renamed.
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
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), bluetooth=(self)');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
// Photos are resized in the browser before being sent as a data URL. Keep the
// parser above the 250KB image cap so valid photo posts reach the route.
app.use(express.json({ limit: '400kb' }));
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

// Public, unauthenticated share page for a public workout (like a Strava activity
// link). Serves a standalone page that fetches /api/public/post/:id client-side.
app.get('/w/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'share.html')));
// Keep the human-friendly docs URL aligned with the links inside the app.
app.get('/developers', (req, res) => res.sendFile(path.join(__dirname, 'public', 'developers.html')));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath, stat) {
    // Every cacheable script/style in index.html carries a version query. It
    // is therefore safe to retain it for a year and avoid re-downloading the
    // app bundle on every visit. The service worker itself must always update.
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (res.req && res.req.query && res.req.query.v && /\.(?:js|css|png|svg|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'functioning-faith-webapp' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Functioning Faith webapp listening on ${PORT}`));
