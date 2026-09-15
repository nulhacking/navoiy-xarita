import * as T from 'three';
export { T };
export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Authored surface models with multi-view photo projection, not photogrammetry.
// Source images stay intact; UVs reference the approved turnaround directly.
export const CHARACTERS = [
  { id:'yigit', image:'01-yigit', height:1.8, front:318, back:1223, side:790, top:42, foot:894, waist:.205, shoulder:.225, arm:.255 },
  { id:'qiz', image:'02-qiz', height:1.7, front:294, back:1239, side:791, top:47, foot:886, waist:.17, shoulder:.185, arm:.225 },
  { id:'ishbilarmon', image:'03-ishbilarmon', height:1.78, front:314, back:1215, side:787, top:36, foot:884, waist:.22, shoulder:.24, arm:.275 },
  { id:'ishchi', image:'04-ishchi', height:1.83, front:337, back:1200, side:792, top:33, foot:890, waist:.225, shoulder:.25, arm:.29 },
];

export function makeAnimations(bones, rest, height) {
  const clips=[];
  const make=(name,duration,pose)=>{
    const count=Math.ceil(duration*30)+1;
    const times=Array.from({length:count},(_,i)=>i*duration/(count-1));
    const tracks=[];
    for(const bone of bones) {
      const values=[];
      for(const t of times) {
        const p=pose(t/duration,t), e=p[bone.name]??[0,0,0];
        values.push(...new T.Quaternion().setFromEuler(new T.Euler(...e)).toArray());
      }
      tracks.push(new T.QuaternionKeyframeTrack(`${bone.name}.quaternion`,times,values));
    }
    const hips=[];
    for(const t of times){const p=pose(t/duration,t);hips.push(0,rest.Hips[1]+(p.bob??0)*height/1.8,p.offset??0);}
    tracks.push(new T.VectorKeyframeTrack('Hips.position',times,hips));
    clips.push(new T.AnimationClip(name,duration,tracks));
  };
  make('Idle',3,(p)=>({Torso:[.012*Math.sin(p*Math.PI*2),0,0],Head:[0,.018*Math.sin(p*Math.PI*2),0],bob:.004*Math.sin(p*Math.PI*2)}));
  for(const [name,duration,amplitude] of [['Walk',.9,.48],['Run',.64,.9]]) make(name,duration,p=>{
    const a=p*Math.PI*2,run=name==='Run',pose={Torso:[run?.13:.035,0,.025*Math.sin(a)],bob:(run?.038:.012)*(1-Math.cos(a*2))};
    for(const [side,sign] of [['L',1],['R',-1]]){
      const swing=Math.sin(a+(sign<0?Math.PI:0));
      pose[`UpperLeg_${side}`]=[-amplitude*swing,0,0];
      pose[`LowerLeg_${side}`]=[(run?1.5:.85)*Math.max(0,-swing),0,0];
      pose[`Foot_${side}`]=[amplitude*swing*.25,0,0];
      pose[`UpperArm_${side}`]=[amplitude*swing*.7,0,sign*.045];
      pose[`LowerArm_${side}`]=[-(run?1.1:.2)-.13*Math.max(0,swing),0,0];
    }return pose;
  });
  const airborne=(amount)=>({UpperLeg_L:[-.32*amount,0,0],UpperLeg_R:[-.24*amount,0,0],LowerLeg_L:[.65*amount,0,0],LowerLeg_R:[.55*amount,0,0],UpperArm_L:[-.3,0,.25],UpperArm_R:[-.3,0,-.25],LowerArm_L:[-.5,0,0],LowerArm_R:[-.5,0,0]});
  make('Jump',.5,p=>airborne(.4+.6*Math.sin(p*Math.PI/2)));
  make('Fall',1,()=>({...airborne(.5),UpperArm_L:[-.12,0,.4],UpperArm_R:[-.12,0,-.4]}));
  make('Land',.3,p=>({UpperLeg_L:[-.48*Math.sin(p*Math.PI),0,0],UpperLeg_R:[-.48*Math.sin(p*Math.PI),0,0],LowerLeg_L:[.85*Math.sin(p*Math.PI),0,0],LowerLeg_R:[.85*Math.sin(p*Math.PI),0,0],Torso:[.15*Math.sin(p*Math.PI),0,0],bob:-.08*Math.sin(p*Math.PI)}));
  const seated={UpperLeg_L:[-1.5,0,0],UpperLeg_R:[-1.5,0,0],LowerLeg_L:[1.45,0,0],LowerLeg_R:[1.45,0,0],UpperArm_L:[-1.05,0,.1],UpperArm_R:[-1.05,0,-.1],LowerArm_L:[-.5,0,0],LowerArm_R:[-.5,0,0]};
  make('Sitting',2,()=>({...seated,UpperArm_L:[-.38,0,.05],UpperArm_R:[-.38,0,-.05],LowerArm_L:[-.85,0,0],LowerArm_R:[-.85,0,0],bob:-.43}));
  make('Drive',2,p=>({...seated,Head:[0,.015*Math.sin(p*Math.PI*2),0],bob:-.43}));
  for(const name of ['EnterVehicle','ExitVehicle'])make(name,.85,p=>{const t=name==='EnterVehicle'?p:1-p,s=t*t*(3-2*t),pose={bob:-.43*s,Torso:[.22*Math.sin(t*Math.PI),0,0]};for(const [k,v] of Object.entries(seated))pose[k]=v.map(a=>a*s);return pose;});
  for(const [name,moving] of [['Swim',true],['TreadWater',false]])make(name,moving?1.35:2,p=>{
    const a=p*Math.PI*2,pose={Hips:[moving?1.25:0,0,0],Torso:[moving?.06:.05,0,0],Neck:[moving?-.38:0,0,0],bob:.018*Math.sin(a)};
    for(const [side,sign] of [['L',1],['R',-1]]){pose[`UpperArm_${side}`]=[moving?-2.5+.45*Math.sin(a):-.75+.35*Math.sin(a),sign*.25*Math.sin(a),sign*(.55+.45*Math.cos(a))];pose[`LowerArm_${side}`]=[-.55-.45*Math.cos(a),0,0];pose[`UpperLeg_${side}`]=[-.15+.3*Math.max(0,Math.sin(a)),0,sign*.13*Math.max(0,Math.sin(a))];pose[`LowerLeg_${side}`]=[.15+.8*Math.max(0,Math.sin(a)),0,0];}return pose;
  });
  make('Wave',2.2,p=>{const lift=Math.sin(Math.min(1,p*4)*Math.PI/2)*Math.min(1,(1-p)*5);return {UpperArm_R:[-.12*lift,0,-1.05*lift],LowerArm_R:[-.15*lift,0,(-1.5+.25*Math.sin(p*Math.PI*10))*lift],Hand_R:[0,.2*Math.sin(p*Math.PI*10)*lift,0],Head:[0,-.08*lift,0]};});
  make('Interact',.7,p=>({UpperArm_L:[-1.2*Math.sin(p*Math.PI),0,0],LowerArm_L:[-.5*Math.sin(p*Math.PI),0,0]}));
  make('Hit',.45,p=>({Torso:[-.2*Math.sin(p*Math.PI),0,0],Head:[-.18*Math.sin(p*Math.PI),0,0],UpperArm_L:[-.2,0,.3*Math.sin(p*Math.PI)],UpperArm_R:[-.2,0,-.3*Math.sin(p*Math.PI)]}));
  return clips;
}

export async function buildCharacter(spec) {
  const h=spec.height, k=h/1.8,scale=(spec.foot-spec.top)/h;
  const texture=await new T.TextureLoader().loadAsync(`/models/reference/${spec.image}.png`);
  texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
  const material=new T.MeshStandardMaterial({map:texture,roughness:.92,metalness:0});material.name='ReferenceClothesAndSkin';
  const flat=(name,color)=>{const m=new T.MeshStandardMaterial({color,roughness:.94});m.name=name;return m;};
  const suit=spec.id==='ishbilarmon',worker=spec.id==='ishchi',female=spec.id==='qiz';
  const materials=[material,flat('Skin',female?0xc9a387:0xb58e71),flat('Sleeves',suit?0x34363a:worker?0x273342:female?0xe2dace:0x464643),flat('Trousers',suit?0x303238:worker?0x242e42:0x41617d),flat('Shoes',suit?0x1e2023:worker?0x3e3c35:female?0xe8e7df:0x602c34),flat('Hair',worker?0x243247:0x28201c),flat('Vest',0xee8025)];
  const root=new T.Group();root.name=`Xarita_${spec.id}`;root.userData={avatarId:spec.id,referenceModel:true,modelMethod:'authored surface with multi-view texture'};
  const bones=[],positions={},index={};
  const bone=(name,parent,p)=>{const b=new T.Bone();b.name=name;const point=new T.Vector3(...p).multiplyScalar(k);positions[name]=point.toArray();if(parent)b.position.copy(point).sub(new T.Vector3(...positions[parent]));else b.position.copy(point);index[name]=bones.length;bones.push(b);(parent?bones[index[parent]]:root).add(b);return b;};
  bone('Hips',null,[0,.91,0]);bone('Abdomen','Hips',[0,1.05,0]);bone('Torso','Abdomen',[0,1.25,0]);bone('Chest','Torso',[0,1.41,0]);bone('Neck','Chest',[0,1.5,0]);bone('Head','Neck',[0,1.59,0]);
  for(const [s,sign] of [['L',1],['R',-1]]){
    bone(`UpperArm_${s}`,'Chest',[sign*spec.arm,1.42,0]);bone(`LowerArm_${s}`,`UpperArm_${s}`,[sign*(spec.arm+.015),1.13,0]);bone(`Hand_${s}`,`LowerArm_${s}`,[sign*(spec.arm+.025),.87,0]);bone(`HandEnd_${s}`,`Hand_${s}`,[sign*(spec.arm+.025),.76,0]);
    bone(`UpperLeg_${s}`,'Hips',[sign*.105,.9,0]);bone(`LowerLeg_${s}`,`UpperLeg_${s}`,[sign*.115,.48,0]);bone(`Foot_${s}`,`LowerLeg_${s}`,[sign*.12,.105,0]);bone(`Toe_${s}`,`Foot_${s}`,[sign*.12,.065,.15]);
  }
  const pos=[],uv=[],si=[],sw=[],groups=[];
  const surface=(angle,row,chain)=>{
    if(Math.abs(Math.cos(angle))>.75)return 0;
    const key=String(chain);
    if(key==='Head')return row[0]>1.72?5:1;
    if(key.includes('UpperLeg'))return 3;
    if(key.includes('UpperArm'))return !suit&&!worker&&!female&&row[0]<1.27?1:2;
    if(key.includes('Neck')||key.startsWith('Hand_'))return 1;
    if(key.startsWith('Foot_'))return 4;
    return worker?6:2;
  };
  const weights=(y,chain)=>{
    if(typeof chain==='string')return [index[chain],0,0,0,1,0,0,0];
    const order=chain.map(n=>[n,positions[n][1]/k]).sort((a,b)=>a[1]-b[1]);
    if(y<=order[0][1])return [index[order[0][0]],0,0,0,1,0,0,0];
    for(let i=1;i<order.length;i++)if(y<=order[i][1]){let t=(y-order[i-1][1])/(order[i][1]-order[i-1][1]);t=t*t*(3-2*t);return [index[order[i-1][0]],index[order[i][0]],0,0,1-t,t,0,0];}
    return [index[order.at(-1)[0]],0,0,0,1,0,0,0];
  };
  const project=(v,angle,side,row)=>{
    const c=Math.cos(angle);let px;
    if(side&&Math.abs(c)<.42)px=spec.side-v[2]*scale*k;
    else if(c>=0)px=spec.front+v[0]*scale*k*.97;
    else px=spec.back-v[0]*scale*k*.97;
    const backTop=Math.max(spec.top,46),py=c>=0?spec.foot-v[1]*scale*k:spec.foot-v[1]/1.8*(spec.foot-backTop);
    const arm=Math.abs(row[1])>.19,sign=c>=0?1:-1;
    const cx=(c>=0?spec.front:spec.back)+sign*row[1]*scale*k*(arm?.9:1);
    px=cx+sign*(v[0]-row[1])*scale*k*(arm?.35:row[1]===0?.75:.5);
    return [px/1536,1-py/1024];
  };
  // Ring fields: [height, centreX, halfWidth, halfDepth, centreZ].
  const loft=(rings,chain,side=false)=>{
    const segments=40,rows=[];
    for(let r=0;r<rings.length-1;r++)for(let j=0;j<3;j++){const t=j/3;rows.push(rings[r].map((v,i)=>v+(rings[r+1][i]-v)*t));}rows.push(rings.at(-1));
    const at=(r,a)=>{const [y,x,rx,rz,z]=rows[r];return [x+Math.sin(a)*rx,y,z+Math.cos(a)*rz];};
    const vertex=(v,a,row)=>{pos.push(...v.map(n=>n*k));uv.push(...project(v,a,side,row));const w=weights(v[1],chain);si.push(...w.slice(0,4));sw.push(...w.slice(4));};
    for(let r=0;r<rows.length-1;r++)for(let j=0;j<segments;j++){
      const a=j/segments*Math.PI*2,b=(j+1)/segments*Math.PI*2,mid=(a+b)/2;
      // Same projection per triangle avoids UVs crossing unrelated atlas panels.
      const mode=Math.cos(mid)>=0?0:Math.PI,projection=side&&Math.abs(Math.cos(mid))<.42?Math.PI/2:mode;
      groups.push({start:pos.length/3,count:6,materialIndex:surface(mid,rows[r],chain)});
      for(const [rr,aa] of [[r,a],[r+1,b],[r+1,a],[r,a],[r,b],[r+1,b]])vertex(at(rr,aa),projection,rows[rr]);
    }
    for(const r of [0,rows.length-1])for(let j=0;j<segments;j++){
      const a=j/segments*Math.PI*2,b=(j+1)/segments*Math.PI*2,[y,x,,,z]=rows[r];
      const verts=r===0?[at(r,a),at(r,b),[x,y,z]]:[at(r,b),at(r,a),[x,y,z]];
      groups.push({start:pos.length/3,count:3,materialIndex:surface((a+b)/2,rows[r],chain)});
      for(const v of verts)vertex(v,(a+b)/2,rows[r]);
    }
  };
  const ring=(y,rx,rz,z=0)=>[y,0,rx,rz,z];
  loft([ring(.87,spec.waist,.12),ring(.94,spec.waist+.01,.125),ring(1.06,spec.waist-.02,.125),ring(1.22,spec.waist,.135),ring(1.36,spec.shoulder,.13),ring(1.44,spec.shoulder*.94,.115),ring(1.49,.075,.075)],['Hips','Abdomen','Torso','Chest']);
  loft([ring(1.46,.066,.066),ring(1.55,.06,.063,.008)],['Neck','Head']);
  loft([ring(1.53,.038,.05,.026),ring(1.56,.071,.075,.021),ring(1.61,.103,.094,.018),ring(1.68,.111,.104,.01),ring(1.74,.1,.102),ring(1.785,.058,.061),ring(1.8,.004,.004)],'Head');
  for(const [s,sign] of [['L',1],['R',-1]]){
    const x=spec.arm;
    const ar=(y,offset,rx,rz,z=0)=>[y,sign*(x+offset),rx,rz,z];
    loft([ar(.86,.025,.033,.037),ar(.95,.02,.043,.045),ar(1.1,.015,.05,.053),ar(1.2,.01,.055,.059),ar(1.34,-.015,.065,.073),ar(1.42,-.03,.065,.078),ar(1.465,-.04,.03,.04)], [`Hand_${s}`,`LowerArm_${s}`,`UpperArm_${s}`]);
    loft([ar(.77,.025,.033,.023,.016),ar(.82,.025,.046,.031,.012),ar(.87,.025,.037,.034)],`Hand_${s}`);
    const leg=(y,c,rx,rz,z=0)=>[y,sign*c,rx,rz,z];
    loft([leg(.09,.12,.066,.069),leg(.2,.12,.071,.073),leg(.36,.12,.086,.081),leg(.48,.115,.084,.085),leg(.64,.11,.102,.103),leg(.8,.105,.112,.12),leg(.94,.105,.111,.125)], [`Foot_${s}`,`LowerLeg_${s}`,`UpperLeg_${s}`]);
    loft([leg(.016,.12,.077,.135,.057),leg(.043,.12,.085,.145,.057),leg(.085,.12,.082,.139,.052),leg(.12,.12,.061,.084,.006)],`Foot_${s}`);
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(pos,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(si,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(sw,4));
  // Pack by material so each avatar costs seven draws, not one per ring.
  const sorted=groups.sort((a,b)=>a.materialIndex-b.materialIndex),attributes=Object.entries(geometry.attributes);
  for(const [name,a] of attributes){const output=new a.array.constructor(a.array.length);let offset=0;for(const g of sorted){output.set(a.array.subarray(g.start*a.itemSize,(g.start+g.count)*a.itemSize),offset);offset+=g.count*a.itemSize;}geometry.setAttribute(name,new T.BufferAttribute(output,a.itemSize));}
  let start=0;for(let m=0;m<materials.length;m++){const count=sorted.filter(g=>g.materialIndex===m).reduce((sum,g)=>sum+g.count,0);if(count)geometry.addGroup(start,count,m);start+=count;}
  geometry.computeVertexNormals();
  // Average normals at duplicated ring vertices without welding UV/skin seams.
  const normal=geometry.getAttribute('normal'),sums=new Map();
  const sortedPos=geometry.getAttribute('position');
  for(let i=0;i<sortedPos.count;i++){const key=new T.Vector3().fromBufferAttribute(sortedPos,i).toArray().map(v=>v.toFixed(5)).join(',');const sum=sums.get(key)??new T.Vector3();sum.add(new T.Vector3().fromBufferAttribute(normal,i));sums.set(key,sum);}
  for(let i=0;i<sortedPos.count;i++){const key=new T.Vector3().fromBufferAttribute(sortedPos,i).toArray().map(v=>v.toFixed(5)).join(',');const n=sums.get(key).clone().normalize();normal.setXYZ(i,n.x,n.y,n.z);}
  const mesh=new T.SkinnedMesh(geometry,materials);mesh.name='Body';mesh.castShadow=true;mesh.frustumCulled=false;root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(bones));
  return {object:root,animations:makeAnimations(bones,positions,h)};
}
