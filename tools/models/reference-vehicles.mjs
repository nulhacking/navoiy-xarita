import * as T from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CARS=[{id:'sedan',length:4.5,width:1.76,height:1.48,color:0x91bedb,image:'05-sedan'},{id:'suv',length:4.65,width:1.87,height:1.73,color:0xf0efeb,image:'06-suv'}];
export async function buildVehicle(spec){
  const suv=spec.id==='suv',root=new T.Group();root.name=`Xarita_${spec.id}`;root.userData={vehicleId:spec.id,referenceModel:true,forward:'+Z'};
  const paint=new T.MeshPhysicalMaterial({color:spec.color,metalness:.38,roughness:.28,clearcoat:1,clearcoatRoughness:.18});paint.name='Paint';
  const rubber=new T.MeshStandardMaterial({color:0x151719,roughness:.94});rubber.name='Rubber';
  const silver=new T.MeshStandardMaterial({color:0xaeb5bb,metalness:.9,roughness:.27});silver.name='Alloy';
  const black=new T.MeshStandardMaterial({color:0x24282d,roughness:.7});black.name='Trim';
  const glass=new T.MeshPhysicalMaterial({color:0x839caa,roughness:.12,metalness:.12,transparent:true,opacity:.34,depthWrite:false,side:T.DoubleSide});glass.name='Windows';
  const cloth=new T.MeshStandardMaterial({color:0x252c32,roughness:1});cloth.name='Interior';
  const headlight=new T.MeshStandardMaterial({color:0xf3f1db,emissive:0xfff2cc,emissiveIntensity:1.2,roughness:.18});headlight.name='Headlight';
  const tail=new T.MeshStandardMaterial({color:0xaa111a,emissive:0xf71922,emissiveIntensity:.6,roughness:.25});tail.name='Taillight';
  const litBrake=new T.MeshStandardMaterial({color:0xff2331,emissive:0xff0710,emissiveIntensity:3});
  const amber=new T.MeshStandardMaterial({color:0xffa329,emissive:0xff8b0a,emissiveIntensity:2});
  const chassis=new T.Group();chassis.name='Chassis';root.add(chassis);
  const box=(parent,size,p,mat=paint,r=.04)=>{const m=new T.Mesh(new RoundedBoxGeometry(...size,2,r),mat);m.position.set(...p);m.castShadow=true;parent.add(m);return m;};
  const rod=(parent,a,b,r,mat=black)=>{const v1=new T.Vector3(...a),v2=new T.Vector3(...b);const m=new T.Mesh(new T.CylinderGeometry(r,r,v1.distanceTo(v2),10),mat);m.position.copy(v1).add(v2).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v2.sub(v1).normalize());parent.add(m);return m;};
  const quad=(parent,pts,mat)=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,1,2,0,2,3].flatMap(i=>pts[i]),3));g.computeVertexNormals();const m=new T.Mesh(g,mat);parent.add(m);return m;};
  const w=spec.width/2,L=spec.length/2,belt=suv?1.14:.98,roof=spec.height,frontAxle=1.36,rearAxle=-1.34,R=suv?.355:.32;
  const doors=[];
  for(const [side,sign] of [['L',1],['R',-1]])for(const [which,z] of [['Front',.83],['Rear',-.32]]){
    const d=new T.Group();d.name=`Door${which}_${side}`;d.position.set(sign*w,.6,z);d.userData={vehicleDoor:true,left:sign>0,front:which==='Front'};root.add(d);doors.push(d);
  }
  const bins=new Map([[chassis,[]],...doors.map(d=>[d,[]])]);
  const ring=(z,a)=>{
    const end=Math.pow(Math.abs(z/L),6),width=w*(1-.12*end);
    const top=belt-(suv?.1:.13)*Math.max(0,(z-.75)/(L-.75))-.025*Math.max(0,(-z-1.3)/(L-1.3));
    let bottom=suv?.34:.27;
    for(const axle of [frontAxle,rearAxle])if(Math.abs(z-axle)<R+.065)bottom=Math.max(bottom,R+Math.sqrt((R+.065)**2-(z-axle)**2));
    const x=width*Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**.32;
    const y=bottom+(top-bottom)*(.5+.5*Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.45);
    return [x,y,z];
  };
  const N=104,K=24;
  for(let n=0;n<N;n++)for(let j=0;j<K;j++){
    const z=-L+spec.length*n/N,next=-L+spec.length*(n+1)/N,a=j/K*Math.PI*2,b=(j+1)/K*Math.PI*2;
    const pts=[ring(z,a),ring(z,b),ring(next,b),ring(next,a)],mid=pts.reduce((sum,p)=>sum+p[0],0)/4;
    const centreZ=(z+next)/2,sideFace=Math.abs(mid)>w*.93;
    if(centreZ> (suv?-1.74:-1.37)&&centreZ<.86&&Math.cos((a+b)/2)>.25)continue;
    const door=sideFace&&centreZ> -1.28&&centreZ<.83?doors.find(d=>d.userData.left===(mid>0)&&d.userData.front===(centreZ>-.32)):null;
    const target=door??chassis,data=bins.get(target);
    for(const i of [0,2,1,0,3,2])data.push(...pts[i].map((v,k)=>v-(door?door.position.getComponent(k):0)));
  }
  for(const [parent,data] of bins){const raw=new T.BufferGeometry();raw.setAttribute('position',new T.Float32BufferAttribute(data,3));const g=mergeVertices(raw);g.computeVertexNormals();raw.dispose();const m=new T.Mesh(g,paint);m.castShadow=true;parent.add(m);}
  for(const z of [-L,L]){const pts=[];for(let j=0;j<K;j++){const a=ring(z,j/K*Math.PI*2),b=ring(z,(j+1)/K*Math.PI*2),c=[0,(belt+.3)/2,z];pts.push(...(z>0?[c,b,a]:[c,a,b]).flat());}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pts,3));g.computeVertexNormals();chassis.add(new T.Mesh(g,paint));}
  // Real cabin, glass and interior remain visible when a front door opens.
  const frontRoof=suv?.40:.28,rearRoof=suv?-.98:-.72,frontBase=.86,rearBase=suv?-1.74:-1.37,roofW=w*.79;
  box(chassis,[roofW*2,.075,frontRoof-rearRoof+.15],[0,roof-.04,(frontRoof+rearRoof)/2],paint,.045);
  const wind=[[ -w*.89,belt,frontBase],[w*.89,belt,frontBase],[roofW,roof-.075,frontRoof],[-roofW,roof-.075,frontRoof]];
  quad(chassis,wind,glass);quad(chassis,[[-w*.87,belt,rearBase],[-roofW,roof-.07,rearRoof],[roofW,roof-.07,rearRoof],[w*.87,belt,rearBase]],glass);
  for(const sign of [-1,1]){
    rod(chassis,[sign*w*.89,belt,frontBase],[sign*roofW,roof-.06,frontRoof],.035,paint);
    rod(chassis,[sign*w*.87,belt,rearBase],[sign*roofW,roof-.06,rearRoof],.045,paint);
    rod(chassis,[sign*roofW,roof-.065,rearRoof],[sign*roofW,roof-.065,frontRoof],.025,paint);
    const df=doors.find(d=>d.userData.left===(sign>0)&&d.userData.front),dr=doors.find(d=>d.userData.left===(sign>0)&&!d.userData.front);
    for(const [d,pts] of [[df,[[sign*w*.90,belt,frontBase],[sign*w*.92,belt,-.30],[sign*roofW,roof-.09,-.30],[sign*roofW,roof-.09,frontRoof]]],[dr,[[sign*w*.92,belt,-.33],[sign*w*.87,belt,rearBase],[sign*roofW,roof-.09,rearRoof],[sign*roofW,roof-.09,-.33]]]]){
      quad(d,pts.map(p=>p.map((v,k)=>v-d.position.getComponent(k))),glass);
      const handle=box(d,[.04,.035,.18],[sign*(w+.017)-d.position.x,belt-.14-d.position.y,d.userData.front?-.93:-.8],silver,.012);handle.name='DoorHandle';
    }
    rod(chassis,[sign*w*.92,belt,-.315],[sign*roofW,roof-.07,-.315],.029,black);
    box(df,[.18,.13,.22],[sign*(w+.065)-df.position.x,belt+.05-df.position.y,.02],paint,.055);
    box(chassis,[.055,.10,3.1],[sign*(w+.005),.34,-.05],suv?black:paint,.025);
    if(suv)rod(chassis,[sign*.64,roof+.04,-1.10],[sign*.64,roof+.04,.5],.032,black);
    // Seats, headrests and rear bench, with room for the IK driver.
    for(const z of [0,-.93]){box(chassis,[.52,.14,.5],[sign*.36,suv?.53:.35,z],cloth,.065);const seat=box(chassis,[.49,.58,.15],[sign*.36,suv?.87:.69,z-.24],cloth,.065);seat.rotation.x=-.1;box(chassis,[.28,.20,.12],[sign*.36,suv?1.21:1.03,z-.29],cloth,.035);}
  }
  box(chassis,[w*1.7,.16,.34],[0,belt-.1,.59],black,.05);box(chassis,[w*1.55,.045,2.5],[0,.24,-.25],black,.02);
  const steering=new T.Group();steering.name='SteeringWheel';steering.position.set(.36,suv?1.14:.97,.38);steering.rotation.x=-.5;root.add(steering);
  steering.add(new T.Mesh(new T.TorusGeometry(.17,.018,8,32),black));rod(steering,[-.15,0,0],[.15,0,0],.014,silver);rod(steering,[0,0,0],[0,-.14,0],.014,silver);
  // Four independently steering/spinning assemblies with real tyres and spokes.
  for(const [side,sign] of [['L',1],['R',-1]])for(const [which,z] of [['Front',frontAxle],['Rear',rearAxle]]){
    const pivot=new T.Group();pivot.name=`Wheel${which}_${side}`;pivot.position.set(sign*(w-.055),R,z);pivot.userData={vehicleWheel:true,front:which==='Front',radius:R};root.add(pivot);
    const spin=new T.Group();spin.name=`WheelSpin_${which}_${side}`;spin.userData.vehicleSpin=true;pivot.add(spin);
    const tyre=new T.Mesh(new T.TorusGeometry(R-.065,.065,12,40),rubber);tyre.rotation.y=Math.PI/2;tyre.scale.z=1.55;spin.add(tyre);
    const rim=new T.Mesh(new T.CylinderGeometry(R*.67,R*.67,.12,32),silver);rim.rotation.z=Math.PI/2;spin.add(rim);
    const dark=new T.Mesh(new T.CylinderGeometry(R*.56,R*.56,.132,32),black);dark.rotation.z=Math.PI/2;spin.add(dark);
    for(let i=0;i<10;i++){const a=i/10*Math.PI*2;rod(spin,[sign*.075,0,0],[sign*.075,Math.cos(a)*R*.62,Math.sin(a)*R*.62],.016,silver);}
    const hub=new T.Mesh(new T.SphereGeometry(.054,12,8),silver);hub.position.x=sign*.085;hub.scale.x=.4;spin.add(hub);
    for(let i=0;i<32;i++){const a=i/32*Math.PI*2;const tread=box(spin,[.115,.012,.025],[0,Math.cos(a)*R,Math.sin(a)*R],rubber,.003);tread.rotation.x=a;}
  }
  // Grilles and optical lenses are separate geometry, not painted wheels/windows.
  box(chassis,[.79,.24,.035],[0,belt-.23,L+.009],black,.04);
  for(let i=0;i<4;i++)box(chassis,[.73,.012,.045],[0,belt-.32+i*.052,L+.03],silver,.006);
  box(chassis,[1.02,.12,.025],[0,.39,L+.015],black,.025);
  for(const sign of [-1,1]){
    box(chassis,[.40,.15,.055],[sign*.58,belt-.12,L-.027],silver,.035);
    for(const x of [sign*.49,sign*.64])box(chassis,[.115,.105,.035],[x,belt-.12,L+.015],headlight,.035);
    box(chassis,[.24,.2,.05],[sign*.65,belt-.10,-L-.007],tail,.035);
    const brake=box(root,[.22,.15,.055],[sign*.65,belt-.1,-L-.018],litBrake,.03);brake.userData.brakeLight=true;brake.visible=false;
    for(const z of [-L-.035,L+.047]){const indicator=box(root,[.07,.07,.025],[sign*.78,belt-.11,z],amber,.015);indicator.userData.indicator=sign;indicator.visible=false;}
  }
  for(const z of [-L-.027,L+.065])box(chassis,[.44,.10,.015],[0,.61,z],new T.MeshStandardMaterial({color:0xe5e7df,roughness:.6}),.008);
  const wipers=[];
  for(const sign of [-1,1]){const p=new T.Group();p.name=`Wiper_${sign>0?'L':'R'}`;p.position.set(sign*.32,belt+.02,frontBase+.006);p.rotation.x=-.65;root.add(p);rod(p,[0,0,0],[sign*.13,.35,0],.009,black);wipers.push(p);}
  // Batch only static descendants of each assembly. Keep all moving pivots.
  const batch=parent=>{
    const meshes=parent.children.filter(n=>n.isMesh),groups=new Map();parent.updateMatrixWorld(true);
    for(const m of meshes){m.updateMatrix();const g=m.geometry.clone().applyMatrix4(m.matrix);const list=groups.get(m.material)??[];list.push(g);groups.set(m.material,list);parent.remove(m);m.geometry.dispose();}
    for(const [mat,geos] of groups){const normal=geos.map(g=>{const full=g.index?g.toNonIndexed():g;full.deleteAttribute('uv');return full;});const g=mergeGeometries(normal);const m=new T.Mesh(g,mat);m.castShadow=true;parent.add(m);for(const part of normal)part.dispose();}
  };
  batch(chassis);for(const d of doors)batch(d);for(const child of root.children)if(child.userData.vehicleWheel)batch(child.children[0]);
  const tracks=(name,duration,objects,axis,values)=>new T.AnimationClip(name,duration,objects.map(({object,sign=1})=>new T.QuaternionKeyframeTrack(`${object.name}.quaternion`,values.map(v=>v[0]*duration),values.flatMap(v=>new T.Quaternion().setFromAxisAngle(axis,v[1]*sign).toArray()))));
  const doorObjects=doors.filter(d=>d.userData.front).map(object=>({object,sign:object.userData.left?-1:1}));
  const animations=[tracks('DoorOpen',.7,doorObjects,new T.Vector3(0,1,0),[[0,0],[1,1.05]]),tracks('DoorClose',.7,doorObjects,new T.Vector3(0,1,0),[[0,1.05],[1,0]]),tracks('WheelsRoll',1,root.children.filter(n=>n.userData.vehicleWheel).map(n=>({object:n.children[0]})),new T.Vector3(1,0,0),[[0,0],[.25,Math.PI/2],[.5,Math.PI],[.75,Math.PI*1.5],[1,Math.PI*2]]),tracks('Steer',2,root.children.filter(n=>n.userData.vehicleWheel&&n.userData.front).map(object=>({object})),new T.Vector3(0,1,0),[[0,0],[.25,.45],[.75,-.45],[1,0]])];
  const wiperTracks=wipers.map(w=>new T.QuaternionKeyframeTrack(`${w.name}.quaternion`,[0,.6,1.2],[0,1,0].flatMap(a=>new T.Quaternion().setFromEuler(new T.Euler(-.65,0,a)).toArray())));animations.push(new T.AnimationClip('Wipers',1.2,wiperTracks));
  return {object:root,animations};
}
