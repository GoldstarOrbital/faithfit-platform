const fs = require('fs');
const path = require('path');
const sharp = require(process.env.CODEX_NODE_MODULES + '/sharp');
const { spawn } = require('child_process');

const root = path.resolve(__dirname,'..');
const source = 'C:/Users/alexg/Downloads/func.png';
const frames = path.join(root,'marketing','functioning-faith-intro-frames');
const output = path.join(root,'marketing','functioning-faith-intro.mp4');
const ffmpeg = require(path.join(root,'.tmp-video-tools','node_modules','ffmpeg-static'));
const W=1920,H=1080,FPS=30,SECONDS=8;
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const txt=(x,y,v,size,fill='#173c34',weight=600,anchor='start',family='Arial')=>`<text x="${x}" y="${y}" font-family="${family}" font-size="${size}px" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(v)}</text>`;
function svg(t){
  const p=Math.max(0,Math.min(1,t/.95));
  const logoScale=.78 + .22*Math.min(1,Math.max(0,(t-.15)/1.2));
  const logoOpacity=Math.min(1,Math.max(0,(t-.1)/.65));
  const titleOpacity=Math.min(1,Math.max(0,(t-1.45)/.55));
  const challenge=Math.min(1,Math.max(0,(t-3.0)/.7));
  const creators=Math.min(1,Math.max(0,(t-5.0)/.55));
  const outro=Math.min(1,Math.max(0,(t-7.0)/.5));
  let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#f8f3e9"/>`;
  s+=`<circle cx="${260+Math.sin(t*.55)*18}" cy="190" r="230" fill="#dce6dd" opacity=".3"/><circle cx="1660" cy="860" r="340" fill="#f3c568" opacity=".13"/>`;
  s+=`<path d="M120 870 C500 760, 760 960, 1120 835 S1580 760, 1870 860" fill="none" stroke="#d99a3f" stroke-width="5" opacity=".22"/>`;
  s+=`<g opacity="${logoOpacity}" transform="translate(${960-770*logoScale},${108-100*logoScale}) scale(${logoScale})"><image href="file:///C:/Users/alexg/Downloads/func.png" x="0" y="0" width="1540" height="770" preserveAspectRatio="xMidYMid meet"/></g>`;
  s+=`<g opacity="${titleOpacity}">`;
  s+=txt(960,635,'YOUR CHRISTIAN HEADQUARTERS',29,'#173c34',800,'middle');
  s+=txt(960,690,'Scripture · Movement · Community · Purpose',22,'#738477',500,'middle');
  s+=`</g>`;
  s+=`<g opacity="${challenge}">`;
  s+=`<rect x="410" y="750" width="1100" height="92" rx="46" fill="#173c34"/>`;
  s+=txt(960,790,'GLOO  ×  YOUVERSION',22,'#f3c568',800,'middle');
  s+=txt(960,821,'Scripture in New Frontiers · Virtual Summer Challenge',16,'#fffdf4',600,'middle');
  s+=`</g>`;
  s+=`<g opacity="${creators}">`;
  s+=txt(960,905,'CREATED BY',14,'#d99a3f',800,'middle');
  s+=txt(960,945,'Alex Goldsmith  ·  William Grahame',27,'#173c34',700,'middle');
  s+=`</g>`;
  s+=`<g opacity="${outro}">`;
  s+=txt(960,1000,'gloo.com/press  ·  youversion.com',15,'#738477',600,'middle');
  s+=`</g></svg>`;
  return Buffer.from(s);
}
(async()=>{
  fs.rmSync(frames,{recursive:true,force:true}); fs.mkdirSync(frames,{recursive:true});
  const logo=await sharp(source).extract({left:540,top:210,width:720,height:470}).resize({width:700,height:450,fit:'contain',background:{r:248,g:243,b:233}}).png().toBuffer();
  let next=0,total=FPS*SECONDS;
  async function worker(){while(true){const i=next++;if(i>=total)return;const base=await sharp(svg(i/FPS)).png().toBuffer();await sharp(base).composite([{input:logo,left:610,top:100}]).png().toFile(path.join(frames,`frame-${String(i).padStart(4,'0')}.png`));}}
  await Promise.all(Array.from({length:4},worker));
  await new Promise((resolve,reject)=>{const p=spawn(ffmpeg,['-y','-framerate',String(FPS),'-i',path.join(frames,'frame-%04d.png'),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:'inherit'});p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error('ffmpeg exited '+c)));});
  console.log(output);
})();
