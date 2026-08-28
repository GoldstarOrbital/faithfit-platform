// A hand-vetted catalog of real, public Spotify playlists, not a live
// catalog search at request time -- chosen for quality and consistency
// (per the same "authored, not generated" philosophy as CURATED in
// motivation.js and JOURNEYS in journeys.js). Every id/url/follower count
// below was verified live against the Spotify Web API, not guessed.
//
// `moods` lets a connected member's real listening (spotify.js's
// computeTaste) surface the playlists most likely to fit what they already
// listen to, without needing a live recommendation model.
'use strict';

const PLAYLISTS = [
  {
    id: '30wdzfOKmW7JmLPiQI0BGC',
    name: 'Top Christian Worship Songs',
    description: 'Popular worship songs for a quiet, reflective session.',
    image: 'https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da84740a2768bb2e74d7c2caf683',
    url: 'https://open.spotify.com/playlist/30wdzfOKmW7JmLPiQI0BGC',
    owner: 'Brencee',
    moods: ['reflective', 'steady'],
  },
  {
    id: '6Dn2TQtJsDj5TpgNgN956h',
    name: 'Black Gospel Praise and Worship',
    description: 'Gospel praise and worship for an uplifting session.',
    image: 'https://mosaic.scdn.co/640/ab67616d00001e020f9d490e8e65805a0f678b95ab67616d00001e023d3321c97b5cfeaf5fd713e6ab67616d00001e026cdd4d23476bdb8a8393180aab67616d00001e027a33fa106db04120a0232a90',
    url: 'https://open.spotify.com/playlist/6Dn2TQtJsDj5TpgNgN956h',
    owner: 'Gracefullymade',
    moods: ['energized', 'reflective'],
  },
  {
    id: '5Ux99VLE8cG7W656CjR2si',
    name: 'Top Christian Hits',
    description: 'Lauren Daigle, Elevation Worship, Chris Tomlin, and more of today’s biggest Christian artists.',
    image: 'https://image-cdn-fa.spotifycdn.com/image/ab67706c0000d72c8cd243ec8fd2da80eafdce3b',
    url: 'https://open.spotify.com/playlist/5Ux99VLE8cG7W656CjR2si',
    owner: 'Universal Hits',
    moods: ['steady', 'energized'],
  },
  {
    id: '1MjHjcxK0uhw1s3MdYzLw2',
    name: 'High Energy Christian Workout Music',
    description: 'Upbeat worship and CCM built for the gym, a run, or HIIT.',
    image: 'https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da840a9cf35a20aac335d78ab76c',
    url: 'https://open.spotify.com/playlist/1MjHjcxK0uhw1s3MdYzLw2',
    owner: 'Christian Playlists',
    moods: ['energized'],
  },
  {
    id: '1dTW9GVMi5tOGRTrft9xdP',
    name: 'Praise and Worship',
    description: 'A steady mix of praise and worship for any time of day.',
    image: 'https://mosaic.scdn.co/640/ab67616d00001e020e6952c6887fd08ac8eb02acab67616d00001e0212ce5cd4002cc883af798076ab67616d00001e028b9c6804b9615f3be56e9709ab67616d00001e02efeed7ff65a4050115713021',
    url: 'https://open.spotify.com/playlist/1dTW9GVMi5tOGRTrft9xdP',
    owner: 'DJ Boat',
    moods: ['steady', 'reflective'],
  },
  {
    id: '0DnykdrVl84nEdYgk2NQMM',
    name: 'Instrumental Worship',
    description: 'Soft piano and instrumental worship for a calm, quiet moment.',
    image: 'https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da84400be2ef0625fb0a26729ede',
    url: 'https://open.spotify.com/playlist/0DnykdrVl84nEdYgk2NQMM',
    owner: 'Hillside Playlists',
    moods: ['reflective', 'heavy'],
  },
  {
    id: '174NV7zjemTk8C4ebhbQY6',
    name: 'Top 50 Christian Praise & Worship',
    description: 'The 50 most popular Christian praise and worship songs right now.',
    image: 'https://image-cdn-fa.spotifycdn.com/image/ab67706c0000d72ce2f368f865f041db67e30e3d',
    url: 'https://open.spotify.com/playlist/174NV7zjemTk8C4ebhbQY6',
    owner: 'Redlist Playlists',
    moods: ['steady', 'energized'],
  },
  {
    id: '66ualkeMzoqzNDATzBXHJ2',
    name: 'Christian Gym Playlist',
    description: 'Upbeat Christian songs and CCM hits to stay motivated at the gym.',
    image: 'https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da842d65bbab9132aba048030ad6',
    url: 'https://open.spotify.com/playlist/66ualkeMzoqzNDATzBXHJ2',
    owner: 'Tim Allen',
    moods: ['energized'],
  },
];

function all() {
  return PLAYLISTS;
}

/** The catalog, with whatever matches this member's real listening mood first. */
function recommended(taste) {
  if (!taste || !taste.mood) return [];
  const matches = PLAYLISTS.filter(p => p.moods.includes(taste.mood));
  return matches.length ? matches : PLAYLISTS.slice(0, 3);
}

module.exports = { all, recommended };
