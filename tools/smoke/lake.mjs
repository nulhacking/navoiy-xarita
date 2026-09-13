import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__xarita?.city.isReady,null,{timeout:120000});
  const visit=page.getByRole('button',{name:'⌖ Ozero qirg‘og‘iga borish'});
  await visit.waitFor({state:'visible',timeout:60000});
  // Software rendering can monopolize animation frames during click stability checks.
  // Stop only the game render loop; Playwright still performs a real, unforced UI click.
  await page.evaluate(()=>window.__xarita.engine.stop());
  await visit.click();
  await page.waitForFunction(()=>!window.__xarita.city.teleporting,null,{timeout:60000});
  console.log('ready');mkdirSync('artifacts',{recursive:true});
  const result=await page.evaluate(async()=>{
    const {city,engine}=window.__xarita;engine.stop();city.paused=true;
    const p=city.frame.toLocal({lat:40.10915,lon:65.36285,alt:0});await city.teleport(p.x,p.z);
    city.clock.setCityHour(12);city.update({dt:1/60,elapsed:0,frame:1});
    const center=city.frame.toLocal({lat:40.10765,lon:65.3663,alt:0});
    const lake=city.lake;window.lakeTest={center};
    engine.camera.position.set(center.x,lake.level+1050,center.z+180);engine.camera.lookAt(center.x,lake.level,center.z);
    engine.camera.far=6000;engine.camera.updateProjectionMatrix();city.sky.dome.position.copy(engine.camera.position);
    engine.renderer.render(engine.scene,engine.camera);
    const physicsLevel=city.ground.waterLevelAt(center.x,center.z);
    const {insidePolygon}=await import('/src/city/RoadNetwork.ts');
    const ring=new Float32Array(lake.outline.flatMap(p=>[p.x,p.y]));
    let emerged=0,sampled=0,physicsError=0;
    const b=city.ground.detail.bounds;
    for(let z=b.minZ;z<b.maxZ;z+=13)for(let x=b.minX;x<b.maxX;x+=13)if(insidePolygon({x,z},ring)) {
      sampled++;const y=city.ground.heightAt(x,z);if(y>lake.level+.1)emerged++;
      if(sampled%23===0){const hit=city.physics.groundHeightAt(x,lake.level+10,z,30);if(hit!==null)physicsError=Math.max(physicsError,Math.abs(hit-y));}
    }
    return {vertices:lake.outline.length,level:lake.level,physicsLevel,depth:lake.level-city.ground.heightAt(center.x,center.z),
      emerged,sampled,physicsError,refinement:[city.ground.detail.sx,city.ground.detail.sz],
      treeCount:lake.group.userData.treeCount,paths:lake.map.roads.length,
      beds:lake.group.userData.parkBeds,landmarks:lake.group.userData.landmarks,
      invalidPositions:lake.group.children.filter(n=>n.isMesh).some(n=>Array.from(n.geometry.getAttribute('position').array).some(v=>!Number.isFinite(v))),
      waterMeshes:lake.group.children.filter(n=>n.name==='NavoiLakeWater').length,
      programs:engine.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
  });
  await page.screenshot({path:'artifacts/ozero-overhead.png'});console.log(JSON.stringify(result,null,2));
  for(const [label,x,y] of [['south',556,956],['north',467,232]]){
    await page.evaluate(async({x,y})=>{
      const {city,engine}=window.__xarita;
      const {referencePoint}=await import('/src/city/LakeReference.ts');
      const p=referencePoint(city.frame,x,y);p.y=city.ground.heightAt(p.x,p.z);
      city.clock.setCityHour(15);city.update({dt:0,elapsed:0,frame:1});
      city.sky.update(city.clock.now(),40.108,65.367,p);
      engine.camera.position.set(p.x-160,p.y+140,p.z+185);engine.camera.lookAt(p.x,p.y,p.z);
      city.sky.dome.position.copy(engine.camera.position);engine.renderer.render(engine.scene,engine.camera);
    },{x,y});
    await page.screenshot({path:`artifacts/ozero-park-${label}.png`});
  }
  for(const hour of [17,1]) {
    await page.evaluate(hour=>{
      const {city,engine}=window.__xarita,{center}=window.lakeTest;
      city.clock.setCityHour(hour);city.update({dt:1/60,elapsed:1,frame:2});
      engine.camera.position.set(center.x-215,city.lake.level+12,center.z-170);
      engine.camera.lookAt(center.x+65,city.lake.level+20,center.z+45);city.sky.dome.position.copy(engine.camera.position);
      city.lake.update(.1,1-city.skyState.daylight,engine.camera.position);engine.renderer.render(engine.scene,engine.camera);
    },hour);
    await page.screenshot({path:`artifacts/ozero-${hour===17?'evening':'night'}.png`});
  }
  const moon=await page.evaluate(()=>{
    const {city,engine}=window.__xarita;
    city.sky.environmentAt=0;
    city.sky.update(new Date('2026-09-11T03:00:00Z'),40.108,65.367,engine.camera.position);
    const morningEnvironment=engine.scene.environment.uuid;
    city.sky.environmentAt=0;
    city.sky.update(new Date('2026-09-11T12:00:00Z'),40.108,65.367,engine.camera.position);
    const reflectionTurn=morningEnvironment!==engine.scene.environment.uuid;
    city.sky.environmentAt=0;
    const state=city.sky.update(new Date('2026-09-26T18:00:00Z'),40.108,65.367,engine.camera.position);
    const dir=city.sky.dome.material.uniforms.moonDir.value;
    engine.camera.lookAt(engine.camera.position.clone().addScaledVector(dir,1000));
    engine.renderer.render(engine.scene,engine.camera);
    return {altitude:state.moon.altitude,illumination:state.moon.illumination,light:city.sky.key.intensity,reflectionTurn};
  });
  await page.screenshot({path:'artifacts/ozero-moon.png'});console.log('full moon',moon);
  assert.equal(result.vertices,46);assert.equal(result.waterMeshes,1);
  assert.ok(Math.abs(result.level-result.physicsLevel)<.03,'visible water and swimming levels must agree');
  assert.ok(result.depth>1,'lake bed must be below water');assert.ok(result.treeCount>80);assert.ok(result.paths>15);
  assert.equal(result.emerged,0,'terrain must not emerge inside the lake');assert.ok(result.sampled>500);assert.ok(result.physicsError<.03);
  assert.ok(moon.altitude>0&&moon.illumination>.8&&moon.light>0,'visible full moon must illuminate the world');
  assert.equal(moon.reflectionTurn,true,'similar sun altitude with opposite azimuth must refresh reflections');
  assert.equal(result.programs,0);assert.deepEqual(errors,[]);
  assert.equal(result.invalidPositions,false,'park geometry must have finite coordinates');
  console.log('PASS: OSM lake contour, water level/depth, reference paths/trees, day/night rendering');
}finally{await browser.close();}
