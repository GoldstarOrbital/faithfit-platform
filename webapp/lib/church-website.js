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
const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3MB cap — enough for any normal page

function isHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
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
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(websiteUrl, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'fitfaith-church-website/1.0 (+https://faithfit-demo-production.up.railway.app)' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body ? res.body.getReader() : null;
    let html;
    if (reader) {
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_HTML_BYTES) break;
        chunks.push(value);
      }
      html = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
    } else {
      html = await res.text();
    }
    return extractEmbeds(html);
  } finally {
    clearTimeout(to);
  }
}

module.exports = { fetchChurchWebsiteEmbeds, extractEmbeds, isHttpUrl };
