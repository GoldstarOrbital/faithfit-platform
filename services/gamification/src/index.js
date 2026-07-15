const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'gamification' }));
app.use('/api/gamification', routes);

const PORT = process.env.PORT || 4008;
app.listen(PORT, () => console.log('[gamification] listening on ' + PORT));

module.exports = app;
