// Journeys — a Zwift-style virtual adventure mode. A user picks a legendary
// route; every kilometre they cover in real life moves their marker forward, and
// waypoints along the way unlock a short piece of narrative plus a paired
// scripture.
//
// Two worlds:
//   'biblical' — REAL geography and REAL scripture. Every scripture_ref below is
//                a genuine reference. Where the book exists in the app's local
//                public-domain Bible library (Genesis, Psalms, Proverbs, Matthew,
//                Mark, Luke, John, James, Romans in WEB; Philippians in KJV) the
//                verse TEXT is pulled from the bible_verses table at seed time —
//                never typed from memory. Where the book is not in the local
//                library (Exodus, Numbers, 1 Kings, Acts…), scripture_text is
//                left NULL and only the reference is shown. Nothing is invented.
//   'fantasy'  — original, Tolkien-*flavoured* prose and original place-names.
//                No copied text, no trademarked route names.
const { randomUUID } = require('crypto');
const db = require('./db');

// Duration -> distance fallback. Some logged activities have no distance (a
// treadmill session logged by time, an indoor trainer, a hike with GPS off). So
// that those still move a journey forward, duration is converted at a
// deliberately CONSERVATIVE assumed pace, chosen per the journey's activity
// hint. These are intentionally on the slow side so a time-only log can never
// out-earn an honestly measured one.
const ASSUMED_KMH = { walk: 5, run: 9, ride: 18, any: 6 };

const JOURNEYS = [
  // ------------------------------------------------------------------ biblical
  {
    key: 'road-to-emmaus',
    name: 'The Road to Emmaus',
    world: 'biblical',
    subtitle: 'Jerusalem to Emmaus · ~11 km',
    description: 'The seven-mile walk two disciples took on the afternoon of the resurrection, joined by a stranger they did not recognise until the bread was broken.',
    scripture_ref: 'Luke 24:13-35',
    total_km: 11,
    terrain: 'flat',
    elevation_m: 120,
    activity_hint: 'walk',
    waypoints: [
      { km_mark: 0, title: 'Leaving the city gate', scripture_ref: 'Luke 24:13',
        narrative: 'You set out in the low afternoon light with the walls of Jerusalem at your back. The week has been heavy. The road ahead is dust and olive trees and the long habit of putting one foot down and then the other.' },
      { km_mark: 2.5, title: 'Talking it over', scripture_ref: 'Luke 24:15',
        narrative: 'Two of you, going over it again and again — what happened, what it meant, what you had hoped. And then a third set of footsteps falls in beside you, matching your pace without asking permission.' },
      { km_mark: 5, title: 'The stranger asks', scripture_ref: 'Luke 24:17',
        narrative: 'He asks what you are arguing about, and you stop dead in the road, astonished that anyone could have missed it. The question is gentle. It is also, you will realise later, an invitation.' },
      { km_mark: 8, title: 'Opening the scriptures', scripture_ref: 'Luke 24:27',
        narrative: 'Mile after mile he walks you back through everything you thought you already knew, and it rearranges itself as he speaks. The kilometres go by unnoticed. That is what good company does to a long road.' },
      { km_mark: 10, title: 'Stay with us', scripture_ref: 'Luke 24:29',
        narrative: 'The village is close and the sun is nearly down. He makes as though to go further. You do the only reasonable thing and beg him to stay — because the day is spent, and because you are not finished listening.' },
      { km_mark: 11, title: 'Known in the breaking of bread', scripture_ref: 'Luke 24:32',
        narrative: 'At the table he takes the bread, blesses it, breaks it — and you see. Eleven kilometres of not knowing, undone in a single gesture. You are already reaching for your sandals to run the whole way back.' },
    ],
  },
  {
    key: 'up-mount-sinai',
    name: 'Up Mount Sinai',
    world: 'biblical',
    subtitle: 'The mountain Moses climbed · ~7 km, 2,285 m',
    description: 'A short route by distance and a brutal one by gradient — the ascent to the summit of Jebel Musa, where Israel camped at the foot of the mountain and Moses went up into the cloud.',
    scripture_ref: 'Exodus 19',
    total_km: 7,
    terrain: 'climb',
    elevation_m: 2285,
    activity_hint: 'walk',
    waypoints: [
      { km_mark: 0, title: 'The camp at the foot', scripture_ref: 'Exodus 19:2',
        narrative: 'The whole camp is spread out on the plain behind you, tents to the horizon. From down here the mountain does not look like a promise. It looks like a wall.' },
      { km_mark: 1.5, title: 'Who may ascend?', scripture_ref: 'Psalm 24:3',
        narrative: 'The first switchbacks bite. Your breathing changes from something you do to something you manage. The old question surfaces with every step: who gets to go up a hill like this?' },
      { km_mark: 3, title: 'Into the cloud', scripture_ref: 'Exodus 19:16',
        narrative: 'Above three thousand feet the air thins and the summit disappears into weather. Thunder, and a thick cloud on the mountain. You climb into the part of the route you cannot see the end of.' },
      { km_mark: 5, title: 'Lifting your eyes', scripture_ref: 'Psalm 121:1',
        narrative: 'You stop on a ledge of red granite, hands on knees, and look up at what is left. There is a great deal of it. Somehow that is steadying rather than crushing.' },
      { km_mark: 6.2, title: 'The steps of repentance', scripture_ref: 'Exodus 24:12',
        narrative: 'The last stretch is stone stairs, thousands of them, cut into the rock by hands that had all the time in the world. Nobody sprints this. You just keep taking the next step.' },
      { km_mark: 7, title: 'The summit', scripture_ref: 'Exodus 34:29',
        narrative: 'Wind, silence, and the whole Sinai laid out below you in ridges of shadow. You came up here carrying something and you are not carrying it any more. Faces do change on mountains.' },
    ],
  },
  {
    key: 'jericho-road',
    name: 'The Jericho Road',
    world: 'biblical',
    subtitle: 'Jerusalem down to Jericho · ~27 km',
    description: 'The steep, lonely descent from the Judean hills to the Jordan valley — over a kilometre of drop in twenty-seven, and the road on which Jesus set the parable of the good Samaritan.',
    scripture_ref: 'Luke 10:25-37',
    total_km: 27,
    terrain: 'rolling',
    elevation_m: 1000,
    activity_hint: 'run',
    waypoints: [
      { km_mark: 0, title: 'The lawyer\'s question', scripture_ref: 'Luke 10:25',
        narrative: 'Every long route begins with a question you are hoping has a short answer. This one does not. You start downhill out of the city with the whole wilderness ahead.' },
      { km_mark: 6, title: 'The descent begins in earnest', scripture_ref: 'Luke 10:30',
        narrative: 'The road drops away and the green goes out of the landscape. Bare limestone, blind corners, no water. It is easy to understand, out here, why this road had a reputation.' },
      { km_mark: 12, title: 'Passing by on the other side', scripture_ref: 'Luke 10:31',
        narrative: 'Halfway. This is the stretch where the mind starts negotiating — busy, tired, someone else\'s problem. The parable knows exactly what you are thinking, because it was written about it.' },
      { km_mark: 17, title: 'Moved with compassion', scripture_ref: 'Luke 10:33',
        narrative: 'The outsider is the one who stops. Not the qualified, not the credentialled — the one nobody expected. Your legs are heavy now and the mercy in it lands differently than it does sitting down.' },
      { km_mark: 21, title: 'The inn', scripture_ref: 'Luke 10:34',
        narrative: 'Oil, wine, bandages, a borrowed animal, a bed paid for out of pocket. Compassion turns out to be a series of unglamorous logistics. Six kilometres left.' },
      { km_mark: 27, title: 'Jericho, and the answer', scripture_ref: 'Luke 10:37',
        narrative: 'You come out of the hills into the oldest city in the world, more than a thousand metres below where you started. Go and do likewise, he said. It was never a riddle. It was an instruction.' },
    ],
  },
  {
    key: 'wilderness-forty',
    name: 'The Wilderness Forty',
    world: 'biblical',
    subtitle: 'A season, not a session · 40 km',
    description: 'Forty kilometres for the forty years Israel spent between the leaving and the arriving. A long-haul goal built to be chipped away at over weeks — the point is that you keep going.',
    scripture_ref: 'Numbers 14:33-34',
    total_km: 40,
    terrain: 'rolling',
    elevation_m: 300,
    activity_hint: 'any',
    waypoints: [
      { km_mark: 0, title: 'Out past the last well', scripture_ref: 'Numbers 14:33',
        narrative: 'A year for each day. Whatever you thought this was going to cost, the wilderness has its own accounting. You go anyway.' },
      { km_mark: 8, title: 'A dry and weary land', scripture_ref: 'Psalm 63:1',
        narrative: 'The novelty burns off somewhere in the first week. What is left is thirst, and the discovery that thirst is not the same thing as failure.' },
      { km_mark: 16, title: 'A table in the wilderness', scripture_ref: 'Psalm 78:19',
        narrative: 'Bread you did not bake, arriving daily, never storable. The wilderness will not let you stockpile. It only teaches you to come back tomorrow.' },
      { km_mark: 24, title: 'Do not harden your heart', scripture_ref: 'Psalm 95:8',
        narrative: 'This is the stretch where people quit — not from injury but from grumbling. The distance is no longer the problem. The story you are telling yourself about it is.' },
      { km_mark: 32, title: 'He led them by a straight way', scripture_ref: 'Psalm 107:7',
        narrative: 'Looking back, the wandering has a shape you could not see from inside it. Eight kilometres left and the ground is starting to rise toward something green.' },
      { km_mark: 40, title: 'The far bank', scripture_ref: 'Psalm 126:3',
        narrative: 'Forty. It took as long as it took. You are not the person who set out, and that — not the mileage — was always the point of the wilderness.' },
    ],
  },

  // ------------------------------------------------------------------- fantasy
  {
    key: 'the-long-road-east',
    name: 'The Long Road East',
    world: 'fantasy',
    subtitle: 'Greenhollow to the Grey Fords · 42 km',
    description: 'The old waggon-road out of the soft country, east through the reed-fens and up to the fords where the river runs fast and cold. A marathon of a route for a fellowship of one.',
    scripture_ref: 'Psalm 121:8',
    total_km: 42,
    terrain: 'rolling',
    elevation_m: 640,
    activity_hint: 'run',
    waypoints: [
      { km_mark: 0, title: 'The last gate of Greenhollow', scripture_ref: 'Psalm 121:8',
        narrative: 'Chimney smoke, an apple orchard, somebody\'s dog barking at nothing. You shut the gate behind you and the road stops being a lane and starts being a road.' },
      { km_mark: 7, title: 'The Milestone Oak', scripture_ref: 'Proverbs 4:26',
        narrative: 'A tree so old the milestone at its root has been swallowed to the number. Travellers still touch the bark going past. You do too, and feel faintly ridiculous, and do it anyway.' },
      { km_mark: 15, title: 'The Reedwater Crossing', scripture_ref: 'Psalm 23:2',
        narrative: 'Flat water, mist to the knees, herons standing like grey punctuation. The plank bridge complains under you. On the far side the ground begins, very gently, to climb.' },
      { km_mark: 24, title: 'Beacon Hollow', scripture_ref: 'James 1:12',
        narrative: 'An unlit beacon on a bald hill, stacked and tarred and waiting for a night nobody wants. From up here you can see both the country you left and the country you are going to.' },
      { km_mark: 33, title: 'The Wayhouse at Thistledown', scripture_ref: 'Romans 12:12',
        narrative: 'Low ceilings, brown bread, a fire that smokes. The keeper says the fords are running high. He also says that of every traveller, in every season, and pours you another cup.' },
      { km_mark: 42, title: 'The Grey Fords', scripture_ref: 'Psalm 18:33',
        narrative: 'Cold water to the thigh, stones rolling underfoot, the far bank rising black against the last of the light. Forty-two kilometres. You cross, and you are on the other side of something.' },
    ],
  },
  {
    key: 'the-shadowed-plain',
    name: 'The Shadowed Plain',
    world: 'fantasy',
    subtitle: 'The crossing of the ash country · 25 km',
    description: 'Twenty-five kilometres of flat, open, unlovely ground where there is nowhere to hide and nothing to look at but the far edge. A route about will, not gradient.',
    scripture_ref: 'Psalm 23:4',
    total_km: 25,
    terrain: 'flat',
    elevation_m: 90,
    activity_hint: 'run',
    waypoints: [
      { km_mark: 0, title: 'The broken wall', scripture_ref: 'Psalm 23:4',
        narrative: 'The old boundary wall has fallen in a dozen places and no one has come to mend it in a lifetime. You step through the gap onto grey ground and the wind takes your first breath away.' },
      { km_mark: 6, title: 'The Salt Flats', scripture_ref: 'Psalm 143:6',
        narrative: 'White crust, cracked into plates, ringing faintly underfoot. No shade, no landmark, no sense of progress except the numbers. This is where the plain does its real work on people.' },
      { km_mark: 13, title: 'The Watcher Stones', scripture_ref: 'Psalm 27:1',
        narrative: 'Nine standing stones in a rough circle, faces worn smooth, still somehow attentive. You are halfway. Whatever these were set here to watch for, it was not you.' },
      { km_mark: 19, title: 'The Wind Turns', scripture_ref: 'Isaiah 41:10',
        narrative: 'For nineteen kilometres it has been in your face. Then, without ceremony, it is at your back — and the same legs that were failing find another gear. Take the gift. Do not question it.' },
      { km_mark: 25, title: 'The Green Line', scripture_ref: 'Psalm 30:5',
        narrative: 'A thin band of green on the horizon resolves into willows, then into a real river with real noise. You walk out of the ash country with grey dust to your knees and it is over.' },
    ],
  },
  {
    key: 'the-ashen-stair',
    name: 'The Ashen Stair',
    world: 'fantasy',
    subtitle: 'Nine kilometres, straight up · 1,650 m',
    description: 'A cut stair and a goat-track winding up the north face of the Ashen Horn. Short, savage, and all of it in one direction. Bring lungs.',
    scripture_ref: 'Psalm 61:2',
    total_km: 9,
    terrain: 'climb',
    elevation_m: 1650,
    activity_hint: 'walk',
    waypoints: [
      { km_mark: 0, title: 'The scree gate', scripture_ref: 'Psalm 61:2',
        narrative: 'Loose black stone shifting under every footfall, and the first of the cut steps somewhere above it. You crane your neck and cannot see the top. That is probably a mercy.' },
      { km_mark: 2, title: 'The Thousand Steps', scripture_ref: 'Proverbs 24:16',
        narrative: 'There are not a thousand. There are rather more. Someone chiselled every one of them into the rock for reasons long forgotten, and you are grateful to them with each burning quadricep.' },
      { km_mark: 4.5, title: 'The Cloudline', scripture_ref: 'Psalm 139:8',
        narrative: 'You climb into weather and the world below simply stops existing. Visibility of twenty paces. Nothing to do but trust the stair and keep your hand on the wall.' },
      { km_mark: 6.5, title: 'The Eagle\'s Landing', scripture_ref: 'Isaiah 40:31',
        narrative: 'A flat shelf the size of a barn floor, wind-scoured, littered with old white bones. You come out of the cloud here and the sun is astonishing. Two and a half to go.' },
      { km_mark: 9, title: 'The Ashen Horn', scripture_ref: 'Psalm 95:4',
        narrative: 'The summit is a knife of dark rock barely wide enough to stand on, and the whole range lies beneath it in ranks of blue. Nine kilometres. Sixteen hundred and fifty metres. You are up.' },
    ],
  },
  {
    key: 'the-mistfall-ride',
    name: 'The Mistfall Ride',
    world: 'fantasy',
    subtitle: 'The high circuit of the Mistfall vales · 60 km',
    description: 'Sixty kilometres of hill road looping the three vales below the Mistfall escarpment — long descents, three real climbs, and a chapel at the far turn.',
    scripture_ref: 'Proverbs 3:6',
    total_km: 60,
    terrain: 'rolling',
    elevation_m: 1200,
    activity_hint: 'ride',
    waypoints: [
      { km_mark: 0, title: 'The bridge at Lowmere', scripture_ref: 'Proverbs 3:6',
        narrative: 'Cold morning, wet stone, the river running fast under three arches. You clip in, roll out, and the valley road unspools ahead of you in the dark before dawn.' },
      { km_mark: 12, title: 'The First Vale', scripture_ref: 'Psalm 65:11',
        narrative: 'Hedged fields and drystone walls and sheep entirely unimpressed by your effort. The road tilts up for the first time and you find out what kind of day this is going to be.' },
      { km_mark: 25, title: 'Mistfall Edge', scripture_ref: 'Psalm 104:8',
        narrative: 'The escarpment falls away on your left for a straight kilometre — a white ribbon of water dropping into cloud, and no bottom visible to it at all. Nobody rides past this without stopping.' },
      { km_mark: 34, title: 'The Chapel at the Turn', scripture_ref: 'Matthew 11:28',
        narrative: 'A one-room chapel of grey stone at the highest point of the loop, door never locked, a jug of water on the sill for whoever comes past. You drink. You go on.' },
      { km_mark: 46, title: 'The Long Descent', scripture_ref: 'Psalm 18:19',
        narrative: 'Twelve kilometres of downhill that you did nothing to deserve. The tears in your eyes are from the wind. Mostly.' },
      { km_mark: 60, title: 'Lowmere, and the same bridge', scripture_ref: 'Psalm 16:6',
        narrative: 'Back over the three arches with the light going gold behind you. Sixty kilometres, and the only thing that changed out there was the rider.' },
    ],
  },
];

// Parse a reference like "Luke 24:32" or "Psalm 107:7" into book/chapter/verse.
// Ranges ("Luke 24:13-35") are book/chapter-level headers only — we never try to
// splice a range together, so those resolve to NULL text and just show the ref.
function parseRef(ref) {
  const m = /^((?:[123]\s)?[A-Za-z]+)\s+(\d+):(\d+)$/.exec(String(ref || '').trim());
  if (!m) return null;
  return { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) };
}

// Book names as they are stored in bible_verses (Psalms is stored as "Psalms",
// while references are conventionally written "Psalm 23:2").
const BOOK_ALIASES = { Psalm: 'Psalms' };

// Pull the REAL verse text out of the local public-domain Bible library. Returns
// null when the book is not in the library (Exodus, Numbers, Isaiah, …) — in
// that case we store only the reference and never guess at the wording.
function lookupScriptureText(ref) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const book = BOOK_ALIASES[parsed.book] || parsed.book;
  const row = db.prepare(
    'SELECT text FROM bible_verses WHERE book = ? AND chapter = ? AND verse = ? ORDER BY translation LIMIT 1'
  ).get(book, parsed.chapter, parsed.verse);
  return row ? row.text : null;
}

// Idempotent upsert of the journey catalog + its waypoints.
function ensureJourneys() {
  const upsertJourney = db.prepare(`
    INSERT INTO journeys (id, key, name, world, subtitle, description, scripture_ref, total_km, terrain, elevation_m, activity_hint)
    VALUES (@id, @key, @name, @world, @subtitle, @description, @scripture_ref, @total_km, @terrain, @elevation_m, @activity_hint)
    ON CONFLICT(key) DO UPDATE SET
      name=excluded.name, world=excluded.world, subtitle=excluded.subtitle,
      description=excluded.description, scripture_ref=excluded.scripture_ref,
      total_km=excluded.total_km, terrain=excluded.terrain,
      elevation_m=excluded.elevation_m, activity_hint=excluded.activity_hint
  `);
  const getId = db.prepare('SELECT id FROM journeys WHERE key = ?');
  const upsertWaypoint = db.prepare(`
    INSERT INTO journey_waypoints (id, journey_id, km_mark, title, narrative, scripture_ref, scripture_text)
    VALUES (@id, @journey_id, @km_mark, @title, @narrative, @scripture_ref, @scripture_text)
    ON CONFLICT(journey_id, km_mark) DO UPDATE SET
      title=excluded.title, narrative=excluded.narrative,
      scripture_ref=excluded.scripture_ref, scripture_text=excluded.scripture_text
  `);

  for (const j of JOURNEYS) {
    const { waypoints, ...row } = j;
    upsertJourney.run({ id: randomUUID(), ...row });
    const journeyId = getId.get(j.key).id;
    for (const w of waypoints) {
      upsertWaypoint.run({
        id: randomUUID(),
        journey_id: journeyId,
        km_mark: w.km_mark,
        title: w.title,
        narrative: w.narrative || null,
        scripture_ref: w.scripture_ref || null,
        // Real text from the local library, or NULL. Never authored here.
        scripture_text: w.scripture_ref ? lookupScriptureText(w.scripture_ref) : null,
      });
    }
  }
}

// Convert a finished workout into the kilometres it contributes to a journey.
// Prefers real recorded distance; falls back to the conservative assumed pace
// above only when no distance was recorded at all.
function kmFromWorkout(workout, activityHint) {
  const dist = Number(workout.distance_km) || 0;
  if (dist > 0) return dist;
  const durationMin = (Number(workout.duration_sec) || 0) / 60;
  if (durationMin <= 0) return 0;
  const kmh = ASSUMED_KMH[activityHint] || ASSUMED_KMH.any;
  return (durationMin / 60) * kmh;
}

// Advance every joined, not-yet-completed journey for this user by a finished
// workout. Returns [{ journey, added_km, progress_km, percent, waypoints, completed }]
// so the caller can fire notifications.
function applyWorkoutToJourneys(userId, workout) {
  const rows = db.prepare(`
    SELECT j.*, uj.progress_km, uj.last_waypoint_km
    FROM user_journeys uj JOIN journeys j ON j.id = uj.journey_id
    WHERE uj.user_id = ? AND uj.completed_at IS NULL
  `).all(userId);
  if (!rows.length) return [];

  const upd = db.prepare(
    'UPDATE user_journeys SET progress_km = ?, last_waypoint_km = ?, completed_at = ? WHERE user_id = ? AND journey_id = ?'
  );
  const wpQuery = db.prepare(
    'SELECT * FROM journey_waypoints WHERE journey_id = ? AND km_mark > ? AND km_mark <= ? ORDER BY km_mark'
  );

  const results = [];
  for (const j of rows) {
    const add = kmFromWorkout(workout, j.activity_hint);
    if (add <= 0) continue;
    const progress = Math.min(Number(j.progress_km) + add, j.total_km);
    const lastWp = Number(j.last_waypoint_km);
    const crossed = wpQuery.all(j.id, lastWp, progress);
    const newLastWp = crossed.length ? crossed[crossed.length - 1].km_mark : lastWp;
    const completed = progress >= j.total_km;
    upd.run(progress, newLastWp, completed ? new Date().toISOString() : null, userId, j.id);
    results.push({
      journey: j,
      added_km: add,
      progress_km: progress,
      percent: Math.min(100, Math.round((progress / j.total_km) * 100)),
      waypoints: crossed,
      completed,
    });
  }
  return results;
}

module.exports = { JOURNEYS, ASSUMED_KMH, ensureJourneys, applyWorkoutToJourneys, kmFromWorkout };
