/**
 * Media rules for member uploads — one place that decides what a post is allowed
 * to carry, for photos and now for short video.
 *
 * Two things are being enforced here and they are worth keeping distinct:
 *
 *   1. Is this actually the file type it claims to be? Decided by MAGIC BYTES.
 *      The `data:video/mp4;base64,` prefix is written by the client, so it is a
 *      claim by an attacker, not evidence. We parse the container ourselves and
 *      only accept what we can positively identify. Anything we cannot parse is
 *      rejected — the default answer is no.
 *
 *   2. Is this the kind of thing this community is for? Decided by the same
 *      self-certified category gate photos already use: nature, animals, groups,
 *      or workout/gear. Never a solo person. That is the anti-vanity rule, and
 *      it lives in ONE vocabulary (MEDIA_CATEGORIES) so photo and video can
 *      never drift apart and open a gap.
 *
 * Video is stored the same way photos are: a base64 data URL in a SQLite column.
 * That is honestly the wrong long-term answer (see MAX_VIDEO_BYTES below) and it
 * is why the cap here is small and deliberate rather than generous.
 */
'use strict';

const db = require('./db');

// ---- the shared anti-vanity vocabulary -------------------------------------
// Photos and video are gated by the SAME list. A member self-certifies what is
// in the frame; the app does not run subject detection and does not pretend to.
// The point is that "a video of me looking good" has no box to tick, so posting
// one means lying on the record — which is what the moderation queue is for.
const MEDIA_CATEGORIES = ['workout', 'nature', 'animal', 'group'];
const PHOTO_CATEGORIES = MEDIA_CATEGORIES;
const VIDEO_CATEGORIES = MEDIA_CATEGORIES;
const CATEGORY_HINT = 'Uploads can only be workout/gear, nature, animals, or groups of people — never a single-person clip (use your profile picture for that).';

// ---- caps ------------------------------------------------------------------
const MAX_IMAGE_BYTES = 250 * 1024; // 250KB — matches the existing photo cap exactly.

// 4MB. This is not a guess at what feels generous; it is the largest number that
// stays honest given how the file is stored. Video here lives as a base64 data
// URL inside the posts row, so 4MB of video is ~5.5MB of text in SQLite, in the
// request body, and in any SELECT that touches the column. That does not scale
// and object storage (upload to a bucket, store a URL) is the real answer later.
// Until then the cap is set where a clip is still worth watching — roughly
// 10-20 seconds of 720p H.264 — and where a feed page cannot blow up memory.
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;

// The size cap alone does not make a video *short*: a 10-minute talk at a low
// bitrate fits inside 4MB comfortably. This is a separate ceiling on running
// time, enforced only when we can read it out of the container with confidence.
const MAX_VIDEO_SECONDS = 60;

// Reject on length before doing any regex scanning or base64 decoding. A data
// URL longer than this can never pass the byte cap, and there is no reason to
// spend work on a multi-megabyte string to discover that.
const MAX_VIDEO_DATA_URL_CHARS = Math.ceil(MAX_VIDEO_BYTES / 3) * 4 + 64;

function fail(error, hint) { return { ok: false, error, hint }; }

// ---------------------------------------------------------------------------
// Category gate
// ---------------------------------------------------------------------------

/** True only for a category on the shared allowlist. Blank/unknown is a no. */
function isAllowedCategory(category) {
  return typeof category === 'string' && MEDIA_CATEGORIES.includes(category);
}

/** The category check as a validation result, so callers can return it directly. */
function validateCategory(category, kind) {
  if (isAllowedCategory(category)) return { ok: true, category };
  return fail(kind === 'video' ? 'invalid_video_category' : 'invalid_photo_category', CATEGORY_HINT);
}

// ---------------------------------------------------------------------------
// Images — same rules as the existing post/avatar path, kept here so photo and
// video validation can eventually be read side by side in one file.
// ---------------------------------------------------------------------------

function validateImage(dataUrl) {
  if (typeof dataUrl !== 'string') return fail('invalid_image', 'Choose a JPEG, PNG, or WebP image.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return fail('invalid_image', 'Choose a JPEG, PNG, or WebP image.');
  let decoded;
  try { decoded = Buffer.from(match[2], 'base64'); } catch { return fail('invalid_image', 'Choose a JPEG, PNG, or WebP image.'); }
  if (!decoded.length || decoded.length > MAX_IMAGE_BYTES) {
    return fail('image_too_large', `Image must be under ${Math.round(MAX_IMAGE_BYTES / 1024)}KB after resizing.`);
  }
  const jpeg = decoded.length >= 3 && decoded[0] === 0xff && decoded[1] === 0xd8 && decoded[2] === 0xff;
  const png = decoded.length >= 8 && decoded.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = decoded.length >= 12 && decoded.subarray(0, 4).toString('latin1') === 'RIFF' && decoded.subarray(8, 12).toString('latin1') === 'WEBP';
  if ((match[1] === 'jpeg' && !jpeg) || (match[1] === 'png' && !png) || (match[1] === 'webp' && !webp)) {
    return fail('invalid_image', 'The file contents do not match the image type.');
  }
  return { ok: true, bytes: decoded.length, format: match[1] };
}

// ---------------------------------------------------------------------------
// MP4 / ISO base media file format
//
// Layout (ISO/IEC 14496-12). A file is a flat chain of boxes, each:
//     [4 bytes big-endian size][4 bytes ASCII type][payload]
// size counts the header itself. Two escapes: size == 1 means a 64-bit size
// follows the type (so the header is 16 bytes), and size == 0 means "this box
// runs to the end of the file" (only legal for the last box).
//
// The first box must be `ftyp`, whose payload is:
//     [4 bytes major_brand][4 bytes minor_version][4 bytes compatible_brand]...
//
// Checking for `ftyp` alone is NOT enough. HEIC and AVIF are also ISO base media
// files with an ftyp box — a phone photo would sail straight through a naive
// check. So the major brand must be on a video allowlist, no brand anywhere in
// the box may be a known still-image brand, and the file must actually contain a
// `moov` (movie header) box, without which nothing could play it anyway.
// ---------------------------------------------------------------------------

// Brands real encoders write for playable MP4 video. Verified against files on
// hand: ffmpeg and browser MediaRecorder write `isom`; Android and several
// desktop tools write `mp42`.
const MP4_VIDEO_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'iso8', 'mp41', 'mp42', 'avc1', 'mmp4', 'dash', 'cmfc', 'M4V ']);
// Brands that share the ISO container but are not video. `qt  ` is QuickTime,
// the format iPhone's camera roll commonly supplies; it is handled as a valid
// movie container below after the same structural checks as MP4.
const ISO_STILL_IMAGE_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'miaf', 'avif', 'avis', 'jpeg', 'j2ki', 'crx ']);
const QUICKTIME_BRAND = 'qt  ';
// A 4MB file has no legitimate reason to hold thousands of top-level boxes;
// fragmented MP4 is the only shape that comes close and stays well under this.
const MP4_MAX_BOXES = 4096;

/**
 * Walk a flat box chain between two offsets. Returns null — not a partial list —
 * the moment anything does not add up, because a chain that does not tile the
 * region exactly is not a file we are willing to call an MP4.
 */
function readBoxes(buf, start, end) {
  const boxes = [];
  let off = start;
  while (off + 8 <= end) {
    if (boxes.length >= MP4_MAX_BOXES) return null;
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null; // box types are printable ASCII
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) return null;
      const hi = buf.readUInt32BE(off + 8), lo = buf.readUInt32BE(off + 12);
      if (hi > 0x1fffff) return null; // beyond a safe integer; nothing we accept is that big
      size = hi * 4294967296 + lo;
      header = 16;
    } else if (size === 0) {
      size = end - off; // runs to the end
    }
    if (size < header || off + size > end) return null; // truncated, or lying about its length
    boxes.push({ type, start: off, header, size });
    off += size;
  }
  // The chain has to account for every byte. Trailing slack means we are either
  // misreading the file or someone appended something to it.
  return off === end ? boxes : null;
}

/** Every brand named in an ftyp box: major brand first, then compatible brands. */
function ftypBrands(buf, box) {
  const payload = box.start + box.header;
  if (payload + 8 > box.start + box.size) return null;
  const brands = [buf.toString('latin1', payload, payload + 4)];
  for (let off = payload + 8; off + 4 <= box.start + box.size; off += 4) {
    brands.push(buf.toString('latin1', off, off + 4));
  }
  return brands;
}

/**
 * Running time in seconds from moov > mvhd, or null if it cannot be read.
 * mvhd payload: version(1) flags(3), then either 32-bit or 64-bit times
 * depending on version, with timescale (ticks per second) before duration.
 */
function mp4DurationSeconds(buf, moov) {
  const children = readBoxes(buf, moov.start + moov.header, moov.start + moov.size);
  const mvhd = children && children.find(b => b.type === 'mvhd');
  if (!mvhd) return null;
  const p = mvhd.start + mvhd.header;
  const version = buf[p];
  let timescale, duration;
  if (version === 0) {
    if (p + 20 > mvhd.start + mvhd.size) return null;
    timescale = buf.readUInt32BE(p + 12);
    duration = buf.readUInt32BE(p + 16);
    if (duration === 0xffffffff) return null; // "unknown" sentinel
  } else if (version === 1) {
    if (p + 32 > mvhd.start + mvhd.size) return null;
    timescale = buf.readUInt32BE(p + 20);
    const hi = buf.readUInt32BE(p + 24), lo = buf.readUInt32BE(p + 28);
    if (hi === 0xffffffff && lo === 0xffffffff) return null;
    if (hi > 0x1fffff) return null;
    duration = hi * 4294967296 + lo;
  } else {
    return null;
  }
  if (!timescale || !Number.isFinite(duration)) return null;
  return duration / timescale;
}

/** Identify an MP4 from its bytes. Returns { ok, duration_s } or a failure. */
function inspectMp4(buf) {
  if (buf.length < 16) return fail('invalid_video', 'That file is too small to be a video.');
  const boxes = readBoxes(buf, 0, buf.length);
  if (!boxes || !boxes.length) return fail('invalid_video', 'That file is not a readable MP4 video.');
  if (boxes[0].type !== 'ftyp') return fail('invalid_video', 'That file is not a readable MP4 video.');

  const brands = ftypBrands(buf, boxes[0]);
  if (!brands) return fail('invalid_video', 'That file is not a readable MP4 video.');
  if (brands.some(b => ISO_STILL_IMAGE_BRANDS.has(b))) {
    return fail('invalid_video', 'That looks like a photo (HEIC/AVIF), not a video. Choose a video file.');
  }
  if (brands[0] !== QUICKTIME_BRAND && !MP4_VIDEO_BRANDS.has(brands[0])) {
    return fail('invalid_video', 'That MP4 uses a format the app cannot confirm is playable video.');
  }

  const moov = boxes.find(b => b.type === 'moov');
  if (!moov) return fail('invalid_video', 'That MP4 is missing its movie header, so it would not play.');

  return { ok: true, duration_s: mp4DurationSeconds(buf, moov) };
}

// ---------------------------------------------------------------------------
// WebM / Matroska (EBML)
//
// The file opens with the EBML header element, id 0x1A45DFA3. Every element is
// [id][size][data], where both id and size are EBML variable-length integers:
// the number of leading zero bits in the first byte gives the total length, and
// for sizes the marker bit is stripped from the value (ids keep their bytes).
//
// Being an EBML file is not enough — .mkv is EBML too, and browsers will not
// reliably play it. The DocType string inside the header must literally be
// "webm", and a Segment element (0x18538067) must follow it.
// ---------------------------------------------------------------------------

const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const ID_EBML_HEADER = 0x1a45dfa3;
const ID_DOCTYPE = 0x4282;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const EBML_MAX_HEADER_BYTES = 4096; // the real thing is a few dozen bytes

/** Total byte length of a vint given its first byte, or 0 if that byte is invalid. */
function vintLength(byte) {
  if (!byte) return 0; // a leading 0x00 means a length beyond 8 bytes: not something we read
  let len = 1;
  for (let mask = 0x80; !(byte & mask); mask >>= 1) len++;
  return len;
}

/** Element id, kept as its raw bytes (that is how EBML ids are written down). */
function readElementId(buf, off, end) {
  const len = vintLength(buf[off]);
  if (!len || len > 4 || off + len > end) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[off + i];
  return { id, len };
}

/** Element size, with the marker bit stripped. All-ones means "unknown length". */
function readElementSize(buf, off, end) {
  const len = vintLength(buf[off]);
  if (!len || len > 8 || off + len > end) return null;
  const mask = 0xff >> len;
  let value = buf[off] & mask;
  let unknown = value === mask;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[off + i];
    unknown = unknown && buf[off + i] === 0xff;
  }
  if (!Number.isSafeInteger(value)) return null;
  return { size: value, len, unknown };
}

/**
 * The direct children of an EBML element. Stops rather than guesses: an element
 * of unknown length (which is normal for a Segment written by MediaRecorder) is
 * yielded as running to the end of the region, and scanning stops there because
 * there is no safe way to find what follows it.
 */
function* ebmlChildren(buf, start, end) {
  let off = start;
  while (off + 2 <= end) {
    const id = readElementId(buf, off, end);
    if (!id) return;
    const size = readElementSize(buf, off + id.len, end);
    if (!size) return;
    const dataStart = off + id.len + size.len;
    const dataEnd = size.unknown ? end : dataStart + size.size;
    if (dataEnd > end || dataEnd < dataStart) return;
    yield { id: id.id, dataStart, dataEnd, unknown: size.unknown };
    if (size.unknown) return;
    off = dataEnd;
  }
}

function readUnsigned(buf, start, end) {
  if (end <= start || end - start > 8) return null;
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + buf[i];
  return Number.isSafeInteger(value) ? value : null;
}

function readEbmlFloat(buf, start, end) {
  const width = end - start;
  if (width === 4) return buf.readFloatBE(start);
  if (width === 8) return buf.readDoubleBE(start);
  return null;
}

/**
 * Running time in seconds from Segment > Info, or null. Matroska stores Duration
 * as a float in TimecodeScale units, and TimecodeScale in nanoseconds (default
 * 1,000,000 — i.e. Duration is normally in milliseconds).
 */
function webmDurationSeconds(buf, segment) {
  for (const child of ebmlChildren(buf, segment.dataStart, segment.dataEnd)) {
    if (child.id !== ID_INFO) continue;
    let scale = 1000000, duration = null;
    for (const item of ebmlChildren(buf, child.dataStart, child.dataEnd)) {
      if (item.id === ID_TIMECODE_SCALE) {
        const v = readUnsigned(buf, item.dataStart, item.dataEnd);
        if (v) scale = v;
      } else if (item.id === ID_DURATION) {
        duration = readEbmlFloat(buf, item.dataStart, item.dataEnd);
      }
    }
    if (duration === null || !Number.isFinite(duration) || duration <= 0) return null;
    return (duration * scale) / 1e9;
  }
  return null;
}

/** Identify a WebM from its bytes. Returns { ok, duration_s } or a failure. */
function inspectWebm(buf) {
  if (buf.length < 8 || !buf.subarray(0, 4).equals(EBML_MAGIC)) {
    return fail('invalid_video', 'That file is not a readable WebM video.');
  }
  const top = [...ebmlChildren(buf, 0, buf.length)];
  const header = top[0];
  if (!header || header.id !== ID_EBML_HEADER || header.unknown) {
    return fail('invalid_video', 'That file is not a readable WebM video.');
  }
  if (header.dataEnd - header.dataStart > EBML_MAX_HEADER_BYTES) {
    return fail('invalid_video', 'That file is not a readable WebM video.');
  }

  let docType = null;
  for (const child of ebmlChildren(buf, header.dataStart, header.dataEnd)) {
    if (child.id === ID_DOCTYPE) docType = buf.toString('latin1', child.dataStart, child.dataEnd).replace(/\0+$/, '');
  }
  if (docType !== 'webm') {
    return fail('invalid_video', docType === 'matroska'
      ? 'That is a Matroska (.mkv) file, which does not play everywhere. Convert it to WebM or MP4.'
      : 'That file is not a readable WebM video.');
  }

  const segment = top.find(el => el.id === ID_SEGMENT);
  if (!segment) return fail('invalid_video', 'That WebM has no video segment, so it would not play.');

  return { ok: true, duration_s: webmDurationSeconds(buf, segment) };
}

// ---------------------------------------------------------------------------
// The public video check
// ---------------------------------------------------------------------------

/**
 * Validate a short video upload.
 *
 * @param {string} dataUrl  data:video/mp4;base64,..., data:video/quicktime;base64,..., or data:video/webm;base64,...
 * @param {string} [category]  self-certified subject; checked when supplied.
 * @returns {{ok:true, bytes:number, format:string, duration_s:number|null, category:string|null}
 *          |{ok:false, error:string, hint:string}}
 *
 * The declared MIME type is only ever used to decide which parser to run. If the
 * bytes disagree with the label, the answer is no.
 */
function validateVideo(dataUrl, category) {
  if (typeof dataUrl !== 'string' || !dataUrl) {
    return fail('invalid_video', 'Choose an MP4, MOV, or WebM video.');
  }
  if (dataUrl.length > MAX_VIDEO_DATA_URL_CHARS) {
    return fail('video_too_large', `Video must be under ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))}MB.`);
  }
  const match = /^data:video\/(mp4|quicktime|webm);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return fail('invalid_video', 'Choose an MP4, MOV, or WebM video.');

  let decoded;
  try { decoded = Buffer.from(match[2], 'base64'); } catch { return fail('invalid_video', 'Choose an MP4, MOV, or WebM video.'); }
  if (!decoded.length) return fail('invalid_video', 'Choose an MP4, MOV, or WebM video.');
  if (decoded.length > MAX_VIDEO_BYTES) {
    return fail('video_too_large', `Video must be under ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))}MB. Trim the clip or record at a lower quality.`);
  }

  // The label picks the parser; the bytes decide the outcome. A WAV renamed to
  // .webm, or a HEIC photo posted as video/mp4, fails here.
  const declared = match[1];
  const inspected = declared === 'webm' ? inspectWebm(decoded) : inspectMp4(decoded);
  if (!inspected.ok) return inspected;

  // Only enforced when the container told us plainly. An unreadable duration is
  // not treated as a violation — the byte cap is still doing its work — but it
  // is reported as null so a caller can see the difference.
  const duration = inspected.duration_s;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > MAX_VIDEO_SECONDS) {
    return fail('video_too_long', `Videos are capped at ${MAX_VIDEO_SECONDS} seconds. This one is about ${Math.round(duration)}s — trim it and try again.`);
  }

  if (category !== undefined) {
    const gate = validateCategory(category, 'video');
    if (!gate.ok) return gate;
  }

  return {
    ok: true,
    bytes: decoded.length,
    format: declared,
    duration_s: typeof duration === 'number' && Number.isFinite(duration) ? +duration.toFixed(2) : null,
    category: category === undefined ? null : category,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Additive columns on posts, same pattern as lib/reels.js: read PRAGMA
 * table_info and add only what is missing, so this is safe to run on every boot
 * and against a database that predates video.
 */
function init() {
  const cols = db.prepare('PRAGMA table_info(posts)').all().map(c => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE posts ADD COLUMN ${ddl}`); };
  add('video_data', 'video_data TEXT');          // data: URL, exactly like photo_data
  add('video_category', 'video_category TEXT');  // one of MEDIA_CATEGORIES
  add('video_format', 'video_format TEXT');      // 'mp4' | 'webm', as verified from bytes
  add('video_bytes', 'video_bytes INTEGER');     // decoded size, for reporting and future migration
  add('video_duration_s', 'video_duration_s REAL'); // null when the container did not say
}

module.exports = {
  init,
  validateImage,
  validateVideo,
  validateCategory,
  isAllowedCategory,
  MEDIA_CATEGORIES,
  PHOTO_CATEGORIES,
  VIDEO_CATEGORIES,
  CATEGORY_HINT,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
};
