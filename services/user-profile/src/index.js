const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'user-profile' }));
app.use('/api/user-profile', routes);

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => console.log('[user-profile] listening on ' + PORT));

module.exports = app;
