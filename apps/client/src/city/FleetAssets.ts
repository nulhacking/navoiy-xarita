import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { createGltfLoader } from './GltfLoader.ts';
import { batchStaticModel, type LoadedModel } from './models.ts';

export type VehicleKind = 'car' | 'motorcycle' | 'bicycle';

/**
 * Haydovchi tayanadigan nuqtalar, transportning O'Z fazosida (metr).
 *
 * Boshlanish nuqtasi — g'ildirak tegadigan tekislikning markazi, +Z oldinga,
 * +Y tepaga, +X CHAPGA. Qiymatlar modelning haqiqiy o'lchamlaridan olingan:
 * egar/o'rindiq balandligi, dastak/rul joyi, pedal yoki oyoq tayanchi.
 * `Rider` shu uchta nuqtaga oyoq-qo'lni teskari kinematika bilan yetkazadi,
 * shuning uchun ular transportga qarab o'zgaradi, personajga qarab emas.
 */
export interface RiderRig {
  /** Chanoq joyi. */
  seat: [number, number, number];
  /** Qo'l tayanchi: [yarim kenglik, balandlik, oldinga siljish]. */
  grip: [number, number, number];
  /** Oyoq tayanchi: [yarim kenglik, balandlik, oldinga siljish]. */
  foot: [number, number, number];
  /** Gavda oldinga egilishi, radian. Manfiy — orqaga yotgan holat. */
  lean: number;
  /** Shatun uzunligi, metr. Nol — oyoq qimirlamaydigan tayanchda. */
  crank: number;
}

export interface VehicleSpec {
  id: string; label: string; kind: VehicleKind; length: number;
  half: { x: number; y: number; z: number };
  maxSpeed: number; acceleration: number; brake: number;
  rig: RiderRig;
}
export const VEHICLE_SPECS: VehicleSpec[] = [
  { id:'car', label:'Sport avtomobil', kind:'car', length:4.5, half:{x:.95,y:.7,z:2.25}, maxSpeed:40, acceleration:7, brake:11,
    rig:{ seat:[.36,.36,-.10], grip:[.17,.72,.16], foot:[.13,.06,.52], lean:-.16, crank:0 } },
  { id:'sedan', label:'Sedan', kind:'car', length:4.5, half:{x:.96,y:.63,z:2.25}, maxSpeed:34, acceleration:5.5, brake:10,
    rig:{ seat:[.36,.24,.02], grip:[.17,.60,.30], foot:[.13,.00,.62], lean:-.10, crank:0 } },
  { id:'suv', label:'SUV', kind:'car', length:4.65, half:{x:1.12,y:.82,z:2.325}, maxSpeed:31, acceleration:4.8, brake:10,
    rig:{ seat:[.4,.46,.10], grip:[.18,.82,.40], foot:[.14,.18,.72], lean:-.08, crank:0 } },
  { id:'motorcycle', label:'Mototsikl', kind:'motorcycle', length:2.2, half:{x:.38,y:.5,z:1.1}, maxSpeed:38, acceleration:8.5, brake:12,
    rig:{ seat:[0,.90,-.26], grip:[.25,.98,.42], foot:[.20,.44,-.24], lean:1.15, crank:0 } },
  { id:'bicycle', label:'Velosiped', kind:'bicycle', length:1.85, half:{x:.3,y:.45,z:.925}, maxSpeed:11, acceleration:2.8, brake:7,
    rig:{ seat:[0,.97,-.20], grip:[.18,.94,.42], foot:[.10,.30,.02], lean:1.35, crank:.16 } },
];
export const vehicleSpec = (object: Object3D): VehicleSpec => VEHICLE_SPECS.find(s=>s.id===object.userData.vehicleId) ?? VEHICLE_SPECS[0]!;

/** Split welded connected pieces so embedded bicycle tyres can become wheel pivots. */
function components(mesh: Mesh): Mesh[] {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  const p = g.getAttribute('position'), parents = Array.from({length:p.count/3},(_,i)=>i);
  const root = (a:number):number => { while(parents[a]!==a){parents[a]=parents[parents[a]!]!;a=parents[a]!;}return a; };
  const vertices = new Map<string,number>();
  for(let i=0;i<p.count;i++) {
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*10000)).join(',');
    const t=Math.floor(i/3), other=vertices.get(key);
    if(other!==undefined) parents[root(t)]=root(other); else vertices.set(key,t);
  }
  const groups=new Map<number,number[]>();
  for(let i=0;i<p.count;i+=3){const r=root(i/3),list=groups.get(r)??[];list.push(i,i+1,i+2);groups.set(r,list);}
  const result=[...groups.values()].map(indices=>{
    const geometry=new BufferGeometry();
    for(const name of Object.keys(g.attributes)) {
      const a=g.getAttribute(name), out=new Float32Array(indices.length*a.itemSize);
      indices.forEach((v,i)=>{for(let k=0;k<a.itemSize;k++)out[i*a.itemSize+k]=a.array[v*a.itemSize+k]!;});
      geometry.setAttribute(name,new BufferAttribute(out,a.itemSize));
    }
    const piece=new Mesh(geometry,mesh.material);piece.name=mesh.name;return piece;
  });
  g.dispose();return result;
}

/** Asset-specific wheel separation, inspected against the downloaded source meshes. */
function rig(source:Group, id:string):Group {
  source.updateMatrixWorld(true);
  const result=new Group(), body=new Group();result.add(body);
  const sourceMeshes:Mesh[]=[];source.traverse(n=>{if(n instanceof Mesh)sourceMeshes.push(n);});
  const pieces:Mesh[]=[];
  for(const mesh of sourceMeshes) pieces.push(...components(mesh));
  const overall=new Box3().setFromObject(source), span=overall.getSize(new Vector3());
  const wheelParts:Mesh[][]=[], centres:Vector3[]=[];
  if(id==='bicycle') {
    for(const p of pieces) {
      const b=new Box3().setFromObject(p), s=b.getSize(new Vector3());
      if(s.y>span.y*.4 && s.x<s.y*.35 && Math.abs(s.y-s.z)<s.y*.15 && b.min.y<overall.min.y+span.y*.08) {
        const c=b.getCenter(new Vector3());
        if(!centres.some(v=>v.distanceTo(c)<span.y*.2)){centres.push(c);wheelParts.push([]);}
      }
    }
  }
  for(const p of pieces) {
    const b=new Box3().setFromObject(p), c=b.getCenter(new Vector3());
    let key=-1;
    if(id==='sedan'||id==='suv') {
      if(/Wheel/.test(p.name)) key=(/Front/.test(p.name)?0:2)+(c.x<0?1:0);
    } else if(id==='motorcycle') {
      if(/^test005_test025/.test(p.name))key=0;
      if(/^test003_test025/.test(p.name))key=1;
    } else if(id==='bicycle') {
      key=centres.findIndex(w=>{
        const radius=span.y*.35, pos=p.geometry.getAttribute('position');
        for(let i=0;i<pos.count;i++) if(Math.hypot(pos.getY(i)-w.y,pos.getZ(i)-w.z)>radius*1.05)return false;
        return Math.abs(c.x-w.x)<span.y*.2;
      });
    }
    if(key>=0){wheelParts[key]??=[];wheelParts[key]!.push(p);}else body.add(p);
  }
  for(let i=0;i<wheelParts.length;i++) {
    const parts=wheelParts[i];if(!parts?.length)continue;
    const spin=new Group();spin.name='WheelSpin';spin.add(...parts);
    const box=new Box3().setFromObject(spin), centre=box.getCenter(new Vector3());
    for(const part of parts)part.geometry.translate(-centre.x,-centre.y,-centre.z);
    const pivot=new Group();pivot.position.copy(centre);
    pivot.userData.vehicleWheel=true;
    pivot.userData.front=id==='bicycle'?centre.z<overall.getCenter(new Vector3()).z:i< (id==='motorcycle'?1:2);
    pivot.userData.radius=(box.max.y-box.min.y)/2;
    pivot.userData.spinSign=id==='bicycle'?-1:1;
    const merged=batchStaticModel(spin);merged.name='WheelSpin';
    pivot.name=pivot.userData.front?'WheelFront':'WheelRear';pivot.add(merged);result.add(pivot);
  }
  result.remove(body);result.add(batchStaticModel(body));
  // Jeremy's bicycle front fork points toward -Z; other sources point +Z.
  if(id==='bicycle')result.rotation.y=Math.PI;
  return result;
}

export async function loadFleet():Promise<LoadedModel[]> {
  return Promise.all(VEHICLE_SPECS.slice(1).map(async spec=>{
    const gltf=await createGltfLoader().loadAsync(`/models/${spec.id}.glb`);
    const source=rig(gltf.scene,spec.id), b=new Box3().setFromObject(source), size=b.getSize(new Vector3());
    const scale=spec.length/Math.max(size.x,size.z);source.scale.setScalar(scale);
    b.setFromObject(source);const centre=b.getCenter(new Vector3());
    source.position.set(-centre.x,-b.min.y,-centre.z);
    const object=new Group();object.userData.vehicleId=spec.id;object.name=spec.label;object.add(source);
    object.traverse(n=>{if(n instanceof Mesh){n.castShadow=true;
      if(n.material instanceof MeshStandardMaterial && n.material.name==='Windows') {
        n.material.transparent=true;n.material.opacity=.28;n.material.depthWrite=false;n.material.roughness=.16;
      }
    }});
    return {object,animations:[]};
  }));
}
