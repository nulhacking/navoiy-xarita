import { AdditiveBlending, Box3, BoxGeometry, CanvasTexture, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type BufferGeometry, type Material } from 'three';
import { createGltfLoader } from './GltfLoader.ts';
import type { CityMapData } from './CityTile.ts';
import type { Ground } from './Ground.ts';
import type { TreeBounds } from './trees.ts';
import { insidePolygon } from './RoadNetwork.ts';
import { props } from './Breakables.ts';

type Part={geometry:BufferGeometry;material:Material|Material[]};
const prefabs=new Map<string,Part[]>();

/**
 * Ko'cha chiroqlari: tunda yonadi, kunduzi o'chadi.
 *
 * Ikki qism. Birinchisi — modelning O'Z linzasi: `street-lamp.glb` da
 * chiroq boshi alohida "Yellow_LightPole01" materiali bilan kelgan, shuning
 * uchun uni topib emissiv qilish kifoya — qayerda turishini taxmin qilish
 * shart emas. Ikkinchisi — yerdagi yorug'lik dog'i: aynan shu narsa tunni
 * "yoritilgan" qilib ko'rsatadi, chunki 110 ta haqiqiy PointLight kadrni
 * o'ldirgan bo'lardi.
 */
const lenses = new Set<MeshStandardMaterial>();
const pools = new Set<InstancedMesh>();
/**
 * 0 — kunduz, 1 — tun.
 *
 * Boshlang'ich qiymat -1: birinchi chaqiruv, hatto u ham 0 bo'lsa, baribir
 * materiallarga yozilsin. Aks holda kunduzi yuklangan sahnada linza
 * three'ning `emissiveIntensity = 1` standarti bilan qolib ketardi.
 */
let nightLevel = -1;

export function setStreetLightLevel(level: number): void {
  if (Math.abs(level - nightLevel) < 0.004) return;
  nightLevel = level;
  for (const lens of lenses) {
    lens.emissive.setHex(0xffd486);
    lens.emissiveIntensity = 2.6 * level;
  }
  for (const pool of pools) applyPool(pool);
}

function applyPool(pool: InstancedMesh): void {
  pool.visible = nightLevel > 0.03;
  (pool.material as MeshBasicMaterial).opacity = 0.55 * nightLevel;
}

let poolTexture: CanvasTexture | null = null;
/** Yerdagi dog'ning radial gradienti — chetga borib so'nadi. */
function lightPoolTexture(): CanvasTexture {
  if (poolTexture) return poolTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,228,170,1)');
  gradient.addColorStop(0.4, 'rgba(255,214,140,0.38)');
  gradient.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  poolTexture = new CanvasTexture(canvas);
  poolTexture.colorSpace = SRGBColorSpace;
  return poolTexture;
}
export async function loadCityProps():Promise<void> {
  await Promise.all([['air-conditioner',.75],['bench',1.65],['street-lamp',7]].map(async ([name,length])=>{
    const root=(await createGltfLoader().loadAsync(`/models/${name}.glb`)).scene;
    let box=new Box3().setFromObject(root);const size=box.getSize(new Vector3());
    root.scale.setScalar(Number(length)/(name==='street-lamp'?size.y:Math.max(size.x,size.y,size.z)));
    box=new Box3().setFromObject(root);const centre=box.getCenter(new Vector3());root.position.set(-centre.x,-box.min.y,-centre.z);root.updateMatrixWorld(true);
    const parts:Part[]=[];root.traverse(n=>{if(n instanceof Mesh)parts.push({geometry:n.geometry.clone().applyMatrix4(n.matrixWorld),material:n.material});});
    prefabs.set(String(name),parts);
    if(name==='street-lamp')for(const part of parts)for(const material of Array.isArray(part.material)?part.material:[part.material]) {
      if(material instanceof MeshStandardMaterial&&/yellow|lamp|light|glass|lens/i.test(material.name))lenses.add(material);
    }
  }));
}
export interface BuildingDetail { ring:Float32Array; base:number; top:number; kind:string; floors:number; seed:number }

/** Architectural accents are visual estimates; building footprints/levels remain OSM-derived. */
export function buildCityDetails(map:CityMapData, buildings:BuildingDetail[],ground:Ground,bounds:TreeBounds,focus:{x:number;z:number},exclude?:(p:{x:number;z:number})=>boolean):Group {
  const group=new Group();group.name='StreetAndFacadeDetails';
  const boxes:Array<{matrix:Matrix4;color:number}>=[], ac:Matrix4[]=[], benches:Matrix4[]=[], lamps:Matrix4[]=[];
  const transform=(x:number,y:number,z:number,yaw:number,sx=1,sy=1,sz=1)=>new Matrix4().compose(new Vector3(x,y,z),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw),new Vector3(sx,sy,sz));
  const box=(x:number,y:number,z:number,yaw:number,sx:number,sy:number,sz:number,color:number)=>{if(boxes.length<3200)boxes.push({matrix:transform(x,y,z,yaw,sx,sy,sz),color});};
  const range=(b:BuildingDetail)=>Math.hypot(b.ring[0]!-focus.x,b.ring[1]!-focus.z);
  for(const b of buildings.filter(b=>range(b)<600).sort((a,b)=>range(a)-range(b))) {
    if(b.top-b.base<6||['industrial','garage','garages','warehouse'].includes(b.kind))continue;
    const n=b.ring.length/2;
    for(let i=0;i<n;i++) {
      const j=(i+1)%n,ax=b.ring[i*2]!,az=b.ring[i*2+1]!,dx=b.ring[j*2]!-ax,dz=b.ring[j*2+1]!-az,len=Math.hypot(dx,dz);
      if(len<9)continue;
      const ux=dx/len,uz=dz/len,nx=-uz,nz=ux,yaw=Math.atan2(-uz,ux);
      const levels=Math.min(12,Math.max(2,b.floors)),step=(b.top-b.base)/levels;
      for(let floor=1;floor<levels;floor++)for(let d=4;d<len-3;d+=8) {
        const x=ax+ux*d,z=az+uz*d,y=b.base+floor*step;
        if((floor+i+Math.floor(d))%3===0&&ac.length<160)ac.push(transform(x+nx*.35,y+.45,z+nz*.35,Math.atan2(nx,nz)));
        if(b.kind==='apartments'||(b.kind==='yes'&&b.floors>=3&&b.seed>.4)) {
          // A projecting slab, parapet and end walls create actual balcony depth.
          box(x+nx*.55,y,z+nz*.55,yaw,2.6,.15,1.1,0xc6bcaa);
          box(x+nx*1.05,y+.48,z+nz*1.05,yaw,2.6,.85,.1,b.seed>.5?0x9dadae:0xc5c0b2);
          for(const side of [-1,1])box(x+ux*side*1.25+nx*.55,y+.48,z+uz*side*1.25+nz*.55,yaw,.1,.85,1.1,0xcec8bb);
        }
      }
    }
  }
  const obstacles=[...map.buildings,...map.water];
  const segments=map.roads.flatMap(r=>Array.from({length:Math.max(0,r.pts.length/2-1)},(_,i)=>({x:r.pts[i*2]!,z:r.pts[i*2+1]!,dx:r.pts[i*2+2]!-r.pts[i*2]!,dz:r.pts[i*2+3]!-r.pts[i*2+1]!,width:r.width,cls:r.cls})));
  const allowed=(x:number,z:number)=>Math.hypot(x-focus.x,z-focus.z)<550&&!exclude?.({x,z})&&x>=bounds.minX&&x<bounds.maxX&&z>=bounds.minZ&&z<bounds.maxZ&&!obstacles.some(r=>insidePolygon({x,z},r))&&!segments.some(s=>{const t=Math.max(0,Math.min(1,((x-s.x)*s.dx+(z-s.z)*s.dz)/(s.dx*s.dx+s.dz*s.dz||1)));return Math.hypot(x-s.x-t*s.dx,z-s.z-t*s.dz)<s.width/2+.4;});
  for(const s of segments) {
    if(!['primary','secondary','tertiary','residential'].includes(s.cls))continue;
    const length=Math.hypot(s.dx,s.dz);if(length<35)continue;
    for(let d=22;d<length-12;d+=46)for(const side of [-1,1]) {
      const nx=-s.dz/length*side,nz=s.dx/length*side,x=s.x+s.dx*d/length+nx*(s.width/2+1.3),z=s.z+s.dz*d/length+nz*(s.width/2+1.3);
      if(!allowed(x,z))continue;
      if(lamps.length<110)lamps.push(transform(x,ground.heightAt(x,z),z,Math.atan2(-nx,-nz)));
      const bx=x+nx*2.5,bz=z+nz*2.5;
      if(benches.length<45&&allowed(bx,bz))benches.push(transform(bx,ground.heightAt(bx,bz),bz,Math.atan2(-nx,-nz)));
    }
  }
  if(boxes.length){
    const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial({roughness:.88}),boxes.length);
    mesh.userData.ownedGeometry=true;mesh.userData.ownedMaterial=true;
    boxes.forEach((b,i)=>{mesh.setMatrixAt(i,b.matrix);mesh.setColorAt(i,new Color(b.color));});mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  const created=new Map<string,InstancedMesh[]>();
  for(const [id,matrices] of [['air-conditioner',ac],['bench',benches],['street-lamp',lamps]] as const)for(const part of prefabs.get(id)??[]) {
    if(!matrices.length)continue;const mesh=new InstancedMesh(part.geometry,part.material,matrices.length);
    matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=id;group.add(mesh);
    created.set(id,[...(created.get(id)??[]),mesh]);
  }
  registerFurniture(group,created,lamps,benches,addLightPools(group,lamps,ground));
  return group;
}

/** Shared ready-made lamp/bench assets for the continuous lakeside promenade. */
export function buildParkFurniture(points:Array<{x:number;z:number;yaw:number}>,ground:Ground):Group {
  const group=new Group();group.name='Ozero · imported lamps and benches';
  const lamps=points.map(p=>new Matrix4().compose(new Vector3(p.x,ground.heightAt(p.x,p.z),p.z),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.yaw),new Vector3(1,1,1)));
  const benches=points.filter((_,i)=>i%2===0).map(p=>new Matrix4().compose(new Vector3(p.x+Math.cos(p.yaw)*2,ground.heightAt(p.x+Math.cos(p.yaw)*2,p.z-Math.sin(p.yaw)*2),p.z-Math.sin(p.yaw)*2),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.yaw),new Vector3(1,1,1)));
  const created=new Map<string,InstancedMesh[]>();
  for(const [id,matrices] of [['street-lamp',lamps],['bench',benches]] as const)for(const part of prefabs.get(id)??[]) {
    if(!matrices.length)continue;
    const mesh=new InstancedMesh(part.geometry,part.material,matrices.length);matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));
    mesh.name=id;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
    created.set(id,[...(created.get(id)??[]),mesh]);
  }
  registerFurniture(group,created,lamps,benches,addLightPools(group,lamps,ground));return group;
}

/** Faqat yerdagi yorug'lik dog'lari — o'z chiroq modeli bor landmarklar uchun. */
/** Chiroq va skameykalarni yiqitiladigan jihoz sifatida ro'yxatga oladi (matritsa — dunyo koordinatasi). */
function registerFurniture(owner:Group,created:Map<string,InstancedMesh[]>,lamps:Matrix4[],benches:Matrix4[],pool:InstancedMesh|null):void {
  lamps.forEach((m,i)=>props.add(owner,'lamp',m.elements[12]!,m.elements[14]!,.22,7,[
    ...(created.get('street-lamp')??[]).map(mesh=>({mesh,index:i})),...(pool?[{mesh:pool,index:i,hideOnly:true}]:[])]));
  benches.forEach((m,i)=>props.add(owner,'bench',m.elements[12]!,m.elements[14]!,.75,.9,(created.get('bench')??[]).map(mesh=>({mesh,index:i}))));
}

export function buildLightPools(points:Array<{x:number;z:number}>,ground:Ground):Group {
  const group=new Group();group.name='street-light-pools';
  addLightPools(group,points.map(p=>new Matrix4().makeTranslation(p.x,0,p.z)),ground);
  return group;
}

function addLightPools(group:Group,lamps:Matrix4[],ground:Ground):InstancedMesh|null {
  if(lamps.length) {
    // Dog' yassi va yerdan 9 sm balandda. Balandlikning o'zi yetmaydi:
    // yo'l qatlamlari `polygonOffset` bilan kameraga tortilgan (`CityTile`
    // dagi `LAYER`), va 200 m dan naridayoq ular dog'ni chuqurlik bo'yicha
    // yutib yuborardi. Shuning uchun dog'ga eng katta siljish beriladi —
    // u hamma yassi qatlamning ustida.
    const pool=new InstancedMesh(
      new PlaneGeometry(15,15).rotateX(-Math.PI/2),
      new MeshBasicMaterial({map:lightPoolTexture(),transparent:true,blending:AdditiveBlending,
        depthWrite:false,fog:false,opacity:0,
        polygonOffset:true,polygonOffsetFactor:-14,polygonOffsetUnits:-42}),
      lamps.length);
    pool.userData.ownedGeometry=true;pool.userData.ownedMaterial=true;pool.name='street-light-pool';
    pool.renderOrder=3;
    lamps.forEach((m,i)=>{
      const x=m.elements[12]!,z=m.elements[14]!;
      pool.setMatrixAt(i,new Matrix4().makeTranslation(x,ground.heightAt(x,z)+.01,z));
    });
    applyPool(pool);
    pools.add(pool);
    group.add(pool);
    return pool;
  }
  return null;
}
export function disposeCityDetails(group:Group):void {
  props.remove(group);
  group.traverse(n=>{if(n instanceof InstancedMesh){pools.delete(n);n.dispose();if(n.userData.ownedGeometry)n.geometry.dispose();if(n.userData.ownedMaterial)(n.material as Material).dispose();}});group.clear();
}
