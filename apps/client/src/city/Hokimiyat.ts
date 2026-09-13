import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Points, PointsMaterial, Quaternion, ShapeUtils, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityFrame } from './CityFrame.ts';
import type { Ground } from './Ground.ts';
import type { CityMapData } from './CityTile.ts';
import { Physics, RAPIER } from './Physics.ts';
import { HOKIMIYAT_HEIGHT, HOKIMIYAT_RINGS, hokimiyatBasis, hokimiyatSatelliteGeo } from './HokimiyatReference.ts';
import { assetTrees } from './TreeAssets.ts';
import { disposeTrees, type TreeMeshes } from './trees.ts';
import { buildParkFurniture, disposeCityDetails } from './CityDetails.ts';
import { parkPavingTexture } from './SurfaceMaterials.ts';

/** Photo-led facade and satellite/OSM-led site. Decorative dimensions are authored estimates. */
export class Hokimiyat {
  readonly group=new Group();
  readonly map:CityMapData={buildings:[],roads:[],water:[],areas:[]};
  readonly basis:ReturnType<typeof hokimiyatBasis>;
  readonly base:number;
  readonly height=HOKIMIYAT_HEIGHT;
  private readonly body:RAPIER.RigidBody;
  private readonly parts=new Map<string,BufferGeometry[]>();
  private readonly materials:Record<string,MeshStandardMaterial>;
  private trees:TreeMeshes|null=null;
  private readonly furniture:Group;
  private readonly jets:Points<BufferGeometry,PointsMaterial>;
  private time=0;
  private readonly fountains:Array<{u:number;v:number;y:number}>=[];
  private readonly canopy:MeshStandardMaterial;
  constructor(private frame:CityFrame,private ground:Ground,private physics:Physics){
    this.basis=hokimiyatBasis(frame);this.base=ground.heightAt(this.basis.origin.x,this.basis.origin.z);
    this.group.name='Navoiy viloyati hokimligi · photo reference';
    this.group.position.set(this.basis.origin.x,this.base,this.basis.origin.z);
    this.group.rotation.y=Math.atan2(-this.basis.east.z,this.basis.east.x);
    this.body=physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.group.position.x,this.base,this.group.position.z).setRotation(this.group.quaternion));
    const material=(color:number,roughness=.82,metalness=0)=>new MeshStandardMaterial({color,roughness,metalness});
    this.materials={stone:material(0xd2d3c9),seam:material(0x909c98),gold:material(0xddb65d,.39,.58),screen:material(0x857445,.55,.45),glass:material(0x263f41,.19,.35),granite:material(0x87645b,.52),metal:material(0x5a6568,.42,.6),white:material(0xf0eee1),grass:material(0x557346),paving:material(0xc9c3b4),stripe:material(0x99988f),solar:material(0x203342,.32,.45),blue:material(0x336780,.3,.3),water:material(0x36767c,.2,.15)};
    for(const key of ['paving','stripe','grass']){
      const m=this.materials[key]!;m.polygonOffset=true;m.polygonOffsetFactor=key==='grass'?-13:-12;m.polygonOffsetUnits=m.polygonOffsetFactor*3;m.side=DoubleSide;
      if(key!=='grass')m.map=parkPavingTexture();
    }
    this.canopy=this.materials.glass!;this.canopy.emissive.setHex(0x537f76);
    this.buildings();this.towerFacade();this.roofEquipment();this.site();
    const treePoints=this.planting();
    for(const [key,parts]of this.parts){
      const geometry=mergeGeometries(parts)!;for(const g of parts)g.dispose();
      const mesh=new Mesh(geometry,this.materials[key]);mesh.name=`Hokimiyat · ${key}`;
      mesh.castShadow=!['paving','stripe','grass','water'].includes(key);mesh.receiveShadow=true;this.group.add(mesh);
    }
    this.parts.clear();
    // Imported tree assets are in city/world coordinates; make them children of a cancelling transform.
    const worldDetails=new Group();worldDetails.name='Hokimiyat · world-space landscaping';
    worldDetails.position.copy(this.group.position).negate().applyQuaternion(this.group.quaternion.clone().invert());
    worldDetails.quaternion.copy(this.group.quaternion).invert();this.group.add(worldDetails);
    const meshes=assetTrees(treePoints,(x,z)=>ground.heightAt(x,z));
    if(meshes){for(const lod of meshes)if(lod.levels[1])lod.levels[1].distance=600;this.trees={meshes,count:treePoints.length,sharedAssets:true};worldDetails.add(...meshes);}
    const lamps=Array.from({length:12},(_,i)=>{const p=this.basis.point(i<6?33:-59,20+(i%6)*25);return{x:p.x,z:p.z,yaw:this.group.rotation.y};});
    this.furniture=buildParkFurniture(lamps,ground);worldDetails.add(this.furniture);
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(360*3),3));
    this.jets=new Points(geometry,new PointsMaterial({color:0xd1eff0,size:.12,transparent:true,opacity:.58,depthWrite:false}));
    this.jets.name='Hokimiyat · fountain spray';this.jets.frustumCulled=false;this.group.add(this.jets);this.update(0,0);
    this.group.userData={sourceIds:[146696850,146696818,367714606],trees:treePoints.length,fountains:this.fountains.length,facade:'photo-authored gold lattice',footprints:'OSM',dimensions:'14-level source extrusion; detail heights estimated'};
  }
  private y(u:number,v:number){const p=this.basis.point(u,v);return this.ground.heightAt(p.x,p.z)-this.base;}
  private add(g:BufferGeometry,key:string){
    const flat=g.index?g.toNonIndexed():g.clone();g.dispose();
    const p=flat.getAttribute('position'),uv=new Float32Array(p.count*2);
    for(let i=0;i<p.count;i++){uv[i*2]=p.getX(i)/4;uv[i*2+1]=p.getZ(i)/4;}
    flat.setAttribute('uv',new BufferAttribute(uv,2));
    const bucket=this.parts.get(key)??[];bucket.push(flat);this.parts.set(key,bucket);
  }
  private box(x:number,y:number,z:number,w:number,h:number,d:number,key:string,collision=false){
    this.add(new BoxGeometry(w,h,d).translate(x,y,z),key);
    if(collision)this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w/2,h/2,d/2).setTranslation(x,y,z),this.body);
  }
  private beam(a:Vector3,b:Vector3,r:number,key:string,collision=false){
    const delta=b.clone().sub(a),length=delta.length(),q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()),p=a.clone().add(b).multiplyScalar(.5);
    this.add(new CylinderGeometry(r,r,length,6).applyQuaternion(q).translate(p.x,p.y,p.z),key);
    if(collision)this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(length/2,r).setTranslation(p.x,p.y,p.z).setRotation(q),this.body);
  }
  private buildings(){
    // Preserve the exact source polygon for both roof/walls and physical mesh.
    HOKIMIYAT_RINGS.forEach((ring,index)=>{
      const contour=ring.map(([lon,lat])=>{const p=this.basis.uv(this.frame.toLocal({lon,lat,alt:0}));return new Vector2(p.u,p.v);});
      const h=[this.height,7.4,4.2][index]!,lo=Math.min(...contour.map(p=>this.y(p.x,p.y)))-.35,hi=Math.max(...contour.map(p=>this.y(p.x,p.y)))+h;
      const positions:number[]=[];
      for(let i=0;i<contour.length;i++){
        const a=contour[i]!,b=contour[(i+1)%contour.length]!;
        positions.push(a.x,lo,a.y,b.x,lo,b.y,b.x,hi,b.y,a.x,lo,a.y,b.x,hi,b.y,a.x,hi,a.y);
      }
      for(const [a,b,c]of ShapeUtils.triangulateShape(contour,[]))for(const i of [c!,b!,a!])positions.push(contour[i]!.x,hi,contour[i]!.y);
      const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));g.computeVertexNormals();
      // Source ring winding may vary; both sides are visible but collision uses the same vertices.
      this.materials.stone!.side=DoubleSide;this.add(g,'stone');
      this.physics.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),Uint32Array.from({length:positions.length/3},(_,i)=>i)).setFriction(.85),this.body);
      if(index===1){
        // Solar panels and alternating white fins match the long western low-rise wing.
        const minV=Math.min(...contour.map(p=>p.y)),maxV=Math.max(...contour.map(p=>p.y));
        for(let v=minV+3;v<maxV-2;v+=3){
          const cuts:number[]=[];
          for(let i=0;i<contour.length;i++){
            const a=contour[i]!,b=contour[(i+1)%contour.length]!;
            if((a.y<=v&&b.y>v)||(b.y<=v&&a.y>v))cuts.push(a.x+(b.x-a.x)*(v-a.y)/(b.y-a.y));
          }
          if(cuts.length<2)continue;const left=Math.min(...cuts),right=Math.max(...cuts);
          this.box((left+right)/2,hi+.24,v,right-left-3,.22,2.3,'solar');
          this.box(right+.18,hi-2.4,v,.3,4.8,.3,'white');
          this.box(right+.08,hi-3,v,.13,3.7,2.1,'glass');
        }
      }
    });
  }
  private towerFacade(){
    const h=this.height;
    for(const side of [-1,1]){
      const z=side*9.28;
      this.box(0,(h+3.8)/2,z,28.6,h-3.8,.22,'glass');
      for(let i=0;i<=13;i++){
        const x=-14+i*28/13;
        this.box(x,22.3,z+side*.29,.17,35.9,.2,'gold');
        for(const dx of [-.34,.34])this.box(x+dx,42.4,z+side*.31,.065,6.2,.09,'gold');
        // Three rows of open elongated diamonds, not a flat decorative image.
        for(let row=0;row<3;row++){
          const y=40.1+row*1.6;
          for(const [dx1,dy1,dx2,dy2] of [[-.48,0,0,.75],[0,.75,.48,0],[.48,0,0,-.75],[0,-.75,-.48,0]])
            this.beam(new Vector3(x+dx1!,y+dy1!,z+side*.31),new Vector3(x+dx2!,y+dy2!,z+side*.31),.048,'gold');
        }
      }
      for(let x=-13.8;x<14;x+=.36)this.box(x,22.1,z+side*.14,.025,35.6,.035,'screen');
      for(let y=4.4;y<39.9;y+=.32)this.box(0,y,z+side*.17,28,.022,.04,'screen');
      this.box(0,h+.1,z,30,.26,.65,'stone');
    }
    // Narrow side elevations: panel joints, recessed windows and sills.
    for(const side of [-1,1])for(let floor=0;floor<13;floor++){
      const y=5.1+floor*3.08;
      this.box(side*15.64,y,0,.05,1.9,1.35,'glass');
      this.box(side*15.7,y-1.04,0,.2,.1,1.65,'white');
      this.box(side*15.65,y-1.5,0,.03,.025,17.6,'seam');
    }
    // White entry portal and brown stone stairs, as in the street-level photos.
    this.box(0,4.4,10.8,15,1,4,'white');
    for(const x of [-6.8,6.8])this.box(x,2.1,11.1,1.1,4.2,2.4,'white',true);
    this.box(0,2.1,10.4,11.8,3.4,.16,'glass');
    for(let i=0;i<5;i++)this.box(0,.07*(i+1),15.2-i*.55,15,.14*(i+1),.65,'granite',true);
    for(const x of [-3,0,3])this.box(x,2.1,10.53,.09,3.4,.07,'metal');
  }
  private roofEquipment(){
    const h=this.height;
    for(const [x,z,height]of [[-4,1,12],[5,-2,8],[10,3,4]]){
      for(const dx of [-.32,.32])this.beam(new Vector3(x!+dx,h,z!),new Vector3(x!+dx,h+height!,z!),.047,'metal');
      for(let y=0;y<height!;y+=1){this.beam(new Vector3(x!-.32,h+y,z!),new Vector3(x!+.32,h+y+.8,z!),.025,'metal');}
      this.box(x!,h+height!*.7,z!,.4,1.6,.3,'stone');
    }
    for(const [x,z]of [[-10,2],[8,2],[3,-4],[-7,-4]]){
      this.beam(new Vector3(x!,h,z!),new Vector3(x!,h+1.9,z!),.06,'metal');
      this.add(new SphereGeometry(.8,16,8,0,Math.PI*2,0,Math.PI/2).rotateX(Math.PI/3).translate(x!,h+2,z!),'stone');
    }
    this.box(1,h+.7,-1,5,1.4,4,'stone');
  }
  private groundQuad(a:Vector2,b:Vector2,c:Vector2,d:Vector2,key:string){
    const nx=Math.max(1,Math.ceil(a.distanceTo(b)/2)),nz=Math.max(1,Math.ceil(a.distanceTo(d)/2)),positions:number[]=[];
    const at=(u:number,v:number)=>{const p=a.clone().lerp(b,u).lerp(d.clone().lerp(c,u),v);return[p.x,this.y(p.x,p.y)+.045,p.y];};
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)for(const [u,v]of [[i/nx,j/nz],[i/nx,(j+1)/nz],[(i+1)/nx,(j+1)/nz],[i/nx,j/nz],[(i+1)/nx,(j+1)/nz],[(i+1)/nx,j/nz]])positions.push(...at(u!,v!));
    const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));g.computeVertexNormals();this.add(g,key);
  }
  private rect(u:number,v:number,w:number,d:number,key:string){this.groundQuad(new Vector2(u-w/2,v-d/2),new Vector2(u+w/2,v-d/2),new Vector2(u+w/2,v+d/2),new Vector2(u-w/2,v+d/2),key);}
  private site(){
    this.rect(-30,-19,118,36,'paving');this.rect(0,19,34,21,'paving');
    // Sample the real plaza quadrilateral, including its slight skew relative to the tower.
    const corners=[[640,280],[772,233],[875,478],[743,523]].map(([x,y])=>{const p=this.basis.uv(this.frame.toLocal(hokimiyatSatelliteGeo(x!,y!)));return new Vector2(p.u,p.v);});
    const [a,b,c,d]=corners as [Vector2,Vector2,Vector2,Vector2];
    const at=(u:number,v:number)=>a.clone().lerp(b,u).lerp(d.clone().lerp(c,u),v);
    const width=a.distanceTo(b),length=a.distanceTo(d),cols=Math.ceil(width/2),rows=Math.ceil(length/2);
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
      const u=(i+.5)/cols,v=(j+.5)/rows,edge=Math.min(u*width,(1-u)*width,v*length,(1-v)*length);
      this.groundQuad(at(i/cols,j/rows),at((i+1)/cols,j/rows),at((i+1)/cols,(j+1)/rows),at(i/cols,(j+1)/rows),Math.floor(edge/2.4)%2?'stripe':'paving');
    }
    const world=corners.map(p=>this.basis.point(p.x,p.y));this.map.areas.push({cls:'parking',pts:new Float32Array(world.flatMap(p=>[p.x,p.z]))});
    // Garden strip and three plate-sculpture fountains west of the patterned plaza.
    this.rect(-40,83,31,131,'paving');
    for(const [x,y]of [[607,283],[643,371],[674,461]]){
      const p=this.basis.uv(this.frame.toLocal(hokimiyatSatelliteGeo(x!,y!)));this.fountain(p.u,p.v);
      // Diamond-shaped planted islands and diagonal paths in the west garden strip.
      for(const sign of [-1,1])this.groundQuad(new Vector2(p.u+sign*2,p.v),new Vector2(p.u+sign*13,p.v-17),new Vector2(p.u+sign*13,p.v+17),new Vector2(p.u+sign*2,p.v),'grass');
    }
    this.rect(-36,-33,85,7,'grass');this.rect(26,0,7,28,'grass');
    for(let z=20;z<155;z+=13)this.planter(-55,z,3.5,7);
    // Open pedestrian connections are map data too; NPC routing still uses OSM road rules.
    for(const [u,v1,v2]of [[-57,13,153],[-23,23,159],[40,32,150]]){
      const p=this.basis.point(u!,v1!),q=this.basis.point(u!,v2!);this.map.roads.push({cls:'footway',width:3,pts:new Float32Array([p.x,p.z,q.x,q.z])});
    }
    for(const u of [-8,-3,2])this.flag(u,-18);
    // Low fence along the street sides, leaving the main approach open.
    for(let u=-80;u<31;u+=3){const y=this.y(u,-29);this.box(u,y+.65,-29,.07,1.3,.07,'metal');this.box(u+1.5,y+1.2,-29,3,.045,.05,'metal');}
  }
  private planter(u:number,v:number,w:number,d:number){
    const y=this.y(u,v);this.rect(u,v,w,d,'grass');
    for(const side of [-1,1]){this.box(u+side*w/2,y+.16,v,.22,.32,d,'granite',true);this.box(u,y+.16,v+side*d/2,w,.32,.22,'granite',true);}
  }
  private fountain(u:number,v:number){
    const y=this.y(u,v);this.fountains.push({u,v,y});
    this.add(new CylinderGeometry(5.1,5.1,.25,16).translate(u,y+.125,v),'granite');
    this.add(new CylinderGeometry(4.7,4.7,.05,32).translate(u,y+.28,v),'water');
    this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(.14,5.1).setTranslation(u,y+.14,v),this.body);
    this.box(u,y+2.5,v,.85,5, .85,'stone',true);
    for(let i=0;i<5;i++){
      const a=i/5*Math.PI*2,center=new Vector3(u+Math.cos(a)*1.6,y+5.1,v+Math.sin(a)*1.6),q=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),new Vector3(Math.cos(a),.1,Math.sin(a)).normalize());
      this.add(new CylinderGeometry(1.25,1.25,.15,32).rotateX(Math.PI/2).applyQuaternion(q).translate(center.x,center.y,center.z),'blue');
      this.add(new TorusGeometry(1.22,.065,6,36).applyQuaternion(q).translate(center.x,center.y,center.z),'gold');
      for(let j=0;j<8;j++){
        const t=j/8*Math.PI*2,p=new Vector3(Math.cos(t)*.76,Math.sin(t)*.76,.12).applyQuaternion(q).add(center);
        this.add(new TorusGeometry(.22,.035,5,16).applyQuaternion(q).translate(p.x,p.y,p.z),'stone');
      }
    }
  }
  private flag(u:number,v:number){
    const y=this.y(u,v);this.beam(new Vector3(u,y,v),new Vector3(u,y+9,v),.065,'metal',true);
    for(const [dy,color]of [[0,0x159fcb],[-.4,0xf4f2e6],[-.8,0x319c56]]){
      const key=`flag${color}`;this.materials[key]??=new MeshStandardMaterial({color:color!,side:DoubleSide,roughness:1});
      this.box(u+1,y+8.5+dy!,v,2,.4,.018,key);
    }
  }
  private planting(){
    const points:Array<{x:number;z:number;scale:number;shape:number;kind:number}>=[];
    const add=(u:number,v:number,scale:number,shape:number)=>{
      const p=this.basis.point(u,v),y=this.y(u,v);points.push({x:p.x,z:p.z,scale,shape:shape===1?3:shape,kind:0});
      this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(1,.16).setTranslation(u,y+1,v),this.body);
      if(shape===2)this.beam(new Vector3(u,y,v),new Vector3(u,y+1.1,v),.13,'white');
    };
    // Conifers frame the civic square; mature broadleaf trees shelter the approach roads.
    for(let v=25;v<160;v+=11)add(43+(v-30)*.035,v,.52,1);
    for(let v=20;v<153;v+=13)add(-55,v,.42,1);
    for(let u=-73;u<30;u+=11)add(u,-33,.66,1);
    for(let v=-25;v<164;v+=12)add(-96,v,1.28+(Math.sin(v)*.12),2);
    for(const f of this.fountains)for(const side of [-1,1])for(const dz of [-8,8])add(f.u+side*9,f.v+dz,.28,1);
    for(const u of [23,29])for(const v of [-7,4])add(u,v,.62,1);
    return points;
  }
  update(dt:number,night:number){
    this.time=(this.time+Math.min(dt,.1))%1000;this.canopy.emissiveIntensity=night*.32;
    const p=this.jets.geometry.getAttribute('position');
    for(let i=0;i<p.count;i++){
      const f=this.fountains[i%this.fountains.length]!,t=(this.time*.6+i*.61803398875)%1,a=i*2.39996;
      const r=.15+t*2.2;p.setXYZ(i,f.u+Math.cos(a)*r,f.y+.3+Math.sin(t*Math.PI)*(i%5===0?9:6),f.v+Math.sin(a)*r);
    }
    p.needsUpdate=true;
  }
  dispose(){
    if(this.trees){for(const m of this.trees.meshes)m.removeFromParent();disposeTrees(this.trees);}
    this.furniture.removeFromParent();disposeCityDetails(this.furniture);
    this.group.traverse(n=>{if(n instanceof Mesh||n instanceof Points)n.geometry.dispose();});
    for(const m of Object.values(this.materials))m.dispose();this.jets.material.dispose();
    this.physics.world.removeRigidBody(this.body);this.group.clear();
  }
}
