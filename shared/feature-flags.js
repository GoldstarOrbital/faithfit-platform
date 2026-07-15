const fs = require('fs');
const path = require('path');

let cache = null;

function loadFlags() {
  if (cache) return cache;
  const file = path.join(__dirname, '..', 'config', 'feature-flags.json');
  cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cache;
}

function isEnabled(flag) {
  const flags = loadFlags();
  if (!(flag in flags)) throw new Error(`Unknown feature flag: ${flag}`);
  // env override lets ops enable per-environment without redeploying code
  const envOverride = process.env[`FLAG_${flag.toUpperCase().replace(/\./g, '_')}`];
  if (envOverride !== undefined) return envOverride === 'true';
  return !!flags[flag];
}

module.exports = { loadFlags, isEnabled };
