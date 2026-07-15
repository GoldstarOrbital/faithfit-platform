const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'notification' }));
app.use('/api/notification', routes);

const PORT = process.env.PORT || 4009;
app.listen(PORT, () => console.log('[notification] listening on ' + PORT));

module.exports = app;
