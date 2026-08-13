'use strict';
(function () {
  var results = document.getElementById('results');
  var sportSel = document.getElementById('f-sport');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function badges(a) {
    var out = [];
    if (a.video_count) out.push('🎥 ' + a.video_count + ' video' + (a.video_count === 1 ? '' : 's'));
    if (a.award_count) out.push('🏅 ' + a.award_count + ' award' + (a.award_count === 1 ? '' : 's'));
    if (a.endorsement_count) out.push('✅ ' + a.endorsement_count + ' coach endorsement' + (a.endorsement_count === 1 ? '' : 's'));
    if (a.handedness) out.push(a.handedness === 'switch' ? 'Switch-handed' : (a.handedness.charAt(0).toUpperCase() + a.handedness.slice(1) + '-handed'));
    return out.length ? '<div class="rc-badges">' + out.map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('') : '';
  }

  function card(a) {
    var initials = (a.display_name || '?').split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return '<div class="card glass recruit-card" data-athlete="' + esc(a.user_id) + '" style="cursor:pointer">'
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
      + badges(a)
      + (a.highlight_url ? '<a class="ghost" style="display:inline-block;margin-top:8px;text-decoration:none" href="' + esc(a.highlight_url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">▶ Highlight video</a>' : '')
      + '<div id="rc-detail-' + esc(a.user_id) + '"></div>'
      + '</div></div>';
  }

  function detailHtml(p) {
    var h = '<div class="rc-detail">';
    if (p.height_cm || p.weight_kg) h += '<div class="muted" style="font-size:.8rem">' + [p.height_cm ? p.height_cm + ' cm' : null, p.weight_kg ? p.weight_kg + ' kg' : null].filter(Boolean).join(' · ') + '</div>';
    if (p.sport_stats && p.sport_stats.length) {
      h += '<div class="rc-stat-grid">' + p.sport_stats.map(function (f) { return '<div><b>' + esc(f.value) + (f.unit ? ' ' + esc(f.unit) : '') + '</b><span>' + esc(f.label) + '</span></div>'; }).join('') + '</div>';
    }
    if (p.teams && p.teams.length) {
      h += '<div class="rc-section-label">Past teams</div><ul class="rc-list">' + p.teams.map(function (t) { return '<li>' + esc(t.team_name) + (t.level ? ' · ' + esc(t.level) : '') + (t.season ? ' · ' + esc(t.season) : '') + '</li>'; }).join('') + '</ul>';
    }
    if (p.awards && p.awards.length) {
      h += '<div class="rc-section-label">Awards</div><ul class="rc-list">' + p.awards.map(function (a) { return '<li>' + esc(a.title) + (a.year ? ' · ' + a.year : '') + (a.issuer ? ' · ' + esc(a.issuer) : '') + '</li>'; }).join('') + '</ul>';
    }
    if (p.videos && p.videos.length) {
      h += '<div class="rc-section-label">Videos</div><ul class="rc-list">' + p.videos.map(function (v) { return '<li><a href="' + esc(v.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + esc(v.title || v.url) + '</a></li>'; }).join('') + '</ul>';
    }
    if (p.endorsements && p.endorsements.length) {
      h += '<div class="rc-section-label">Coach endorsements</div>' + p.endorsements.map(function (e) {
        return '<div class="rc-endorsement"><b>' + esc(e.coach_name) + '</b>' + (e.coach_organization ? ' · ' + esc(e.coach_organization) : '') + '<div>' + esc(e.quote) + '</div></div>';
      }).join('');
    }
    h += '</div>';
    return h;
  }

  function toggleDetail(athleteId) {
    var box = document.getElementById('rc-detail-' + athleteId);
    if (!box) return;
    if (box.dataset.loaded === '1') { box.style.display = box.style.display === 'none' ? 'block' : 'none'; return; }
    box.innerHTML = '<div class="muted" style="margin-top:8px">Loading…</div>';
    fetch('/api/athletes/' + encodeURIComponent(athleteId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        box.innerHTML = detailHtml(data.profile || {});
        box.dataset.loaded = '1';
      })
      .catch(function () { box.innerHTML = '<div class="muted">Could not load full profile.</div>'; });
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
        results.querySelectorAll('[data-athlete]').forEach(function (el) {
          el.addEventListener('click', function () { toggleDetail(el.dataset.athlete); });
        });
      })
      .catch(function () { results.innerHTML = '<div class="muted">Could not load the directory right now.</div>'; });
  }

  document.getElementById('f-go').onclick = search;
  document.getElementById('f-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
  search();
})();
