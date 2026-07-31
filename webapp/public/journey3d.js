// Functioning Faith 3D journey world.
//
// A lightweight WebGL scene (Three.js, loaded from a CDN like Leaflet already
// is) that renders the route you are actually travelling. Real distance from a
// smart trainer, treadmill, GPS or a declared pace drives the camera forward;
// waypoint gates stand at their real km marks along the road.
//
// The worlds are written in-genre rather than borrowed: original place-names
// and original geometry, evoking desert scripture country, high fantasy road,
// ashen plain and winter wood without using anyone's trademarked names or art.
//
// Everything here degrades: no WebGL, no Three.js, or a lost context all fall
// back to the existing 2D SVG route map rather than showing a broken canvas.

(function (global) {
  'use strict';

  const THREE_URL = 'https://unpkg.com/three@0.150.1/build/three.min.js';
  let threeLoading = null;

  function loadThree() {
    if (global.THREE) return Promise.resolve(global.THREE);
    if (threeLoading) return threeLoading;
    threeLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = THREE_URL;
      s.onload = () => (global.THREE ? resolve(global.THREE) : reject(new Error('three_missing')));
      s.onerror = () => reject(new Error('three_load_failed'));
      document.head.appendChild(s);
    });
    return threeLoading;
  }

  let webglSupported = null;
  function webglAvailable() {
    if (webglSupported !== null) return webglSupported;   // probe once, ever
    try {
      const c = document.createElement('canvas');
      const gl = global.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'));
      // Hand the probe's context straight back. Browsers cap live contexts at
      // roughly sixteen, and a leaked one per journey opened is a budget that
      // runs out during ordinary browsing.
      if (gl) {
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
      webglSupported = !!gl;
    } catch { webglSupported = false; }
    return webglSupported;
  }

  // --- Themes ---------------------------------------------------------------
  // Chosen per journey. Colours are the app's own earthy palette pushed into 3D.
  const THEMES = {
    desert:   { sky: 0xe0c08d, skyTop: 0x4f86c6, fog: 0xe6cfa6, haze: 0.0055, sunColor: 0xffe6b0, sunPower: 1.35, weather: 'dust',
                ground: 0xd2b075, path: 0xa8814a, prop: 0x8f6b45, peak: 0xb08a5f, accent: 0x8a5a2a, propKind: 'rock',  density: 0.5 },
    pastoral: { sky: 0xbcd0e2, skyTop: 0x5b8fd0, fog: 0xd2e0ea, haze: 0.0050, sunColor: 0xfff4d6, sunPower: 1.15, weather: 'pollen',
                ground: 0x8fa963, path: 0xb8a173, prop: 0x5c7346, peak: 0x7d9160, accent: 0x46c07f, propKind: 'tree',  density: 0.8 },
    highland: { sky: 0x9fb6c6, skyTop: 0x46708f, fog: 0xb3c6d2, haze: 0.0068, sunColor: 0xffeccb, sunPower: 1.0,  weather: 'none',
                ground: 0x6f8368, path: 0x9c8a6a, prop: 0x33513f, peak: 0x5f7382, accent: 0x6fe6a5, propKind: 'pine',  density: 1.0 },
    ashen:    { sky: 0x7a4a3a, skyTop: 0x2a1a18, fog: 0x6b4034, haze: 0.0105, sunColor: 0xff9060, sunPower: 0.85, weather: 'ember',
                ground: 0x413a38, path: 0x554a45, prop: 0x2b2523, peak: 0x3a2f2c, accent: 0x8e3b2e, propKind: 'spire', density: 0.7 },
    wold:     { sky: 0xa9c48f, skyTop: 0x4d84b0, fog: 0xc3d8ae, haze: 0.0060, sunColor: 0xfff0c8, sunPower: 1.2,  weather: 'pollen',
                ground: 0x5f7d3f, path: 0x8a7048, prop: 0x2f4a26, peak: 0x51703c, accent: 0xd8b24a, propKind: 'tree',  density: 1.3 },
    stone:    { sky: 0xc6d3de, skyTop: 0x5d86a8, fog: 0xd8e2ea, haze: 0.0048, sunColor: 0xfff2dc, sunPower: 1.25, weather: 'none',
                ground: 0xb9b2a6, path: 0xe6e0d4, prop: 0xd8d2c6, peak: 0x8e9aa4, accent: 0x6d7f8e, propKind: 'spire', density: 0.9 },
    coast:    { sky: 0x9fd6e8, skyTop: 0x2f7fb8, fog: 0xc9e8f2, haze: 0.0044, sunColor: 0xfff6e0, sunPower: 1.3,  weather: 'none',
                ground: 0x7fae7a, path: 0xd9cba6, prop: 0x4f7f6a, peak: 0x86b8c9, accent: 0xe8d27a, propKind: 'rock',  density: 0.6 },
    winter:   { sky: 0xd8e4ee, skyTop: 0x6f9bc4, fog: 0xdfeaf2, haze: 0.0072, sunColor: 0xfff0e2, sunPower: 0.95, weather: 'snow',
                ground: 0xeaf1f7, path: 0xa9bccd, prop: 0x2f5142, peak: 0xc3d3e0, accent: 0x4b6f8a, propKind: 'fir',   density: 1.0 },
  };

  // Journey key -> theme. Falls back on world/terrain for anything unlisted.
  const KEY_THEME = {
    'up-mount-sinai': 'desert',
    'jericho-road': 'desert',
    'wilderness-forty': 'desert',
    'road-to-emmaus': 'pastoral',
    'the-long-road-east': 'highland',
    'the-mistfall-ride': 'highland',
    'the-shadowed-plain': 'ashen',
    'the-ashen-stair': 'ashen',
    'the-winter-wood': 'winter',
    'the-jordan-crossing': 'pastoral',
    'elijah-to-horeb': 'desert',
    'the-shore-of-galilee': 'coast',
    'the-greenway-under-eaves': 'wold',
    'the-white-tower-climb': 'stone',
    'the-eastern-sea-road': 'coast',
    'the-hollow-hill': 'wold',
    'middle-earth-west-road': 'fellowship',
    'narnia-lantern-wood': 'lantern',
  };

  function themeFor(journey) {
    if (!journey) return THEMES.pastoral;
    const named = KEY_THEME[journey.key];
    if (named) return THEMES[named];
    return journey.world === 'biblical' ? THEMES.desert : THEMES.highland;
  }

  // Deterministic RNG so a route's scenery is the same every time you ride it.
  function rng(seedStr) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return function () { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // --- Scene ---------------------------------------------------------------
  async function create(canvas, opts) {
    const journey = (opts && opts.journey) || {};
    const waypoints = (opts && opts.waypoints) || [];
    const onError = (opts && opts.onError) || function () {};

    if (!webglAvailable()) { onError(new Error('webgl_unsupported')); return null; }
    let THREE;
    try { THREE = await loadThree(); } catch (e) { onError(e); return null; }

    const theme = themeFor(journey);
    const rand = rng(journey.key || 'journey');
    const isClimb = journey.terrain === 'climb';

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    // A retina phone reports 3; rendering every pixel of that costs nine times
    // a 1x buffer for a scene of flat-shaded blocks that gains almost nothing
    // from it. 1.5 keeps edges clean at a fraction of the fill cost.
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.5));

    renderer.outputColorSpace = THREE.SRGBColorSpace || renderer.outputColorSpace;

    const scene = new THREE.Scene();

    // A flat background colour is the single thing that made these worlds read
    // as diagrams. A graded dome — deep overhead, pale at the horizon — plus
    // haze in the horizon colour gives the scene air and distance.
    const skyTop = new THREE.Color(theme.skyTop != null ? theme.skyTop : theme.sky).multiplyScalar(0.82);
    const skyHaze = new THREE.Color(theme.fog);
    scene.fog = new THREE.FogExp2(skyHaze.getHex(), theme.haze != null ? theme.haze : 0.0062);
    scene.background = skyHaze.clone();

    const skyGeo = new THREE.SphereGeometry(1, 24, 16);
    {
      // Vertex colours rather than a shader: no GLSL to keep working across
      // three.js versions, and it costs one small mesh.
      const pos = skyGeo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        // -1 at the nadir, +1 overhead; ease so the gradient sits near the horizon.
        const t = Math.max(0, Math.min(1, (pos.getY(i) + 0.15) / 0.9));
        c.copy(skyHaze).lerp(skyTop, Math.pow(t, 0.65));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      skyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const skyDome = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    }));
    skyDome.scale.setScalar(900);
    skyDome.renderOrder = -1;
    scene.add(skyDome);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1400);

    // Sky-to-ground bounce, plus a warm low sun and a cool fill opposite it, so
    // surfaces turned away from the sun keep colour instead of going to mud.
    // Total light is kept near one. It was well over two, which multiplied every
    // surface past its own colour: ground authored as a muted sage rendered as a
    // bright mint, and the same washing-out happened to every theme. A palette
    // that only works unlit is not a palette.
    scene.add(new THREE.HemisphereLight(skyTop.getHex(), theme.ground, 0.62));
    const sun = new THREE.DirectionalLight(theme.sunColor != null ? theme.sunColor : 0xfff2d8,
                                           (theme.sunPower != null ? theme.sunPower : 1.15) * 0.90);
    sun.position.set(-60, 70, 30);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(skyTop.getHex(), 0.20);
    fill.position.set(50, 25, -40);
    scene.add(fill);

    // Contact shadows. A real shadow map is far more than this scene needs; a
    // dark disc under anything standing on the ground is what actually stops
    // objects looking like they float.
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false, fog: true,
    });
    const shadowGeo = new THREE.CircleGeometry(1, 12);
    function addShadow(parent, radius) {
      const sh = new THREE.Mesh(shadowGeo, shadowMat);
      sh.rotation.x = -Math.PI / 2;
      // Offset away from the sun rather than sitting dead centre. A shadow
      // directly under an object reads as a sticker; one thrown to the side
      // reads as light coming from somewhere.
      sh.position.set(radius * 0.42, 0.03, radius * 0.18);
      sh.scale.setScalar(radius);
      parent.add(sh);
      return sh;
    }

    const ROAD_LEN = 400;

    // --- Route shape ---------------------------------------------------------
    // A straight line is not a route. Each journey gets its own deterministic
    // curve and elevation profile, derived from the route seed and its real
    // metadata, so the same road bends and climbs the same way every ride.
    //
    // The rider is always at x=0: rather than steering a camera along a spline,
    // we displace the whole world sideways and vertically by the profile,
    // measured relative to wherever the rider currently is. Same picture, far
    // less that can go wrong, and prop recycling keeps working untouched.
    const bend = [
      { amp: 26 + rand() * 34, len: 260 + rand() * 220, phase: rand() * 6.283 },
      { amp: 10 + rand() * 18, len: 90 + rand() * 90,  phase: rand() * 6.283 },
    ];
    // Climbs rise steadily; rolling routes undulate in proportion to their real
    // elevation gain; flat routes stay honest and barely move.
    const totalKm = Math.max(1, Number(journey.total_km) || 10);
    const elevM = Math.max(0, Number(journey.elevation_m) || 0);
    const climbPerUnit = isClimb ? (elevM / (totalKm * 220)) * 0.55 : 0;
    const rollAmp = Math.min(18, (elevM / totalKm) * 0.24) * (journey.terrain === 'flat' ? 0.25 : 1);
    const roll = [
      { amp: rollAmp,       len: 300 + rand() * 200, phase: rand() * 6.283 },
      { amp: rollAmp * 0.4, len: 110 + rand() * 80,  phase: rand() * 6.283 },
    ];

    function curveX(z) {
      let x = 0;
      for (const b of bend) x += Math.sin(z / b.len + b.phase) * b.amp;
      return x;
    }
    function elevY(z) {
      // z runs negative as you advance, so -z is distance travelled.
      let y = -z * climbPerUnit;
      for (const r of roll) y += Math.sin(z / r.len + r.phase) * r.amp;
      return y;
    }

    // Ribbon builder: a strip of quads following the profile, rebuilt each
    // frame around the rider. Used for both the ground and the road surface.
    const RIB_SEGS = 110;
    // `cols` is the number of points across the ribbon. The road only needs its
    // two edges; the ground needs a cross-section so it can carry relief.
    function makeRibbon(width, color, yLift, isTerrain) {
      const cols = isTerrain ? 13 : 2;
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array((RIB_SEGS + 1) * cols * 3);
      const idx = [];
      for (let i = 0; i < RIB_SEGS; i++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = i * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
          // Wind these counter-clockwise seen from above. z decreases as i
          // grows, so the naive order yields downward normals and every ribbon
          // -- ground, verge, road, centre line -- gets back-face culled and
          // the whole landscape turns into the underside of the sky dome.
          idx.push(a, b, cc, b, d, cc);
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, verts, width, yLift, cols, isTerrain: !!isTerrain };
    }
    // Terrain relief: the verge rises away from the road rather than being a
    // flat plate, which is what made the ground read as paper.
    const relief = [
      { amp: 5 + rand() * 7, len: 120 + rand() * 90, phase: rand() * 6.283 },
      { amp: 2 + rand() * 3, len: 41 + rand() * 30,  phase: rand() * 6.283 },
    ];
    function reliefAt(z, lateralFrac) {
      let h = 0;
      for (const r of relief) h += Math.sin(z / r.len + r.phase) * r.amp;
      // Flat by the roadside, rising with distance from it, so the road itself
      // stays rideable and the hills happen out in the landscape.
      return h * Math.pow(Math.min(1, Math.abs(lateralFrac) * 2.4), 2);
    }

    const ground = makeRibbon(620, theme.ground, 0, true);
    const verge = makeRibbon(13, theme.path, 0.03);      // gravel shoulder
    const road = makeRibbon(7.4, theme.path, 0.06);
    const centreLine = makeRibbon(0.36, theme.accent, 0.09);
    verge.mesh.material.color = new THREE.Color(theme.ground).lerp(new THREE.Color(theme.path), 0.55);
    road.mesh.material.color = new THREE.Color(theme.path);
    centreLine.mesh.material.color = new THREE.Color(theme.path).lerp(new THREE.Color(0xffffff), 0.45);

    function updateRibbon(rib, camZ) {
      const baseX = curveX(camZ), baseY = elevY(camZ);
      const from = camZ + 60, to = camZ - ROAD_LEN * 1.6;
      const cols = rib.cols;
      for (let i = 0; i <= RIB_SEGS; i++) {
        const z = from + (to - from) * (i / RIB_SEGS);
        const x = curveX(z) - baseX;
        const y = elevY(z) - baseY + rib.yLift;
        for (let c = 0; c < cols; c++) {
          const f = cols === 1 ? 0 : (c / (cols - 1)) - 0.5;    // -0.5 .. +0.5
          const o = (i * cols + c) * 3;
          rib.verts[o] = x + f * rib.width;
          rib.verts[o + 1] = y + (rib.isTerrain ? reliefAt(z, f) : 0);
          rib.verts[o + 2] = z;
        }
      }
      rib.mesh.geometry.attributes.position.needsUpdate = true;
      // Only the terrain has a shape worth re-deriving normals for, and even it
      // changes slowly. The road, verge and centre line are flat strips: their
      // normals point up and always will, so recomputing them sixty times a
      // second was pure cost.
      if (rib.isTerrain) {
        if ((rib.normalTick = (rib.normalTick || 0) + 1) % 4 === 0) rib.mesh.geometry.computeVertexNormals();
      } else if (!rib.normalsDone) {
        rib.mesh.geometry.computeVertexNormals();
        rib.normalsDone = true;
      }
    }

    // --- The sun ------------------------------------------------------------
    // A visible source for the light that is already falling on everything. It
    // rides on the sky dome and takes no fog, so it stays a disc rather than
    // dissolving into the haze at distance.
    const sunGroup = new THREE.Group();
    {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(26, 32),
        new THREE.MeshBasicMaterial({ color: theme.sunColor != null ? theme.sunColor : 0xfff2d8, fog: false })
      );
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(78, 32),
        new THREE.MeshBasicMaterial({
          color: theme.sunColor != null ? theme.sunColor : 0xfff2d8,
          transparent: true, opacity: 0.16, fog: false, depthWrite: false,
        })
      );
      glow.position.z = -1;
      sunGroup.add(glow); sunGroup.add(disc);
      // Placed where the directional light comes from, so highlights agree with it.
      sunGroup.position.set(-420, 210, -620);
      sunGroup.renderOrder = -0.5;
      scene.add(sunGroup);
    }

    // --- Ridgelines -----------------------------------------------------------
    // Three bands of hills at increasing distance, each hazier and slower to
    // pass than the one in front. A scattering of separate cones never reads as
    // a landscape; overlapping silhouettes with aerial perspective do, and this
    // is what actually gives these worlds a horizon.
    function makeRidge(distance, height, hazeMix, seedPhase) {
      const SEGS = 72, width = distance * 3.2;
      const verts = new Float32Array((SEGS + 1) * 2 * 3);
      const idx = [];
      for (let i = 0; i <= SEGS; i++) {
        const t = i / SEGS;
        const x = -width / 2 + width * t;
        // Layered sines of different frequencies: broad massifs with smaller
        // summits on them, rather than one repeating wave.
        const n = Math.sin(t * 5.3 + seedPhase) * 0.5
                + Math.sin(t * 13.7 + seedPhase * 2.1) * 0.28
                + Math.sin(t * 29.1 + seedPhase * 0.7) * 0.13;
        const h = height * (0.42 + 0.58 * Math.abs(n));
        const o = i * 6;
        verts[o] = x; verts[o + 1] = h; verts[o + 2] = 0;
        verts[o + 3] = x; verts[o + 4] = -height * 0.9; verts[o + 5] = 0;
        if (i < SEGS) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      // Aerial perspective: the further back, the more it washes into the haze.
      const col = new THREE.Color(theme.peak).lerp(new THREE.Color(theme.fog), hazeMix);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, fog: false }));
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, distance };
    }
    const ridges = [
      makeRidge(520, 78, 0.34, rand() * 6.283),
      makeRidge(760, 128, 0.58, rand() * 6.283),
      makeRidge(1040, 186, 0.76, rand() * 6.283),
    ];

    // --- Clouds ---------------------------------------------------------------
    // Puffed clusters rather than sprites, so they belong to the same low-poly
    // world as everything else.
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5, fog: false, depthWrite: false,
    });
    const clouds = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < puffs; k++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), cloudMat);
        const r = 26 + rand() * 30;
        m.scale.set(r, r * (0.5 + rand() * 0.2), r * 0.7);
        m.position.set((k - puffs / 2) * (r * 0.85), (rand() - 0.5) * r * 0.3, 0);
        g.add(m);
      }
      g.position.set((rand() - 0.5) * 1600, 210 + rand() * 150, -300 - rand() * 900);
      g.userData.drift = 1.6 + rand() * 2.4;
      scene.add(g);
      clouds.push(g);
    }

    // A sea beside these roads was tried and removed: at any distance where it
    // did not collide with the terrain it projected to a sliver on the horizon,
    // behind the nearest ridgeline. It needs a scene laid out for it, not a
    // plane bolted onto one that is not.

    // Roadside props, recycled as the camera passes them (infinite road).
    // --- Scenery -------------------------------------------------------------
    // One flat-coloured cone per tree is what made these worlds look like
    // placeholders. Props are built from a few parts, and every instance gets
    // its own shade so a hillside reads as many trees rather than one repeated.
    const TRUNK = new THREE.MeshLambertMaterial({ color: 0x4a3527, flatShading: true });

    // Geometry is shared across instances; only materials vary.
    const GEO = {
      cone: new THREE.ConeGeometry(1, 1, 7),
      sphere: new THREE.SphereGeometry(1, 7, 6),
      trunk: new THREE.CylinderGeometry(0.1, 0.15, 1, 5),
      rock: new THREE.DodecahedronGeometry(1, 0),
      blade: new THREE.ConeGeometry(1, 1, 3),
    };

    // Jitter a theme colour so no two props are identical.
    function shade(hex, spread) {
      const c = new THREE.Color(hex);
      const hsl = {};
      c.getHSL(hsl);
      c.setHSL(
        (hsl.h + (rand() - 0.5) * 0.045 + 1) % 1,
        Math.max(0, Math.min(1, hsl.s + (rand() - 0.5) * 0.22)),
        Math.max(0.04, Math.min(0.95, hsl.l + (rand() - 0.5) * (spread == null ? 0.20 : spread)))
      );
      return new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    }

    // A conifer: stacked skirts on a bare trunk, narrowing toward the top.
    function makeConifer() {
      const g = new THREE.Group();
      const mat = shade(theme.prop);
      const tiers = 3 + Math.floor(rand() * 2);
      const trunk = new THREE.Mesh(GEO.trunk, TRUNK);
      trunk.scale.set(1, 1.5, 1);
      trunk.position.y = 0.75;
      g.add(trunk);
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const skirt = new THREE.Mesh(GEO.cone, mat);
        skirt.scale.set(1 - t * 0.55, 1.25 - t * 0.35, 1 - t * 0.55);
        skirt.position.y = 1.0 + i * 0.72;
        skirt.rotation.y = rand() * Math.PI;
        g.add(skirt);
      }
      return g;
    }

    // A broadleaf: a leaning trunk under two or three offset canopy masses.
    function makeBroadleaf() {
      const g = new THREE.Group();
      const mat = shade(theme.prop);
      const trunk = new THREE.Mesh(GEO.trunk, TRUNK);
      trunk.scale.set(1.3, 2.0, 1.3);
      trunk.position.y = 1.0;
      g.add(trunk);
      const blobs = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < blobs; i++) {
        const b = new THREE.Mesh(GEO.sphere, mat);
        const r = 0.75 + rand() * 0.5;
        b.scale.set(r, r * (0.8 + rand() * 0.3), r);
        b.position.set((rand() - 0.5) * 0.9, 2.0 + rand() * 0.7, (rand() - 0.5) * 0.9);
        g.add(b);
      }
      return g;
    }

    // A rock cluster: one mass with smaller ones tucked against it.
    function makeRocks() {
      const g = new THREE.Group();
      const mat = shade(theme.prop, 0.26);
      for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) {
        const r = new THREE.Mesh(GEO.rock, mat);
        const sc = i === 0 ? 1 : 0.35 + rand() * 0.4;
        r.scale.set(sc, sc * (0.6 + rand() * 0.4), sc);
        r.position.set((rand() - 0.5) * 1.6, sc * 0.35, (rand() - 0.5) * 1.6);
        r.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        g.add(r);
      }
      return g;
    }

    // A ruined spire / standing stone for the ashen roads.
    function makeSpire() {
      const g = new THREE.Group();
      const mat = shade(theme.prop, 0.18);
      const n = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const sh = new THREE.Mesh(GEO.cone, mat);
        sh.scale.set(0.5 + rand() * 0.4, 2.6 + rand() * 1.8, 0.5 + rand() * 0.4);
        sh.position.set((rand() - 0.5) * 1.4, sh.scale.y * 0.5, (rand() - 0.5) * 1.4);
        sh.rotation.z = (rand() - 0.5) * 0.22;   // leaning, not planted
        g.add(sh);
      }
      return g;
    }

    // Low scrub that fills the middle distance cheaply.
    function makeScrub() {
      const g = new THREE.Group();
      const mat = shade(theme.prop, 0.24);
      for (let i = 0; i < 3 + Math.floor(rand() * 3); i++) {
        const b = new THREE.Mesh(GEO.blade, mat);
        const h = 0.5 + rand() * 0.8;
        b.scale.set(0.28 + rand() * 0.2, h, 0.28 + rand() * 0.2);
        b.position.set((rand() - 0.5) * 1.5, h * 0.5, (rand() - 0.5) * 1.5);
        g.add(b);
      }
      return g;
    }

    function makeProp() {
      // Mostly the theme's signature prop, with scrub mixed in for variety.
      if (rand() < 0.28) return makeScrub();
      switch (theme.propKind) {
        case 'tree':  return makeBroadleaf();
        case 'pine':
        case 'fir':   return makeConifer();
        case 'spire': return makeSpire();
        default:      return makeRocks();
      }
    }
    // Density is what sells a landscape, and these props are cheap enough to
    // afford far more of them than the old single-cone scenery needed.
    const PROP_COUNT = Math.round(190 * theme.density);
    const props = [];
    for (let i = 0; i < PROP_COUNT; i++) {
      const p = makeProp();
      const side = rand() < 0.5 ? -1 : 1;
      // The prop models carry their own proportions now, so this is size
      // variation only — a stand of trees, not one tree at seventeen scales.
      const s = 0.75 + rand() * 0.9;
      p.scale.set(s, s * (0.85 + rand() * 0.4), s);
      // Keep props well clear of the road. Anything closer than about 12 units
      // laterally fills the whole frame as you draw level with it — the camera
      // ends up inside a boulder rather than passing one. Scrub is small enough
      // to sit closer, which is what fills the verge.
      const small = p.children.length > 2 && p.scale.y < 1.1;
      const minLateral = small ? 7 : 12;
      const lateral = side * (minLateral + s * 1.6 + rand() * 46);
      p.userData.lateral = lateral;
      p.userData.baseY = 0;         // props stand on the ground, not above it
      p.userData.scale = p.scale.clone();
      p.position.set(lateral, 0, -rand() * ROAD_LEN * 2);
      p.rotation.y = rand() * Math.PI;
      addShadow(p, 1.1 + rand() * 0.5);
      scene.add(p);
      props.push(p);
    }

    // A lantern at the roadside for the winter wood — a warm point of light in
    // the snow, the kind of landmark that makes a route feel like somewhere.
    if (theme === THEMES.winter || theme === THEMES.lantern) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6, 6), new THREE.MeshLambertMaterial({ color: 0x2b2523 }));
      post.position.set(-6.2, 3, -34);
      scene.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9b0 }));
      lamp.position.set(-6.2, 6.2, -34);
      scene.add(lamp);
      scene.add(new THREE.PointLight(0xffd58a, 1.5, 42));
    }

    // Waypoint gates at their real km marks.
    const gateMat = new THREE.MeshLambertMaterial({ color: theme.accent });
    const gatePassedMat = new THREE.MeshLambertMaterial({ color: theme.prop });
    const gates = waypoints.map((w) => {
      const g = new THREE.Group();
      const pillar = new THREE.CylinderGeometry(0.42, 0.55, 6, 7);
      const l = new THREE.Mesh(pillar, gateMat); l.position.set(-4.4, 3, 0);
      const r = new THREE.Mesh(pillar, gateMat); r.position.set(4.4, 3, 0);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 0.5), gateMat); bar.position.set(0, 6, 0);
      g.add(l); g.add(r); g.add(bar);
      scene.add(g);
      return { group: g, km: Number(w.km_mark) || 0, parts: [l, r, bar] };
    });

    // Kilometre posts down the roadside. Without a repeating near-field
    // reference the road reads as static no matter how fast you are going.
    const postGeo = new THREE.BoxGeometry(0.28, 1.5, 0.28);
    const postMat = new THREE.MeshLambertMaterial({ color: theme.accent });
    const kmPosts = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(postGeo, postMat);
      m.position.set(-4.6, 0.75, 0);
      scene.add(m);
      kmPosts.push(m);
    }

    // The rider: a small third-person avatar keeps the route feeling like a
    // game instead of a map. It is intentionally stylised and asset-free so
    // every themed world can own the same readable player silhouette.
    function cylinderBetween(a, b, radius, material) {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const mid = va.clone().add(vb).multiplyScalar(0.5);
      const dir = vb.clone().sub(va);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 8), material);
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return mesh;
    }
    const rider = new THREE.Group();
    const bikeMat = new THREE.MeshLambertMaterial({ color: theme.accent, flatShading: true });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x22201e, flatShading: true });
    const jerseyMat = new THREE.MeshLambertMaterial({ color: theme.prop, flatShading: true });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xc98f6b, flatShading: true });
    const wheels = [0.0, -2.0].map((wheelZ) => {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.075, 8, 18), darkMat);
      wheel.position.set(0, 0.68, wheelZ);
      rider.add(wheel);
      return wheel;
    });
    rider.add(cylinderBetween([0, 0.68, 0], [0, 1.32, -0.95], 0.07, bikeMat));
    rider.add(cylinderBetween([0, 1.32, -0.95], [0, 0.68, -2.0], 0.07, bikeMat));
    rider.add(cylinderBetween([0, 0.68, -2.0], [0, 0.68, 0], 0.07, bikeMat));
    rider.add(cylinderBetween([0, 1.32, -0.95], [0, 1.42, -1.45], 0.06, bikeMat));
    rider.add(cylinderBetween([0, 1.42, -1.45], [0, 1.62, -1.78], 0.05, darkMat));
    const pedals = new THREE.Group();
    pedals.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.06), darkMat));
    pedals.position.set(0, 0.95, -0.85);
    rider.add(pedals);
    const body = new THREE.Group();
    body.position.set(0, 2.08, -0.72);
    body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.9, 8), jerseyMat));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skinMat);
    head.position.set(0, 0.7, 0.02);
    body.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), bikeMat);
    helmet.position.set(0, 0.82, 0.02);
    body.add(helmet);
    rider.add(body);
    const armL = cylinderBetween([-0.2, 2.2, -0.76], [-0.22, 1.66, -1.48], 0.075, jerseyMat);
    const armR = cylinderBetween([0.2, 2.2, -0.76], [0.22, 1.66, -1.48], 0.075, jerseyMat);
    rider.add(armL); rider.add(armR);
    const legL = cylinderBetween([-0.16, 1.78, -0.58], [-0.22, 1.05, -0.86], 0.09, darkMat);
    const legR = cylinderBetween([0.16, 1.78, -0.58], [0.22, 1.05, -0.86], 0.09, darkMat);
    rider.add(legL); rider.add(legR);
    rider.userData = { wheels, pedals, legL, legR };
    addShadow(rider, 1.15);
    scene.add(rider);

    // --- Weather -------------------------------------------------------------
    // Snow in the winter wood, embers over the ashen plain, dust in the desert,
    // drifting pollen on the green roads. A drifting particle field is the
    // cheapest thing that makes a static world feel like weather is happening.
    const WEATHER = {
      snow:   { count: 700, size: 0.5,  color: 0xffffff, opacity: 0.9,  fall: 5,  drift: 2.2 },
      ember:  { count: 320, size: 0.42, color: 0xff7a3c, opacity: 0.95, fall: -3, drift: 3.0 },
      dust:   { count: 420, size: 0.34, color: 0xdcc79a, opacity: 0.5,  fall: 1,  drift: 6.0 },
      pollen: { count: 300, size: 0.26, color: 0xfff2b0, opacity: 0.6,  fall: 0.7, drift: 2.0 },
    };
    const weatherCfg = WEATHER[theme.weather] || null;
    const WEATHER_BOX = { x: 90, y: 46, z: 220 };   // volume carried with the rider
    let weatherPoints = null, weatherPos = null;
    if (weatherCfg) {
      weatherPos = new Float32Array(weatherCfg.count * 3);
      for (let i = 0; i < weatherCfg.count; i++) {
        weatherPos[i * 3] = (rand() - 0.5) * WEATHER_BOX.x;
        weatherPos[i * 3 + 1] = rand() * WEATHER_BOX.y;
        weatherPos[i * 3 + 2] = (rand() - 0.5) * WEATHER_BOX.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(weatherPos, 3));
      weatherPoints = new THREE.Points(g, new THREE.PointsMaterial({
        color: weatherCfg.color, size: weatherCfg.size,
        transparent: true, opacity: weatherCfg.opacity,
        depthWrite: false, sizeAttenuation: true,
        fog: true,
      }));
      weatherPoints.frustumCulled = false;
      scene.add(weatherPoints);
    }


    // --- Ghost riders --------------------------------------------------------
    // Every ghost is somebody's real recorded ride on this road, replayed at the
    // pace they actually held. They are translucent copies of the rider model,
    // placed at the distance that rider had covered by the current elapsed time.
    // No recorded rides means no ghosts: the road is never populated with
    // invented company.
    let ghosts = [];

    function makeGhostMesh(isSelf) {
      const g = rider.clone(true);
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = isSelf ? 0.42 : 0.3;
        o.material.depthWrite = false;
        if (isSelf) o.material.color = new THREE.Color(theme.accent);
      });
      g.visible = false;
      scene.add(g);
      return g;
    }

    function clearGhosts() {
      for (const gh of ghosts) {
        scene.remove(gh.mesh);
        gh.mesh.traverse((o) => { if (o.isMesh && o.material) o.material.dispose(); });
      }
      ghosts = [];
    }

    // Where had this rider got to, in km, after `sec` of their own ride?
    function ghostKmAt(data, sec) {
      let t = sec;
      let km = data.segments.length ? Number(data.segments[0].from_km) : 0;
      for (const seg of data.segments) {
        const span = Number(seg.to_km) - Number(seg.from_km);
        const dur = Number(seg.duration_sec);
        if (!(span > 0) || !(dur > 0)) continue;
        if (t <= dur) return Number(seg.from_km) + span * (t / dur);
        t -= dur;
        km = Number(seg.to_km);
      }
      return km;   // their ride ended here
    }

    // --- state / loop ------------------------------------------------------
    // World metres per real km — compressed so a 40 km route is a believable
    // ride rather than an empty void, while keeping gates proportionally placed.
    const METRES_PER_KM = 220;
    const GATE_SETBACK = 34;   // world units a gate sits beyond its km mark
    let distanceKm = 0, speedKmh = 0, raf = null, disposed = false, bob = 0;
    let anchored = false;   // props are seeded around the first real position
    let grade = 0;          // live gradient %, from the route profile
    // Scenery fades in over the last stretch of visible road.
    const FADE_START = ROAD_LEN * 1.05, FADE_END = ROAD_LEN * 1.55;
    // Adaptive quality: the scene is tuned for a laptop, and a mid-range phone
    // rendering the same thing will not hold a frame rate. Rather than guess the
    // device, watch the frames and shed scenery until it keeps up.
    let hiddenProps = 0;
    let frameAcc = 0, frameCount = 0, lastFrameAt = 0;
    function adaptiveQuality(now) {
      if (lastFrameAt) { frameAcc += now - lastFrameAt; frameCount++; }
      lastFrameAt = now;
      if (frameCount < 45) return;
      const avg = frameAcc / frameCount;
      frameAcc = 0; frameCount = 0;
      if (avg > 26 && hiddenProps < props.length * 0.7) {
        hiddenProps = Math.min(props.length, hiddenProps + Math.ceil(props.length * 0.15));
      } else if (avg < 15 && hiddenProps > 0) {
        hiddenProps = Math.max(0, hiddenProps - Math.ceil(props.length * 0.1));
      }
    }
    let elapsedSec = 0;     // session elapsed, which is what places the ghosts

    function layout() {
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 200;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function frame(now) {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      adaptiveQuality(now || performance.now());

      const z = -distanceKm * METRES_PER_KM;      // travelled position along the road

      // Seed scenery around the starting point the first time we know it.
      if (!anchored) {
        anchored = true;
        for (const p of props) p.position.z += z;
      }

      // The world is drawn relative to the rider, so everything that sits on
      // the ground is offset by the route profile at its own z.
      const baseX = curveX(z), baseY = elevY(z);
      const offX = (zz) => curveX(zz) - baseX;
      const offY = (zz) => elevY(zz) - baseY;
      skyDome.position.set(0, 0, z);
      sunGroup.position.z = z - 620;

      // Ridgelines sit at a fixed distance ahead and slide sideways far more
      // slowly than the roadside does, which is what parallax actually is.
      for (const r of ridges) {
        r.mesh.position.set(-baseX * (60 / r.distance), -baseY * 0.35 + 12, z - r.distance);
      }

      // Clouds drift, and wrap rather than being left behind.
      for (const c of clouds) {
        c.position.x += c.userData.drift * 0.02;
        if (c.position.x > 900) c.position.x = -900;
        c.position.z = z - 300 - ((z * 0.02) % 600);
      }

      updateRibbon(ground, z);
      updateRibbon(verge, z);
      updateRibbon(road, z);
      updateRibbon(centreLine, z);
      bob += 0.05 + Math.min(speedKmh, 40) * 0.004;


      rider.position.set(offX(z - 3), offY(z - 3) + Math.sin(bob) * 0.035, z - 3);
      rider.rotation.y = Math.atan2(offX(z - 18) - offX(z - 3), -15);
      const pedalSpin = Math.min(speedKmh, 45) * 0.09;
      rider.userData.wheels.forEach(w => { w.rotation.x += pedalSpin; });
      rider.userData.pedals.rotation.x += pedalSpin * 1.2;
      rider.userData.legL.rotation.z = Math.sin(bob * 2.2) * Math.min(0.22, speedKmh * 0.008);
      rider.userData.legR.rotation.z = -rider.userData.legL.rotation.z;

      // The camera sits above the road and looks at the road ahead, so a bend
      // reads as a bend and a crest hides what is beyond it.
      // Field of view opens slightly with speed. It is a small change and it is
      // most of why fast feels fast.
      const wantFov = 62 + Math.min(speedKmh, 45) * 0.16;
      if (Math.abs(camera.fov - wantFov) > 0.05) {
        camera.fov += (wantFov - camera.fov) * 0.06;
        camera.updateProjectionMatrix();
      }

      const aheadZ = z - 30;
      camera.position.set(0, 4.5, z + 9.5);
      camera.lookAt(offX(aheadZ), offY(aheadZ) + 2.35, aheadZ);

      // Live gradient, from the profile the rider is actually on.
      const dz = 6;
      grade = ((elevY(z - dz) - elevY(z)) / dz) * 100;

      // Recycle props that fall behind the camera to the far distance, and
      // pull forward any that are absurdly far ahead (e.g. after a big jump).
      // Props recycle to the far distance. Scaling them in over the last stretch
      // of fog stops them appearing out of nothing, which is the single most
      // obvious tell that a world is a treadmill of recycled objects.
      const visibleProps = props.length - hiddenProps;
      for (let pi = 0; pi < props.length; pi++) {
        const p = props[pi];
        if (pi >= visibleProps) { p.visible = false; continue; }
        if (p.position.z > z + 12) p.position.z -= ROAD_LEN * 2;
        else if (p.position.z < z - ROAD_LEN * 2) p.position.z += ROAD_LEN * 2;
        p.position.x = p.userData.lateral + offX(p.position.z);
        p.position.y = offY(p.position.z) + p.userData.baseY;

        const dist = z - p.position.z;                 // how far ahead it is
        const fade = dist > FADE_START
          ? Math.max(0, 1 - (dist - FADE_START) / (FADE_END - FADE_START))
          : 1;
        p.visible = fade > 0.02;
        const s0 = p.userData.scale;
        p.scale.set(s0.x * fade, s0.y * fade, s0.z * fade);
      }

      // Weather drifts with the rider, wrapping inside its own volume so a
      // fixed number of particles covers an endless road.
      if (weatherPoints && weatherCfg) {
        const dt = 0.016;
        for (let i = 0; i < weatherCfg.count; i++) {
          const o = i * 3;
          weatherPos[o] += Math.sin((weatherPos[o + 1] + bob) * 0.35) * weatherCfg.drift * dt;
          weatherPos[o + 1] -= weatherCfg.fall * dt;
          if (weatherPos[o + 1] < 0) weatherPos[o + 1] += WEATHER_BOX.y;
          if (weatherPos[o + 1] > WEATHER_BOX.y) weatherPos[o + 1] -= WEATHER_BOX.y;
          if (weatherPos[o] > WEATHER_BOX.x / 2) weatherPos[o] -= WEATHER_BOX.x;
          if (weatherPos[o] < -WEATHER_BOX.x / 2) weatherPos[o] += WEATHER_BOX.x;
        }
        weatherPoints.geometry.attributes.position.needsUpdate = true;
        weatherPoints.position.set(0, 0, z - WEATHER_BOX.z * 0.25);
      }

      // Ghosts ride their own recorded pace alongside you.
      for (const gh of ghosts) {
        const gz = -ghostKmAt(gh.data, elapsedSec) * METRES_PER_KM;
        // Drawing a ghost two kilometres up the road is pure cost.
        const near = gz < z + 60 && gz > z - ROAD_LEN;
        gh.mesh.visible = near;
        if (near) {
          gh.mesh.position.set(offX(gz) + gh.lane, offY(gz), gz);
          gh.mesh.rotation.y = Math.atan2(offX(gz - 15) - offX(gz), -15);
        }
      }

      // Kilometre posts sit on whole-km marks around the current position.
      const kmNow = Math.floor(distanceKm);
      for (let i = 0; i < kmPosts.length; i++) {
        const pz = -(kmNow + i - 2) * METRES_PER_KM;
        kmPosts[i].position.set(offX(pz) - 4.6, offY(pz) + 0.75, pz);
      }

      // Gates sit at their km mark, set back far enough that the km-0 arch is
      // something you ride through rather than something wrapped around the
      // camera at the start line.
      for (const g of gates) {
        const gz = -g.km * METRES_PER_KM - GATE_SETBACK;
        g.group.position.set(offX(gz), offY(gz), gz);
        const passed = distanceKm >= g.km;
        for (const part of g.parts) part.material = passed ? gatePassedMat : gateMat;
      }

      renderer.render(scene, camera);
    }

    layout();
    frame();

    const ro = global.ResizeObserver ? new ResizeObserver(layout) : null;
    if (ro) ro.observe(canvas);

    return {
      setDistance(km) { distanceKm = Math.max(0, Number(km) || 0); },
      setSpeed(kmh) { speedKmh = Math.max(0, Number(kmh) || 0); },
      setElapsed(sec) { elapsedSec = Math.max(0, Number(sec) || 0); },
      getGrade() { return grade; },

      /**
       * The average gradient over the next `metres` of road, as a percentage.
       * Lets the session see a climb coming rather than only noticing one once
       * the rider is already on it.
       */
      gradeAhead(metres) {
        const m = Math.max(20, Number(metres) || 200);
        const z = -distanceKm * METRES_PER_KM;
        return ((elevY(z - m) - elevY(z)) / m) * 100;
      },

      /** Distance in km to the start of the next sustained climb, or null. */
      nextClimbKm(minGrade, searchKm) {
        const step = 25;                       // world units between probes
        const limit = (searchKm || 1.2) * METRES_PER_KM;
        const z0 = -distanceKm * METRES_PER_KM;
        for (let d = step; d < limit; d += step) {
          const g = ((elevY(z0 - d - 120) - elevY(z0 - d)) / 120) * 100;
          if (g >= (minGrade || 3)) return d / METRES_PER_KM;
        }
        return null;
      },

      /**
       * Put real recorded rides on the road. Each entry needs segment times.
       * Returns how many ghosts were actually placed — an empty list draws none.
       */
      setGhosts(list) {
        clearGhosts();
        (list || []).forEach((data, i) => {
          if (!data || !Array.isArray(data.segments) || !data.segments.length) return;
          ghosts.push({
            data,
            mesh: makeGhostMesh(!!data.is_self),
            // Fan them across the road so overlapping riders stay readable.
            lane: ((i % 4) - 1.5) * 1.6,
          });
        });
        return ghosts.length;
      },

      /** How far ahead (+) or behind (-) each ghost is right now, in km. */
      ghostDeltas(myKm) {
        return ghosts.map(gh => ({
          display_name: gh.data.display_name,
          is_self: !!gh.data.is_self,
          delta_km: ghostKmAt(gh.data, elapsedSec) - Number(myKm || 0),
        }));
      },
      resize: layout,
      dispose() {
        disposed = true;
        clearGhosts();
        if (weatherPoints) {
          scene.remove(weatherPoints);
          weatherPoints.geometry.dispose();
          weatherPoints.material.dispose();
        }
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        });
        renderer.dispose();
        // dispose() frees GPU resources but keeps the context alive; this is
        // what actually returns it to the browser's pool.
        if (typeof renderer.forceContextLoss === 'function') {
          try { renderer.forceContextLoss(); } catch {}
        }
      },
    };
  }

  global.FunctioningFaithJourney3D = { create, webglAvailable, themeFor, THEMES };
})(window);
