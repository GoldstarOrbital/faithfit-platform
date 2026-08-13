'use strict';
(function () {
  var results = document.getElementById('results');
  var sportSel = document.getElementById('f-sport');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function card(a) {
    var initials = (a.display_name || '?').split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return '<div class="card glass recruit-card">'
      + '<div class="rc-avatar">' + esc(initials) + '</div>'
      + '<div style="flex:1">'
      + '<div style="font-weight:700">' + esc(a.display_name) + '</div>'
      + '<div class="muted">' + esc(a.sport) + (a.position ? ' · ' + esc(a.position) : '') + (a.grad_year ? ' · Class of ' + esc(a.grad_year) : '') + '</div>'
      + (a.school ? '<div class="muted" style="font-size:.82rem">' + esc(a.school) + '</div>' : '')
      + (a.bio ? '<div style="margin-top:6px;font-size:.85rem">' + esc(a.bio) + '</div>' : '')
      + '<div class="rc-stats">'
      + '<div><b>' + a.stats.workouts_90d + '</b> workouts / 90d</div>'
      + '<div><b>' + a.stats.distance_km_90d + '</b> km / 90d</div>'
      + (a.stats.avg_hr_90d ? '<div><b>' + a.stats.avg_hr_90d + '</b> avg HR</div>' : '')
      + '</div>'
      + (a.highlight_url ? '<a class="ghost" style="display:inline-block;margin-top:8px;text-decoration:none" href="' + esc(a.highlight_url) + '" target="_blank" rel="noopener">▶ Highlight video</a>' : '')
      + '</div></div>';
  }

  function search() {
    results.innerHTML = 'Loading…';
    var p = new URLSearchParams();
    if (sportSel.value) p.set('sport', sportSel.value);
    if (document.getElementById('f-year').value) p.set('grad_year', document.getElementById('f-year').value);
    if (document.getElementById('f-q').value) p.set('q', document.getElementById('f-q').value);
    fetch('/api/athletes/search?' + p.toString())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!sportSel.options.length || sportSel.options.length === 1) {
          data.sports.forEach(function (s) { var o = document.createElement('option'); o.value = s; o.textContent = s; sportSel.appendChild(o); });
        }
        if (!data.athletes.length) { results.innerHTML = '<div class="card glass recruit-empty muted">No public profiles match yet. Check back soon, or be the first — set up your Athlete Recruiting Profile in Profile Settings.</div>'; return; }
        results.innerHTML = data.athletes.map(card).join('');
      })
      .catch(function () { results.innerHTML = '<div class="muted">Could not load the directory right now.</div>'; });
  }

  document.getElementById('f-go').onclick = search;
  document.getElementById('f-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
  search();
})();
