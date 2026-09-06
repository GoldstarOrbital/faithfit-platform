'use strict';
const { createHash } = require('node:crypto');

// Version by bytes, not by a hand-maintained label. This also escapes old
// immutable browser entries when the visitor has no active service worker.
function versionShell(html, readAsset) {
  return html.replace(/\b(src|href)="(\/[a-zA-Z0-9_/-]+\.(?:js|css))(?:\?[^"<>]*)?"/g,
    (_match, attribute, asset) => {
      const version = createHash('sha256').update(readAsset(asset)).digest('hex').slice(0, 16);
      return `${attribute}="${asset}?v=${version}"`;
    });
}

module.exports = { versionShell };
