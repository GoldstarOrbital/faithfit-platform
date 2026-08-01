// Functioning Faith live workout sensors.
//
// Four honest sources of "how fast am I actually going", in preference order:
//   1. A smart trainer / spin bike / treadmill speaking the Bluetooth SIG
//      Fitness Machine Service (FTMS) — the open standard real equipment
//      advertises. No vendor SDK, no API key.
//   2. A speed/cadence sensor (CSC) or running footpod (RSC).
//   3. GPS outdoors.
//   4. A pace the user declares themselves.
//
// Rule for this whole file: we never invent a number. If nothing is connected,
// speed is null and the UI says so. A declared pace is labelled as declared,
// never presented as measured.

(function (global) {
  'use strict';

  // --- Bluetooth SIG assigned numbers -------------------------------------
  const FTMS_SERVICE = 0x1826;          // Fitness Machine Service
  const INDOOR_BIKE_DATA = 0x2ad2;      // spin bikes / smart trainers
  const TREADMILL_DATA = 0x2acd;        // treadmills
  const CSC_SERVICE = 0x1816;           // Cycling Speed and Cadence
  const CSC_MEASUREMENT = 0x2a5b;
  const RSC_SERVICE = 0x1814;           // Running Speed and Cadence
  const RSC_MEASUREMENT = 0x2a53;

  // Wheel circumference for deriving speed from CSC wheel revolutions.
  // 2.096 m is a 700x23c road wheel — the common default. Configurable.
  let wheelCircumferenceM = 2.096;

  // --- Frame parsers -------------------------------------------------------
  // All of these read the flags field FIRST and bounds-check every optional
  // field before reading it: a short or malformed frame must return null, not
  // throw, or one bad packet would kill the whole session.

  // FTMS Indoor Bike Data (0x2AD2). Flags are uint16 LE at offset 0.
  // Field order per spec: Instantaneous Speed, Average Speed, Instantaneous
  // Cadence, Average Cadence, Total Distance, Resistance, Instantaneous Power…
  // Bit 0 is "More Data": when it is 0, Instantaneous Speed IS present.
  function parseIndoorBikeData(dv) {
    if (!dv || dv.byteLength < 4) return null;
    const flags = dv.getUint16(0, true);
    let o = 2;
    const out = { speedKmh: null, cadenceRpm: null, powerW: null, totalDistanceM: null };

    if (!(flags & 0x0001)) {                       // bit0 clear => inst. speed present
      if (o + 2 > dv.byteLength) return out;
      out.speedKmh = dv.getUint16(o, true) / 100;  // uint16, 0.01 km/h
      o += 2;
    }
    if (flags & 0x0002) { if (o + 2 > dv.byteLength) return out; o += 2; }   // average speed
    if (flags & 0x0004) {                                                     // inst. cadence
      if (o + 2 > dv.byteLength) return out;
      out.cadenceRpm = dv.getUint16(o, true) / 2;  // uint16, 0.5 /min
      o += 2;
    }
    if (flags & 0x0008) { if (o + 2 > dv.byteLength) return out; o += 2; }   // average cadence
    if (flags & 0x0010) {                                                     // total distance
      if (o + 3 > dv.byteLength) return out;
      out.totalDistanceM = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
      o += 3;
    }
    if (flags & 0x0020) { if (o + 2 > dv.byteLength) return out; o += 2; }   // resistance
    if (flags & 0x0040) {                                                     // inst. power
      if (o + 2 > dv.byteLength) return out;
      out.powerW = dv.getInt16(o, true);
      o += 2;
    }
    return out;
  }

  // FTMS Treadmill Data (0x2ACD). Same shape: uint16 flags, bit0 "More Data"
  // clear => Instantaneous Speed present as uint16 in 0.01 km/h.
  function parseTreadmillData(dv) {
    if (!dv || dv.byteLength < 4) return null;
    const flags = dv.getUint16(0, true);
    let o = 2;
    const out = { speedKmh: null, inclinePct: null, totalDistanceM: null };

    if (!(flags & 0x0001)) {
      if (o + 2 > dv.byteLength) return out;
      out.speedKmh = dv.getUint16(o, true) / 100;
      o += 2;
    }
    if (flags & 0x0002) { if (o + 2 > dv.byteLength) return out; o += 2; }   // average speed
    if (flags & 0x0004) {                                                     // total distance
      if (o + 3 > dv.byteLength) return out;
      out.totalDistanceM = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
      o += 3;
    }
    if (flags & 0x0008) {                                                     // inclination
      if (o + 2 > dv.byteLength) return out;
      out.inclinePct = dv.getInt16(o, true) / 10;
      o += 2;
    }
    return out;
  }

  // CSC Measurement (0x2A5B): uint8 flags; bit0 => cumulative wheel revs
  // (uint32) + last wheel event time (uint16, 1/1024 s). Speed is derived from
  // the deltas between two notifications, so it needs prior state.
  function makeCscParser() {
    let lastRevs = null, lastTime = null;
    return function parseCsc(dv) {
      if (!dv || dv.byteLength < 1) return null;
      const flags = dv.getUint8(0);
      if (!(flags & 0x01)) return { speedKmh: null };      // no wheel data in this frame
      if (dv.byteLength < 7) return { speedKmh: null };
      const revs = dv.getUint32(1, true);
      const t = dv.getUint16(5, true);                      // 1/1024 s, wraps at 64s
      if (lastRevs === null) { lastRevs = revs; lastTime = t; return { speedKmh: null }; }
      let dRev = revs - lastRevs;
      let dT = t - lastTime;
      if (dT < 0) dT += 65536;                              // handle 16-bit wrap
      lastRevs = revs; lastTime = t;
      if (dT <= 0 || dRev < 0) return { speedKmh: null };
      const seconds = dT / 1024;
      const metres = dRev * wheelCircumferenceM;
      return { speedKmh: seconds > 0 ? (metres / seconds) * 3.6 : null };
    };
  }

  // RSC Measurement (0x2A53): uint8 flags, then instantaneous speed uint16 in
  // 1/256 m/s, then cadence uint8 (steps/min).
  function parseRscData(dv) {
    if (!dv || dv.byteLength < 4) return null;
    const speedMs = dv.getUint16(1, true) / 256;
    return { speedKmh: speedMs * 3.6, cadenceSpm: dv.getUint8(3) };
  }

  // Heart Rate Measurement (0x2A37). Flags bit 0 selects uint8 vs uint16 BPM.
  // Contact bits are respected: a strap reporting "not worn" gives no number
  // rather than a stale one.
  function parseHeartRate(dv) {
    if (!dv || dv.byteLength < 2) return { hr: null };
    const flags = dv.getUint8(0);
    const wide = flags & 0x01;
    if (wide && dv.byteLength < 3) return { hr: null };
    const hr = wide ? dv.getUint16(1, true) : dv.getUint8(1);
    // Bit 1 = contact supported, bit 2 = contact detected.
    if ((flags & 0x02) && !(flags & 0x04)) return { hr: null, contact: false };
    if (!Number.isFinite(hr) || hr <= 0 || hr > 250) return { hr: null };
    return { hr, contact: true };
  }

  // --- Live session --------------------------------------------------------
  // Integrates whatever speed source is active into accumulated distance.
  function createSession(opts) {
    const onUpdate = (opts && opts.onUpdate) || function () {};
    const state = {
      source: null,          // 'ftms-bike' | 'ftms-treadmill' | 'csc' | 'rsc' | 'gps' | 'manual'
      sourceLabel: 'Not connected',
      speedKmh: null,
      cadence: null,
      powerW: null,
      distanceKm: 0,
      elapsedSec: 0,
      running: false,
      device: null,
      declaredPaceKmh: null, // only set in manual mode; always labelled as declared
      // Heart rate is null unless a real monitor is streaming. Nothing in this
      // app may substitute an estimate for a measurement.
      hr: null,
      hrMeasured: false,
      hrLabel: 'No monitor',
      hrDevice: null,
      recentHr: [],
      recentSpeeds: [],
      // GPS readiness. A first fix is often hundreds of metres out and carries
      // no speed at all; starting a route on it would credit distance the rider
      // never covered, as the receiver walks the position in to the true one.
      gpsReady: false,
      gpsAccuracyM: null,
      gpsFixCount: 0,
      gpsHasSpeed: false,
      gpsStatus: null,
      // How long we have been trying, and whether the rider may start
      // regardless. Nobody gets trapped behind a fix that is not coming.
      gpsWaitedMs: 0,
      gpsCanOverride: false,
      gpsFatal: false,
    };
    let tickTimer = null, lastTickAt = null, gpsWatchId = null, lastGpsPos = null;
    let gpsStartedAt = null, gpsTicker = null;

    function emit() {
      if (Number.isFinite(state.speedKmh) && state.speedKmh !== null && state.running) {
        state.recentSpeeds.push(state.speedKmh);
        if (state.recentSpeeds.length > 120) state.recentSpeeds.shift();
      }
      onUpdate({ ...state });
    }

    // Integrate current speed into distance. Called on a fixed tick so every
    // source (BLE push, GPS, manual) accumulates the same way.
    function tick() {
      const now = Date.now();
      if (lastTickAt == null) { lastTickAt = now; return; }
      const dtSec = (now - lastTickAt) / 1000;
      lastTickAt = now;
      if (!state.running) return;
      state.elapsedSec += dtSec;
      const kmh = state.source === 'manual' ? state.declaredPaceKmh : state.speedKmh;
      if (kmh != null && kmh > 0) state.distanceKm += (kmh * dtSec) / 3600;
      emit();
    }

    async function connectFtms() {
      if (!navigator.bluetooth) throw new Error('web_bluetooth_unsupported');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE] }],
        optionalServices: [FTMS_SERVICE, CSC_SERVICE, RSC_SERVICE],
      });
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(FTMS_SERVICE);

      // A machine advertises whichever data characteristic matches what it is.
      let ch = null, kind = null;
      try { ch = await svc.getCharacteristic(INDOOR_BIKE_DATA); kind = 'ftms-bike'; }
      catch { ch = await svc.getCharacteristic(TREADMILL_DATA); kind = 'ftms-treadmill'; }

      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (e) => {
        const parsed = kind === 'ftms-bike' ? parseIndoorBikeData(e.target.value) : parseTreadmillData(e.target.value);
        if (!parsed) return;
        if (parsed.speedKmh != null) state.speedKmh = parsed.speedKmh;
        if (parsed.cadenceRpm != null) state.cadence = parsed.cadenceRpm;
        if (parsed.powerW != null) state.powerW = parsed.powerW;
        emit();
      });
      device.addEventListener('gattserverdisconnected', () => {
        state.speedKmh = null; state.sourceLabel = 'Trainer disconnected'; emit();
      });
      state.device = device;
      state.source = kind;
      state.sourceLabel = (kind === 'ftms-bike' ? 'Smart bike' : 'Treadmill') + ' · ' + (device.name || 'connected');
      emit();
      return kind;
    }

    async function connectSensor() {
      if (!navigator.bluetooth) throw new Error('web_bluetooth_unsupported');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [CSC_SERVICE] }, { services: [RSC_SERVICE] }],
        optionalServices: [CSC_SERVICE, RSC_SERVICE],
      });
      const server = await device.gatt.connect();
      let svc, ch, kind, parse;
      try {
        svc = await server.getPrimaryService(CSC_SERVICE);
        ch = await svc.getCharacteristic(CSC_MEASUREMENT);
        kind = 'csc'; parse = makeCscParser();
      } catch {
        svc = await server.getPrimaryService(RSC_SERVICE);
        ch = await svc.getCharacteristic(RSC_MEASUREMENT);
        kind = 'rsc'; parse = parseRscData;
      }
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (e) => {
        const parsed = parse(e.target.value);
        if (parsed && parsed.speedKmh != null) { state.speedKmh = parsed.speedKmh; emit(); }
      });
      device.addEventListener('gattserverdisconnected', () => {
        state.speedKmh = null; state.sourceLabel = 'Sensor disconnected'; emit();
      });
      state.device = device;
      state.source = kind;
      state.sourceLabel = (kind === 'csc' ? 'Speed sensor' : 'Footpod') + ' · ' + (device.name || 'connected');
      emit();
      return kind;
    }

    // What counts as good enough to start on.
    //
    // 50 m, not 25. A phone outdoors with a clear sky settles to 5-15 m, but
    // between buildings, under cloud, or in the first half-minute of a cold
    // start it will sit in the 30-60 m band for a long time — and indoors it
    // may never do better. 25 m was a number that looked rigorous and in
    // practice just meant "wait forever" for anyone not standing in a field.
    // The real accuracy is always shown, so this is a threshold, not a claim.
    const GPS_ACCURACY_M = 50;
    const GPS_MIN_FIXES = 2;     // one good-looking fix can still be a fluke
    // How long to try before offering to start anyway. Long enough that a
    // normal fix arrives first; short enough that nobody stands in the cold
    // wondering whether the app is broken.
    const GPS_OVERRIDE_AFTER_MS = 8000;

    function gpsAssess() {
      const acc = state.gpsAccuracyM;
      const waited = gpsStartedAt ? Date.now() - gpsStartedAt : 0;
      // An override is offered once we have *something* real to report and have
      // been trying a while — or immediately when GPS is settled-impossible
      // here. Requiring a fix was right for a slow lock and wrong for a refused
      // one: with permission denied no fix ever arrives, so the rider was
      // trapped on this screen permanently.
      state.gpsWaitedMs = waited;
      state.gpsCanOverride = state.gpsFatal ||
        (acc != null && waited >= GPS_OVERRIDE_AFTER_MS);

      // The error handler's message explains the real cause; do not overwrite
      // it with a description of a wait that cannot end.
      if (state.gpsFatal) { state.gpsReady = false; return; }
      if (acc == null) { state.gpsStatus = 'Waiting for a GPS fix…'; state.gpsReady = false; return; }
      if (acc > GPS_ACCURACY_M) {
        state.gpsStatus = 'Getting an accurate fix… currently ±' + Math.round(acc) + ' m';
        state.gpsReady = false; return;
      }
      if (state.gpsFixCount < GPS_MIN_FIXES) {
        state.gpsStatus = 'Confirming the fix… (' + state.gpsFixCount + '/' + GPS_MIN_FIXES + ')';
        state.gpsReady = false; return;
      }
      // Deliberately NOT waiting for a speed reading here.
      //
      // A speed of zero is what a phone reports when you are standing still,
      // and many devices report null instead. Requiring one before letting
      // someone start was circular: you cannot register movement until you
      // start, and you could not start until you registered movement. People
      // were told to "take a few steps" while stood on the start line.
      state.gpsStatus = 'GPS ready · ±' + Math.round(acc) + ' m';
      state.gpsReady = true;
    }

    function useGps() {
      if (!navigator.geolocation) throw new Error('gps_unsupported');
      lastGpsPos = null;
      state.gpsReady = false; state.gpsAccuracyM = null;
      state.gpsFixCount = 0; state.gpsHasSpeed = false;
      state.gpsCanOverride = false; state.gpsWaitedMs = 0; state.gpsFatal = false;
      gpsStartedAt = Date.now();
      state.gpsStatus = 'Waiting for a GPS fix…';
      // watchPosition only fires on a new fix. Without a ticker, someone whose
      // phone has gone quiet sees a frozen "Waiting…" and no override is ever
      // offered, because nothing re-evaluates the elapsed time.
      if (gpsTicker) clearInterval(gpsTicker);
      gpsTicker = setInterval(() => {
        if (state.source !== 'gps' || state.gpsReady) return;
        gpsAssess();
        emit();
      }, 1000);
      gpsWatchId = navigator.geolocation.watchPosition((pos) => {
        // Prefer the device's own speed when it reports one; otherwise derive
        // it from successive fixes.
        if (pos.coords.speed != null && !Number.isNaN(pos.coords.speed)) {
          state.speedKmh = Math.max(0, pos.coords.speed * 3.6);
        } else if (lastGpsPos) {
          const R = 6371, toRad = (d) => (d * Math.PI) / 180;
          const dLat = toRad(pos.coords.latitude - lastGpsPos.latitude);
          const dLon = toRad(pos.coords.longitude - lastGpsPos.longitude);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lastGpsPos.latitude)) * Math.cos(toRad(pos.coords.latitude)) * Math.sin(dLon / 2) ** 2;
          const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const dtH = (pos.timestamp - lastGpsPos.timestamp) / 3600000;
          if (dtH > 0) state.speedKmh = km / dtH;
        }
        // Readiness is judged on the fix itself, not on how long we have waited.
        state.gpsAccuracyM = (pos.coords.accuracy != null && isFinite(pos.coords.accuracy))
          ? pos.coords.accuracy : null;
        // Accuracy fluctuates sample to sample, so one poor reading steps the
        // counter back rather than wiping it. Resetting to zero meant a phone
        // that alternated good/bad could never accumulate a run and stayed
        // stuck at "Confirming the fix…" indefinitely.
        if (state.gpsAccuracyM != null && state.gpsAccuracyM <= GPS_ACCURACY_M) state.gpsFixCount++;
        else state.gpsFixCount = Math.max(0, state.gpsFixCount - 1);
        if (state.speedKmh != null && isFinite(state.speedKmh)) state.gpsHasSpeed = true;
        gpsAssess();

        lastGpsPos = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, timestamp: pos.timestamp };
        emit();
      }, (err) => {
        state.sourceLabel = 'GPS unavailable';
        state.gpsReady = false;
        // Code 1 is PERMISSION_DENIED: settled, and waiting changes nothing.
        // Codes 2 and 3 may still resolve on a later fix, so they keep the
        // normal countdown and the watch stays up.
        const denied = !!(err && err.code === 1);
        if (denied) state.gpsFatal = true;
        state.gpsStatus = denied
          ? 'Location permission was declined — you can start anyway, but the route will not be recorded.'
          : 'GPS is not available here.';
        gpsAssess();
        emit();
      // maximumAge 0: never start on a cached fix from somewhere the rider no
      // longer is.
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      state.source = 'gps';
      state.sourceLabel = 'GPS';
      emit();
    }

    // A pace the user tells us. Labelled as declared everywhere it surfaces —
    // this is an input, not a measurement.
    function useDeclaredPace(kmh) {
      state.source = 'manual';
      state.declaredPaceKmh = Number(kmh) || 0;
      state.speedKmh = null;
      state.sourceLabel = 'Declared pace · ' + state.declaredPaceKmh + ' km/h';
      emit();
    }

    function start() {
      state.running = true;
      lastTickAt = Date.now();
      if (!tickTimer) tickTimer = setInterval(tick, 1000);
      emit();
    }
    function pause() { state.running = false; emit(); }
    function stop() {
      state.running = false;
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      if (gpsWatchId != null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
      if (gpsTicker) { clearInterval(gpsTicker); gpsTicker = null; }
      gpsStartedAt = null;
      try { if (state.device && state.device.gatt.connected) state.device.gatt.disconnect(); } catch {}
      try { if (state.hrDevice && state.hrDevice.gatt.connected) state.hrDevice.gatt.disconnect(); } catch {}
      emit();
    }

    // A heart-rate strap is a separate connection from the speed source, so it
    // pairs independently: you can ride a dumb treadmill with a real strap, or
    // a smart bike with none.
    async function connectHr() {
      if (!navigator.bluetooth) throw new Error('web_bluetooth_unsupported');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['heart_rate'],
      });
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService('heart_rate');
      const ch = await svc.getCharacteristic('heart_rate_measurement');
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (e) => {
        const r = parseHeartRate(e.target.value);
        if (r.hr == null) return;           // dropped frame or strap not in contact
        state.hr = r.hr;
        state.hrMeasured = true;
        state.recentHr.push(r.hr);
        if (state.recentHr.length > 60) state.recentHr.shift();
        emit();
      });
      device.addEventListener('gattserverdisconnected', () => {
        // Go blank rather than hold the last reading: a stale BPM is a lie.
        state.hr = null; state.hrMeasured = false; state.hrLabel = 'Monitor disconnected';
        state.recentHr = [];
        emit();
      });
      state.hrDevice = device;
      state.hrLabel = device.name || 'Heart rate monitor';
      emit();
      return device;
    }

    return {
      state,
      connectFtms, connectSensor, useGps, useDeclaredPace, connectHr,
      start, pause, stop,
      setWheelCircumference: (m) => { if (m > 0) wheelCircumferenceM = m; },
    };
  }

  global.FunctioningFaithSensors = {
    createSession,
    // exported for testing against synthetic frames
    _parsers: { parseIndoorBikeData, parseTreadmillData, parseRscData, makeCscParser, parseHeartRate },
  };
})(window);
