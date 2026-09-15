import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
const require=createRequire(resolve('artifacts/blender-work/build-tools/package.json')),sharp=require('sharp');
const rows=JSON.parse(readFileSync('artifacts/avatar-turnarounds/3d/audit/report.json','utf8'));
for(const id of [...new Set(rows.map(r=>r.id))]){
 const frames=rows.filter(r=>r.id===id),columns=Math.min(9,frames.length),height=Math.ceil(frames.length/columns)*260,composite=[];
 for(const [i,frame] of frames.entries()){
  const left=i%columns*220,top=Math.floor(i/columns)*260;
  const input=await sharp(frame.path).resize(220,238,{fit:'contain',background:'#ece9e2'}).png().toBuffer();composite.push({input,left,top});
  const label=Buffer.from(`<svg width="220" height="22"><rect width="220" height="22" fill="#eee"/><text x="8" y="16" font-family="Arial" font-size="12">${frame.clip} · ${frame.fraction}</text></svg>`);composite.push({input:label,left,top:top+238});
 }
 await sharp({create:{width:columns*220,height,channels:3,background:'#ece9e2'}}).composite(composite).png().toFile(`artifacts/avatar-turnarounds/3d/audit/${id}-sheet.png`);
}
