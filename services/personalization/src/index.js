const express = require('express');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/health', (req, res) => res.json({ status: 'ok', service: 'personalization' }));
app.use('/api/personalization', routes);

const PORT = process.env.PORT || 4006;
app.listen(PORT, () => console.log('[personalization] listening on ' + PORT));

module.exports = app;
