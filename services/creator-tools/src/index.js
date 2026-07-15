const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'creator-tools' }));
app.use('/api/creator-tools', routes);

const PORT = process.env.PORT || 4011;
app.listen(PORT, () => console.log('[creator-tools] listening on ' + PORT));

module.exports = app;
