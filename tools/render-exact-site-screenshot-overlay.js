const fs = require('fs');
const path = require('path');
const sharp = require(process.env.CODEX_NODE_MODULES + '/sharp');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const shots = [
  path.join(root,'marketing','live-train-initial.png'),
  path.join(root,'marketing','live-train-cue.png'),
  path.join(root,'marketing','live-train-cue-result.png')
];
const frames = path.join(root,'marketing','exact-site-run-frames');
const out = path.join(root,'marketing','functioning-faith-exact-site-run-overlay.mp4');
const ffmpeg = require(path.join(root,'.tmp-video-tools','node_modules','ffmpeg-static'));
const W=1920,H=1080,FPS=30,SECONDS=14;

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const label = (x,y,txt,size,fill='#fffdf4',weight=700) => `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}px" font-weight="${weight}" fill="${fill}">${esc(txt)}</text>`;
function overlay(t) {
  const scene = t < 3 ? 0 : t < 7 ? 1 : t < 11 ? 2 : 0;
  const sceneTitle = scene===0 ? 'OPEN TRAIN' : scene===1 ? 'WAIT FOR GPS LOCK' : 'GET YOUR STARTING CUE';
  const sceneSub = scene===0 ? 'Select Run and review your live metrics.' : scene===1 ? 'Functioning Faith waits for an accurate location before starting.' : 'The exact live app brings in your faith-aligned cue and route map.';
  const progress = scene===0 ? Math.min(1,t/3) : scene===1 ? Math.min(1,(t-3)/4) : Math.min(1,(t-7)/4);
  const steps = ['01  TRAIN','02  GPS LOCK','03  CUE + MAP'];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#00ff00"/>`;
  s += `<rect x="90" y="115" width="760" height="850" rx="38" fill="#173c34" opacity=".96"/>`;
  s += label(150,205,'FUNCTIONING FAITH',30,'#f3c568',800);
  s += label(150,286,'START A RUN',68,'#fffdf4',800);
  s += label(150,345,'on the real app',30,'#b8d4be',600);
  s += `<line x1="150" y1="395" x2="760" y2="395" stroke="#42665a" stroke-width="3"/>`;
  s += steps.map((v,i)=>{const active=i===scene; return `<circle cx="178" cy="${480+i*92}" r="14" fill="${active?'#f3c568':'#42665a'}"/>${label(220,491+i*92,v,25,active?'#fffdf4':'#b8d4be',active?800:600)}`;}).join('');
  s += `<rect x="150" y="805" width="610" height="8" rx="4" fill="#42665a"/><rect x="150" y="805" width="${610*progress}" height="8" rx="4" fill="#f3c568"/>`;
  s += label(150,890,sceneTitle,25,'#f3c568',800);
  s += label(150,930,sceneSub,18,'#b8d4be',600);
  s += `</svg>`;
  return { svg:Buffer.from(s), scene };
}

(async()=>{
  fs.rmSync(frames,{recursive:true,force:true}); fs.mkdirSync(frames,{recursive:true});
  const crops=[];
  for (const file of shots) {
    const crop = await sharp(file).extract({left:470,top:0,width:560,height:692}).resize({height:940}).png().toBuffer();
    crops.push(crop);
  }
  let next=0; const total=FPS*SECONDS;
  async function worker(){ while(true){ const i=next++; if(i>=total)return; const t=i/FPS; const {svg,scene}=overlay(t); const base=await sharp(svg).png().toBuffer(); const img=crops[scene]; await sharp(base).composite([{input:img,left:1030,top:70}]).png().toFile(path.join(frames,`frame-${String(i).padStart(4,'0')}.png`)); }}
  await Promise.all(Array.from({length:4},worker));
  await new Promise((resolve,reject)=>{const p=spawn(ffmpeg,['-y','-framerate',String(FPS),'-i',path.join(frames,'frame-%04d.png'),'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:'inherit'});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error('ffmpeg exited '+code)));});
  console.log(out);
})();
