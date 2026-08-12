#!/usr/bin/env node
/**
 * Generates the raster PWA/iOS icons from the same geometry as public/icon.svg.
 *
 * There is no rasterizer on this box (no ImageMagick, no rsvg, no sharp) and we
 * do not add npm dependencies, so this draws the mark directly. That is only
 * reasonable because the mark is pure geometry: a rounded square, two dashed
 * circular arcs, an axis-aligned cross, and one stroked path. Every shape is
 * evaluated as a signed distance, so the output is genuinely antialiased rather
 * than a traced approximation.
 *
 * Keep this file in sync with public/icon.svg. If the SVG changes, re-run:
 *   npm run icons
 *
 * PNG encoding is done by hand against the spec (RFC 2083): signature, IHDR,
 * IDAT (zlib, filter byte 0 per scanline), IEND. zlib ships with Node.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- palette (identical to public/icon.svg) ----------------------------
const CREAM = [0xf6, 0xef, 0xdf];
const INK = [0x2b, 0x1e, 0x14];
const GOLD = [0xd9, 0xab, 0x55];

// ---- geometry, in the SVG's own 512x512 user space ---------------------
const VB = 512;
const CX = 256, CY = 256, R = 176, RING_W = 36;

// The ring is one dash per circle, and the two circles sit 180 degrees apart,
// so together they read as a ring broken by a gap top-right and bottom-left.
// Dash 496 of a 1105.84 circumference is 161.4 degrees; the 613 gap only has to
// be long enough that the pattern never repeats within the circle.
//
// This matches the brand mark as it is actually drawn in the header and favicon
// (r=27, dasharray "76 94" -> 76/27*176 = 495.4 here). public/icon.svg was
// carrying "248 312", which put the two arcs almost exactly on top of each
// other and hid the ink one under the gold; icon.svg has been corrected to
// agree with this.
const DEG = 180 / Math.PI;
const ARCS = [[0, (496 / R) * DEG]];

// The f: a horizontal entry, a rounded corner (cubic), then the stem. Round
// caps and joins mean "within half a stroke of the centreline", so flattening
// the cubic into a polyline and taking the distance is exact, not an estimate.
const F_STEM = flatten([
  ['M', 296, 96],
  ['L', 274, 96],
  ['C', 244, 96, 220, 120, 220, 150],
  ['L', 220, 376],
]);
const F_BAR = [[128, 218], [260, 218]];

function flatten(cmds) {
  const pts = [];
  let cur = [0, 0];
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') { cur = [c[1], c[2]]; pts.push(cur); continue; }
    // Cubic bezier, sampled finely enough that the polyline error is well under
    // a single supersample step.
    const [, x1, y1, x2, y2, x3, y3] = c;
    const [x0, y0] = cur;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      pts.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    cur = [x3, y3];
  }
  return pts;
}

function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    const d = Math.sqrt(qx * qx + qy * qy);
    if (d < best) best = d;
  }
  return best;
}

function inArc(px, py, rotation) {
  const d = Math.hypot(px - CX, py - CY);
  if (Math.abs(d - R) > RING_W / 2) return false;
  // SVG rotate(a) turns the mark clockwise on screen, which is the same
  // direction atan2 grows in when y points down, so the rotation is a subtraction.
  let a = (Math.atan2(py - CY, px - CX) * DEG - rotation) % 360;
  if (a < 0) a += 360;
  return ARCS.some(([from, to]) => a >= from && a < to);
}

/** Colour of the mark at a point in SVG user space, or null for transparent. */
function sample(px, py, opts) {
  // Painted back to front, exactly as the SVG stacks them.
  let color = null;

  // `glyphOnly` skips the background fill entirely: used for Android adaptive
  // icon foreground layers, where the background is a SEPARATE layer
  // (ic_launcher_background) composited underneath by the OS. Painting cream
  // here too would double it up and, worse, defeat the whole point of the
  // adaptive-icon system -- the OS masks the combined layers to whatever
  // shape that launcher uses (circle, squircle, rounded square...), and that
  // only looks right if "outside the glyph" is transparent, not a second
  // opaque square underneath the mask.
  if (!opts.glyphOnly) {
    if (opts.fullBleed) color = CREAM;
    else if (insideRoundedRect(px, py, 0, 0, VB, VB, 112)) color = CREAM;
    if (color === null) return null; // outside the rounded square: stays transparent
  }

  if (inArc(px, py, 96)) color = INK;
  if (inArc(px, py, -84)) color = GOLD;

  // The gold cross, both bars butt-capped and axis aligned.
  if (px >= 316 - 18 && px <= 316 + 18 && py >= 126 && py <= 390) color = GOLD;
  if (px >= 240 && px <= 392 && py >= 218 - 18 && py <= 218 + 18) color = GOLD;

  // The f sits on top so its stem reads in front of the cross.
  if (distToPolyline(px, py, F_STEM) <= 18) color = INK;
  if (distToPolyline(px, py, F_BAR) <= 18) color = INK;

  return color;
}

function insideRoundedRect(px, py, x, y, size, _h, r) {
  if (px < x || py < y || px > x + size || py > y + size) return false;
  const dx = Math.min(px - x, x + size - px);
  const dy = Math.min(py - y, y + size - py);
  if (dx >= r || dy >= r) return true;
  return Math.hypot(r - dx, r - dy) <= r;
}

/**
 * Renders at `size` px with 4x4 supersampling. `mode`:
 *   'square'     the mark on its own cream rounded-square background, at
 *                full size -- the plain app icon (icon-512, ic_launcher).
 *   'maskable'   fills the whole canvas (no transparent corners) and shrinks
 *                the mark into an 80%-ish safe zone, so a circular OS crop
 *                never clips the glyph (PWA maskable icons, apple-touch-icon,
 *                the App Store 1024 icon which must carry zero transparency).
 *   'foreground' Android adaptive-icon foreground layer: transparent
 *                everywhere except the glyph itself, inset further into the
 *                ~66% guaranteed-visible safe zone, since the OS composites
 *                this over a SEPARATE background layer and may mask it to
 *                a circle, squircle, or rounded square depending on launcher.
 */
function render(size, mode) {
  const SS = 4;
  const scale = VB / size;
  const inset = mode === 'maskable' ? 0.74 : mode === 'foreground' ? 0.60 : 1;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          let ux = (x + (sx + 0.5) / SS) * scale;
          let uy = (y + (sy + 0.5) / SS) * scale;
          if (mode === 'maskable' || mode === 'foreground') {
            // Map the canvas back onto the artwork, scaled about the centre.
            ux = CX + (ux - CX) / inset;
            uy = CY + (uy - CY) / inset;
          }
          const c = sample(ux, uy, { fullBleed: mode === 'maskable', glyphOnly: mode === 'foreground' });
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      // Un-premultiply so edge pixels keep their colour as alpha falls off.
      const cover = a / (255 * n);
      rgba[i] = cover ? Math.round(r / (a / 255)) : 0;
      rgba[i + 1] = cover ? Math.round(g / (a / 255)) : 0;
      rgba[i + 2] = cover ? Math.round(b / (a / 255)) : 0;
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

/**
 * Splash screens, unlike icons, are not square -- Android ships 11 of them
 * (5 densities x portrait/landscape, plus one default) and get shown for a
 * real, if brief, moment on every native cold start. Capacitor's own
 * template placeholder here is its generic blue logo on white, which is not
 * a small thing to ship unnoticed: it would be the very first thing anyone
 * sees opening the app.
 *
 * The mark stays a fixed physical size and centred regardless of aspect
 * ratio -- inset relative to the SHORTER side, so a wide landscape splash
 * doesn't stretch the glyph edge-to-edge and a tall portrait one doesn't
 * shrink it to a speck.
 */
function renderRect(width, height, opts) {
  const SS = 4;
  const short = Math.min(width, height);
  // BUG FIXED: this was previously VB / (short / markFraction), which is the
  // reciprocal of the intended relationship and made the mark render at
  // roughly 1/markFraction of the canvas -- i.e. wildly oversized and
  // cropped, confirmed by actually rendering a splash and looking at it
  // rather than trusting the arithmetic. The artwork's native VB=512 span
  // should occupy markFraction * short output pixels.
  const scale = VB / (short * (opts && opts.markFraction || 0.42));
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const cx = width / 2, cy = height / 2;
          const ux = CX + ((x + (sx + 0.5) / SS) - cx) * scale;
          const uy = CY + ((y + (sy + 0.5) / SS) - cy) * scale;
          const c = sample(ux, uy, { glyphOnly: true }); // background painted separately below; this is glyph-only
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (y * width + x) * 4;
      const cover = a / (255 * n);
      // Composite the glyph over solid CREAM -- a splash screen is always
      // fully opaque, so this is a flat blend, not alpha compositing.
      rgba[i] = cover ? Math.round((r / (a / 255)) * cover + CREAM[0] * (1 - cover)) : CREAM[0];
      rgba[i + 1] = cover ? Math.round((g / (a / 255)) * cover + CREAM[1] * (1 - cover)) : CREAM[1];
      rgba[i + 2] = cover ? Math.round((b / (a / 255)) * cover + CREAM[2] * (1 - cover)) : CREAM[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// ---- minimal PNG writer ------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, width, height, opts) {
  // Backward-compatible with the old (rgba, size, opts) call shape used by
  // every square icon target -- only splash screens pass width !== height.
  if (typeof height !== 'number') { opts = height; height = width; }
  const dropAlpha = opts && opts.dropAlpha;
  const channels = dropAlpha ? 3 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = dropAlpha ? 2 : 6;  // colour type: 2 = truecolor (RGB), 6 = RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = None) in front of every scanline.
  const raw = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * channels + 1);
    raw[rowStart] = 0;
    if (!dropAlpha) {
      rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
      continue;
    }
    // App Store icon requirement: NO alpha channel at all -- not "fully
    // opaque with an alpha byte", but the channel itself absent, so
    // App Store Connect's automatic "contains transparency" check has
    // nothing to trip on. Every pixel here already came from a `maskable`
    // render, which is opaque everywhere by construction; this just also
    // drops the now-redundant alpha byte from the file itself.
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4, di = rowStart + 1 + x * 3;
      raw[di] = rgba[si]; raw[di + 1] = rgba[si + 1]; raw[di + 2] = rgba[si + 2];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- outputs -----------------------------------------------------------
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const IOS_ICONSET = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

// [outputPath, size, mode, encodeOpts]
const TARGETS = [
  // --- PWA / web (unchanged from before) ---
  [path.join(PUBLIC, 'icon-192.png'), 192, 'square'],
  [path.join(PUBLIC, 'icon-512.png'), 512, 'square'],
  [path.join(PUBLIC, 'icon-maskable-512.png'), 512, 'maskable'],
  [path.join(PUBLIC, 'apple-touch-icon.png'), 180, 'maskable'],

  // --- iOS App Store icon ---
  // Xcode 14+'s single-size AppIcon.appiconset wants exactly this one file,
  // named exactly this, per ios/App/App/Assets.xcassets/AppIcon.appiconset/
  // Contents.json ("universal", 1024x1024). No alpha channel: App Store
  // Connect's automatic validation rejects an icon that carries transparency.
  [path.join(IOS_ICONSET, 'AppIcon-512@2x.png'), 1024, 'maskable', { dropAlpha: true }],
];

// --- Android: legacy square launcher icon + round variant, every density ---
// Same non-maskable full-size render as icon-512 -- the classic launcher icon
// is expected to look like the actual brand mark, corners and all.
const ANDROID_DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(ANDROID_DENSITIES)) {
  const dir = path.join(ANDROID_RES, `mipmap-${density}`);
  TARGETS.push([path.join(dir, 'ic_launcher.png'), size, 'square']);
  TARGETS.push([path.join(dir, 'ic_launcher_round.png'), size, 'square']);
}

// --- Android: adaptive-icon foreground layer, every density ---
// Transparent background, glyph inset into the safe zone -- see the
// 'foreground' mode doc on render(). The background layer is a flat colour
// (res/values/ic_launcher_background.xml), not a raster, so nothing to
// generate there.
const FOREGROUND_DENSITIES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [density, size] of Object.entries(FOREGROUND_DENSITIES)) {
  TARGETS.push([path.join(ANDROID_RES, `mipmap-${density}`, 'ic_launcher_foreground.png'), size, 'foreground']);
}

for (const [outPath, size, mode, encodeOpts] of TARGETS) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const png = encodePng(render(size, mode), size, encodeOpts);
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${path.relative(ROOT, outPath)} (${size}x${size}, ${png.length} bytes)`);
}

// --- Splash screens: replace Capacitor's generic placeholder everywhere ---
const SPLASH_TARGETS = [
  // Android: default + 4 densities, portrait and landscape each.
  [path.join(ANDROID_RES, 'drawable', 'splash.png'), 480, 320],
  [path.join(ANDROID_RES, 'drawable-land-mdpi', 'splash.png'), 480, 320],
  [path.join(ANDROID_RES, 'drawable-land-hdpi', 'splash.png'), 800, 480],
  [path.join(ANDROID_RES, 'drawable-land-xhdpi', 'splash.png'), 1280, 720],
  [path.join(ANDROID_RES, 'drawable-land-xxhdpi', 'splash.png'), 1600, 960],
  [path.join(ANDROID_RES, 'drawable-land-xxxhdpi', 'splash.png'), 1920, 1280],
  [path.join(ANDROID_RES, 'drawable-port-mdpi', 'splash.png'), 320, 480],
  [path.join(ANDROID_RES, 'drawable-port-hdpi', 'splash.png'), 480, 800],
  [path.join(ANDROID_RES, 'drawable-port-xhdpi', 'splash.png'), 720, 1280],
  [path.join(ANDROID_RES, 'drawable-port-xxhdpi', 'splash.png'), 960, 1600],
  [path.join(ANDROID_RES, 'drawable-port-xxxhdpi', 'splash.png'), 1280, 1920],
  // iOS: one universal square image, referenced 3 times per Contents.json.
  [path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732.png'), 2732, 2732],
  [path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732-1.png'), 2732, 2732],
  [path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732-2.png'), 2732, 2732],
];

for (const [outPath, w, h] of SPLASH_TARGETS) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const png = encodePng(renderRect(w, h), w, h);
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${path.relative(ROOT, outPath)} (${w}x${h}, ${png.length} bytes)`);
}
