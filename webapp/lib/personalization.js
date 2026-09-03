// Ranks a candidate pool of feed posts for one member's own "For You"
// section. Every signal here is drawn from that member's own real activity
// (who they follow, what they've liked/commented on, what they work out,
// whether they engage with scripture) -- never another member's data, and
// never a guess dressed up as a fact. A pure function on purpose: the
// scoring logic is easy to get subtly wrong (a sign flip, a missing
// fallback), and a pure function is the cheapest thing in this codebase to
// unit test in isolation from the database.
//
// See routes/api.js's GET /feed/for-you for why this is a separate,
// non-paginated snapshot rather than a re-sort of /feed's cursor-paginated
// results.
function rankPosts(candidates, opts) {
  const o = opts || {};
  const myWorkoutTypes = new Set(o.myWorkoutTypes || []);
  const engagesWithScripture = !!o.engagesWithScripture;
  const priorAuthors = new Set(o.priorAuthors || []);
  const now = o.now || Date.now();

  return (candidates || [])
    .map((p) => {
      let score = 0;
      // Strongest signal: they chose to follow this person.
      if (p._score_is_followed) score += 3;
      // They've engaged with this author's other posts before, even if not
      // (or not yet) following.
      if (priorAuthors.has(p.author_id)) score += 1;
      // Gentle recency lean so "For You" doesn't ossify into a fixed set of
      // old favorites -- full weight for a brand-new post, tapering off
      // over the candidate pool's 21-day window rather than a hard cutoff.
      const createdMs = Date.parse(`${p.created_at}Z`);
      const daysAgo = Number.isFinite(createdMs) ? Math.max(0, (now - createdMs) / 86400000) : 21;
      score += 3 / (1 + daysAgo);
      // Social proof, logarithmic so one viral post can't dominate every
      // member's "For You" the same way.
      const likeCount = Number(p._score_like_count || 0);
      const commentCount = Number(p.comment_count || 0);
      score += Math.log(1 + likeCount + commentCount);
      // Content-affinity: real activity, not a guess. Logs this workout
      // type themselves; actually saves verses or uses Bible Answers.
      if (p.workout_type && myWorkoutTypes.has(p.workout_type)) score += 2;
      if (p.verse_reference && engagesWithScripture) score += 2;
      return { ...p, _score: score };
    })
    .sort((a, b) => b._score - a._score);
}

module.exports = { rankPosts };
