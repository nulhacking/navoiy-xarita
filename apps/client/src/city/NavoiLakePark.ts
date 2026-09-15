import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PointLight, ShapeUtils, Vector2, Vector3 } from 'three';
import type { CityFrame } from './CityFrame.ts';
import type { Ground } from './Ground.ts';
import type { CityMapData } from './CityTile.ts';
import { Physics, RAPIER } from './Physics.ts';
import { waterSurfaceLevel } from './WaterZones.ts';
import { insidePolygon } from './RoadNetwork.ts';
import { SpatialGrid } from './SpatialGrid.ts';
import { assetTrees } from './TreeAssets.ts';
import { disposeTrees, type TreeMeshes } from './trees.ts';
import { PARK_BEDS, plantingCandidates, referencePoint, type ReferenceXY } from './LakeReference.ts';
import { lakeWater } from './LakeWater.ts';
import { buildParkFurniture, disposeCityDetails } from './CityDetails.ts';
import { ParkLandmarks } from './ParkLandmarks.ts';
import { groundTexture, parkPavingTexture } from './SurfaceMaterials.ts';
import { QUALITY } from './Quality.ts';

/** OSM shoreline + satellite-reference park reconstruction. No map-image plane.
 * Landmark footprints are approximate; dimensions/heights are authored estimates.
 */
export class NavoiLakePark {
  readonly group=new Group();
  readonly map:CityMapData={roads:[],water:[],buildings:[],areas:[]};
  readonly outline:Vector2[];
  readonly level:number;
  private readonly water:ReturnType<typeof lakeWater>;
  private readonly surface:number[]=[];
  private readonly colors:number[]=[];
  private readonly solid:number[]=[];
  private readonly materials:MeshStandardMaterial[]=[];
  private trees:TreeMeshes|null=null;
  private readonly body:RAPIER.RigidBody;
  private readonly flag:Mesh<BufferGeometry,MeshStandardMaterial>;
  private time=0;
  private readonly lamps:Array<{x:number;z:number;yaw:number}>=[];
  private readonly furniture:Group;
  private readonly landmarks:ParkLandmarks;
  private readonly localLights=Array.from({length:4},()=>new PointLight(0xffd69a,0,27,2));

  constructor(private frame:CityFrame,private ground:Ground,private physics:Physics,ring:number[],maps:Iterable<CityMapData>) {
    this.group.name='Navoi Lake · reference park';
    this.outline=[];
    // The source closes the ring explicitly; do not triangulate its duplicate endpoint.
    for(let i=0;i<ring.length-2;i+=2){const p=frame.toLocal({lon:ring[i]!,lat:ring[i+1]!,alt:0});this.outline.push(new Vector2(p.x,p.z));}
    this.level=waterSurfaceLevel(this.outline.map(p=>ground.surfaceAt(p.x,p.y)));
    this.water=lakeWater(this.outline);
    const vertices:number[]=[];
    for(const [a,b,c] of ShapeUtils.triangulateShape(this.outline,[])) {
      const pts=[a!,b!,c!].map(i=>this.outline[i]!);
      this.upTriangle(vertices,...pts.map(p=>new Vector3(p.x,this.level+.026,p.y)) as [Vector3,Vector3,Vector3]);
    }
    const waterMesh=new Mesh(this.geometry(vertices),this.water.material);waterMesh.name='NavoiLakeWater';waterMesh.receiveShadow=true;this.group.add(waterMesh);

    this.shoreline();
    // Northern monument and flagpole axes, rings, and the eastern promenade.
    this.circle(465,128,18,0,0xc4baa7);this.circle(465,128,56,3.3,0xc8c1b2);
    for(const [x,y] of [[390,65],[525,40],[561,171],[421,215],[379,153],[547,100]])this.path([[465,128],[x!,y!]],4.5);
    this.circle(462,300,19,0,0xcbb695);
    this.circle(462,300,31,3,0xd3ccba);this.circle(462,300,43,3,0xc8c1b2);
    this.path([[416,224],[476,419]],7);this.path([[443,246],[560,209]],5);
    this.path([[447,312],[593,265]],5);this.path([[480,429],[625,378]],5);
    this.path([[602,240],[626,315],[655,387],[691,463],[725,528],[775,605]],6);
    for(const [x,y] of [[623,315],[653,385],[679,451],[728,533]])this.circle(x!,y!,10,3,0xd0c6b3);
    this.path([[519,518],[555,521],[613,525],[656,515],[713,486]],6);
    this.path([[609,538],[688,602],[747,569]],4);
    this.path([[486,863],[573,890],[634,938],[697,920],[762,866]],4.5);
    this.path([[446,1018],[521,951],[573,890]],4);
    // Perimeter walks and diagonals visible in the northern and southern park images.
    this.path([[366,77],[522,24],[576,184],[420,237],[366,77]],5);
    this.path([[430,253],[572,205],[630,382],[476,437],[430,253]],4);
    this.path([[407,869],[446,1018],[458,1084],[646,1024],[788,971]],5);
    this.path([[486,863],[522,949],[565,981],[646,1024]],4);
    this.path([[446,1018],[567,976],[641,935],[753,892]],5);
    this.path([[522,949],[575,921],[618,927],[641,935],[667,1008]],4);
    this.path([[567,976],[586,1010],[610,1040]],3);
    this.path([[646,1024],[626,980],[641,935],[619,864]],4);
    this.path([[697,920],[710,955],[754,939],[762,866]],3);
    for(const [x,y,r] of [[446,1018,12],[641,935,13],[614,999,20],[452,892,14]])this.circle(x!,y!,r!,0,0xc1bbaa);
    this.amphitheatre(657,515);
    this.body=physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.flag=this.flagpole(462,300);
    this.landmarks=new ParkLandmarks(frame,ground,physics);this.group.add(this.landmarks.group);
    // The source images show small piers along the south shore.
    this.pier(469,776,458,792);this.pier(591,824,588,805);this.pier(707,778,687,776);
    const surfaceMesh=new Mesh(this.geometry(this.surface,this.colors),new MeshStandardMaterial({map:parkPavingTexture(),vertexColors:true,side:DoubleSide,roughness:.88,bumpMap:parkPavingTexture(),bumpScale:.018,polygonOffset:true,polygonOffsetFactor:-12,polygonOffsetUnits:-36}));
    // Ground overlays must not cast a second near-coplanar terrain shadow (striped acne).
    surfaceMesh.name='Ozero · embankment, paths, amphitheatre';surfaceMesh.receiveShadow=true;surfaceMesh.castShadow=false;
    this.materials.push(surfaceMesh.material);this.group.add(surfaceMesh);
    if(this.solid.length){const indices=Uint32Array.from({length:this.solid.length/3},(_,i)=>i);physics.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(this.solid),indices).setFriction(.9),this.body);}
    this.gardenBeds();this.planting([...maps]);
    this.group.userData.reference='satellites.pro Apple imagery z17–19 + user screenshots; manual estimates';
    this.group.userData.parkBeds=PARK_BEDS.length;
    this.group.userData.landmarks=this.landmarks.clearings.length;
    this.furniture=buildParkFurniture(this.lamps,ground);this.group.add(this.furniture,...this.localLights);
  }

  private geometry(vertices:number[],colors?:number[]):BufferGeometry {
    const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array(vertices),3));
    const uv=new Float32Array(vertices.length/3*2);
    for(let i=0;i<vertices.length/3;i++){uv[i*2]=vertices[i*3]!/4;uv[i*2+1]=vertices[i*3+2]!/4;}
    g.setAttribute('uv',new BufferAttribute(uv,2));
    if(colors)g.setAttribute('color',new BufferAttribute(new Float32Array(colors),3));g.computeVertexNormals();return g;
  }
  private upTriangle(out:number[],a:Vector3,b:Vector3,c:Vector3) {
    if((b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z)<0)[b,c]=[c,b];
    out.push(...a.toArray(),...b.toArray(),...c.toArray());
  }
  private quad(a:Vector3,b:Vector3,c:Vector3,d:Vector3,color:number,collision=false) {
    const points=[...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...d.toArray()];
    // Faces are double-sided so sloped shoreline and risers work in either winding.
    this.surface.push(...points);const rgb=new Color(color);for(let i=0;i<6;i++)this.colors.push(rgb.r,rgb.g,rgb.b);
    if(collision)this.solid.push(...points);
  }
  private point(x:number,y:number,lift=0):Vector3 {
    const p=referencePoint(this.frame,x,y);p.y=this.ground.heightAt(p.x,p.z)+lift;return p;
  }
  private path(pixels:number[][],width:number,color=0xc1bbaa) {
    const points=pixels.map(p=>this.point(p[0]!,p[1]!));this.ribbon(points,width,color);
    this.map.roads.push({cls:'footway',width,pts:new Float32Array(points.flatMap(p=>[p.x,p.z]))});
  }
  private ribbon(points:Vector3[],width:number,color:number,flat?:number,collision=false) {
    for(let i=0;i<points.length-1;i++) {
      const a=points[i]!,b=points[i+1]!,len=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(len/2));
      const nx=-(b.z-a.z)/(len||1)*width/2,nz=(b.x-a.x)/(len||1)*width/2;
      const edge=(t:number,side:number)=>{const x=a.x+(b.x-a.x)*t+nx*side,z=a.z+(b.z-a.z)*t+nz*side;return new Vector3(x,flat??this.ground.heightAt(x,z),z);};
      for(let j=0;j<steps;j++)this.quad(edge(j/steps,-1),edge(j/steps,1),edge((j+1)/steps,1),edge((j+1)/steps,-1),color,collision);
    }
  }
  private circle(x:number,y:number,radiusPixels:number,width:number,color:number) {
    const points:Vector3[]=[];
    for(let i=0;i<=96;i++){const a=i/96*Math.PI*2;points.push(this.point(x+Math.cos(a)*radiusPixels,y+Math.sin(a)*radiusPixels));}
    if(width)this.ribbon(points,width,color);
    else {
      const center=this.point(x,y);
      for(let i=0;i<96;i++)this.groundTriangle(center,points[i]!,points[i+1]!,color);
    }
    const pts=new Float32Array(points.flatMap(p=>[p.x,p.z]));
    if(width)this.map.roads.push({cls:'footway',width,pts});
    else this.map.areas.push({cls:'parking',pts});
  }
  private groundTriangle(a:Vector3,b:Vector3,c:Vector3,color:number,depth=0):void {
    if(depth<7&&Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>4){
      const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);
      this.groundTriangle(a,ab,ca,color,depth+1);this.groundTriangle(ab,b,bc,color,depth+1);
      this.groundTriangle(ca,bc,c,color,depth+1);this.groundTriangle(ab,bc,ca,color,depth+1);return;
    }
    this.upTriangle(this.surface,...[a,b,c].map(p=>new Vector3(p.x,this.ground.heightAt(p.x,p.z),p.z)) as [Vector3,Vector3,Vector3]);
    const rgb=new Color(color);for(let i=0;i<3;i++)this.colors.push(rgb.r,rgb.g,rgb.b);
  }
  private shoreline() {
    const ring=this.outline,n=ring.length;
    let area=0;for(let i=0;i<n;i++){const a=ring[i]!,b=ring[(i+1)%n]!;area+=a.x*b.y-b.x*a.y;}
    const offsets=ring.map((p,i)=>{
      const a=ring[(i+n-1)%n]!,b=ring[(i+1)%n]!;
      const v1=p.clone().sub(a).normalize(),v2=b.clone().sub(p).normalize();
      const normal=new Vector2(v1.y+v2.y,-v1.x-v2.x).normalize().multiplyScalar(Math.sign(area));
      const edgeNormal=new Vector2(v2.y,-v2.x).multiplyScalar(Math.sign(area));
      return normal.multiplyScalar(1/Math.max(.65,normal.dot(edgeNormal)));
    });
    const at=(i:number,d:number)=>{const p=ring[i]!,o=offsets[i]!;return new Vector3(p.x+o.x*d,0,p.y+o.y*d);};
    // Sloped pale stone bank, then a terrain-conforming walk. No coplanar duplicate water.
    for(let i=0;i<n;i++) {
      const j=(i+1)%n,a=at(i,0),b=at(j,0),c=at(j,7),d=at(i,7);
      const steps=Math.max(1,Math.ceil(a.distanceTo(b)/3));
      for(let k=0;k<steps;k++) {
        const innerA=a.clone().lerp(b,k/steps),innerB=a.clone().lerp(b,(k+1)/steps);
        const outerA=d.clone().lerp(c,k/steps),outerB=d.clone().lerp(c,(k+1)/steps);
        innerA.y=innerB.y=this.level+.07;
        outerA.y=this.ground.heightAt(outerA.x,outerA.z);outerB.y=this.ground.heightAt(outerB.x,outerB.z);
        this.quad(innerA,innerB,outerB,outerA,0xc2bca6,true);
      }
    }
    const walk=ring.map((_,i)=>at(i,11));walk.push(walk[0]!.clone());this.ribbon(walk,5,0xb4b2a8);
    this.map.roads.push({cls:'footway',width:5,pts:new Float32Array(walk.flatMap(p=>[p.x,p.z]))});
    // Even arc-length spacing avoids a cluster of lamps at densely sampled corners.
    let next=15,total=0;
    for(let i=0;i<n;i++) {
      const a=at(i,15),b=at((i+1)%n,15),length=a.distanceTo(b);
      while(next<total+length){const p=a.clone().lerp(b,(next-total)/(length||1));this.lamps.push({x:p.x,z:p.z,yaw:Math.atan2(ring[i]!.x-p.x,ring[i]!.y-p.z)});next+=32;}
      total+=length;
    }
  }
  private amphitheatre(x:number,y:number) {
    const p=this.point(x,y),base=p.y+.12,start=-2.1,end=2.1;
    const at=(radius:number,angle:number,height:number)=>new Vector3(p.x+Math.cos(angle)*radius,base+height,p.z+Math.sin(angle)*radius);
    // Horseshoe opens west toward the lake, with alternating pale risers and dark seats.
    for(let row=0;row<11;row++)for(let i=0;i<64;i++) {
      const a=start+(end-start)*i/64,b=start+(end-start)*(i+1)/64,r=12+row*1.15,h=row*.4;
      this.quad(at(r,a,h),at(r,b,h),at(r+1.15,b,h),at(r+1.15,a,h),row%3===0?0x8d898b:0xc6bcb0,true);
      this.quad(at(r+1.15,a,h),at(r+1.15,b,h),at(r+1.15,b,h+.4),at(r+1.15,a,h+.4),0xd4cbbb,true);
    }
    for(let i=0;i<64;i++)this.quad(p.clone().setY(base),at(10,i/64*Math.PI*2,0),at(10,(i+1)/64*Math.PI*2,0),p.clone().setY(base),0xbeb4a0,true);
    this.map.areas.push({cls:'parking',pts:new Float32Array(Array.from({length:64},(_,i)=>{const v=at(25,i/64*Math.PI*2,0);return[v.x,v.z];}).flat())});
  }
  private flagpole(x:number,y:number):Mesh<BufferGeometry,MeshStandardMaterial> {
    const p=this.point(x,y),material=new MeshStandardMaterial({color:0xd3d4ce,metalness:.65,roughness:.3});this.materials.push(material);
    const pole=new Mesh(new CylinderGeometry(.16,.3,38,12),material);pole.position.copy(p).add(new Vector3(0,19,0));pole.castShadow=true;this.group.add(pole);
    this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(19,.3).setTranslation(p.x,p.y+19,p.z),this.body);
    const vertices:number[]=[],colors:number[]=[];
    for(let row=0;row<16;row++)for(let col=0;col<32;col++) {
      const color=row<5?0x21a7d7:row===5||row===10?0xc7393f:row<10?0xf0efe6:0x219a64;
      const c=new Color(color);
      for(const [dx,dy] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]){vertices.push((col+dx!)/32*7,36-(row+dy!)/16*3.5,0);colors.push(c.r,c.g,c.b);}
    }
    const flagMaterial=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:1});this.materials.push(flagMaterial);
    const flag=new Mesh(this.geometry(vertices,colors),flagMaterial);flag.position.copy(p);flag.name='Reference flagpole · animated cloth';flag.castShadow=true;this.group.add(flag);return flag;
  }
  private pier(x:number,y:number,x2:number,y2:number) {
    const a=this.point(x,y),b=this.point(x2,y2),level=Math.max(this.level+.3,a.y);
    this.ribbon([a,b],2.2,0xa69b81,level,true);
  }
  private planting(maps:CityMapData[]) {
    // Barcha yuklangan tayllarning to'siq va yo'llari to'rga — har nomzod faqat o'z katagini tekshiradi.
    const obstacles=new SpatialGrid<Float32Array>(32);
    for(const ring of [...maps.flatMap(m=>[...m.buildings,...m.water,...m.areas.filter(a=>a.cls==='pitch'||a.cls==='parking').map(a=>a.pts)]),...this.map.areas.filter(a=>a.cls==='parking'||a.cls==='pitch').map(a=>a.pts)])obstacles.insertRing(ring,ring);
    type Edge={ax:number;az:number;dx:number;dz:number;reach:number};
    const roads=new SpatialGrid<Edge>(32);
    for(const road of [...maps.flatMap(m=>m.roads),...this.map.roads]){
      for(let i=0;i<road.pts.length-2;i+=2){const ax=road.pts[i]!,az=road.pts[i+1]!,dx=road.pts[i+2]!-ax,dz=road.pts[i+3]!-az,reach=road.width/2+2.5;
        roads.insert({ax,az,dx,dz,reach},Math.min(ax,ax+dx)-reach,Math.min(az,az+dz)-reach,Math.max(ax,ax+dx)+reach,Math.max(az,az+dz)+reach);}
    }
    const points:Array<{x:number;z:number;scale:number;kind:number;shape:number}>=[];
    for(const bed of PARK_BEDS) {
      for(const {x,y,scale,shape} of plantingCandidates(bed)) {
        const p=this.point(x,y);
        if(obstacles.query(p.x,p.z).some(r=>insidePolygon(p,r))||this.ground.water.contains(p,5))continue;
        if(this.landmarks.clearings.some(c=>Math.hypot(p.x-c.x,p.z-c.z)<c.radius))continue;
        if(roads.query(p.x,p.z).some(({ax,az,dx,dz,reach})=>{
          const t=Math.max(0,Math.min(1,((p.x-ax)*dx+(p.z-az)*dz)/(dx*dx+dz*dz||1)));
          return Math.hypot(p.x-ax-dx*t,p.z-az-dz*t)<reach;
        }))continue;
        points.push({x:p.x,z:p.z,scale,kind:0,shape});
      }
    }
    const meshes=assetTrees(points,(x,z)=>this.ground.heightAt(x,z));
    if(meshes){
      // The park is a focal location: retain the leaf-textured assets across its courtyards.
      for(const lod of meshes)if(lod.levels[1])lod.levels[1].distance=QUALITY.treeDetail(550);
      this.trees={meshes,count:points.length,sharedAssets:true};this.group.add(...meshes);
    }
    this.group.userData.treeCount=points.length;
  }
  private gardenBeds() {
    const positions:number[]=[],colors:number[]=[];
    const fill=(ring:readonly ReferenceXY[],color:number)=>{
      const pts=ring.map(([x,y])=>{const p=referencePoint(this.frame,x,y);return new Vector2(p.x,p.z);}),rgb=new Color(color);
      const emit=(a:Vector2,b:Vector2,c:Vector2,depth=0):void=>{
        if(depth<7&&Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>7){
          const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);
          emit(a,ab,ca,depth+1);emit(ab,b,bc,depth+1);emit(ca,bc,c,depth+1);emit(ab,bc,ca,depth+1);return;
        }
        this.upTriangle(positions,...[a,b,c].map(p=>new Vector3(p.x,this.ground.heightAt(p.x,p.y),p.y)) as [Vector3,Vector3,Vector3]);
        for(let i=0;i<3;i++)colors.push(rgb.r,rgb.g,rgb.b);
      };
      for(const [a,b,c] of ShapeUtils.triangulateShape(pts,[]))emit(pts[a!]!,pts[b!]!,pts[c!]!);
      this.map.areas.push({cls:'grass',pts:new Float32Array(pts.flatMap(p=>[p.x,p.y]))});
    };
    for(const bed of PARK_BEDS)fill(bed.ring,bed.color);
    const material=new MeshStandardMaterial({map:groundTexture(),vertexColors:true,roughness:1,side:DoubleSide,polygonOffset:true,polygonOffsetFactor:-4.5,polygonOffsetUnits:-13.5});
    const mesh=new Mesh(this.geometry(positions,colors),material);mesh.name='Ozero · distinct planted beds';mesh.receiveShadow=true;
    this.materials.push(material);this.group.add(mesh);
  }
  update(dt:number,night=0,viewer?:{x:number;z:number}) {
    this.water.update(dt);this.time+=Math.min(dt,.1);
    const nearest=viewer&&night>.01?[...this.lamps].sort((a,b)=>Math.hypot(a.x-viewer.x,a.z-viewer.z)-Math.hypot(b.x-viewer.x,b.z-viewer.z)):[];
    this.localLights.forEach((light,i)=>{
      const p=nearest[i];light.intensity=p?85*night:0;
      if(p)light.position.set(p.x,this.ground.heightAt(p.x,p.z)+6.6,p.z);
    });
    const pos=this.flag.geometry.getAttribute('position');
    for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i);pos.setZ(i,Math.sin(x*1.5-this.time*2.4+y)*.28*x/7);}
    pos.needsUpdate=true;this.flag.geometry.computeVertexNormals();
  }
  dispose() {
    this.group.remove(this.furniture);disposeCityDetails(this.furniture);
    this.group.remove(this.landmarks.group);this.landmarks.dispose();
    if(this.trees){for(const mesh of this.trees.meshes)this.group.remove(mesh);disposeTrees(this.trees);}
    this.group.traverse(n=>{if(n instanceof Mesh&&!n.name.includes('Tree'))n.geometry.dispose();});
    for(const m of this.materials)m.dispose();this.water.dispose();this.physics.world.removeRigidBody(this.body);this.group.clear();
  }
}
