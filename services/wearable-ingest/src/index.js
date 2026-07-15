const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'wearable-ingest' }));
app.use('/api/wearable-ingest', routes);

const PORT = process.env.PORT || 4004;
app.listen(PORT, () => console.log('[wearable-ingest] listening on ' + PORT));

module.exports = app;
