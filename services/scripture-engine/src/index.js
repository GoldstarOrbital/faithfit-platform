const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'scripture-engine' }));
app.use('/api/scripture-engine', routes);

const PORT = process.env.PORT || 4005;
app.listen(PORT, () => console.log('[scripture-engine] listening on ' + PORT));

module.exports = app;
