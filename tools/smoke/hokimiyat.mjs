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
  await page.getByRole('button',{name:'⌖ Viloyat hokimiyatiga borish',exact:true}).click();
  await page.waitForFunction(()=>!window.__xarita.city.teleporting,null,{timeout:60000});
  mkdirSync('artifacts',{recursive:true});
  const data=await page.evaluate(async()=>{
    const {city,engine}=window.__xarita,h=city.hokimiyat;
    // Settle on the loaded plaza approach and test actual collider geometry.
    for(let i=0;i<90;i++)city.update({dt:1/60,elapsed:i/60,frame:i});
    const position=city.playerState.position.clone();
    const coords=h.basis.uv(position),center=h.basis.point(0,0);
    const hit=city.physics.groundHeightAt(center.x,h.base+h.height+20,center.z,100);
    const plaza=h.basis.point(5,70),ground=city.ground.heightAt(plaza.x,plaza.z);
    const plazaHit=city.physics.groundHeightAt(plaza.x,ground+10,plaza.z,30);
    let invalid=0,meshes=0;h.group.traverse(n=>{if(n.isMesh){meshes++;for(const v of n.geometry.getAttribute('position').array)if(!Number.isFinite(v))invalid++;}});
    // The generic tile must not also own colliders/rendered detail for the three replaced IDs.
    let overlappingGeneric=0;for(const t of city.tiles.values())for(const b of t.detailContext.buildings){
      const r=b.ring,u=h.basis.uv({x:r[0],z:r[1]});if(Math.abs(u.u)<17&&Math.abs(u.v)<11)overlappingGeneric++;
    }
    city.paused=true;
    return{...h.group.userData,meshes,invalid,coords,roofHeight:hit-h.base,plazaError:Math.abs(plazaHit-ground),grounded:city.playerState.grounded,overlappingGeneric};
  });
  console.log(JSON.stringify(data,null,2));
  for(const [name,u,v,elevation,hour]of [['front',53,100,9,15],['satellite',5,72,245,12],['street',48,-58,5,17],['night',35,88,8,21]]){
    await page.evaluate(({u,v,elevation,hour})=>{
      const {city,engine}=window.__xarita,h=city.hokimiyat;
      city.clock.setCityHour(hour);city.update({dt:0,elapsed:1,frame:100});
      const target=h.basis.point(-16,30);target.y=h.base+19;
      city.sky.update(city.clock.now(),40.10332,65.37386,target);
      const eye=h.basis.point(u,v);eye.y=h.base+elevation;
      engine.camera.position.copy(eye);engine.camera.lookAt(target);engine.camera.far=6000;engine.camera.updateProjectionMatrix();
      city.sky.dome.position.copy(eye);engine.renderer.render(engine.scene,engine.camera);
    },{u,v,elevation,hour});
    await page.screenshot({path:`artifacts/hokimiyat-${name}.png`});
  }
  assert.equal(data.invalid,0);assert.equal(data.overlappingGeneric,0);assert.ok(data.roofHeight>45&&data.roofHeight<52);
  assert.ok(data.plazaError<.08,'plaza paving and walking surface must agree');assert.ok(data.grounded);
  assert.ok(Math.hypot(data.coords.u,data.coords.v)<200,'visit button should land at the intended landmark');
  assert.deepEqual(errors,[]);console.log('PASS: hokimiyat facade, unique geometry, plaza approach, collisions, day/night');
}finally{await browser.close();}
