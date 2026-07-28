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
    fellowship: { sky: 0x9dbb8e, fog: 0xb1c9a4, ground: 0x66804a, path: 0x9b7b52, prop: 0x3f5b31, peak: 0x58765c, accent: 0xd1aa55, propKind: 'tree', density: 1.1 },
    lantern:  { sky: 0xc7d9e6, fog: 0xdce8ef, ground: 0xe8f0f4, path: 0xb1c4d1, prop: 0x355345, peak: 0xa8bccb, accent: 0xffd27c, propKind: 'fir', density: 1.15 },
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
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.Fog(theme.fog, 30, 190);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);

    scene.add(new THREE.HemisphereLight(theme.sky, theme.ground, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(-40, 60, 20);
    scene.add(sun);

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
    const RIB_SEGS = 90;
    function makeRibbon(width, color, yLift) {
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array((RIB_SEGS + 1) * 2 * 3);
      const idx = [];
      for (let i = 0; i < RIB_SEGS; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, verts, width, yLift };
    }
    const ground = makeRibbon(620, theme.ground, 0);
    const road = makeRibbon(7.4, theme.path, 0.05);

    function updateRibbon(rib, camZ) {
      const baseX = curveX(camZ), baseY = elevY(camZ);
      const from = camZ + 60, to = camZ - ROAD_LEN * 1.6;
      for (let i = 0; i <= RIB_SEGS; i++) {
        const z = from + (to - from) * (i / RIB_SEGS);
        const x = curveX(z) - baseX;
        const y = elevY(z) - baseY + rib.yLift;
        const o = i * 6;
        rib.verts[o] = x - rib.width / 2; rib.verts[o + 1] = y; rib.verts[o + 2] = z;
        rib.verts[o + 3] = x + rib.width / 2; rib.verts[o + 4] = y; rib.verts[o + 5] = z;
      }
      rib.mesh.geometry.attributes.position.needsUpdate = true;
      rib.mesh.geometry.computeVertexNormals();
    }

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
      const lateral = side * (12 + s * 1.6 + rand() * 38);
      p.userData.lateral = lateral;
      p.userData.baseY = s * 0.6;
      p.position.set(lateral, s * 0.6, -rand() * ROAD_LEN * 2);
      p.rotation.y = rand() * Math.PI;
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
    scene.add(rider);

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
    let elapsedSec = 0;     // session elapsed, which is what places the ghosts

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

      // The world is drawn relative to the rider, so everything that sits on
      // the ground is offset by the route profile at its own z.
      const baseX = curveX(z), baseY = elevY(z);
      const offX = (zz) => curveX(zz) - baseX;
      const offY = (zz) => elevY(zz) - baseY;
      updateRibbon(ground, z);
      updateRibbon(road, z);
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
      const aheadZ = z - 30;
      camera.position.set(0, 4.5, z + 9.5);
      camera.lookAt(offX(aheadZ), offY(aheadZ) + 2.35, aheadZ);

      // Live gradient, from the profile the rider is actually on.
      const dz = 6;
      grade = ((elevY(z - dz) - elevY(z)) / dz) * 100;

      // Recycle props that fall behind the camera to the far distance, and
      // pull forward any that are absurdly far ahead (e.g. after a big jump).
      for (const p of props) {
        if (p.position.z > z + 12) p.position.z -= ROAD_LEN * 2;
        else if (p.position.z < z - ROAD_LEN * 2) p.position.z += ROAD_LEN * 2;
        p.position.x = p.userData.lateral + offX(p.position.z);
        p.position.y = offY(p.position.z) + p.userData.baseY;
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
