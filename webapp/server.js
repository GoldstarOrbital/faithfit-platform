const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const { seed } = require('./lib/seed');
const apiRoutes = require('./routes/api');
const { startPodcastRefresh } = require('./lib/podcasts');
const youtube = require('./lib/youtube');
const { startVideoLibraryRefresh } = require('./lib/videos');

seed();
// Ingest real podcast episodes from public RSS feeds (background, non-blocking).
startPodcastRefresh();
// Church devotionals from YouTube — true no-op (not even a timer) unless
// Alex has set YOUTUBE_API_KEY, since it requires his own Google Cloud project.
if (youtube.isConfigured()) youtube.startDevotionalRefresh();
// Curated video library — same YOUTUBE_API_KEY gate, true no-op when unset.
if (youtube.isConfigured()) startVideoLibraryRefresh();

const app = express();
// Railway terminates TLS in front of the app — trust its X-Forwarded-* headers
// so req.protocol/req.secure and the OAuth redirect_uri we build are correct.
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Apple posts its OAuth callback as form_post
app.use(cookieSession({
  name: 'faithfit_session',
  keys: [process.env.SESSION_SECRET || 'faithfit-demo-secret-change-in-real-deploy'],
  maxAge: 30 * 24 * 60 * 60 * 1000,
}));

app.use('/api', apiRoutes);

// Public, unauthenticated share page for a public workout (like a Strava activity
// link). Serves a standalone page that fetches /api/public/post/:id client-side.
app.get('/w/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'share.html')));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'fitfaith-webapp' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FitFaith webapp listening on ${PORT}`));
