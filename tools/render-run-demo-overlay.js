const fs = require('fs');
const path = require('path');
const sharp = require(process.env.CODEX_NODE_MODULES + '/sharp');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'marketing', 'run-demo-frames');
const output = path.join(root, 'marketing', 'functioning-faith-run-demo-overlay.mp4');
const ffmpeg = require(path.join(root, '.tmp-video-tools', 'node_modules', 'ffmpeg-static'));
const W = 1920, H = 1080, FPS = 30, SECONDS = 14;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (x, y, value, size, fill = '#173c34', weight = 400, anchor = 'start', family = 'Arial') =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}px" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
const line = (x1, y1, x2, y2, stroke, width = 3, dash = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;
const rr = (x, y, w, h, r, fill, stroke = 'none', sw = 0, opacity = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;
const circle = (cx, cy, r, fill, stroke = 'none', sw = 0, opacity = 1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;

function routeSvg(t, x, y, w, h) {
  const progress = Math.max(0, Math.min(1, (t - 3.2) / 9.5));
  const pts = [[x+60,y+h-46],[x+150,y+h-110],[x+235,y+h-72],[x+330,y+h-150],[x+430,y+h-105],[x+510,y+h-210],[x+615,y+h-165],[x+720,y+h-260],[x+770,y+60]];
  const pathD = pts.map((p,i)=>(i?'L':'M')+p[0]+' '+p[1]).join(' ');
  const total = pts.length-1, f = progress*total, i=Math.min(total-1,Math.floor(f)), q=f-i;
  const px=pts[i][0]+(pts[i+1][0]-pts[i][0])*q, py=pts[i][1]+(pts[i+1][1]-pts[i][1])*q;
  return `<g><path d="${pathD}" fill="none" stroke="#b6c7b6" stroke-width="24" opacity=".45" stroke-linecap="round" stroke-linejoin="round"/><path d="${pathD}" fill="none" stroke="#d99a3f" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${progress*1450} 1450"/><path d="M ${x+25} ${y+75} C ${x+200} ${y+18}, ${x+340} ${y+138}, ${x+520} ${y+55} S ${x+700} ${y+120}, ${x+w-25} ${y+62}" fill="none" stroke="#dbe4d9" stroke-width="3"/><path d="M ${x+30} ${y+h-150} C ${x+230} ${y+h-210}, ${x+360} ${y+h-120}, ${x+w-20} ${y+h-180}" fill="none" stroke="#dbe4d9" stroke-width="3"/>${circle(px,py,15,'#173c34','#fffdf4',5)}${circle(px,py,5,'#f3c568')}</g>`;
}

function frame(t) {
  const locked = t >= 1.7;
  const running = t >= 3.2;
  const cue = t >= 7.0;
  const finish = t >= 12.0;
  const timer = running ? Math.max(0, t - 3.2) : 0;
  const mins = String(Math.floor(timer / 60)).padStart(2,'0');
  const secs = String(Math.floor(timer % 60)).padStart(2,'0');
  const distance = running ? (timer * 0.0024).toFixed(2) : '0.00';
  const pace = running ? '8:42' : '--:--';
  const metric = (x, y, label, value, accent='#173c34') => `${text(x,y,label.toUpperCase(),14,'#738477',700)}${text(x,y+34,value,29,accent,700)}`;
  const panelX=110, panelY=55, panelW=1160, panelH=970;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += rr(0,0,W,H,0,'#00ff00');
  s += rr(panelX+12,panelY+16,panelW,panelH,42,'#102f2a','#0d211e',2,.25);
  s += rr(panelX,panelY,panelW,panelH,42,'#fffdf4','#d7e2d3',3,1);
  s += text(160,112,'FUNCTIONING FAITH',22,'#173c34',800);
  s += text(160,144,'TRAIN',14,'#d99a3f',800);
  s += rr(1038,86,180,52,26,running?'#d8f1d6':'#edf1d9');
  s += circle(1065,112,7,running?'#1e9b52':locked?'#d99a3f':'#d97845');
  s += text(1085,119,running?'RUNNING':locked?'GPS LOCKED':'LOCATING…',14,'#173c34',800);
  s += line(160,170,1218,170,'#e0e8dc',2);
  s += text(160,214,'RUN',34,'#173c34',800);
  s += text(1215,214,'LIVE TRACK',15,'#738477',700,'end');
  s += rr(160,240,1058,62,18,locked?'#e6f5e3':'#fff1dc');
  s += circle(193,271,8,locked?'#2da25c':'#d97845');
  s += text(218,278,locked?'GPS LOCKED · READY TO RUN':'Waiting for an accurate GPS lock before you go.',16,locked?'#226d42':'#9a6427',700);
  s += text(1185,278,locked?'Accuracy ±4 m':'Locating…',14,'#738477',600,'end');
  s += rr(160,330,690,410,28,'#eaf0e4');
  s += text(194,378,'ROUTE PREVIEW',14,'#738477',800);
  s += text(194,414,running?'Your run is live':'Start when your signal is ready',24,'#173c34',700);
  s += routeSvg(t,194,445,620,250);
  s += rr(194,680,620,34,17,'#d7e4d2');
  s += rr(194,680,620*Math.min(1,Math.max(0,(t-3.2)/10.8)),34,17,'#d99a3f');
  s += text(194,707,running?`${distance} km completed`:'GPS lock required to begin',13,'#173c34',700);
  s += rr(884,330,334,410,28,'#173c34');
  s += text(920,378,'LIVE STATS',14,'#b8d4be',800);
  s += text(920,450,`${mins}:${secs}`,62,'#fffdf4',800);
  s += text(920,478,'ELAPSED TIME',13,'#b8d4be',700);
  s += line(920,505,1182,505,'#42665a',2);
  s += metric(920,555,'Distance',`${distance} km`,'#f3c568');
  s += metric(1060,555,'Pace',pace,'#fffdf4');
  s += metric(920,635,'Heart rate',running?'142 BPM':'-- BPM','#fffdf4');
  s += metric(1060,635,'Calories',running?'48 kcal':'-- kcal','#fffdf4');
  s += rr(160,780,1058,82,22,running?'#173c34':locked?'#d99a3f':'#b7c2b5');
  s += text(689,832,running?'PAUSE RUN':locked?'START RUN':'WAITING FOR GPS',19,running||locked?'#fffdf4':'#6b786d',800,'middle');
  s += text(160,920,'RUN WITH PURPOSE',15,'#d99a3f',800);
  s += text(160,950,'Every mile is an opportunity to move with faith.',18,'#173c34',600);

  // Floating phone-style scripture cue, timed once during the run.
  if (cue && !finish) {
    const age = t-7; const slide = Math.min(1,age/.55); const x=1320+(1-slide)*420;
    s += rr(x+8,104,480,420,30,'#102f2a','#0d211e',2,.22);
    s += rr(x,90,480,420,30,'#fffdf4','#d7e2d3',3);
    s += text(x+34,140,'FUNCTIONING FAITH',14,'#d99a3f',800);
    s += text(x+34,177,'ON YOUR RUN',26,'#173c34',800);
    s += line(x+34,198,x+446,198,'#e0e8dc',2);
    s += text(x+34,244,'Philippians 4:13',22,'#173c34',800,'start','Georgia');
    s += text(x+34,290,'I can do all things through',21,'#173c34',400,'start','Georgia');
    s += text(x+34,321,'Christ who strengthens me.',21,'#173c34',400,'start','Georgia');
    s += rr(x+34,365,412,74,18,'#edf1d9');
    s += text(x+58,394,'KEEP GOING, ALEX.',14,'#173c34',800);
    s += text(x+58,418,'Your effort has purpose.',14,'#738477',600);
  }
  if (finish) {
    s += rr(1320,90,480,420,30,'#173c34','#d99a3f',3);
    s += text(1356,155,'RUN COMPLETE',18,'#f3c568',800);
    s += text(1356,224,'MOVE',56,'#fffdf4',800);
    s += text(1356,284,'WITH PURPOSE',56,'#fffdf4',800);
    s += text(1356,352,'Track the miles. Keep the faith.',20,'#b8d4be',600);
    s += rr(1356,400,300,58,18,'#d99a3f');
    s += text(1506,436,'FUNCTIONINGFAITH.COM',14,'#fffdf4',800,'middle');
  }
  s += `</svg>`;
  return s;
}

async function renderFrame(i) {
  const svg = Buffer.from(frame(i / FPS));
  await sharp(svg).png().toFile(path.join(outDir, `frame-${String(i).padStart(4,'0')}.png`));
}

(async () => {
  const total = FPS * SECONDS;
  let next = 0;
  async function worker() { while (true) { const i = next++; if (i >= total) return; await renderFrame(i); } }
  await Promise.all(Array.from({length:4}, worker));
  const { spawn } = require('child_process');
  await new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-y','-framerate',String(FPS),'-i',path.join(outDir,'frame-%04d.png'),'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',output], {stdio:'inherit'});
    p.on('error', reject); p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
  console.log(output);
})();
