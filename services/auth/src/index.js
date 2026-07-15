const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'auth' }));
app.use('/api/auth', routes);

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log('[auth] listening on ' + PORT));

module.exports = app;
