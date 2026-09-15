import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__xarita?.city.isReady,null,{timeout:120000});
  console.log('ready');
  const result=await page.evaluate(async()=>{
    const {city,engine}=window.__xarita;engine.stop();
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {loadFleet,vehicleSpec}=await import('/src/city/FleetAssets.ts');
    const {loadCharacter,cloneModel}=await import('/src/city/models.ts');
    const {Rider}=await import('/src/city/Rider.ts');
    const {animateVehicle}=await import('/src/city/VehicleRig.ts');
    const fleet=await loadFleet(),character=await loadCharacter(),p=city.player;
    const initialParked=city.parked.snapshot;
    const pressF=()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF'}));for(let frame=0;frame<600;frame++){p.update(1/60);city.physics.world.step();p.render();if(frame>1&&!p.entryPath.length&&!p.vehicleTransition)break;}};
    const tests=[];
    for(let i=0;i<fleet.length;i++) {
      if(p.mode==='drive')pressF();
      const walker=p.body.translation(), model=cloneModel(fleet[i]),spec=vehicleSpec(model.object);
      const at=new THREE.Vector3(walker.x+1.6,city.ground.heightAt(walker.x+1.6,walker.z)+spec.half.y+.08,walker.z);
      city.parked.add({object:model.object,position:at,yaw:0,speed:0});
      const previous=p.car.uuid;
      // Ensure the newly added fixture is nearest, including when an older car is nearby.
      p.body.setTranslation({x:at.x+1,y:walker.y,z:at.z},true);
      pressF();
      tests.push({id:spec.id,mode:p.mode,identity:p.car.uuid===model.object.uuid,previousPreserved:city.parked.snapshot.some(v=>v.id===previous),rider:p.rider.object.visible,half:p.carCollider.halfExtents()});
      // Move to clear ground for the next exchange to exercise dismount without a pile of fixtures.
      p.carPosition.x+=20;p.carBody.setTranslation(p.carPosition,true);p.carBody.setNextKinematicTranslation(p.carPosition);
      pressF();
      tests.at(-1).exit=p.mode;
    }
    const scene=new THREE.Scene();scene.background=new THREE.Color('#b9cee0');
    scene.add(new THREE.HemisphereLight(0xffffff,0x61715a,2));
    const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(5,10,3);scene.add(sun);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,50),new THREE.MeshStandardMaterial({color:0x747a71,roughness:1}));floor.rotation.x=-Math.PI/2;scene.add(floor);
    const wheelCounts=[];
    for(let i=0;i<fleet.length;i++) {
      const model=fleet[i],spec=vehicleSpec(model.object);scene.add(model.object);model.object.position.set((i-1.5)*4,0,0);
      const rider=new Rider(character);model.object.add(rider.object);rider.pose(spec,0);
      animateVehicle(model.object,.4,.15);let wheels=0;model.object.traverse(n=>{if(n.userData.vehicleWheel)wheels++;});wheelCounts.push({id:spec.id,wheels});
    }
    const camera=new THREE.PerspectiveCamera(45,1400/900,.1,100);camera.position.set(11,8,16);camera.lookAt(0,.8,0);
    engine.renderer.setSize(1400,900);engine.renderer.render(scene,camera);
    return {tests,wheelCounts,initialParked,errors:engine.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
  });
  mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/fleet-riders.png'});console.log(JSON.stringify(result,null,2));
  for(const t of result.tests){assert.equal(t.mode,'drive',t.id);assert.equal(t.identity,true,t.id);assert.equal(t.previousPreserved,true,t.id);assert.equal(t.rider,true,t.id);assert.equal(t.exit,'walk',t.id);}
  for(const w of result.wheelCounts)assert.equal(w.wheels,w.id==='sedan'||w.id==='suv'?4:2,w.id);
  assert.equal(result.errors,0);assert.deepEqual(errors,[]);
  console.log('PASS: exact vehicle identity, parked persistence, all dismounts, rider visibility and wheel rigs');
}finally{await browser.close();}
