// Creator overlay client.
//
// Polls the public projection behind the token in the URL and draws it. Runs
// inside an OBS browser source, so it must be self-sufficient: no sign-in, no
// interaction, and it must fail quietly. A stream overlay that shows an error
// box, or freezes on the last numbers it saw, is worse than one that hides.

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const token = params.get('t') || params.get('token') || '';
  // Streamers arrange their own scene; let the URL choose a corner.
  const align = (params.get('align') || 'bottom').toLowerCase();
  const POLL_MS = 2000;

  const el = (id) => document.getElementById(id);
  const root = el('root');

  if (align === 'top') root.style.flexDirection = 'column-reverse';

  function fig(value, label, cls) {
    return '<div class="fig"><div class="fig-v ' + (cls || '') + '">' + value + '</div>'
         + '<div class="fig-l">' + label + '</div></div>';
  }

  function fmtElapsed(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '--';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }

  function paceFromKmh(kmh) {
    if (!Number.isFinite(kmh) || kmh <= 0.3) return '--';
    const minPerKm = 60 / kmh;
    if (minPerKm > 60) return '--';
    const m = Math.floor(minPerKm);
    const s = Math.round((minPerKm - m) * 60);
    return m + ':' + String(s === 60 ? 0 : s).padStart(2, '0');
  }

  // Track which verse is on screen so a redraw does not restart its animation.
  let shownRef = null;

  function render(data) {
    if (!data || !data.live || !data.state) { root.hidden = true; shownRef = null; return; }
    const st = data.state;
    root.hidden = false;

    el('route').textContent = st.journey_name || 'Functioning Faith';
    el('mark-name').textContent = data.display_name || 'Functioning Faith';

    const done = Number(st.distance_km) || 0;
    const total = Number(st.total_km) || 0;
    el('sub').textContent = total
      ? done.toFixed(1) + ' / ' + total.toFixed(1) + ' km'
        + (st.next_waypoint ? ' · next: ' + st.next_waypoint : '')
      : done.toFixed(2) + ' km';
    const pct = Number.isFinite(Number(st.percent)) ? Number(st.percent)
      : (total ? Math.min(100, (done / total) * 100) : 0);
    el('bar').style.width = Math.max(0, Math.min(100, pct)) + '%';

    // Only draw a figure we actually have. A blank tile beats a fabricated one.
    let cells = '';
    cells += fig(done.toFixed(2), 'km');
    cells += fig(paceFromKmh(st.speed_kmh), 'pace /km');
    if (st.hr) cells += fig(String(Math.round(st.hr)), 'bpm', st.zone ? 'z' + st.zone : '');
    if (st.zone) cells += fig('Z' + st.zone, 'zone', 'z' + st.zone);
    cells += fig(fmtElapsed(st.elapsed_sec), 'time');
    el('figures').innerHTML = cells;

    const verseBox = el('verse');
    if (st.verse_reference && st.verse_text) {
      if (st.verse_reference !== shownRef) {
        shownRef = st.verse_reference;
        el('ref').textContent = st.verse_reference;
        el('text').textContent = '“' + st.verse_text + '”';
        el('moment-label').textContent = st.moment_label || 'Scripture';
        const src = el('moment-src');
        // Say plainly whether the moment was read from a monitor or inferred.
        src.hidden = !st.moment_label;
        src.textContent = st.moment_measured ? 'measured' : 'pace & route';
        verseBox.hidden = false;
        verseBox.classList.remove('out');
        void verseBox.offsetWidth;            // restart the entrance animation
      }
    } else if (shownRef) {
      shownRef = null;
      verseBox.classList.add('out');
      setTimeout(() => { verseBox.hidden = true; verseBox.classList.remove('out'); }, 500);
    }
  }

  async function tick() {
    if (!token) { root.hidden = true; return; }
    try {
      const res = await fetch('/api/overlay/s/' + encodeURIComponent(token), { cache: 'no-store' });
      if (!res.ok) { root.hidden = true; return; }
      render(await res.json());
    } catch {
      // Network blip: leave the last frame up briefly rather than flashing the
      // overlay off. The staleness check on the server handles a real stop.
    }
  }

  tick();
  setInterval(tick, POLL_MS);
})();
