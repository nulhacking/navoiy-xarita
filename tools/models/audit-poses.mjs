import {chromium} from 'playwright-core';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
const out='artifacts/avatar-turnarounds/3d/audit';mkdirSync(out,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}});await page.goto('http://localhost:5173/models.html');
 const report=[];
 for(const id of process.argv.slice(2).length?process.argv.slice(2):['yigit','qiz','ishbilarmon','ishchi','sedan','suv']){
  await page.selectOption('#model',id);await page.waitForFunction(id=>window.__modelStudio?.object.getObjectByName(`Xarita_${id}`)&&document.querySelector('#status').textContent.includes('tayyor'),id);
  const clips=await page.evaluate(()=>{window.__modelStudio.renderer.setAnimationLoop(null);return window.__modelStudio.clips.map(c=>({name:c.name,duration:c.duration}));});
  for(const clip of clips){
   await page.selectOption('#animation',clip.name);
   for(const fraction of ['Walk','Run','EnterVehicle','ExitVehicle'].includes(clip.name)?[0,.25,.5,.75]:[.5]){
    const data=await page.evaluate(({name,time})=>{const s=window.__modelStudio;s.mixer.stopAllAction();const a=s.mixer.clipAction(s.clips.find(c=>c.name===name)).reset().play();a.time=time;s.mixer.update(0);s.object.updateMatrixWorld(true);s.renderer.render(s.scene,s.camera);return {calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles};},{name:clip.name,time:clip.duration*fraction});
    const path=`${out}/${id}-${clip.name}-${fraction}.png`;await page.locator('#viewport').screenshot({path});report.push({id,clip:clip.name,fraction,path,...data});
   }
  }
 }
 writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(`Rendered ${report.length} animation poses.`);
}finally{await browser.close();}
