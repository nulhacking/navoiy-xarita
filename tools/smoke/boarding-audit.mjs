import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto('http://localhost:5173/');await page.waitForFunction(()=>window.__xarita?.city.isReady,null,{timeout:120000});
 const setup=await page.evaluate(async()=>{
  const {city,engine}=window.__xarita;engine.stop();engine.renderer.domElement.id='boarding-canvas';const p=city.player,T=await import('/node_modules/.vite/deps/three.js');
  const t=p.body.translation();p.teleport(t.x,t.z);p.carYaw=0;p.carSpeed=0;
  const x=p.carPosition.x+p.spec.half.x+.55,z=p.carPosition.z+.06;
  p.body.setTranslation({x,y:city.ground.heightAt(x,z)+.92,z},true);p.body.setNextKinematicTranslation(p.body.translation());p.render();
  const scene=new T.Scene();scene.background=new T.Color('#dddcd7');scene.environment=engine.scene.environment;scene.add(new T.HemisphereLight(0xffffff,0x777771,1.2));const sun=new T.DirectionalLight(0xffffff,2.2);sun.position.set(4,8,6);scene.add(sun);
  scene.add(p.car,p.avatar);const base=p.carPosition.clone();const floor=new T.Mesh(new T.PlaneGeometry(50,50),new T.MeshStandardMaterial({color:'#d5d3cc',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.set(base.x,p.car.position.y-.02,base.z);scene.add(floor);
  const camera=new T.PerspectiveCamera(40,1280/900,.05,1000);camera.position.copy(base).add(new T.Vector3(5.8,2,4.2));camera.lookAt(base.x,base.y+.15,base.z);engine.renderer.setSize(1280,900);
  p.enterCar();window.__boarding={scene,camera,frames:0};return {};
 });
 const checks=[];
 for(const frame of [1,15,35,60,75,90]){
  const state=await page.evaluate(async frame=>{const {city,engine}=window.__xarita,p=city.player,s=window.__boarding,T=await import('/node_modules/.vite/deps/three.js');while(s.frames<frame){p.update(1/60);city.physics.world.step();p.render();s.frames++;}s.scene.updateMatrixWorld(true);let handoffError=0;const target=new Map();p.rider.object.traverse(n=>{if(n.isBone)target.set(n.name,n);});if(p.vehicleTransition&&p.vehicleTransition.elapsed>1.05)p.avatar.traverse(n=>{if(n.isBone&&target.has(n.name))handoffError=Math.max(handoffError,n.getWorldPosition(new T.Vector3()).distanceTo(target.get(n.name).getWorldPosition(new T.Vector3())));});engine.renderer.render(s.scene,s.camera);return {frame,mode:p.mode,transition:p.vehicleTransition?.elapsed??null,riderVisible:p.rider.object.visible,handoffError};},frame);checks.push(state);await page.locator('#boarding-canvas').screenshot({path:`artifacts/avatar-turnarounds/3d/audit/boarding-${frame}.png`});
 }
 await page.evaluate(()=>{const p=window.__xarita.city.player;p.exitCar();window.__boarding.frames=0;});
 const exits=[];
 for(const frame of [1,15,35,60,75,90]){
  exits.push(await page.evaluate(frame=>{const {city,engine}=window.__xarita,p=city.player,s=window.__boarding;while(s.frames<frame){p.update(1/60);city.physics.world.step();p.render();s.frames++;}engine.renderer.render(s.scene,s.camera);return {frame,mode:p.mode,transition:p.vehicleTransition?.elapsed??null,position:p.avatar.position.toArray()};},frame));
  await page.locator('#boarding-canvas').screenshot({path:`artifacts/avatar-turnarounds/3d/audit/exit-${frame}.png`});
 }
 assert.equal(exits.at(-1).mode,'walk');assert.equal(exits.at(-1).transition,null);
 const performanceResult=await page.evaluate(async()=>{const {city,engine}=window.__xarita;city.group.add(city.player.car,city.player.avatar);city.player.render();const gl=engine.renderer.getContext(),times=[];for(let i=0;i<95;i++){await new Promise(requestAnimationFrame);const start=performance.now();city.update({dt:1/60,elapsed:i/60,frame:i});engine.renderer.render(engine.scene,engine.camera);gl.finish();if(i>=5)times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {medianFrameMs:times[45],p95FrameMs:times[85],calls:engine.renderer.info.render.calls,triangles:engine.renderer.info.render.triangles,scope:'city update + render + GPU completion, 1280x900'};});
 writeFileSync('artifacts/avatar-turnarounds/3d/boarding-validation.json',JSON.stringify({checks,exits,performance:performanceResult},null,2));console.log(JSON.stringify({checks,exits,performance:performanceResult},null,2));
 assert.ok(checks.some(c=>c.transition>1.05));assert.ok(checks.every(c=>c.handoffError<.035),'Avatar and seated rider must match at handoff');assert.ok(checks.at(-1).riderVisible);
}finally{await browser.close();}

