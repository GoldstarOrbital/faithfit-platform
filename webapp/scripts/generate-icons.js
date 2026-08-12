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

  if (opts.fullBleed) color = CREAM;
  else if (insideRoundedRect(px, py, 0, 0, VB, VB, 112)) color = CREAM;

  if (color === null) return null; // outside the rounded square: stays transparent

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
 * Renders at `size` px with 4x4 supersampling.
 * `maskable` fills the whole square and shrinks the mark into the 80% safe
 * circle Android masks against, so a circular crop never clips the glyph.
 */
function render(size, maskable) {
  const SS = 4;
  const scale = VB / size;
  const inset = maskable ? 0.74 : 1; // artwork scale inside a full-bleed square
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          let ux = (x + (sx + 0.5) / SS) * scale;
          let uy = (y + (sy + 0.5) / SS) * scale;
          if (maskable) {
            // Map the canvas back onto the artwork, scaled about the centre.
            ux = CX + (ux - CX) / inset;
            uy = CY + (uy - CY) / inset;
          }
          const c = sample(ux, uy, { fullBleed: maskable });
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

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = None) in front of every scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- outputs -----------------------------------------------------------
const OUT = path.join(__dirname, '..', 'public');
const TARGETS = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  // iOS ignores SVG and manifest icons for the Home Screen; it wants this one.
  ['apple-touch-icon.png', 180, true],
];

for (const [name, size, maskable] of TARGETS) {
  const png = encodePng(render(size, maskable), size);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`wrote public/${name} (${size}x${size}, ${png.length} bytes)`);
}
