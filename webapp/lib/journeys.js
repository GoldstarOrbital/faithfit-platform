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
  {
    key: 'the-winter-wood',
    name: 'The Winter Wood',
    world: 'fantasy',
    subtitle: 'A long white crossing under bare branches · 15 km',
    description: 'Fifteen kilometres through a forest held under a winter that has outstayed every calendar. Cold, quiet, and beautiful in a way that does not care whether you make it. The thaw, when it comes, comes suddenly.',
    scripture_ref: 'Isaiah 9:2',
    total_km: 15,
    terrain: 'rolling',
    elevation_m: 260,
    activity_hint: 'run',
    waypoints: [
      { km_mark: 0, title: 'The Iron Gate', scripture_ref: 'Isaiah 9:2',
        narrative: 'A wrought gate stands open in a wall that guards nothing any more, and beyond it the snow begins — unbroken, blue in the hollows, going back further than the light does.' },
      { km_mark: 3.5, title: 'The Lantern at the Crossing', scripture_ref: 'John 1:5',
        narrative: 'Where four paths meet, a lantern burns on an iron post. Nobody lit it and nobody tends it, but the snow for six feet around it has melted to black earth, and you stand in that circle a moment longer than you need to.' },
      { km_mark: 7, title: 'The Frozen Beck', scripture_ref: 'Psalm 147:16',
        narrative: 'The stream is glass over moving water; you can hear it running underneath. Halfway. The cold has stopped being uncomfortable and started being simply the weather you live in now.' },
      { km_mark: 11, title: 'The Thaw Line', scripture_ref: 'Isaiah 1:18',
        narrative: 'One step the snow is knee-deep and the next it is patchy, sagging, dripping from the branches in a steady rattle. Something enormous has turned, and it turned while you were walking.' },
      { km_mark: 15, title: 'The First Green', scripture_ref: 'Psalm 74:17',
        narrative: 'Wet black soil, and pushing through it a green so new it looks lit from inside. You came the whole way through the cold on your own legs, and here is what was waiting on the other side of it.' },
    ],
  },
  // --- More ground to cover. Biblical routes follow real geography; the tales
  // are written in-genre with original names and places rather than borrowing
  // anyone's trademarked ones. ---
  {
    key: 'the-jordan-crossing',
    name: 'The Jordan Crossing',
    world: 'biblical',
    subtitle: 'Shittim to Gilgal, over a river in flood · 12 km',
    description: 'Twelve kilometres down the Jordan valley to a river running high with the spring melt, and across it. The distance is not the hard part. Stepping into water that has not yet moved is.',
    scripture_ref: 'Joshua 1:9',
    total_km: 12,
    terrain: 'flat',
    elevation_m: 120,
    activity_hint: 'walk',
    waypoints: [
      { km_mark: 0, title: 'The Camp at Shittim', scripture_ref: 'Joshua 1:9',
        narrative: 'Tents on the plain east of the river, struck at dawn. Forty years of walking end somewhere ahead of you today, and everyone knows it, and nobody says it.' },
      { km_mark: 4, title: 'The Valley Floor', scripture_ref: 'Joshua 3:4',
        narrative: 'Flat hot ground and the smell of the river before you can see it. You keep a distance from the front of the column, the way you were told, and the road does the rest.' },
      { km_mark: 7.5, title: 'The River in Flood', scripture_ref: 'Joshua 3:15',
        narrative: 'The Jordan overflows its banks all through the harvest, and it is doing it now: brown, fast, wider than the maps say. The first feet go in before the water does anything at all.' },
      { km_mark: 10, title: 'The Twelve Stones', scripture_ref: 'Joshua 4:7',
        narrative: 'One stone lifted from the riverbed for each tribe, carried up the far bank on a shoulder. They are heavy on purpose. Something you had to carry is the only kind of memory that lasts.' },
      { km_mark: 12, title: 'Gilgal', scripture_ref: 'Joshua 4:24',
        narrative: 'Camp pitched on the west bank, the stones set up in a circle. The river is behind you now and it will not be crossed backwards.' },
    ],
  },
  {
    key: 'elijah-to-horeb',
    name: 'The Flight to Horeb',
    world: 'biblical',
    subtitle: 'Beersheba to the mountain of God · 60 km',
    description: 'Sixty kilometres south into the Negev and the Sinai wastes, run by a man who set out asking to die and arrived to be fed, slept, and asked a question. A long haul for a long season.',
    scripture_ref: '1 Kings 19:8',
    total_km: 60,
    terrain: 'rolling',
    elevation_m: 1400,
    activity_hint: 'run',
    waypoints: [
      { km_mark: 0, title: 'Beersheba', scripture_ref: '1 Kings 19:3',
        narrative: 'You leave your servant at the edge of town and go on alone into the wilderness. Not bravery. You simply cannot be around anyone.' },
      { km_mark: 8, title: 'The Broom Tree', scripture_ref: '1 Kings 19:4',
        narrative: 'A day out, one thin tree, and enough shade for a person lying down. This is the low point of the whole route and it comes early, which is usually how it goes.' },
      { km_mark: 14, title: 'The Cake and the Jar', scripture_ref: '1 Kings 19:6',
        narrative: 'Bread baked on hot stones and a jar of water, set by your head while you slept. Nobody asked you to be better first. You were fed and told to sleep again.' },
      { km_mark: 32, title: 'The Long Middle', scripture_ref: '1 Kings 19:8',
        narrative: 'Halfway, and the strength of that one meal is somehow still in your legs. The desert does not change hour to hour. You stop expecting it to and the kilometres get easier.' },
      { km_mark: 48, title: 'The Cave', scripture_ref: '1 Kings 19:9',
        narrative: 'A split in the rock at the foot of the mountain, big enough to lie down in out of the wind. And a question, asked plainly: what are you doing here?' },
      { km_mark: 60, title: 'The Thin Silence', scripture_ref: '1 Kings 19:12',
        narrative: 'Wind that breaks rock, then earthquake, then fire, and none of it is the thing. Afterwards a still small voice, and you cover your face, because that is the one you came sixty kilometres to hear.' },
    ],
  },
  {
    key: 'the-shore-of-galilee',
    name: 'The Shore Road',
    world: 'biblical',
    subtitle: 'Capernaum around the north shore to Magdala · 9 km',
    description: 'Nine kilometres of lakeside path on the north-west shore of Galilee, past the fishing villages where most of this began. Flat, warm, and busier than the wilderness routes; this one is meant to be walked with someone.',
    scripture_ref: 'Matthew 4:18',
    total_km: 9,
    terrain: 'flat',
    elevation_m: 60,
    activity_hint: 'walk',
    waypoints: [
      { km_mark: 0, title: 'Capernaum', scripture_ref: 'Matthew 4:13',
        narrative: 'Black basalt houses right down to the water, nets drying on the stones. A working town, and the base of operations for three years of walking.' },
      { km_mark: 2.5, title: 'The Casting Nets', scripture_ref: 'Matthew 4:18',
        narrative: 'Two brothers throwing a circular net into the shallows, the way it is still done here. The call, when it came, came to people already in the middle of a shift.' },
      { km_mark: 5, title: 'The Hillside', scripture_ref: 'Matthew 5:1',
        narrative: 'The slope rises gently off the shore into a natural bowl that carries a voice a surprising distance. Sit down here for a minute. That is what everyone else did.' },
      { km_mark: 7, title: 'The Plain of Gennesaret', scripture_ref: 'Mark 6:53',
        narrative: 'Fertile flat ground between the hills and the lake, the most productive land on this shore. Boats beached here when the crossing went badly in the night.' },
      { km_mark: 9, title: 'Magdala', scripture_ref: 'Luke 8:2',
        narrative: 'A fish-salting town at the end of the shore road, and a name that a woman carried out of it into every gospel. Nine kilometres, walked at conversation pace.' },
    ],
  },
  {
    key: 'the-greenway-under-eaves',
    name: 'The Greenway Under Eaves',
    world: 'fantasy',
    subtitle: 'An old forest track through a wood that watches · 22 km',
    description: 'Twenty-two kilometres of green road running under a canopy so old the trees have opinions. Soft ground, long light, and the persistent feeling that the path is longer on the way in than on the way out.',
    scripture_ref: 'Psalm 96:12',
    total_km: 22,
    terrain: 'rolling',
    elevation_m: 320,
    activity_hint: 'ride',
    waypoints: [
      { km_mark: 0, title: 'The Hedge Gate', scripture_ref: 'Psalm 96:12',
        narrative: 'A gap in a hedge that has been growing since before the road had a name. Beyond it the track narrows and the noise of the fields stops all at once.' },
      { km_mark: 6, title: 'The Bonfire Glade', scripture_ref: 'Isaiah 55:12',
        narrative: 'A clearing burned open long ago and never grown back, ringed by trees leaning in. Grass, sun, and a good place to eat something. The road out of it is not the road you came in on, but it goes the right way.' },
      { km_mark: 12, title: 'The Withy Ford', scripture_ref: 'Psalm 1:3',
        narrative: 'Willows down to a brown stream running over gravel, shallow enough to ride. Halfway, and the wood has stopped feeling like it is deciding about you.' },
      { km_mark: 17, title: 'The Bare Downs', scripture_ref: 'Psalm 23:4',
        narrative: 'Out of the trees onto green hills with old grass-covered mounds on their crests. Open sky, wind, and a strong preference for not stopping here after dark.' },
      { km_mark: 22, title: 'The Road Again', scripture_ref: 'Proverbs 4:18',
        narrative: 'The track drops down to meet a proper road, rutted and honest and going east. Twenty-two kilometres of green under you, and the light ahead getting broader.' },
    ],
  },
  {
    key: 'the-white-tower-climb',
    name: 'The White Tower Climb',
    world: 'fantasy',
    subtitle: 'Seven walled tiers to the topmost court · 14 km',
    description: 'Fourteen kilometres of switchbacks up a city built in seven rings against the flank of a mountain, each tier walled, each gate set at a different angle so no charge can run straight through. A pure climb.',
    scripture_ref: 'Psalm 48:12',
    total_km: 14,
    terrain: 'climb',
    elevation_m: 900,
    activity_hint: 'ride',
    waypoints: [
      { km_mark: 0, title: 'The Great Gate', scripture_ref: 'Psalm 48:12',
        narrative: 'Iron and stone, and the whole city stacked overhead like a held breath. Walk about it, count her towers: you are going past every one of them.' },
      { km_mark: 4, title: 'The Third Tier', scripture_ref: 'Psalm 121:1',
        narrative: 'Above the market levels now, the road turning back on itself every few hundred metres. The gradient here is the honest part of the climb.' },
      { km_mark: 8, title: 'The Lamplighters Run', scripture_ref: 'Psalm 18:28',
        narrative: 'A long straight along the fifth wall where the lamps are lit end to end at dusk by people running the length of it. Halfway, and your legs know it.' },
      { km_mark: 11.5, title: 'The Court of the Fountain', scripture_ref: 'Psalm 42:1',
        narrative: 'A dead white tree over a dry basin in a courtyard of pale stone. Nothing grows here and everyone keeps it anyway, which is its own kind of hope.' },
      { km_mark: 14, title: 'The Topmost Wall', scripture_ref: 'Isaiah 40:31',
        narrative: 'Nine hundred metres of ascent behind you and the whole plain laid out below, rivers going silver toward the sea. You climbed the entire city.' },
    ],
  },
  {
    key: 'the-eastern-sea-road',
    name: 'The Eastern Sea Road',
    world: 'fantasy',
    subtitle: 'A coast road east until the water turns sweet · 30 km',
    description: 'Thirty kilometres of cliff road running east above a sea that grows brighter and stiller the further you go, until the light on it stops behaving like light on water. The long one.',
    scripture_ref: 'Psalm 139:9',
    total_km: 30,
    terrain: 'rolling',
    elevation_m: 480,
    activity_hint: 'ride',
    waypoints: [
      { km_mark: 0, title: 'The Harbour Steps', scripture_ref: 'Psalm 139:9',
        narrative: 'Wet stone, gulls, and rigging knocking in the wind. If I take the wings of the dawn and dwell in the uttermost parts of the sea: east is that way.' },
      { km_mark: 8, title: 'The Three Green Isles', scripture_ref: 'Psalm 97:1',
        narrative: 'Three low islands off the point, close enough to see smoke from. The road climbs above them and keeps going, which is the whole discipline of a long route.' },
      { km_mark: 15, title: 'The Dark Water', scripture_ref: 'Psalm 107:24',
        narrative: 'Halfway. The sea below goes suddenly deep and colourless and the wind drops to nothing. They that go down to the sea in ships see his works in the deep, including this stretch, which most people would rather not.' },
      { km_mark: 22, title: 'The Silver Sea', scripture_ref: 'Psalm 36:9',
        narrative: 'White lilies on the water from the cliff-foot to the horizon, thick enough to walk on if you were foolish. The air tastes of them and you find you need less food than you did.' },
      { km_mark: 26.5, title: 'The Standing Wave', scripture_ref: 'Psalm 42:7',
        narrative: 'A wall of green water that does not break and does not move, holding still at the end of the world with the sun coming through it.' },
      { km_mark: 30, title: 'The Last Headland', scripture_ref: 'Isaiah 25:8',
        narrative: 'The road runs out on a headland of short sweet grass. Thirty kilometres east, all of it under your own power, and the only thing left ahead is the light.' },
    ],
  },
  {
    key: 'the-hollow-hill',
    name: 'The Hollow Hill',
    world: 'fantasy',
    subtitle: 'A ruined orchard, a green mound, a door · 18 km',
    description: 'Eighteen kilometres through the overgrown grounds of a house that has been gone for centuries, to a grassy mound with a stone door in its side. Ruins, apple trees gone wild, and a thin place at the end of it.',
    scripture_ref: 'Isaiah 61:4',
    total_km: 18,
    terrain: 'rolling',
    elevation_m: 340,
    activity_hint: 'run',
    waypoints: [
      { km_mark: 0, title: 'The Wild Orchard', scripture_ref: 'Isaiah 61:4',
        narrative: 'Apple trees in rows nobody has pruned in living memory, fruit small and sharp and free. Somebody planted these on purpose for people who would never meet them.' },
      { km_mark: 5, title: 'The Broken Hall', scripture_ref: 'Psalm 102:26',
        narrative: 'Four walls and no roof, grass growing up through a floor that was once polished. They shall perish, but you remain, and the grass, apparently, remains too.' },
      { km_mark: 9, title: 'The Well in the Courtyard', scripture_ref: 'Isaiah 12:3',
        narrative: 'A well-head choked with ivy, and cold clean water still standing in it. Halfway. Some things keep working long after everyone stops maintaining them.' },
      { km_mark: 14, title: 'The Green Mound', scripture_ref: 'Psalm 24:3',
        narrative: 'A hill too round to be an accident, ringed by old thorn trees. The path spirals up it rather than going straight, and you take the spiral, because that is what it is for.' },
      { km_mark: 18, title: 'The Stone Door', scripture_ref: 'Psalm 118:19',
        narrative: 'A doorframe of three great stones set into the side of the mound, with nothing behind it but more hillside, from this angle. Eighteen kilometres to stand in front of an open door.' },
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

// Advance ONE journey by a measured distance, mid-session. Used by the live
// "ride/run the route" mode, which streams real distance from a smart trainer,
// treadmill, GPS or a user-declared pace and persists it as it goes — so a
// dropped connection or page refresh never erases someone's session.
// Same crossing/completion semantics as applyWorkoutToJourneys, for one route.
function advanceJourney(userId, journeyKey, addKm) {
  const add = Number(addKm);
  if (!Number.isFinite(add) || add <= 0) return null;
  const j = db.prepare(`
    SELECT j.*, uj.progress_km, uj.last_waypoint_km, uj.completed_at
    FROM journeys j JOIN user_journeys uj ON uj.journey_id = j.id AND uj.user_id = ?
    WHERE j.key = ?
  `).get(userId, journeyKey);
  if (!j || j.completed_at) return null;

  // Round on store: a live session adds hundreds of tiny increments, and raw
  // float accumulation surfaces as 3.5999999999999996 km in the UI.
  const progress = Math.min(Math.round((Number(j.progress_km) + add) * 1000) / 1000, j.total_km);
  const lastWp = Number(j.last_waypoint_km);
  const crossed = db.prepare(
    'SELECT * FROM journey_waypoints WHERE journey_id = ? AND km_mark > ? AND km_mark <= ? ORDER BY km_mark'
  ).all(j.id, lastWp, progress);
  const newLastWp = crossed.length ? crossed[crossed.length - 1].km_mark : lastWp;
  const completed = progress >= j.total_km;
  db.prepare('UPDATE user_journeys SET progress_km = ?, last_waypoint_km = ?, completed_at = ? WHERE user_id = ? AND journey_id = ?')
    .run(progress, newLastWp, completed ? new Date().toISOString() : null, userId, j.id);

  return {
    journey: j,
    added_km: add,
    progress_km: progress,
    percent: Math.min(100, Math.round((progress / j.total_km) * 100)),
    waypoints: crossed,
    completed,
  };
}

module.exports = { JOURNEYS, ASSUMED_KMH, ensureJourneys, applyWorkoutToJourneys, kmFromWorkout, advanceJourney };
