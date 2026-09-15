import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});await page.goto('http://localhost:5173/models.html');await page.waitForFunction(()=>window.__modelStudio);
 const result=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{loadFleet,vehicleSpec}=await import('/src/city/FleetAssets.ts'),{loadCharacter}=await import('/src/city/models.ts'),{Rider}=await import('/src/city/Rider.ts'),{animateVehicle}=await import('/src/city/VehicleRig.ts');
  const bike=(await loadFleet()).find(m=>m.object.userData.vehicleId==='bicycle').object,rider=new Rider(await loadCharacter()),spec=vehicleSpec(bike);bike.add(rider.object);rider.pose(spec);
  const wheels=[];bike.traverse(n=>{if(n.userData.vehicleWheel)wheels.push(n);});
  const wheelTests=wheels.map(w=>{const spin=w.getObjectByName('WheelSpin'),center=w.getWorldPosition(new T.Vector3()),radius=w.userData.radius*w.getWorldScale(new T.Vector3()).y;const local=spin.worldToLocal(center.clone().add(new T.Vector3(0,-radius,0)));return {spin,local,before:spin.localToWorld(local.clone())};});
  animateVehicle(bike,.001,0);bike.position.z+=.001;bike.updateMatrixWorld(true);
  const contactErrors=wheelTests.map(({spin,local,before})=>spin.localToWorld(local.clone()).distanceTo(before));
  const ankle=rider.object.getObjectByName('Foot_L'),before=ankle.getWorldPosition(new T.Vector3());rider.pose(spec,.001);const after=ankle.getWorldPosition(new T.Vector3());
  const frontPedalMovesDown=after.y<before.y,frames=[];let previous=after.clone();
  let pedalContactError=0;
  for(let i=0;i<120;i++){
    const distance=i<90?5/60:-3/60;
    animateVehicle(bike,distance,0);rider.pose(spec,distance,0,bike.userData.pedalPhase);
    const point=ankle.getWorldPosition(new T.Vector3());frames.push(point.distanceTo(previous));previous.copy(point);
    const sole=bike.worldToLocal(point.clone()).add(new T.Vector3(0,-.085,.07)),pedal=bike.worldToLocal(bike.getObjectByName('Pedal_L').getWorldPosition(new T.Vector3()));
    pedalContactError=Math.max(pedalContactError,sole.distanceTo(pedal));
  }
  const cadenceRPM=5/.86/Math.PI/2*60;
  const {scene,renderer,camera,object}=window.__modelStudio;renderer.setAnimationLoop(null);scene.remove(object);scene.add(bike);rider.pose(spec,0,0,bike.userData.pedalPhase);
  document.querySelector('aside').style.display='none';document.querySelector('#studio').style.gridTemplateColumns='1fr';document.querySelector('.topline').style.display='none';document.querySelector('.bottomline').style.display='none';
  camera.position.set(3.2,1.25,2.6);camera.lookAt(0,.85,0);camera.fov=35;camera.aspect=1200/900;camera.updateProjectionMatrix();renderer.setSize(1200,900);renderer.render(scene,camera);
  return {contactErrors,frontPedalMovesDown,cadenceRPM,pedalContactError,frozenMovingFrames:frames.filter(d=>d<1e-5).length,maxAnkleStep:Math.max(...frames)};
 });
 await page.locator('#viewport canvas').screenshot({path:'artifacts/avatar-turnarounds/3d/bicycle-current.png'});
 writeFileSync('artifacts/avatar-turnarounds/3d/bicycle-validation.json',JSON.stringify(result,null,2));console.log(result);
 assert.ok(result.contactErrors.every(e=>e<.00002),'Wheel ground contact must roll forwards without sliding');assert.ok(result.frontPedalMovesDown,'Forward crank must push the front pedal down');assert.ok(result.cadenceRPM>45&&result.cadenceRPM<100);assert.equal(result.frozenMovingFrames,0);assert.ok(result.maxAnkleStep<.05);assert.ok(result.pedalContactError<.005,'Shoe and physical pedal must stay synchronized through forward and reverse motion');
}finally{await browser.close();}
