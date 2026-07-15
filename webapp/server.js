const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const { seed } = require('./lib/seed');
const apiRoutes = require('./routes/api');

seed();

const app = express();
app.use(express.json());
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

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'faithfit-webapp' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FaithFit webapp listening on ${PORT}`));
