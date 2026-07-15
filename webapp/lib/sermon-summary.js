// Sermon transcript retrieval — no LLM/AI summarization step (the app never
// calls the Claude/Anthropic API or any other paid LLM). This module only
// fetches YouTube's real auto-generated caption track for a service video, so
// the transcript can be read aloud client-side via the browser's free Web
// Speech API. If no transcript is available, callers must say so plainly —
// never fabricate one.

const TIMEDTEXT_TIMEOUT_MS = 15000;

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
}

// Best-effort fetch of YouTube's auto-generated caption track via the
// well-known (unofficial) timedtext endpoint. Returns plain text, or null if
// unavailable for any reason — never fabricates a transcript.
async function fetchTranscript(videoId) {
  if (!videoId) return null;
  const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEDTEXT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'fitfaith-sermon-transcript/1.0' } });
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml || !xml.includes('<text')) return null;
    const lines = [];
    const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = re.exec(xml))) {
      const t = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
    }
    const transcript = lines.join(' ').trim();
    return transcript || null;
  } catch (err) {
    console.error(`[sermon-transcript] fetch failed for ${videoId}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(to);
  }
}

module.exports = { fetchTranscript };
