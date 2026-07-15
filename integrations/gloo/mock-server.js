const express = require('express');
const app = express();

app.get('/v1/churches/:id', (req, res) => res.json({ id: req.params.id, name: 'Sample Community Church' }));
app.get('/v1/groups/:id', (req, res) => res.json({ id: req.params.id, name: 'Sunrise 5K Fellowship' }));
app.get('/v1/groups/:id/members', (req, res) => res.json([{ user_id: 'u1' }, { user_id: 'u2' }]));

const PORT = process.env.MOCK_GLOO_PORT || 5002;
if (require.main === module) app.listen(PORT, () => console.log('Gloo mock on ' + PORT));
module.exports = app;
