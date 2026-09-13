import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityFrame } from './CityFrame.ts';
import type { Ground } from './Ground.ts';
import { Physics, RAPIER } from './Physics.ts';
import { referencePoint } from './LakeReference.ts';

/** Authored park structures. Locations follow visual references; heights and construction
 * details are estimates. Static parts are merged per material rather than one draw per bar.
 */
export class ParkLandmarks {
  readonly group=new Group();
  readonly clearings:Array<{x:number;z:number;radius:number}>=[];
  private readonly parts=new Map<number,BufferGeometry[]>();
  private readonly body:RAPIER.RigidBody;
  constructor(private frame:CityFrame,private ground:Ground,private physics:Physics) {
    this.group.name='Ozero · reference park structures';
    this.body=physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.wheel(614,999);
    this.carousel(452,892);
    this.pergola(496,855,17,4);
    this.pergola(733,745,20,4);
    this.exerciseCourt(586,518);
    for(const [x,y] of [[623,315],[653,385],[679,451],[728,533]])this.rosette(x!,y!);
    for(const [color,parts] of this.parts){
      const geometry=mergeGeometries(parts)!;for(const p of parts)p.dispose();
      const material=new MeshStandardMaterial({color,roughness:color===0xc0c6c4?.38:.82,metalness:color===0xc0c6c4?.65:0});
      const mesh=new Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh);
    }
    this.parts.clear();
  }
  private point(x:number,y:number){const p=referencePoint(this.frame,x,y);p.y=this.ground.heightAt(p.x,p.z);return p;}
  private add(geometry:BufferGeometry,color:number){
    const g=geometry.index?geometry.toNonIndexed():geometry.clone();geometry.dispose();g.deleteAttribute('uv');
    const bucket=this.parts.get(color)??[];bucket.push(g);this.parts.set(color,bucket);
  }
  private box(p:Vector3,w:number,h:number,d:number,color:number){
    this.add(new BoxGeometry(w,h,d).translate(p.x,p.y,p.z),color);
  }
  private beam(a:Vector3,b:Vector3,r:number,color:number,collision=false){
    const d=b.clone().sub(a),length=d.length(),q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),d.normalize()),p=a.clone().add(b).multiplyScalar(.5);
    this.add(new CylinderGeometry(r,r,length,8).applyQuaternion(q).translate(p.x,p.y,p.z),color);
    if(collision)this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(length/2,r).setTranslation(p.x,p.y,p.z).setRotation(q),this.body);
  }
  private reserve(p:Vector3,radius:number){this.clearings.push({x:p.x,z:p.z,radius});}
  private wheel(x:number,y:number){
    const base=this.point(x,y),hub=base.clone().add(new Vector3(0,18,0)),radius=14;
    this.reserve(base,18);
    for(const z of [-2,2]){
      this.add(new TorusGeometry(radius,.18,6,72).translate(hub.x,hub.y,hub.z+z),0xc0c6c4);
      for(const side of [-1,1])this.beam(base.clone().add(new Vector3(side*7,0,z*2)),hub.clone().add(new Vector3(0,0,z)),.38,0xb1b7ab,true);
    }
    for(let i=0;i<14;i++){
      const a=i/14*Math.PI*2,p=hub.clone().add(new Vector3(Math.cos(a)*radius,Math.sin(a)*radius,0));
      for(const z of [-2,2])this.beam(hub.clone().add(new Vector3(0,0,z)),p.clone().add(new Vector3(0,0,z)),.07,0xc0c6c4);
      this.beam(p.clone().add(new Vector3(0,0,-2)),p.clone().add(new Vector3(0,0,2)),.1,0xc0c6c4);
      this.box(p.clone().add(new Vector3(0,-1.6,0)),1.7,.55,1.8,i%2?0x648e92:0xccc5af);
      this.box(p.clone().add(new Vector3(0,-.05,0)),2,.12,2.1,0xadb6ad);
      for(const dx of [-.75,.75])for(const dz of [-.75,.75])this.beam(p.clone().add(new Vector3(dx,-1.5,dz)),p.clone().add(new Vector3(dx,-.15,dz)),.035,0xc0c6c4);
    }
  }
  private carousel(x:number,y:number){
    const p=this.point(x,y);this.reserve(p,11);
    this.add(new CylinderGeometry(8.5,8.5,.18,40).translate(p.x,p.y+.09,p.z),0xb8ad92);
    this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(.09,8.5).setTranslation(p.x,p.y+.09,p.z),this.body);
    this.add(new CylinderGeometry(.2,9,2.4,16).translate(p.x,p.y+5.8,p.z),0x9b5344);
    this.beam(p,p.clone().add(new Vector3(0,6,0)),.34,0xc0c6c4,true);
    for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2,q=p.clone().add(new Vector3(Math.cos(a)*5.8,0,Math.sin(a)*5.8));
      this.beam(q.clone().add(new Vector3(0,.18,0)),q.clone().add(new Vector3(0,5,0)),.06,0xc0c6c4,true);
      this.box(q.clone().add(new Vector3(0,.75,0)),.8,.22,1.1,0x648e92);
    }
  }
  private pergola(x:number,y:number,length:number,width:number){
    const p=this.point(x,y);this.reserve(p,length/2+2);
    for(let i=0;i<=4;i++)for(const side of [-1,1]){
      const a=p.clone().add(new Vector3(-length/2+i*length/4,0,side*width/2));a.y=this.ground.heightAt(a.x,a.z);
      this.beam(a,a.clone().setY(p.y+3.2),.13,0x9c9680,true);
    }
    for(let i=0;i<=20;i++)this.box(p.clone().add(new Vector3(-length/2+i*length/20,3.25,0)),.13,.17,width+1,0xb7af91);
    for(const side of [-1,1])this.box(p.clone().add(new Vector3(0,3.1,side*width/2)),length+.5,.25,.2,0x9c9680);
  }
  private exerciseCourt(x:number,y:number){
    const p=this.point(x,y);this.reserve(p,15);
    // Only equipment here: ground remains terrain-conforming and walkable.
    for(let i=0;i<4;i++){
      const a=p.clone().add(new Vector3(-5+i*3,0,-3)),b=a.clone().add(new Vector3(0,0,3));
      a.y=this.ground.heightAt(a.x,a.z);b.y=this.ground.heightAt(b.x,b.z);
      const top=Math.max(a.y,b.y)+2.3;
      this.beam(a,a.clone().setY(top),.055,0x4a5551,true);this.beam(b,b.clone().setY(top),.055,0x4a5551,true);
      this.beam(a.clone().setY(top),b.clone().setY(top),.04,0xc0c6c4);
    }
  }
  private rosette(x:number,y:number){
    const p=this.point(x,y);this.reserve(p,13);
    // Flush pale/dark paving lobes seen in the eastern axial promenade.
    for(let i=0;i<5;i++){
      const a=i/5*Math.PI*2,q=p.clone().add(new Vector3(Math.cos(a)*3.4,0,Math.sin(a)*3.4));q.y=this.ground.heightAt(q.x,q.z)+.008;
      this.add(new CylinderGeometry(2.1,2.1,.016,20).translate(q.x,q.y,q.z),0x9b998c);
    }
  }
  dispose(){
    this.group.traverse(n=>{if(n instanceof Mesh){n.geometry.dispose();(n.material as MeshStandardMaterial).dispose();}});
    this.physics.world.removeRigidBody(this.body);this.group.clear();
  }
}
