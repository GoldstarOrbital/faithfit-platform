const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'fitness' }));
app.use('/api/fitness', routes);

const PORT = process.env.PORT || 4003;
app.listen(PORT, () => console.log('[fitness] listening on ' + PORT));

module.exports = app;
