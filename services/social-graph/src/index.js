const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'social-graph' }));
app.use('/api/social-graph', routes);

const PORT = process.env.PORT || 4007;
app.listen(PORT, () => console.log('[social-graph] listening on ' + PORT));

module.exports = app;
