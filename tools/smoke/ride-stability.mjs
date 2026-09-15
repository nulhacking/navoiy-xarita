import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try {
 const page=await browser.newPage();await page.goto('http://localhost:5173/models.html');await page.waitForFunction(()=>window.__modelStudio);
 const result=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{Physics,RAPIER}=await import('/src/city/Physics.ts'),{Player}=await import('/src/city/Player.ts'),{Input}=await import('/src/city/Input.ts'),{loadCharacter,cloneModel}=await import('/src/city/models.ts'),{buildBicycle}=await import('/src/city/Bicycle.ts');
  const template=await loadCharacter(),results=[];
  for(const surface of ['flat','slope'])for(const hz of [60,90,120,144]){
   const slope=surface==='slope'?.06:0;
   const physics=await Physics.create();physics.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array([-500,-500*slope,-500,500,-500*slope,-500,500,500*slope,500,-500,500*slope,500]),new Uint32Array([0,2,1,0,3,2])));
   const input=new Input(document.createElement('div')),ground={heightAt:(_x,z)=>z*slope,waterLevelAt:()=>null,water:{contains:()=>false},bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500}};
   const p=new Player({physics,ground,input,camera:new T.PerspectiveCamera(),spawn:new T.Vector3(50,0,50),characterModel:cloneModel(template)});
   p.adoptVehicle({object:buildBicycle(),position:new T.Vector3(0,.47,0),yaw:0,speed:5});p.mode='drive';p.body.setEnabled(false);p.yaw=Math.PI;
   const steps=[],cameraSteps=[],wheelSteps=[];let previous=0,previousCamera=0,maxRiderLocalDrift=0,previousY=0,maxVerticalStep=0,previousRoll=0;
   const wheel=p.car.getObjectByName('WheelFront').getObjectByName('WheelSpin');
   for(let i=0;i<hz*3;i++){
    physics.step(1/hz,dt=>{p.carSpeed=5;p.update(dt);});p.render(physics.interpolationAlpha??1,1/hz);
    if(i>hz){steps.push((p.car.position.z-previous)*hz);cameraSteps.push((p.camera.position.z-previousCamera)*hz);maxVerticalStep=Math.max(maxVerticalStep,Math.abs(p.car.position.y-previousY));wheelSteps.push(Math.abs(Math.atan2(Math.sin(wheel.rotation.x-previousRoll),Math.cos(wheel.rotation.x-previousRoll))));}
    previousY=p.car.position.y;previousRoll=wheel.rotation.x;
    previous=p.car.position.z;previousCamera=p.camera.position.z;
    const hips=p.rider.object.getObjectByName('Hips'),local=p.car.worldToLocal(hips.getWorldPosition(new T.Vector3()));if(i>hz)maxRiderLocalDrift=Math.max(maxRiderLocalDrift,local.distanceTo(new T.Vector3(...p.spec.rig.seat)));
   }
   const mean=steps.reduce((a,b)=>a+b,0)/steps.length,spread=Math.max(...steps)-Math.min(...steps),cameraSpread=Math.max(...cameraSteps)-Math.min(...cameraSteps);
   results.push({surface,hz,meanSpeed:mean,speedSpread:spread,cameraSpeedSpread:cameraSpread,frozenFrames:steps.filter(v=>v<.01).length,frozenWheelFrames:wheelSteps.filter(v=>v<1e-6).length,maxVerticalStep,maxRiderLocalDrift});input.dispose();physics.dispose();
  }
  return results;
 });
 console.log(result);writeFileSync(`artifacts/avatar-turnarounds/3d/ride-stability-${process.argv[2]??'current'}.json`,JSON.stringify(result,null,2));
 if(process.argv[2]!=='before')for(const r of result){assert.equal(r.frozenFrames,0);assert.equal(r.frozenWheelFrames,0);assert.ok(r.maxVerticalStep<.01);assert.ok(r.speedSpread<.03);assert.ok(r.cameraSpeedSpread<.04);assert.ok(r.maxRiderLocalDrift<.001);}
}finally{await browser.close();}
