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

/// A content hash produced by versionShell, as opposed to a hand-written
/// label. Only these are safe to cache immutably: the URL changes whenever the
/// bytes do, which is exactly what the reused labels never did.
const FINGERPRINT = /^[0-9a-f]{16}$/;

/// Every versioned URL the shell actually requests, in document order.
/// The service worker precaches by URL, so it has to be handed these rather
/// than a hand-maintained list -- once the versions are computed from file
/// contents at boot, any list written by hand is stale the moment an asset
/// changes, and silently: it precaches URLs nobody requests while the ones
/// the page does request go uncached.
function shellAssets(versionedHtml) {
  return [...versionedHtml.matchAll(/(?:src|href)="(\/[^"]*\?v=[^"]*)"/g)].map(match => match[1]);
}

/// Names the cache after what is in it, so a changed asset retires the old
/// cache on activate without anyone remembering to bump a number.
function shellCacheName(assets) {
  return `functioning-faith-shell-${createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12)}`;
}

/// Rewrites the service worker's own SHELL list and cache name to match what
/// the shell will really ask for.
function versionServiceWorker(source, assets) {
  return source
    .replace(/const SHELL_CACHE = '[^']*';/, `const SHELL_CACHE = '${shellCacheName(assets)}';`)
    .replace(/const SHELL = \[[\s\S]*?\];/,
      `const SHELL = [\n  '/',\n${assets.map(a => `  '${a}',`).join('\n')}\n];`);
}

module.exports = { versionShell, shellAssets, shellCacheName, versionServiceWorker, FINGERPRINT };
