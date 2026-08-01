'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const sharp = require(process.env.CODEX_NODE_MODULES + '/sharp');
const root = path.resolve(__dirname, '..');
const frames = path.join(root, '.tmp-discipline-overlay-frames');
const ffmpeg = require(path.join(root, '.tmp-video-tools', 'node_modules', 'ffmpeg-static'));
const FPS = 30, TOTAL = 12 * FPS, W = 1920, H = 1080;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function svg(frame, chroma) {
  const t = frame / FPS;
  const p = Math.max(0, Math.min(1, (t - 1.7) / .65));
  const y = -390 + (1 - Math.pow(1 - p, 3)) * 500;
  const opacity = Math.min(1, Math.max(0, (t - 1.55) / .35)) * (t > 10.7 ? Math.max(0, 1 - (t - 10.7) / 1.1) : 1);
  const bg = chroma ? '<rect width="1920" height="1080" fill="#00ff00"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffdf4"/><stop offset="1" stop-color="#edf1d9"/></linearGradient><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe4a6"/><stop offset="1" stop-color="#d99a3f"/></linearGradient><filter id="shadow"><feGaussianBlur stdDeviation="18"/><feComponentTransfer><feFuncA type="linear" slope=".45"/></feComponentTransfer><feOffset dy="14"/></filter></defs>
    ${bg}
    <g opacity="${opacity}" transform="translate(0 ${y})">
      <rect x="1110" y="20" width="750" height="350" rx="30" fill="#000" opacity=".38" filter="url(#shadow)"/>
      <rect x="1110" y="20" width="750" height="350" rx="30" fill="url(#card)"/>
      <circle cx="1180" cy="90" r="35" fill="url(#gold)"/><path d="M1180 66v48M1156 90h48" stroke="#173c34" stroke-width="8" stroke-linecap="round"/>
      <text x="1240" y="78" fill="#4a3825" font-family="Arial,sans-serif" font-size="21" font-weight="800" letter-spacing="2">FUNCTIONING FAITH · LIVE</text>
      <text x="1240" y="108" fill="#8a765c" font-family="Arial,sans-serif" font-size="17">A WORD FOR THE STREAM</text>
      <text x="1160" y="180" fill="#173c34" font-family="Arial,sans-serif" font-size="34" font-weight="800">DISCIPLINE IS A DAILY YES.</text>
      <text x="1160" y="235" fill="#173c34" font-family="Georgia,serif" font-size="28">“Every man that striveth for the mastery</text>
      <text x="1160" y="275" fill="#173c34" font-family="Georgia,serif" font-size="28">is temperate in all things.”</text>
      <text x="1160" y="320" fill="#b87928" font-family="Arial,sans-serif" font-size="22" font-weight="800" letter-spacing="3">1 CORINTHIANS 9:25</text>
    </g>
  </svg>`;
}
async function render(dir, chroma) {
  const workers = Array.from({ length: 4 }, async (_, w) => {
    for (let i = w; i < TOTAL; i += 4) await sharp(Buffer.from(svg(i, chroma))).png().toFile(path.join(dir, `frame-${String(i).padStart(4, '0')}.png`));
  });
  await Promise.all(workers);
}
async function main() {
  fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true }); fs.mkdirSync(path.join(root, 'marketing'), { recursive: true });
  await render(frames, false);
  await execFileAsync(ffmpeg, ['-y','-framerate',String(FPS),'-i',path.join(frames,'frame-%04d.png'),'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0',path.join(root,'marketing','functioning-faith-discipline-overlay.webm')]);
  fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
  await render(frames, true);
  await execFileAsync(ffmpeg, ['-y','-framerate',String(FPS),'-i',path.join(frames,'frame-%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(root,'marketing','functioning-faith-discipline-overlay.mp4')]);
  fs.rmSync(frames, { recursive: true, force: true }); console.log('overlay rendered');
}
main().catch(e => { console.error(e); process.exit(1); });
