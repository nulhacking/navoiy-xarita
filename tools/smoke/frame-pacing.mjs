import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.goto('http://localhost:5173/');await page.waitForFunction(()=>window.__xarita?.city.isReady,null,{timeout:120000});
 const result=await page.evaluate(async bicycle=>{
  const {city,engine}=window.__xarita;engine.stop();const p=city.player,gl=engine.renderer.getContext();
  if(bicycle){const {buildBicycle}=await import('/src/city/Bicycle.ts');const position=p.carPosition.clone();position.y=city.ground.heightAt(position.x,position.z)+.47;p.adoptVehicle({object:buildBicycle(),position,yaw:p.carYaw,speed:5});p.mode='drive';p.body.setEnabled(false);}
  const scopes={};let current={};
  const wrap=(object,method,label)=>{if(!object||!object[method])return;const fn=object[method].bind(object);object[method]=(...args)=>{const start=performance.now();const r=fn(...args);const ms=performance.now()-start;(scopes[label]??=[]).push(ms);current[label]=(current[label]??0)+ms;return r;};};
  for(const name of ['physics','player','traffic','parked','lake','sky','hokimiyat','farxod','xalqlar'])for(const method of ['update','step','render','updateDetail'])wrap(city[name],method,`${name}.${method}`);
  wrap(city,'select','select');for(const [key,tile]of city.tiles)wrap(tile,'updateDetails',`details.${key}`);
  const frames=[],details=[],position=p.state.position.clone();
  // Include the 100 m detail refresh threshold repeatedly, in different directions.
  for(let i=0;i<240;i++) {
   await new Promise(requestAnimationFrame);current={};const start=performance.now();
   if(i===60||i===120||i===180){for(const tile of city.tiles.values())tile.detailFocus={x:position.x+150*(i/60),z:position.z};}
   if(i===90)p.yaw+=Math.PI/2;if(i===150)p.yaw+=Math.PI;
   if(bicycle)p.carSpeed=5;
   city.update({dt:1/60,elapsed:i/60,frame:i});const update=performance.now()-start;
   engine.renderer.render(engine.scene,engine.camera);gl.finish();const ms=performance.now()-start;
   if(i>20){frames.push(ms);details.push({frame:i,ms,update,scopes:current});}
  }
  const summarize=a=>{a=[...a].sort((a,b)=>a-b);return {median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
  return {frame:summarize(frames),over50ms:frames.filter(t=>t>50).length,scopes:Object.fromEntries(Object.entries(scopes).map(([k,v])=>[k,summarize(v)])),slowest:details.sort((a,b)=>b.ms-a.ms).slice(0,8),calls:engine.renderer.info.render.calls,triangles:engine.renderer.info.render.triangles,shadows:engine.renderer.shadowMap.enabled,pixelRatio:engine.renderer.getPixelRatio(),scope:'1280x900 city update + render + GPU completion; detail refresh and camera turns'};
 },process.argv[3]==='bicycle');
 const path=`artifacts/avatar-turnarounds/3d/frame-pacing-${process.argv[2]??'current'}.json`;writeFileSync(path,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
