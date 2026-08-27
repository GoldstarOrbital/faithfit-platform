/**
 * "Sync & correct with GPS" -- an opt-in, after-the-fact cleanup of a
 * recorded route, the same idea Strava's own corrected distance/elevation
 * offers. Two independent problems, two independent fixes:
 *
 *   1. Distance: raw phone GPS occasionally reports an impossible jump (tree
 *      cover, urban canyon, a satellite re-lock) that inflates total
 *      distance. Points implying a speed no one could actually be moving at
 *      are dropped before distance is re-summed from what's left.
 *
 *   2. Elevation: phone barometric/GPS altitude is noisy enough that
 *      naively summing every up/down tick wildly overstates real elevation
 *      gain. This replaces it with real terrain elevation from a public DEM
 *      (Open-Meteo's elevation API -- free, no key, no rate-limit hoops),
 *      sampled at intervals along the (already-cleaned) route and smoothed
 *      before gain/loss is computed.
 *
 * Never invents a route: if the DEM lookup fails, elevation is left alone
 * and only the distance correction (pure geometry, no external dependency)
 * still applies.
 */
'use strict';

const EARTH_RADIUS_M = 6371000;

// Generous ceilings, not precise ones -- the goal is only to catch an
// obviously-impossible GPS jump, never to second-guess a genuinely fast mile.
const MAX_SPEED_KMH = {
  Run: 30, Walk: 12, Hike: 12, Cycle: 75, Swim: 8, Row: 25, Elliptical: 25,
};
const DEFAULT_MAX_SPEED_KMH = 45;

function haversineMeters(a, b) {
  const [lat1, lon1] = a, [lat2, lon2] = b;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Drops points whose implied speed from the last KEPT point is impossible. */
function cleanRoute(points, activityType) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const maxSpeedMS = ((MAX_SPEED_KMH[activityType] || DEFAULT_MAX_SPEED_KMH) * 1000) / 3600;
  const cleaned = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const curr = points[i];
    if (!Array.isArray(curr) || curr.length !== 2) continue;
    // GPS points carry no per-point timestamp in the stored path, only order
    // -- assume a plausible minimum real-world spacing (1s) between samples
    // so a burst of near-simultaneous points doesn't get treated as infinite
    // speed and dropped wholesale.
    const distM = haversineMeters(prev, curr);
    if (distM / 1 <= maxSpeedMS * 3) { cleaned.push(curr); continue; }
    // Otherwise this point implies an impossible jump relative to the last
    // kept one -- skip it and let the next point be judged against the same
    // last-good point, rather than compounding the error.
  }
  return cleaned.length >= 2 ? cleaned : points;
}

function totalDistanceKm(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += haversineMeters(points[i - 1], points[i]);
  return m / 1000;
}

/** Evenly-spaced indices, always including the first and last point. */
function sampleIndices(length, maxSamples) {
  if (length <= maxSamples) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (maxSamples - 1);
  return Array.from({ length: maxSamples }, (_, i) => Math.round(i * step));
}

async function fetchElevations(points) {
  const lats = points.map(p => p[0].toFixed(5)).join(',');
  const lons = points.map(p => p[1].toFixed(5)).join(',');
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.elevation) && data.elevation.length === points.length ? data.elevation : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** A short moving average -- smooths DEM sampling noise, not real terrain. */
function smooth(series, window) {
  if (series.length <= window) return series;
  const half = Math.floor(window / 2);
  return series.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(series.length, i + half + 1);
    const slice = series.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Gain/loss from a smoothed elevation series, ignoring sub-threshold noise. */
function gainLoss(elevations, thresholdM = 1.5) {
  let gain = 0, loss = 0, ref = elevations[0];
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - ref;
    if (delta >= thresholdM) { gain += delta; ref = elevations[i]; }
    else if (delta <= -thresholdM) { loss += -delta; ref = elevations[i]; }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

/**
 * @param {Array<[number, number]>} rawPoints stored gps_path, [lat, lng] pairs
 * @param {string} activityType Functioning Faith's own activity vocabulary
 * @returns {{distanceKm: number, elevationGainM: number|null, elevationLossM: number|null, pointsUsed: number, pointsDropped: number}}
 */
async function correctRoute(rawPoints, activityType) {
  const points = (rawPoints || []).filter(p => Array.isArray(p) && p.length === 2
    && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length < 2) return null;

  const cleaned = cleanRoute(points, activityType);
  const distanceKm = Math.round(totalDistanceKm(cleaned) * 1000) / 1000;

  let elevationGainM = null, elevationLossM = null;
  const sampleAt = sampleIndices(cleaned.length, 120).map(i => cleaned[i]);
  const elevations = await fetchElevations(sampleAt);
  if (elevations) {
    const { gain, loss } = gainLoss(smooth(elevations, 3));
    elevationGainM = gain;
    elevationLossM = loss;
  }

  return {
    distanceKm, elevationGainM, elevationLossM,
    pointsUsed: cleaned.length, pointsDropped: points.length - cleaned.length,
  };
}

module.exports = { correctRoute, haversineMeters, cleanRoute, totalDistanceKm };
