// Real church discovery via OpenStreetMap's free Overpass API (no API key, no
// cost) — the same data source the app's Leaflet maps already use. Never
// fabricates a church name or location: if Overpass returns nothing, we return
// an empty array and let the UI say so.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const TIMEOUT_MS = 15000;

function buildAddress(tags) {
  if (!tags) return null;
  const parts = [];
  const num = tags['addr:housenumber'];
  const street = tags['addr:street'];
  if (num && street) parts.push(`${num} ${street}`);
  else if (street) parts.push(street);
  if (tags['addr:city']) parts.push(tags['addr:city']);
  if (tags['addr:state']) parts.push(tags['addr:state']);
  if (tags['addr:postcode']) parts.push(tags['addr:postcode']);
  return parts.length ? parts.join(', ') : null;
}

async function searchNearbyChurches({ lat, lng, radiusM = 5000 } = {}) {
  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="place_of_worship"]["religion"="christian"](around:${radiusM},${lat},${lng});
      way["amenity"="place_of_worship"]["religion"="christian"](around:${radiusM},${lat},${lng});
    );
    out center tags;
  `;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'faithfit-church-search/1.0 (contact: alexmarcusgoldsmith@gmail.com)',
      },
      body: 'data=' + encodeURIComponent(query),
    });
  } finally {
    clearTimeout(to);
  }

  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  const results = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const name = tags.name;
    if (!name) continue; // skip unnamed nodes — never show an unnamed node as a church
    const elLat = el.lat ?? (el.center && el.center.lat);
    const elLng = el.lon ?? (el.center && el.center.lon);
    if (elLat == null || elLng == null) continue;
    results.push({
      osm_id: `${el.type}/${el.id}`,
      name,
      lat: elLat,
      lng: elLng,
      address: buildAddress(tags),
    });
  }
  return results;
}

module.exports = { searchNearbyChurches };
