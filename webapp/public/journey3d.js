// FitFaith 3D journey world.
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

  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(global.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch { return false; }
  }

  // --- Themes ---------------------------------------------------------------
  // Chosen per journey. Colours are the app's own earthy palette pushed into 3D.
  const THEMES = {
    desert:   { sky: 0xe0c08d, fog: 0xe0c08d, ground: 0xd2b075, path: 0xa8814a, prop: 0x8f6b45, peak: 0xb08a5f, accent: 0x8a5a2a, propKind: 'rock',  density: 0.5 },
    pastoral: { sky: 0xbcd0e2, fog: 0xc8d6e0, ground: 0x8fa963, path: 0xb8a173, prop: 0x5c7346, peak: 0x7d9160, accent: 0x46c07f, propKind: 'tree',  density: 0.8 },
    highland: { sky: 0x9fb6c6, fog: 0xa8bcc9, ground: 0x6f8368, path: 0x9c8a6a, prop: 0x33513f, peak: 0x5f7382, accent: 0x6fe6a5, propKind: 'pine',  density: 1.0 },
    ashen:    { sky: 0x7a4a3a, fog: 0x6b4034, ground: 0x413a38, path: 0x554a45, prop: 0x2b2523, peak: 0x3a2f2c, accent: 0x8e3b2e, propKind: 'spire', density: 0.7 },
    wold:     { sky: 0xa9c48f, fog: 0xb6cf9d, ground: 0x5f7d3f, path: 0x8a7048, prop: 0x2f4a26, peak: 0x51703c, accent: 0xd8b24a, propKind: 'tree',  density: 1.3 },
    stone:    { sky: 0xc6d3de, fog: 0xd2dce5, ground: 0xb9b2a6, path: 0xe6e0d4, prop: 0xd8d2c6, peak: 0x8e9aa4, accent: 0x6d7f8e, propKind: 'spire', density: 0.9 },
    coast:    { sky: 0x9fd6e8, fog: 0xbfe4ef, ground: 0x7fae7a, path: 0xd9cba6, prop: 0x4f7f6a, peak: 0x86b8c9, accent: 0xe8d27a, propKind: 'rock',  density: 0.6 },
    winter:   { sky: 0xd8e4ee, fog: 0xdde8f0, ground: 0xeaf1f7, path: 0xa9bccd, prop: 0x2f5142, peak: 0xc3d3e0, accent: 0x4b6f8a, propKind: 'fir',   density: 1.0 },
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
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.Fog(theme.fog, 30, 190);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);

    scene.add(new THREE.HemisphereLight(theme.sky, theme.ground, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(-40, 60, 20);
    scene.add(sun);

    // Ground + a path ribbon running away to the horizon.
    const ROAD_LEN = 400;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, ROAD_LEN * 2),
      new THREE.MeshLambertMaterial({ color: theme.ground })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(7, ROAD_LEN * 2),
      new THREE.MeshLambertMaterial({ color: theme.path })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    scene.add(road);

    // Distant peaks — a static ring that sells depth without costing much.
    const peakGeo = new THREE.ConeGeometry(1, 1, 5);
    const peakMat = new THREE.MeshLambertMaterial({ color: theme.peak, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(peakGeo, peakMat);
      const side = rand() < 0.5 ? -1 : 1;
      const h = 22 + rand() * 46;
      m.scale.set(16 + rand() * 26, h, 16 + rand() * 26);
      m.position.set(side * (70 + rand() * 130), h / 2 - 2, -ROAD_LEN + rand() * ROAD_LEN * 2);
      scene.add(m);
    }

    // Roadside props, recycled as the camera passes them (infinite road).
    function makeProp() {
      const mat = new THREE.MeshLambertMaterial({ color: theme.prop, flatShading: true });
      let geo;
      switch (theme.propKind) {
        case 'tree':  geo = new THREE.SphereGeometry(1, 7, 5); break;
        case 'pine':
        case 'fir':   geo = new THREE.ConeGeometry(1, 2.6, 6); break;
        case 'spire': geo = new THREE.ConeGeometry(1, 3.4, 4); break;
        default:      geo = new THREE.DodecahedronGeometry(1, 0); break; // rock
      }
      return new THREE.Mesh(geo, mat);
    }
    const PROP_COUNT = Math.round(90 * theme.density);
    const props = [];
    for (let i = 0; i < PROP_COUNT; i++) {
      const p = makeProp();
      const side = rand() < 0.5 ? -1 : 1;
      const s = 0.8 + rand() * 2.6;
      p.scale.set(s, s * (theme.propKind === 'rock' ? 0.8 : 1.5), s);
      // Keep props well clear of the road. Anything closer than about 12 units
      // laterally fills the whole frame as you draw level with it — the camera
      // ends up inside a boulder rather than passing one.
      p.position.set(side * (12 + s * 1.6 + rand() * 38), s * 0.6, -rand() * ROAD_LEN * 2);
      p.rotation.y = rand() * Math.PI;
      scene.add(p);
      props.push(p);
    }

    // A lantern at the roadside for the winter wood — a warm point of light in
    // the snow, the kind of landmark that makes a route feel like somewhere.
    if (theme === THEMES.winter) {
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

    // The traveller: a simple glowing marker the camera follows.
    const traveller = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 14, 12),
      new THREE.MeshBasicMaterial({ color: theme.accent })
    );
    scene.add(traveller);

    // --- state / loop ------------------------------------------------------
    // World metres per real km — compressed so a 40 km route is a believable
    // ride rather than an empty void, while keeping gates proportionally placed.
    const METRES_PER_KM = 220;
    const GATE_SETBACK = 34;   // world units a gate sits beyond its km mark
    let distanceKm = 0, speedKmh = 0, raf = null, disposed = false, bob = 0;
    let anchored = false;   // props are seeded around the first real position

    function layout() {
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 200;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function frame() {
      if (disposed) return;
      raf = requestAnimationFrame(frame);

      const z = -distanceKm * METRES_PER_KM;      // travelled position along the road

      // Seed scenery around the starting point the first time we know it.
      if (!anchored) {
        anchored = true;
        for (const p of props) p.position.z += z;
      }
      bob += 0.05 + Math.min(speedKmh, 40) * 0.004;

      // Climb routes tilt the world upward so an ascent reads as an ascent.
      const rise = isClimb ? distanceKm * 6 : 0;

      traveller.position.set(0, 1.1 + Math.sin(bob) * 0.12, z - 6);
      camera.position.set(0, 3.4 + rise * 0.02, z + 5.5);
      camera.lookAt(0, 2.2 + rise * 0.02, z - 26);

      ground.position.z = z;
      road.position.z = z;

      // Recycle props that fall behind the camera to the far distance, and
      // pull forward any that are absurdly far ahead (e.g. after a big jump).
      for (const p of props) {
        if (p.position.z > z + 12) p.position.z -= ROAD_LEN * 2;
        else if (p.position.z < z - ROAD_LEN * 2) p.position.z += ROAD_LEN * 2;
      }

      // Kilometre posts sit on whole-km marks around the current position.
      const kmNow = Math.floor(distanceKm);
      for (let i = 0; i < kmPosts.length; i++) {
        kmPosts[i].position.z = -(kmNow + i - 2) * METRES_PER_KM;
      }

      // Gates sit at their km mark, set back far enough that the km-0 arch is
      // something you ride through rather than something wrapped around the
      // camera at the start line.
      for (const g of gates) {
        g.group.position.z = -g.km * METRES_PER_KM - GATE_SETBACK;
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
      resize: layout,
      dispose() {
        disposed = true;
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        });
        renderer.dispose();
      },
    };
  }

  global.FitFaithJourney3D = { create, webglAvailable, themeFor, THEMES };
})(window);
