const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'media' }));
app.use('/api/media', routes);

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => console.log('[media] listening on ' + PORT));

module.exports = app;
