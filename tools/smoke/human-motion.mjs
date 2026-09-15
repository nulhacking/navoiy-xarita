import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});await page.goto('http://localhost:5173/models.html');await page.waitForFunction(()=>window.__modelStudio);
 const result=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{Physics,RAPIER}=await import('/src/city/Physics.ts'),{Player}=await import('/src/city/Player.ts'),{Input}=await import('/src/city/Input.ts'),{loadCharacter,cloneModel}=await import('/src/city/models.ts'),{loadFleet}=await import('/src/city/FleetAssets.ts');
  const template=await loadCharacter(),fleet=await loadFleet();
  const create=async()=>{
   const physics=await Physics.create();physics.world.createCollider(RAPIER.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0));
   const input=new Input(document.createElement('div')),ground={heightAt:()=>0,waterLevelAt:()=>null,water:{contains:()=>false},bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500}};
   const p=new Player({physics,ground,input,camera:new T.PerspectiveCamera(),spawn:new T.Vector3(),characterModel:cloneModel(template)});p.yaw=0;
   const tick=(hz=60)=>{physics.step(1/hz,dt=>p.update(dt));p.render(physics.interpolationAlpha,1/hz);};
   for(let i=0;i<60;i++)tick();return {p,physics,input,tick};
  };
  const walking=[];
  for(const hz of [60,90,120,144]){
   const {p,physics,input,tick}=await create();input.setVirtualAxis(0,1);
   const bone=p.avatar.getObjectByName('UpperArm_L'),old=new T.Quaternion(),steps=[],boneSteps=[];let last=0,maxRootYStep=0,lastY=0,worst=null;
   for(let i=0;i<hz*3;i++){
    tick(hz);if(i>hz){steps.push(Math.abs(p.avatar.position.z-last)*hz);boneSteps.push(old.angleTo(bone.quaternion));if(Math.abs(p.avatar.position.y-lastY)>maxRootYStep)worst={i,y:p.avatar.position.y,lastY,body:p.body.translation().y,hips:p.avatar.getObjectByName('Hips').position.toArray(),state:p.animator.current};maxRootYStep=Math.max(maxRootYStep,Math.abs(p.avatar.position.y-lastY));}
    last=p.avatar.position.z;lastY=p.avatar.position.y;old.copy(bone.quaternion);
   }
   walking.push({hz,frozenRootFrames:steps.filter(v=>v<.01).length,frozenArmFrames:boneSteps.filter(v=>v<1e-6).length,speedSpread:Math.max(...steps)-Math.min(...steps),maxRootYStep,worst});input.dispose();physics.dispose();
  }
  const collisions=[];
  for(const kind of ['standing','dynamic','fallen']){
   const {p,physics,input,tick}=await create();
   const desc=kind==='standing'?RAPIER.RigidBodyDesc.kinematicPositionBased():RAPIER.RigidBodyDesc.dynamic().setLinearDamping(8).setAngularDamping(10);
   const body=physics.world.createRigidBody(desc.setTranslation(0,kind==='fallen'?.3:.9,-2));
   const collider=physics.world.createCollider(RAPIER.ColliderDesc.capsule(.55,kind==='fallen'?.3:.35).setMass(75),body);
   if(kind==='fallen')body.setRotation({x:0,y:0,z:Math.sin(Math.PI/4),w:Math.cos(Math.PI/4)},true);
   physics.world.updateSceneQueries();input.setVirtualAxis(0,1);input.keys.add('ShiftLeft');
   let minSeparation=Infinity,minSurfaceDistance=Infinity,worst=null;
   for(let i=0;i<180;i++){tick();const a=p.body.translation(),b=body.translation();minSeparation=Math.min(minSeparation,Math.hypot(a.x-b.x,a.z-b.z));const contact=p.collider.contactCollider(collider,10);if(contact&&contact.distance<minSurfaceDistance){minSurfaceDistance=contact.distance;worst={i,a,b,rotation:body.rotation(),shape:collider.shape.type,shapeHit:physics.world.castShape(a,{x:0,y:0,z:0,w:1},{x:0,y:0,z:-.1},p.personalSpace,1,true,8,undefined,p.collider)?.toi};}}
   const playerZ=p.body.translation().z,stoppedState=p.animator.current;
   input.setVirtualAxis(0,0);tick();input.setVirtualAxis(0,-1);for(let i=0;i<90;i++)tick();
   const retreat=p.body.translation().z-playerZ;
   collisions.push({kind,minSeparation,minSurfaceDistance,playerZ,stoppedState,retreat,worst});input.dispose();physics.dispose();
  }
  const idleState=await create(),{p:idle, tick:idleTick}=idleState;
  const head=idle.avatar.getObjectByName('Head'),left=idle.avatar.getObjectByName('LowerArm_L'),right=idle.avatar.getObjectByName('LowerArm_R'),headStart=head.quaternion.clone();let headMotion=0,armDifference=0,maxIdleShift=0;const origin=idle.avatar.position.clone();
  for(let i=0;i<600;i++){idleTick();headMotion=Math.max(headMotion,headStart.angleTo(head.quaternion));armDifference=Math.max(armDifference,left.quaternion.angleTo(right.quaternion));maxIdleShift=Math.max(maxIdleShift,idle.avatar.position.distanceTo(origin));}
  const exits=[];
  for(const id of ['sedan','suv','bicycle']){
   const {p,physics,input,tick}=await create();const model=cloneModel(fleet.find(m=>m.object.userData.vehicleId===id));
   p.adoptVehicle({object:model.object,position:new T.Vector3(0,id==='suv'?.92:id==='sedan'?.77:.47,0),yaw:0,speed:0});p.mode='drive';p.body.setEnabled(false);p.yaw=Math.PI;for(let i=0;i<60;i++)tick();
   const seated=p.rider.object.children[0].getWorldPosition(new T.Vector3());let lastCamera=p.camera.position.clone(),maxCameraStep=0,maxAvatarStep=0,lastAvatar=seated.clone();p.exitCar();
   for(let i=0;i<210;i++){tick(120);maxCameraStep=Math.max(maxCameraStep,p.camera.position.distanceTo(lastCamera));maxAvatarStep=Math.max(maxAvatarStep,p.avatar.position.distanceTo(lastAvatar));lastCamera.copy(p.camera.position);lastAvatar.copy(p.avatar.position);}
   exits.push({id,mode:p.mode,transition:p.vehicleTransition,footHeight:p.body.translation().y-.9,maxCameraStep,maxAvatarStep});input.dispose();physics.dispose();
  }
  const {scene,renderer,camera,object}=window.__modelStudio;renderer.setAnimationLoop(null);scene.remove(object);scene.add(idle.avatar);idle.avatar.rotation.y=0;
  document.querySelector('aside').style.display='none';document.querySelector('#studio').style.gridTemplateColumns='1fr';document.querySelector('.topline').style.display='none';document.querySelector('.bottomline').style.display='none';
  camera.position.set(2.5,1.25,4);camera.lookAt(0,.9,0);camera.fov=32;camera.aspect=1200/900;camera.updateProjectionMatrix();renderer.setSize(1200,900);renderer.render(scene,camera);
  idleState.input.dispose();idleState.physics.dispose();return {walking,collisions,idle:{headMotion,armDifference,maxIdleShift},exits};
 });
 await page.locator('#viewport canvas').screenshot({path:'artifacts/avatar-turnarounds/3d/idle-current.png'});
 writeFileSync('artifacts/avatar-turnarounds/3d/human-motion-validation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 for(const w of result.walking){assert.equal(w.frozenRootFrames,0);assert.ok(w.frozenArmFrames<3);assert.ok(w.speedSpread<.03);assert.ok(w.maxRootYStep<.025);}
 for(const c of result.collisions){assert.ok(c.minSurfaceDistance>-.035,`${c.kind} must not overlap the player's capsule`);assert.equal(c.stoppedState,'Idle');assert.ok(c.retreat>1,'Personal space must let the player back away');}
 assert.ok(result.idle.headMotion>.05&&result.idle.headMotion<.25&&result.idle.armDifference>.03&&result.idle.armDifference<.2&&result.idle.maxIdleShift<.035);
 for(const e of result.exits){assert.equal(e.mode,'walk');assert.equal(e.transition,null);assert.ok(e.footHeight<.035&&e.footHeight>0);assert.ok(e.maxCameraStep<.12);assert.ok(e.maxAvatarStep<.09);}
} finally {await browser.close();}
