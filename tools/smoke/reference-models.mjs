import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
mkdirSync('artifacts/avatar-turnarounds/3d',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:5173/models.html');
  const results=[];
  for(const id of ['yigit','qiz','ishbilarmon','ishchi','sedan','suv']){
    await page.selectOption('#model',id);
    await page.waitForFunction(id=>window.__modelStudio?.select.value===id&&window.__modelStudio.object.getObjectByName(`Xarita_${id}`)&&document.querySelector('#status').textContent.includes('tayyor'),id);
    const result=await page.evaluate(async(id)=>{
      const {object,mixer,clips}=window.__modelStudio;
      const T=await import('/node_modules/.vite/deps/three.js');
      const skins=[],wheels=[],doors=[];object.traverse(n=>{if(n.isSkinnedMesh)skins.push(n);if(n.userData.vehicleWheel)wheels.push(n);if(n.userData.vehicleDoor)doors.push(n);});
      let invalidWeights=0;for(const skin of skins){const w=skin.geometry.getAttribute('skinWeight');for(let i=0;i<w.count;i++){const sum=w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i);if(Math.abs(sum-1)>.0001)invalidWeights++;}}
      const bounds=[];
      for(const clip of clips){mixer.stopAllAction();const a=mixer.clipAction(clip).reset().play();mixer.update(0);const samples=[];for(const time of [0,clip.duration*.25,clip.duration*.5,clip.duration*.9]){a.time=time;mixer.update(0);object.updateMatrixWorld(true);for(const skin of skins)skin.skeleton.update();const b=new T.Box3().setFromObject(object,true);samples.push({min:b.min.toArray(),max:b.max.toArray()});}bounds.push({clip:clip.name,samples});}
      let deformation=0;
      if(skins.length){const skin=skins[0],g=skin.geometry;const points=[];mixer.stopAllAction();const a=mixer.clipAction(clips.find(c=>c.name==='Run')).reset().play();a.time=0;mixer.update(0);object.updateMatrixWorld(true);skin.skeleton.update();for(let i=0;i<g.getAttribute('position').count;i+=71)points.push(skin.getVertexPosition(i,new T.Vector3()));a.time=.19;mixer.update(0);object.updateMatrixWorld(true);skin.skeleton.update();for(let i=0,j=0;i<g.getAttribute('position').count;i+=71,j++)deformation=Math.max(deformation,skin.getVertexPosition(i,new T.Vector3()).distanceTo(points[j]));}
      return {id,clips:clips.map(c=>c.name),skins:skins.length,wheels:wheels.length,doors:doors.length,invalidWeights,deformation,bounds};
    },id);
    results.push(result);assert.equal(result.invalidWeights,0,id);
    for(const {clip,samples} of result.bounds)for(const b of samples){assert.ok([...b.min,...b.max].every(Number.isFinite),`${id}/${clip} finite`);assert.ok(b.max[1]-b.min[1]<4,`${id}/${clip} height`);assert.ok(b.max[0]-b.min[0]<6,`${id}/${clip} width`);}
    if(['sedan','suv'].includes(id)){assert.equal(result.wheels,4);assert.equal(result.doors,4);}else{assert.ok(result.deformation>.07,`${id} skin actually deforms`);for(const clip of ['Idle','Walk','Run','Jump','Fall','Land','Swim','TreadWater','EnterVehicle','ExitVehicle'])assert.ok(result.clips.includes(clip),`${id} ${clip}`);}
    await page.selectOption('#animation',['sedan','suv'].includes(id)?'DoorOpen':'Walk');
    await page.evaluate(()=>{window.__modelStudio.mixer.update(.45);});
    await page.screenshot({path:`artifacts/avatar-turnarounds/3d/studio-${id}.png`});
  }
  const ik=await page.evaluate(async()=>{
    const {loadCharacter}=await import('/src/city/models.ts');const {loadFleet,vehicleSpec}=await import('/src/city/FleetAssets.ts');const {Rider}=await import('/src/city/Rider.ts');const T=await import('/node_modules/.vite/deps/three.js');
    const character=await loadCharacter(),fleet=await loadFleet(),checks=[];
    for(const model of fleet){const spec=vehicleSpec(model.object),rider=new Rider(character);model.object.add(rider.object);rider.pose(spec,.2,.2);model.object.updateMatrixWorld(true);const bones={};rider.object.traverse(n=>{if(n.isBone)bones[n.name.replace(/[._]/g,'')]=n;});checks.push({id:spec.id,left:bones.HandL.getWorldPosition(new T.Vector3()).toArray(),right:bones.HandR.getWorldPosition(new T.Vector3()).toArray(),height:new T.Box3().setFromObject(rider.object,true).getSize(new T.Vector3()).y});rider.dispose();}return checks;
  });
  for(const i of ik){assert.ok(i.left[0]>i.right[0]+.1,`${i.id} hands on opposite grips`);assert.ok(i.height<2.3,`${i.id} plausible rider height`);}
  assert.deepEqual(errors,[]);writeFileSync('artifacts/avatar-turnarounds/3d/validation.json',JSON.stringify({results,ik,errors},null,2));
  console.log('PASS: six GLBs; animation deformation, normalized skin weights, finite bounds, four wheels/doors, and distinct driver grips.');
}finally{await browser.close();}
