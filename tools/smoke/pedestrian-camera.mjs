import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try{
 const page=await browser.newPage();await page.goto('http://localhost:5173/models.html');await page.waitForFunction(()=>window.__modelStudio);
 const result=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{Physics,RAPIER}=await import('/src/city/Physics.ts'),{Player}=await import('/src/city/Player.ts'),{Input}=await import('/src/city/Input.ts');
  const physics=await Physics.create();physics.world.createCollider(RAPIER.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0));
  const input=new Input(document.createElement('div')),ground={heightAt:()=>0,waterLevelAt:()=>null,water:{contains:()=>false},bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500}};
  const p=new Player({physics,ground,input,camera:new T.PerspectiveCamera(),spawn:new T.Vector3(),carSpawn:new T.Vector3(100,0,100)});
  // Teleport parks the owned car at +X. Keep this directional camera fixture
  // obstacle-free until the explicit wall test below.
  p.carCollider.setEnabled(false);
  const tick=(seconds,hz=60)=>{for(let i=0;i<seconds*hz;i++){physics.step(1/hz,dt=>p.update(dt));p.render();}};
  const error=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b))),directions=[];
  for(const hz of [30,60,120])for(const [name,x,y]of [['W',0,1],['A',-1,0],['S',0,-1],['D',1,0],['WA',-.7071,.7071],['joystick',.36,.48]]){
    input.setVirtualAxis(0,0);p.teleport(0,0);p.yaw=0;tick(.5);input.setVirtualAxis(x,y);tick(3,hz);
    const at=p.body.translation(),heading=Math.atan2(x,-y),target=heading+Math.PI;
    directions.push({name,hz,headingError:error(Math.atan2(at.x,at.z),heading),cameraError:error(p.yaw,target),distance:Math.hypot(at.x,at.z)});
  }
  input.setVirtualAxis(0,0);tick(.25);const stopped=p.yaw;tick(2);const stoppedDrift=error(p.yaw,stopped);
  p.teleport(0,0);p.yaw=0;tick(.5);input.setVirtualAxis(0,1);tick(.5);input.mouseDeltaX=220;p.updateCamera(1/60);const orbit=p.yaw;tick(.75);const manualDrift=error(p.yaw,orbit);tick(2);const resumedError=error(p.yaw,p.walkCameraHeading+Math.PI);
  input.setVirtualAxis(0,0);tick(.5);const newHeading=p.yaw+Math.PI;input.setVirtualAxis(0,1);const before=p.body.translation();tick(1);const after=p.body.translation();const restartError=error(Math.atan2(after.x-before.x,after.z-before.z),newHeading);
  input.setVirtualAxis(0,0);p.teleport(0,0);p.yaw=0;tick(.5);
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.1,2,20).setTranslation(1.2,2,0));
  input.setVirtualAxis(.7071,.7071);tick(3);const wallFacingError=error(p.facing,Math.PI),wallCameraError=error(p.yaw,0);
  return {directions,stoppedDrift,manualDrift,resumedError,restartError,wallFacingError,wallCameraError};
 });
 writeFileSync('artifacts/avatar-turnarounds/3d/pedestrian-camera-validation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 assert.ok(result.directions.every(d=>d.headingError<.001&&d.cameraError<.001),'Held direction must remain straight while camera follows at all frame rates');assert.equal(result.stoppedDrift,0);assert.equal(result.manualDrift,0);assert.ok(result.resumedError<.02);assert.ok(result.restartError<.001);assert.ok(result.wallFacingError<.03&&result.wallCameraError<.03,'Body and camera must face the collision-resolved travel along a wall');
}finally{await browser.close();}
