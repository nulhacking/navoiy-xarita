import * as T from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

/** Retarget measured joint directions rather than copying Euler angles between rigs. */
export async function locomotionClips(object,bones,rest,rootUrl) {
 const results=[],lookup=new Map(bones.map(b=>[b.name,b]));
 const mapping={Abdomen:['Hips','Neck1','Torso'],Torso:['Hips','Neck1','Chest'],Chest:['Hips','Neck1','Neck']};
 for(const [s,word] of [['L','Left'],['R','Right']]){
  mapping[`UpperArm_${s}`]=[word+'Arm',word+'ForeArm',`LowerArm_${s}`];
  mapping[`LowerArm_${s}`]=[word+'ForeArm',word+'Hand',`Hand_${s}`];
  mapping[`UpperLeg_${s}`]=[word+'UpLeg',word+'Leg',`LowerLeg_${s}`];
  mapping[`LowerLeg_${s}`]=[word+'Leg',word+'Foot',`Foot_${s}`];
  mapping[`Foot_${s}`]=[word+'Foot',word+'ToeBase',`Toe_${s}`];
 }
 const original=bones.map(b=>[b,b.position.clone(),b.quaternion.clone()]);
 for(const [name,file] of [['Walk','walk'],['Run','run']]){
  const bvh=new BVHLoader().parse(await (await fetch(`${rootUrl}/artifacts/blender-work/mocap/${file}.bvh`)).text());
  const srcRoot=bvh.skeleton.bones[0],src=new Map(bvh.skeleton.bones.map(b=>[b.name,b]));
  const mixer=new T.AnimationMixer(srcRoot);mixer.clipAction(bvh.clip).play();
  const targetLength=new T.Vector3(...rest.UpperLeg_L).distanceTo(new T.Vector3(...rest.LowerLeg_L))+new T.Vector3(...rest.LowerLeg_L).distanceTo(new T.Vector3(...rest.Foot_L));
  const sourceLength=src.get('LeftLeg').position.length()+src.get('LeftFoot').position.length(),scale=targetLength/sourceLength;
  const sample=time=>{
   mixer.setTime(time);srcRoot.updateMatrixWorld(true);
   const positions=new Map([...src].map(([n,b])=>[n,b.getWorldPosition(new T.Vector3())]));
   const lateral=positions.get('LeftUpLeg').clone().sub(positions.get('RightUpLeg'));lateral.y=0;lateral.normalize();
   const forward=new T.Vector3().crossVectors(lateral,new T.Vector3(0,1,0));
   const turn=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-Math.atan2(forward.x,forward.z));
   const hips=positions.get('Hips').clone();for(const p of positions.values())p.sub(hips).applyQuaternion(turn);
   return {positions,hips,turn};
  };
  const reference=sample(0);
  const soles=[];object.traverse(n=>{if(n.isSkinnedMesh&&n.parent.name==='LOD0'){const p=n.geometry.attributes.position;const indices=[];for(let i=0;i<p.count;i++)if(p.getY(i)<.09)indices.push(i);if(indices.length)soles.push([n,indices]);}});
  const samples=[];for(let t=.05;t<bvh.clip.duration-.02;t+=1/60){const s=sample(t);samples.push({t,z:s.positions.get('LeftFoot').z});}
  const extrema=sign=>{const found=[];for(let i=6;i<samples.length-6;i++)if(sign*samples[i].z>0&&samples.slice(i-6,i+7).every(s=>sign*s.z<=sign*samples[i].z)&&(!found.length||samples[i].t-found.at(-1).t>(name==='Walk'?.65:.4)))found.push(samples[i]);return found;};
  let peaks=extrema(1),negativeStart=false;if(peaks.length<2){peaks=extrema(-1);negativeStart=true;}
  if(peaks.length<2)throw new Error(`No complete ${name} gait cycle in source`);
  const start=peaks[0].t,end=peaks[1].t,duration=end-start,count=Math.round(duration*30)+1;
  const tracks=new Map(bones.map(b=>[b.name,[]])),hipsValues=[],times=[];let lowestSole=Infinity;
  const initial=sample(start),last=sample(end);
  const sourceSpeed=initial.hips.distanceTo(last.hips)*scale/duration;
  // Source ground is measured from the capture's foot trajectories, excluding its T pose.
  let sourceGround=Infinity;for(let t=start;t<=end;t+=1/60){const s=sample(t);for(const n of ['LeftFoot','RightFoot'])sourceGround=Math.min(sourceGround,s.hips.y+s.positions.get(n).y);}
  for(let i=0;i<count;i++){
   const t=i*duration/(count-1),s=sample(start+(negativeStart?(t+duration*.5)%duration:t));times.push(t);
   for(const [b,p,q] of original){b.position.copy(p);b.quaternion.copy(q);}
   const hips=lookup.get('Hips');hips.position.y=(s.hips.y-sourceGround)*scale+rest.Foot_L[1];
   object.updateMatrixWorld(true);
   for(const bone of bones){
    const map=mapping[bone.name];if(!map||!src.has(map[0])||!src.has(map[1]))continue;
    const from=new T.Vector3(...rest[map[2]]).sub(new T.Vector3(...rest[bone.name])).normalize();
    let to=s.positions.get(map[1]).clone().sub(s.positions.get(map[0])).normalize();
    if(bone.name.startsWith('Foot_')){const ref=reference.positions.get(map[1]).clone().sub(reference.positions.get(map[0])).normalize();to=from.clone().applyQuaternion(new T.Quaternion().setFromUnitVectors(ref,to));}
    const world=new T.Quaternion().setFromUnitVectors(from,to);
    const parent=bone.parent?.isBone?bone.parent.getWorldQuaternion(new T.Quaternion()):new T.Quaternion();
    bone.quaternion.copy(parent.invert().multiply(world));bone.updateWorldMatrix(false,true);
   }
   // Keep the gaze on the horizon; the capture's neck offsets are not head pitch.
   const neck=lookup.get('Neck');if(neck){neck.quaternion.copy(neck.parent.getWorldQuaternion(new T.Quaternion()).invert());neck.updateWorldMatrix(false,true);}
   object.updateMatrixWorld(true);let ground=Infinity;for(const [mesh,indices] of soles){mesh.skeleton.update();for(const index of indices)ground=Math.min(ground,mesh.getVertexPosition(index,new T.Vector3()).applyMatrix4(mesh.matrixWorld).y);}
   if(Number.isFinite(ground)){lowestSole=Math.min(lowestSole,ground);if(name==='Walk')hips.position.y-=ground;}
   for(const bone of bones)tracks.get(bone.name).push(...bone.quaternion.toArray());
   hipsValues.push(...hips.position.toArray());
  }
  // Remove the rig-dependent floor offset once for a run, preserving its flight arc.
  if(name==='Run'&&Number.isFinite(lowestSole))for(let i=1;i<hipsValues.length;i+=3)hipsValues[i]-=lowestSole;
  // Blend the last 15% into the first pose, preserving continuous cycle endpoints.
  const keyframes=[];
  for(const [name,values] of tracks){const first=new T.Quaternion().fromArray(values,0);for(let i=0;i<count;i++){const p=i/(count-1);if(p>.85){const q=new T.Quaternion().fromArray(values,i*4).slerp(first,(p-.85)/.15);q.toArray(values,i*4);}}keyframes.push(new T.QuaternionKeyframeTrack(`${name}.quaternion`,times,values));}
  for(let i=0;i<count;i++){const p=i/(count-1);if(p>.85)for(let j=0;j<3;j++)hipsValues[i*3+j]=T.MathUtils.lerp(hipsValues[i*3+j],hipsValues[j],(p-.85)/.15);}
  keyframes.push(new T.VectorKeyframeTrack('Hips.position',times,hipsValues));
  const clip=new T.AnimationClip(name,duration,keyframes);results.push(clip);
  object.userData[name.toLowerCase()+'Speed']=sourceSpeed;
  console.log(name,{duration,sourceSpeed,start,end});
 }
 for(const [b,p,q] of original){b.position.copy(p);b.quaternion.copy(q);}object.updateMatrixWorld(true);
 return results;
}
