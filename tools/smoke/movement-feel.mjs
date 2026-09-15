import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto('http://localhost:5173/models.html');await page.waitForFunction(()=>window.__modelStudio);
 const feet=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{loadCharacter,cloneModel,alignCharacterFeet}=await import('/src/city/models.ts'),{CharacterAnimator}=await import('/src/city/CharacterAnimator.ts'),{FootPlant}=await import('/src/city/FootPlant.ts');
  const template=await loadCharacter(),results=[];
  for(const speed of [1.8,5.2]){
   const baseline=cloneModel(template).object,locked=cloneModel(template).object,a=new CharacterAnimator(baseline,template.animations),b=new CharacterAnimator(locked,template.animations),plant=new FootPlant(locked);
   const previous=new Map();let rawTravel=0,lockedTravel=0,samples=0,flightFrames=0,maxCorrection=0;
   for(let i=0;i<300;i++){
    const motion={speed,grounded:true,verticalSpeed:0,swimming:false};a.update(1/60,motion);b.update(1/60,motion);
    baseline.position.set(0,0,i*speed/60);locked.position.copy(baseline.position);alignCharacterFeet(baseline,0,speed>3);alignCharacterFeet(locked,0,speed>3);plant.update(1/60,()=>0);
    let inAir=true;
    for(const side of ['L','R']){
     const raw=baseline.getObjectByName(`Foot_${side}`).getWorldPosition(new T.Vector3()),point=locked.getObjectByName(`Foot_${side}`).getWorldPosition(new T.Vector3()),leg=plant.legs.find(l=>l.foot.name===`Foot_${side}`),last=previous.get(side);
     const rawFoot=baseline.getObjectByName(`Foot_${side}`),heel=rawFoot.localToWorld(leg.heel.clone()),toe=rawFoot.localToWorld(leg.toe.clone());
     if(Math.min(heel.y,toe.y)<.045)inAir=false;maxCorrection=Math.max(maxCorrection,raw.distanceTo(point));
     if(i>60&&last&&leg.planted&&leg.weight>.98&&last.planted){rawTravel+=Math.hypot(raw.x-last.raw.x,raw.z-last.raw.z);lockedTravel+=Math.hypot(point.x-last.point.x,point.z-last.point.z);samples++;}
     previous.set(side,{raw,point,planted:leg.planted&&leg.weight>.98});
    }
    if(inAir)flightFrames++;
   }
   results.push({speed,samples,rawSlipMetres:rawTravel,lockedSlipMetres:lockedTravel,ratio:lockedTravel/Math.max(rawTravel,.0001),flightFrames,maxCorrection});a.dispose();b.dispose();
  }
  return results;
 });
 await page.goto('http://localhost:5173/');await page.waitForFunction(()=>window.__xarita?.city.isReady,null,{timeout:120000});
 const camera=await page.evaluate(()=>{
  const {city,engine}=window.__xarita;engine.stop();const p=city.player,error=target=>Math.abs(Math.atan2(Math.sin(target-p.yaw),Math.cos(target-p.yaw)));
  p.mode='drive';p.vehicleTransition=null;p.carSpeed=5;p.carYaw=.9;p.yaw=0;p.cameraOrbitHold=0;
  for(let i=0;i<90;i++)p.updateCamera(1/60);const forwardError=error(p.carYaw+Math.PI);
  p.carYaw=1.9;const beforeTurn=error(p.carYaw+Math.PI);for(let i=0;i<60;i++)p.updateCamera(1/60);const afterTurn=error(p.carYaw+Math.PI);
  p.input.element.dispatchEvent(new MouseEvent('mousedown',{button:2}));document.dispatchEvent(new MouseEvent('mousemove',{movementX:300,movementY:0}));p.updateCamera(1/60);document.dispatchEvent(new MouseEvent('mouseup',{button:2}));const manual=p.yaw;for(let i=0;i<45;i++)p.updateCamera(1/60);const orbitDrift=Math.abs(p.yaw-manual);for(let i=0;i<150;i++)p.updateCamera(1/60);const resumedError=error(p.carYaw+Math.PI);
  p.carSpeed=-3;for(let i=0;i<120;i++)p.updateCamera(1/60);const reverseError=error(p.carYaw);
  p.carSpeed=0;p.yaw+=.7;const stationary=p.yaw;for(let i=0;i<120;i++)p.updateCamera(1/60);const stoppedDrift=Math.abs(p.yaw-stationary);
  return {forwardError,beforeTurn,afterTurn,orbitDrift,resumedError,reverseError,stoppedDrift};
 });
 const result={feet,camera};writeFileSync('artifacts/avatar-turnarounds/3d/movement-validation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 for(const f of feet){assert.ok(f.samples>15,`Support samples at ${f.speed}`);assert.ok(f.ratio<.6,`Foot planting must reduce measured ground slip at ${f.speed}`);assert.ok(f.maxCorrection<.24);if(f.speed>3)assert.ok(f.flightFrames>5,'Run must retain flight phases');}
 assert.ok(camera.forwardError<.03&&camera.afterTurn<.03&&camera.resumedError<.03&&camera.reverseError<.03);assert.ok(camera.beforeTurn>.8);assert.equal(camera.orbitDrift,0);assert.equal(camera.stoppedDrift,0);
 console.log('PASS: measured stance slip reduction, running flight, camera follows forward/turn/reverse and respects manual orbit.');
}finally{await browser.close();}
