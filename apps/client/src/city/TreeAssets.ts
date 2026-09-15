import { Box3, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh, LOD, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createGltfLoader } from './GltfLoader.ts';
import { QUALITY } from './Quality.ts';
import { props } from './Breakables.ts';
let templates:Array<Array<{geometry:BufferGeometry;material:Material|Material[]}>>=[];
export async function loadTreeAssets():Promise<void> {
  templates=await Promise.all(['tree-broad','tree-pine'].map(async file=>{
    const gltf=await createGltfLoader().loadAsync(`/models/${file}.glb`),root=gltf.scene;
    const box=new Box3().setFromObject(root),size=box.getSize(new Vector3());
    root.scale.setScalar(1/size.y);box.setFromObject(root);const c=box.getCenter(new Vector3());
    root.position.set(-c.x,-box.min.y,-c.z);root.updateMatrixWorld(true);
    const parts:Array<{geometry:BufferGeometry;material:Material|Material[]}>=[];
    root.traverse(n=>{if(n instanceof Mesh)parts.push({geometry:n.geometry.clone().applyMatrix4(n.matrixWorld),material:n.material});});
    return parts;
  }));
}
const lowTrunk=new CylinderGeometry(.028,.04,.42,4).translate(0,.21,0);
// Comparable triangle budget to the old sphere, but a broken multi-crown silhouette.
const crownParts=[[-.14,.64,0,.29],[.16,.67,.09,.28],[.03,.82,-.08,.28],[0,.59,-.15,.27]].map(([x,y,z,r])=>
  new IcosahedronGeometry(r!,0).scale(1,.92,1).translate(x!,y!,z!));
const lowRound=mergeGeometries(crownParts)!;for(const g of crownParts)g.dispose();
const pineParts=[new ConeGeometry(.24,.5,7).translate(0,.47,0),new ConeGeometry(.19,.46,7).translate(0,.67,0),new ConeGeometry(.12,.35,7).translate(0,.84,0)];
const lowPine=mergeGeometries(pineParts)!;for(const g of pineParts)g.dispose();
const distantMaterial=new MeshStandardMaterial({vertexColors:true,roughness:1});
function distantGeometry(crown:BufferGeometry):BufferGeometry {
  const parts=[[lowTrunk,0x65513c],[crown,0x56733d]] as const;
  const geometries=parts.map(([shape,hex])=>{
    const g=shape.index?shape.toNonIndexed():shape.clone(),p=g.getAttribute('position'),a=new Float32Array(p.count*3),color=new Color(hex);
    for(let i=0;i<p.count;i++)a.set([color.r,color.g,color.b],i*3);
    g.setAttribute('color',new BufferAttribute(a,3));g.deleteAttribute('uv');return g;
  });
  const merged=mergeGeometries(geometries)!;for(const g of geometries)g.dispose();return merged;
}
const distantTemplates=[distantGeometry(lowRound),distantGeometry(lowPine)];
type DistantTree={template:BufferGeometry;x:number;y:number;z:number;width:number;height:number;shade:number};
/**
 * Uzoq daraxtlarni bitta geometriyaga to'g'ridan-to'g'ri yozadi.
 * Har daraxt uchun `clone().applyMatrix4()` + `mergeGeometries` bilan bir xil natija,
 * lekin oraliq geometriyalarsiz: transformatsiya faqat masshtab va siljish, burilish yo'q,
 * shuning uchun normal matritsasi — shunchaki teskari masshtab.
 */
function bakeDistantTrees(trees:DistantTree[]):BufferGeometry {
  let size=0;for(const t of trees)size+=t.template.getAttribute('position').array.length;
  const position=new Float32Array(size),normal=new Float32Array(size),color=new Float32Array(size);
  let o=0;
  for(const {template,x,y,z,width,height,shade} of trees) {
    const sp=template.getAttribute('position').array,sn=template.getAttribute('normal').array,sc=template.getAttribute('color').array;
    const iw=1/width,ih=1/height;
    for(let i=0;i<sp.length;i+=3) {
      position[o+i]=sp[i]!*width+x;position[o+i+1]=sp[i+1]!*height+y;position[o+i+2]=sp[i+2]!*width+z;
      // Math.hypot o'zgaruvchan argumentli va bu siklda yuklanishning ~0.5 s ini olardi.
      const nx=sn[i]!*iw,ny=sn[i+1]!*ih,nz=sn[i+2]!*iw,l=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      normal[o+i]=nx/l;normal[o+i+1]=ny/l;normal[o+i+2]=nz/l;
      color[o+i]=sc[i]!*shade;color[o+i+1]=sc[i+1]!*shade;color[o+i+2]=sc[i+2]!*shade;
    }
    o+=sp.length;
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(position,3));
  geometry.setAttribute('normal',new BufferAttribute(normal,3));
  geometry.setAttribute('color',new BufferAttribute(color,3));
  return geometry;
}
export function assetTrees(points:Array<{x:number;z:number;scale:number;shape:number;kind:number}>,heightAt:(x:number,z:number)=>number):LOD[]|null {
  if(!templates.length)return null;
  const chunks=new Map<string,typeof points>();
  for(const p of points){const key=`${Math.floor(p.x/200)},${Math.floor(p.z/200)}`;const list=chunks.get(key)??[];list.push(p);chunks.set(key,list);}
  const lods:LOD[]=[];
  for(const [key,chunk] of chunks) {
    const [cx,cz]=key.split(',').map(Number),ox=(cx!+.5)*200,oz=(cz!+.5)*200,oy=heightAt(ox,oz);
    const lod=new LOD(),high=new Group(),low=new Group();lod.position.set(ox,oy,oz);lod.name='TreeDetailLOD';
    const distant:DistantTree[]=[];
    for(let variant=0;variant<templates.length;variant++) {
      const selected=chunk.filter(p=>(p.shape===1||p.shape===3?1:0)===variant);if(!selected.length)continue;
      const instances=(part:{geometry:BufferGeometry;material:Material|Material[]},target:Group,imported:boolean)=>{
        const mesh=new InstancedMesh(part.geometry,part.material,selected.length);mesh.name=imported?'ImportedTree':'DistantTree';
        const matrix=new Matrix4(),q=new Quaternion(),scale=new Vector3(),position=new Vector3();
        selected.forEach((p,i)=>{
          const h=p.scale*(p.kind===1?2:variant===1?9:7.5);
          position.set(p.x-ox,heightAt(p.x,p.z)-oy,p.z-oz);q.setFromAxisAngle(new Vector3(0,1,0),(p.x*3.73+p.z*7.31)%6.283);
          const width=p.shape===3?.46:p.shape===2?1.15:1;
          scale.set(h*width,h,h*width);
          matrix.compose(position,q,scale);mesh.setMatrixAt(i,matrix);
          const shade=.82+.18*Math.abs(Math.sin(p.x*.27+p.z*.39));mesh.setColorAt(i,new Color(shade,shade,shade*.96));
        });
        mesh.castShadow=imported;mesh.receiveShadow=true;mesh.computeBoundingSphere();target.add(mesh);
      };
      const before=high.children.length;
      for(const part of templates[variant]!)instances(part,high,true);
      // Har daraxt yiqitiladigan jihoz: shu variantning barcha qismlari bitta nusxa indeksi bilan.
      const parts=high.children.slice(before) as InstancedMesh[];
      selected.forEach((p,i)=>{if(p.kind===1)return;const h=p.scale*(variant===1?9:7.5);
        props.add(lod,'tree',p.x,p.z,Math.max(.25,.32*p.scale),h,parts.map(mesh=>({mesh,index:i})));});
      for(const p of selected) {
        const h=p.scale*(p.kind===1?2:variant===1?9:7.5),width=h*(p.shape===3?.46:p.shape===2?1.15:1);
        distant.push({template:distantTemplates[variant]!,x:p.x-ox,y:heightAt(p.x,p.z)-oy,z:p.z-oz,width,height:h,shade:.76+.23*Math.abs(Math.sin(p.x*.27+p.z*.39))});
      }
    }
    if(distant.length){
      const mesh=new Mesh(bakeDistantTrees(distant),distantMaterial);mesh.name='DistantTrees';mesh.userData.ownedTreeGeometry=true;low.add(mesh);}
    lod.addLevel(high,0);lod.addLevel(low,QUALITY.treeDetail(300),.12);lods.push(lod);
  }
  return lods;
}
