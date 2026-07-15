// Local mock server for offline dev/testing against the assumed YouVersion contract.
const express = require('express');
const app = express();

const VERSES = {
  'jhn.3.16': { youversion_id: 'jhn.3.16', reference: 'John 3:16', translation: 'NIV',
    text: 'For God so loved the world that he gave his one and only Son...' },
  'phl.4.13': { youversion_id: 'phl.4.13', reference: 'Philippians 4:13', translation: 'NIV',
    text: 'I can do all this through him who gives me strength.' },
};

app.get('/v1/verses/:id', (req, res) => {
  const v = VERSES[req.params.id];
  if (!v) return res.status(404).json({ error: 'not_found' });
  res.json(v);
});

app.get('/v1/verses/search', (req, res) => {
  const q = String(req.query.query || '').toLowerCase();
  res.json(Object.values(VERSES).filter(v => v.text.toLowerCase().includes(q)));
});

const PORT = process.env.MOCK_YOUVERSION_PORT || 5001;
if (require.main === module) app.listen(PORT, () => console.log('YouVersion mock on ' + PORT));
module.exports = app;
