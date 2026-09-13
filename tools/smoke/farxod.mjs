import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__xarita?.city.isReady,null,{timeout:120000});
  await page.evaluate(()=>window.__xarita.engine.stop());
  await page.getByRole('button',{name:'⌖ Farhod madaniyat saroyiga borish',exact:true}).click();
  await page.waitForFunction(()=>!window.__xarita.city.teleporting,null,{timeout:60000});
  mkdirSync('artifacts',{recursive:true});
  const data=await page.evaluate(async()=>{
    const {city}=window.__xarita,f=city.farxod;
    for(let i=0;i<90;i++)city.update({dt:1/60,elapsed:i/60,frame:i});
    const coords=f.basis.uv(city.playerState.position);
    // Tomning fizik balandligi: kollider yuzasi ko'rinadigan hajm bilan bir xil bo'lishi kerak.
    const roof=f.basis.point(30,-10),roofHit=city.physics.groundHeightAt(roof.x,f.base+f.height+30,roof.z,120);
    const plaza=f.basis.point(-12,-40),ground=city.ground.heightAt(plaza.x,plaza.z);
    const plazaHit=city.physics.groundHeightAt(plaza.x,ground+10,plaza.z,30);
    let invalid=0,meshes=0;f.group.traverse(n=>{if(n.isMesh){meshes++;for(const v of n.geometry.getAttribute('position').array)if(!Number.isFinite(v))invalid++;}});
    // Poydevor ichidagi OSM binosi endi shu landmarkka tegishli — tayl uni chizmasligi kerak.
    let overlappingGeneric=0;for(const t of city.tiles.values())for(const b of t.detailContext.buildings){
      const r=b.ring,q=f.basis.uv({x:r[0],z:r[1]});if(q.u>-8&&q.u<56&&q.v>-49&&q.v<49)overlappingGeneric++;
    }
    city.paused=true;
    return{...f.group.userData,meshes,invalid,coords,roofHeight:roofHit-f.base,
      plazaError:Math.abs(plazaHit-ground),grounded:city.playerState.grounded,overlappingGeneric};
  });
  console.log(JSON.stringify(data,null,2));
  const views = [
    { name: 'front', u: -72, v: -46, elevation: 14, hour: 16, targetU: 4, targetV: -4, targetElev: 11 },
    { name: 'plaza', u: -30, v: -58, elevation: 6, hour: 11, targetU: 4, targetV: -4, targetElev: 11 },
    { name: 'entrance', u: -26, v: 10, elevation: 5, hour: 10, targetU: 4, targetV: -16, targetElev: 11 },
    { name: 'satellite', u: -65, v: 0, elevation: 260, hour: 12, targetU: -65, targetV: 0, targetElev: 0 },
    { name: 'surroundings-1km', u: -70, v: 0, elevation: 650, hour: 12, targetU: -70, targetV: 0, targetElev: 0 },
  ];
  for(const view of views){
    await page.evaluate(({name,u,v,elevation,hour,targetU,targetV,targetElev})=>{
      const {city,engine}=window.__xarita,f=city.farxod;
      city.clock.setCityHour(hour);city.update({dt:0,elapsed:1,frame:100});
      const target=f.basis.point(targetU,targetV);target.y=f.base+targetElev;
      city.sky.update(city.clock.now(),40.09437,65.37999,target);
      const eye=f.basis.point(u,v);eye.y=f.base+elevation;
      engine.camera.position.copy(eye);engine.camera.lookAt(target);
      engine.camera.far=6000;engine.camera.updateProjectionMatrix();
      city.sky.dome.position.copy(eye);engine.renderer.render(engine.scene,engine.camera);
    },view);
    await page.screenshot({path:`artifacts/farxod-${view.name}.png`});
  }
  assert.equal(data.invalid,0,'landmark geometry must be finite');
  assert.equal(data.overlappingGeneric,0,'the generic tile must not also draw buildings inside the palace');
  assert.ok(data.roofHeight>16&&data.roofHeight<24,`roof collider at ${data.roofHeight}`);
  assert.ok(data.plazaError<.08,'plaza paving and walking surface must agree');
  assert.ok(data.grounded,'the visit button must land the player on solid ground');
  assert.ok(Math.hypot(data.coords.u,data.coords.v)<200,'visit button should land at the intended landmark');
  assert.deepEqual(errors,[]);
  console.log('PASS: farxod massing, plaza fountains, collisions, day/night');
}finally{await browser.close();}
