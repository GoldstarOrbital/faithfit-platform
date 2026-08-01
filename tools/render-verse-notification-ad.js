'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const sharp = require(process.env.CODEX_NODE_MODULES + '/sharp');

const root = path.resolve(__dirname, '..');
const framesDir = path.join(root, '.tmp-verse-ad-frames');
const out = path.join(root, 'marketing', 'functioning-faith-verse-notification-ad.mp4');
const ffmpeg = require(path.join(root, '.tmp-video-tools', 'node_modules', 'ffmpeg-static'));
const FPS = 24;
const TOTAL = 15 * FPS;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function svgFor(frame) {
  const t = frame / FPS;
  const run = Math.sin(t * 9) * 12;
  const notifProgress = Math.max(0, Math.min(1, (t - 5.2) / 0.7));
  const notifY = -390 + (1 - Math.pow(1 - notifProgress, 3)) * 820;
  const notifOpacity = Math.min(1, Math.max(0, (t - 5.05) / 0.35));
  const glow = 0.22 + Math.abs(Math.sin(t * 4)) * 0.12;
  const showIntro = t < 3.2;
  const showCta = t > 11.8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#153d35"/><stop offset=".55" stop-color="#0b2726"/><stop offset="1" stop-color="#301d16"/></linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe4a6"/><stop offset="1" stop-color="#d99a3f"/></linearGradient>
      <linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffdf4"/><stop offset="1" stop-color="#f0ead8"/></linearGradient>
      <filter id="shadow"><feGaussianBlur stdDeviation="22"/><feComponentTransfer><feFuncA type="linear" slope=".35"/></feComponentTransfer><feOffset dy="18"/></filter>
      <filter id="soft"><feGaussianBlur stdDeviation="45"/></filter>
    </defs>
    <rect width="1080" height="1920" fill="url(#bg)"/>
    <circle cx="120" cy="380" r="300" fill="#4ccf8b" opacity="${glow}" filter="url(#soft)"/>
    <circle cx="980" cy="1430" r="330" fill="#d99a3f" opacity=".12" filter="url(#soft)"/>
    <path d="M-100 1480 C220 1320 380 1590 620 1430 S980 1270 1190 1390" fill="none" stroke="#f4d98d" stroke-opacity=".22" stroke-width="4"/>
    <path d="M-80 1520 C220 1360 380 1630 620 1470 S980 1310 1160 1430" fill="none" stroke="#6de0a4" stroke-opacity=".16" stroke-width="2"/>
    <text x="70" y="100" fill="#fff7e2" font-family="Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="7">FUNCTIONING FAITH</text>
    <circle cx="970" cy="88" r="22" fill="none" stroke="#f3ce7a" stroke-width="4"/><path d="M970 75v15l10 7" fill="none" stroke="#f3ce7a" stroke-width="4" stroke-linecap="round"/>
    ${showIntro ? `<g opacity="${Math.min(1, t * 2)}"><text x="70" y="700" fill="#ffe7ad" font-family="Arial,sans-serif" font-size="30" font-weight="700" letter-spacing="6">YOUR NEXT MILE</text><text x="70" y="790" fill="#fffdf4" font-family="Arial,sans-serif" font-size="86" font-weight="800">RUN WITH</text><text x="70" y="885" fill="#f3c568" font-family="Arial,sans-serif" font-size="86" font-weight="800">PURPOSE.</text><text x="70" y="960" fill="#d9efe5" font-family="Arial,sans-serif" font-size="30">A little encouragement, right when you need it.</text></g>` : ''}
    ${!showIntro ? `<g transform="translate(0 ${run})"><ellipse cx="370" cy="1350" rx="210" ry="38" fill="#000" opacity=".28" filter="url(#soft)"/><circle cx="370" cy="945" r="57" fill="#f1bd8d"/><path d="M315 930q30-95 112-23l-12 42q-53-28-100 11z" fill="#191614"/><path d="M370 1005 C320 1080 325 1190 362 1270 L430 1270 C451 1150 442 1070 405 1005 Z" fill="#4ccf8b"/><path d="M365 1050L292 1155L318 1173L386 1102" fill="none" stroke="#f1bd8d" stroke-width="25" stroke-linecap="round"/><path d="M415 1060L474 1154L451 1173L390 1100" fill="none" stroke="#f1bd8d" stroke-width="25" stroke-linecap="round"/><path d="M380 1265L315 1395L360 1410L414 1282" fill="none" stroke="#f1bd8d" stroke-width="31" stroke-linecap="round"/><path d="M420 1265L474 1375L516 1360L443 1248" fill="none" stroke="#f1bd8d" stroke-width="31" stroke-linecap="round"/><path d="M335 1400l-62 0" stroke="#fffdf4" stroke-width="22" stroke-linecap="round"/><path d="M505 1360l60 22" stroke="#fffdf4" stroke-width="22" stroke-linecap="round"/></g>
      <g><text x="700" y="1130" fill="#fffdf4" font-family="Arial,sans-serif" font-size="25" letter-spacing="3">LIVE RUN</text><text x="700" y="1200" fill="#ffe7ad" font-family="Arial,sans-serif" font-size="70" font-weight="800">3.84</text><text x="700" y="1240" fill="#d9efe5" font-family="Arial,sans-serif" font-size="24">MILES</text><text x="700" y="1320" fill="#ffe7ad" font-family="Arial,sans-serif" font-size="70" font-weight="800">8:42</text><text x="700" y="1360" fill="#d9efe5" font-family="Arial,sans-serif" font-size="24">PACE / MI</text></g>` : ''}
    ${notifOpacity > 0 ? `<g transform="translate(50 ${notifY})" opacity="${notifOpacity}"><rect x="0" y="0" width="980" height="365" rx="38" fill="#000" opacity=".42" filter="url(#shadow)"/><rect x="0" y="0" width="980" height="365" rx="38" fill="url(#card)"/><circle cx="68" cy="72" r="34" fill="url(#gold)"/><path d="M68 50v45M47 73h42" stroke="#173c34" stroke-width="8" stroke-linecap="round"/><text x="125" y="58" fill="#4a3825" font-family="Arial,sans-serif" font-size="22" font-weight="800" letter-spacing="2">FUNCTIONING FAITH</text><text x="125" y="88" fill="#8a765c" font-family="Arial,sans-serif" font-size="18">JUST NOW · ON YOUR RUN</text><text x="55" y="155" fill="#173c34" font-family="Georgia,serif" font-size="35" font-weight="700">“I can do all things through Christ</text><text x="55" y="200" fill="#173c34" font-family="Georgia,serif" font-size="35" font-weight="700">who strengthens me.”</text><text x="55" y="248" fill="#b87928" font-family="Arial,sans-serif" font-size="24" font-weight="800" letter-spacing="3">PHILIPPIANS 4:13</text><rect x="55" y="285" width="870" height="2" fill="#decda9"/><text x="55" y="330" fill="#4a3825" font-family="Arial,sans-serif" font-size="24" font-weight="700">Keep going, Alex. You’re stronger than this moment.</text></g>` : ''}
    ${showCta ? `<g opacity="${Math.min(1, (t - 11.8) * 2)}"><rect x="70" y="1640" width="940" height="130" rx="65" fill="#f3c568"/><text x="540" y="1722" text-anchor="middle" fill="#173c34" font-family="Arial,sans-serif" font-size="34" font-weight="800" letter-spacing="3">MOVE WITH PURPOSE</text><text x="70" y="1840" fill="#d9efe5" font-family="Arial,sans-serif" font-size="26">Faith, fitness, and encouragement in one place.</text></g>` : ''}
  </svg>`;
}

async function main() {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const workers = Array.from({ length: 4 }, async (_, worker) => {
    for (let i = worker; i < TOTAL; i += 4) {
      await sharp(Buffer.from(svgFor(i))).png().toFile(path.join(framesDir, `frame-${String(i).padStart(4, '0')}.png`));
    }
  });
  await Promise.all(workers);
  await execFileAsync(ffmpeg, ['-y', '-framerate', String(FPS), '-i', path.join(framesDir, 'frame-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  fs.rmSync(framesDir, { recursive: true, force: true });
  console.log(out);
}
main().catch(err => { console.error(err); process.exit(1); });
