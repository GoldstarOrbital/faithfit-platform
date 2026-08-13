'use strict';
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var coachId = new URLSearchParams(location.search).get('coach');
  var results = document.getElementById('results');
  if (!coachId) { results.innerHTML = '<div class="muted">No coach specified.</div>'; return; }

  function card(m) {
    var a = m.athlete;
    var initials = (a.display_name || '?').split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return '<div class="card glass roster-card">'
      + '<div class="rc-avatar">' + esc(initials) + '</div>'
      + '<div style="flex:1">'
      + '<div style="font-weight:700">' + esc(a.display_name) + '</div>'
      + '<div class="muted" style="font-size:.82rem">' + esc(a.sport) + (m.position_on_team ? ' · ' + esc(m.position_on_team) : (a.position ? ' · ' + esc(a.position) : '')) + (m.jersey_number ? ' · #' + esc(m.jersey_number) : '') + (a.grad_year ? ' · Class of ' + esc(a.grad_year) : '') + '</div>'
      + '</div></div>';
  }

  fetch('/api/coach/' + encodeURIComponent(coachId) + '/roster')
    .then(function (r) { if (!r.ok) throw new Error('not found'); return r.json(); })
    .then(function (data) {
      document.getElementById('roster-title').textContent = (data.coach.organization || data.coach.display_name) + ' — ' + data.coach.sport;
      document.getElementById('roster-sub').textContent = 'Roster published by ' + data.coach.display_name + (data.coach.title ? ' (' + data.coach.title + ')' : '');
      if (!data.roster.length) { results.innerHTML = '<div class="card glass muted" style="text-align:center;padding:24px">No roster members published yet.</div>'; return; }
      results.innerHTML = data.roster.map(card).join('');
    })
    .catch(function () {
      document.getElementById('roster-title').textContent = 'Roster not found';
      results.innerHTML = '<div class="muted">This coach hasn\'t published a roster, or isn\'t verified.</div>';
    });
})();
