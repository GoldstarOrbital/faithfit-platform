// Reads a church's OFFICIAL website (a URL the user themselves supplies and
// verifies, mirroring the ownership check used for linking a YouTube channel)
// and extracts REAL embeddable video references already present on that page —
// YouTube/YouTube-nocookie/Vimeo <iframe> embeds most churches already use for
// sermon players. This is a free, key-free complement to the YouTube Data API
// path: no search, no guessing — we only ever surface a video ID that is
// literally embedded in the church's own HTML at fetch time.
//
// Nothing here re-hosts or downloads video content; we only capture the iframe
// src (a real embed URL, exactly like a browser would load) so the app can
// render the SAME iframe pointed at the SAME official/nocookie player.

const FETCH_TIMEOUT_MS = 15000;
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3MB cap — enough for any normal page

function isHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

// Extract every YouTube/YouTube-nocookie/Vimeo iframe embed from real HTML.
// Never fabricates — only returns what is literally present in the fetched page.
function extractEmbeds(html) {
  const embeds = [];
  const seen = new Set();
  const iframeRe = /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = iframeRe.exec(html))) {
    const src = m[1];
    let url;
    try { url = new URL(src, 'https://example.com'); } catch { continue; }
    const host = url.hostname.replace(/^www\./, '');

    let provider = null, videoId = null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
      const em = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (em) { provider = 'youtube'; videoId = em[1]; }
    } else if (host === 'player.vimeo.com') {
      const vm = url.pathname.match(/\/video\/(\d+)/);
      if (vm) { provider = 'vimeo'; videoId = vm[1]; }
    }
    if (!provider || !videoId) continue;
    const key = `${provider}:${videoId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    embeds.push({ provider, videoId, embedUrl: src });
  }
  return embeds;
}

// Fetch a church's own website and return the real embeds found on it.
// Throws on network/HTTP failure; returns [] (not an error) if the page loads
// fine but simply has no recognizable video embeds.
async function fetchChurchWebsiteEmbeds(websiteUrl) {
  if (!isHttpUrl(websiteUrl)) throw new Error('invalid_url');
  const html = await fetchPinnedHtml(new URL(websiteUrl), 0);
  return extractEmbeds(html);
}

function publicAddress(address) {
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  const h = address.toLowerCase();
  return !(h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') ||
    /^fe[89ab]/.test(h) || h.startsWith('::ffff:'));
}

async function resolvePublic(hostname) {
  const rows = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!rows.length || rows.some(row => !publicAddress(row.address))) throw new Error('private_address_not_allowed');
  return rows[0];
}

async function fetchPinnedHtml(url, redirects) {
  if (!isHttpUrl(url.toString())) throw new Error('invalid_url');
  if (redirects > 3) throw new Error('too_many_redirects');
  const target = await resolvePublic(url.hostname);
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: 'https:', hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'GET', servername: url.hostname,
      headers: { 'User-Agent': 'functioning-faith-church-website/1.0 (+https://faithfit-demo-production.up.railway.app)', Accept: 'text/html,application/xhtml+xml' },
      lookup: (_host, _opts, cb) => cb(null, target.address, target.family),
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url); } catch { return reject(new Error('invalid_redirect')); }
        return fetchPinnedHtml(next, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const type = String(res.headers['content-type'] || '');
      if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) { res.resume(); return reject(new Error('unsupported_content_type')); }
      const chunks = []; let total = 0;
      res.on('data', chunk => { total += chunk.length; if (total > MAX_HTML_BYTES) return req.destroy(new Error('response_too_large')); chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

module.exports = { fetchChurchWebsiteEmbeds, extractEmbeds, isHttpUrl, publicAddress, resolvePublic };
