import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto('http://localhost:5173/models.html');
 await page.waitForFunction(()=>window.__modelStudio);
 const result=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js');
  const {createGltfLoader}=await import('/src/city/GltfLoader.ts');
  const {CharacterAnimator}=await import('/src/city/CharacterAnimator.ts');
  const {updateModelLOD}=await import('/src/city/ModelLOD.ts');
  const {animateVehicle,animateVehicleAccessories}=await import('/src/city/VehicleRig.ts');
  const studio=window.__modelStudio;studio.renderer.setAnimationLoop(null);const loader=createGltfLoader(),models=[];
  const stats=o=>{let triangles=0;o.traverseVisible(n=>{if(n.isMesh)triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});return triangles;};
  for(const id of ['yigit','qiz','ishbilarmon','ishchi','sedan','suv']){
   const gltf=await loader.loadAsync(`/models/reference/${id}.glb`),o=gltf.scene;updateModelLOD(o,0);const high=stats(o);updateModelLOD(o,10000);const low=stats(o);updateModelLOD(o,0);
   const data={id,high,low};
   if(!['sedan','suv'].includes(id)){
    let torsoVertices=0;o.updateMatrixWorld(true);o.traverseVisible(n=>{if(!n.isSkinnedMesh)return;const p=n.geometry.attributes.position;for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(n.matrixWorld);if(v.y>.96&&v.y<1.28&&Math.abs(v.x)<.3)torsoVertices++;}});data.torsoVertices=torsoVertices;
    const a=new CharacterAnimator(o,gltf.animations),states=[];
    for(const [label,motion] of [['idle',{speed:0,grounded:true}],['walk',{speed:1.8,grounded:true}],['blend',{speed:2.7,grounded:true}],['run',{speed:5.2,grounded:true}],['jump',{speed:0,grounded:false,verticalSpeed:3}],['fall',{speed:0,grounded:false,verticalSpeed:-3}],['land',{speed:0,grounded:true}],['swim',{speed:2,swimming:true}],['tread',{speed:0,swimming:true}],['idle',{speed:0,grounded:true}]]){
     for(let i=0;i<(label==='land'?3:60);i++)a.update(1/60,{verticalSpeed:0,grounded:false,swimming:false,...motion});
     const weight=[...a.actions.values()].reduce((s,x)=>s+x.getEffectiveWeight(),0);states.push({label,state:a.current,weight});
    }
    a.wave();a.update(.1,{speed:0,grounded:true,verticalSpeed:0,swimming:false});states.push({label:'wave',state:a.current});
    for(let i=0;i<150;i++)a.update(1/60,{speed:0,grounded:true,verticalSpeed:0,swimming:false});a.wave();a.update(.05,{speed:0,grounded:true,verticalSpeed:0,swimming:false});data.waveRestart=a.actions.get('Wave').time;
    a.dispose();
    const mixer=new T.AnimationMixer(o);let maxLoopError=0,maxFootGap=0,minFootGap=Infinity;
    for(const name of ['Walk','Run']){
     const clip=gltf.animations.find(c=>c.name===name);
     for(const track of clip.tracks){const width=track.getValueSize();for(let j=0;j<width;j++)maxLoopError=Math.max(maxLoopError,Math.abs(track.values[j]-track.values[track.values.length-width+j]));}
     mixer.stopAllAction();const action=mixer.clipAction(clip).reset().play();
     for(let i=0;i<32;i++){
      action.time=clip.duration*i/32;mixer.update(0);o.updateMatrixWorld(true);let floor=Infinity;
      o.traverseVisible(n=>{if(!n.isSkinnedMesh)return;n.skeleton.update();const p=n.geometry.attributes.position;for(let k=0;k<p.count;k++)if(p.getY(k)<.10)floor=Math.min(floor,n.getVertexPosition(k,new T.Vector3()).applyMatrix4(n.matrixWorld).y);});
      if(name==='Walk'){maxFootGap=Math.max(maxFootGap,floor);minFootGap=Math.min(minFootGap,floor);}
     }
    }
    Object.assign(data,{states,maxLoopError,maxFootGap,minFootGap});mixer.uncacheRoot(o);
   }else{
    const wheels=[];o.traverse(n=>{if(n.userData.vehicleWheel)wheels.push(n);});animateVehicle(o,1,.3);const forward=wheels.map(w=>w.children.find(n=>n.userData.vehicleSpin).rotation.x);animateVehicle(o,-1,0);data.wheelReturn=wheels.map(w=>w.children.find(n=>n.userData.vehicleSpin).rotation.x);data.forward=forward;
    animateVehicleAccessories(o,{time:.6,steering:.3,brake:true,door:1,doorSide:-1,wipers:true});data.doors={left:o.getObjectByName('DoorFront_L').rotation.y,right:o.getObjectByName('DoorFront_R').rotation.y};
    animateVehicleAccessories(o,{time:1.2,steering:0,brake:false,door:0,wipers:false});data.wiperReturn=o.getObjectByName('Wiper_L').quaternion.angleTo(new T.Quaternion());
   }
   models.push(data);
  }
  const {renderer,scene,camera}=studio,gl=renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');const rendererName=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  const timings=[];for(let i=0;i<65;i++){await new Promise(requestAnimationFrame);const start=performance.now();renderer.render(scene,camera);gl.finish();if(i>=5)timings.push(performance.now()-start);}timings.sort((a,b)=>a-b);
  return {models,performance:{renderer:rendererName,width:renderer.domElement.width,height:renderer.domElement.height,medianRenderMs:timings[30],p95RenderMs:timings[57],calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,scope:'single avatar studio, GPU completion included'}};
 });
 writeFileSync('artifacts/avatar-turnarounds/3d/state-validation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 for(const m of result.models){assert.ok(m.low<m.high*.4,`${m.id} LOD reduction`);if(m.states){for(const s of m.states){if(s.weight!==undefined)assert.ok(Math.abs(s.weight-1)<1e-6,`${m.id}/${s.label} normalized blend`);const expected={idle:'Idle',walk:'Walk',run:'Run',jump:'Jump',fall:'Fall',land:'Land',swim:'Swim',tread:'TreadWater',wave:'Wave'}[s.label];if(expected)assert.equal(s.state,expected,`${m.id}/${s.label}`);}assert.ok(m.waveRestart<.1);assert.ok(m.maxLoopError<.005,`${m.id} loop closure`);assert.ok(m.maxFootGap<.06&&m.minFootGap>-.025,`${m.id} stance contact ${m.minFootGap}..${m.maxFootGap}`);}else{assert.ok(m.wheelReturn.every(x=>Math.abs(x)<1e-6));assert.equal(m.doors.left,0);assert.ok(m.doors.right>1);assert.ok(m.wiperReturn<1e-6);}}
 for(const m of result.models)if(m.states)assert.ok(m.torsoVertices>200,`${m.id} retained torso/clothing geometry`);
 console.log('PASS: torso geometry, animation states, gait loop/contact, repeatable gesture, LOD, reversible wheels, correct door side and wiper rest.');
}finally{await browser.close();}
