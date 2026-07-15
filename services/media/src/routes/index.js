const express = require('express');
const router = express.Router();

// TODO: wire to Postgres/Timescale via src/models, and emit domain events via ../../../eventbus/producer
router.get('/', (req, res) => {
  res.json({ service: 'media', message: 'stub endpoint - see README for planned routes' });
});

module.exports = router;
