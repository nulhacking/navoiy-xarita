import { BoxGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { Ground } from './Ground.ts';
import type { PointXZ, RoadEdge } from './RoadNetwork.ts';
import { signalPhase, signalStops } from './SignalRules.ts';

export class TrafficSignals {
  readonly group = new Group();
  private stops = new Map<string, number[]>();
  private heads: Array<{ edge: RoadEdge; lampIndex: number; phase?: string }> = [];
  private time = 0;
  private pole = new CylinderGeometry(.07,.09,3.4,8);
  private housing = new BoxGeometry(.42,1.15,.27);
  private lens = new SphereGeometry(.13,10,6);
  private stripe = new BoxGeometry(.5,.015,2.4);
  private dark = new MeshStandardMaterial({ color:0x22272b, roughness:.7 });
  private paint = new MeshStandardMaterial({ color:0xdddccf, roughness:1 });
  private lensMaterial = new MeshBasicMaterial({ color:0xffffff });
  constructor(private ground: Ground, private points: PointXZ[]) {}

  setRoads(edges: RoadEdge[]): void {
    this.group.clear(); this.heads = [];
    this.stops = signalStops(edges,this.points);
    const items:Array<{edge:RoadEdge;x:number;y:number;z:number;yaw:number;width:number}>=[];
    for (const edge of edges) for (const distance of this.stops.get(edge.key) ?? []) {
      const dx = (edge.b.x-edge.a.x)/edge.length, dz = (edge.b.z-edge.a.z)/edge.length;
      const x = edge.a.x+dx*(distance+3), z = edge.a.z+dz*(distance+3);
      const right = edge.width/2+.4;
      const px=x-dz*right,pz=z+dx*right;
      items.push({edge,x:px,y:this.ground.heightAt(px,pz),z:pz,yaw:Math.atan2(dx,dz),width:edge.width});
    }
    const poles=new InstancedMesh(this.pole,this.dark,items.length), housings=new InstancedMesh(this.housing,this.dark,items.length);
    const stripesPerItem=items.map(item=>Math.max(0,Math.ceil(item.width-.5)));
    const stripes=new InstancedMesh(this.stripe,this.paint,stripesPerItem.reduce((a,b)=>a+b,0));
    const lamps=new InstancedMesh(this.lens,this.lensMaterial,items.length*3);
    const matrix=new Matrix4(), quaternion=new Quaternion(), position=new Vector3(), scale=new Vector3(1,1,1), up=new Vector3(0,1,0);
    let stripeIndex=0;
    items.forEach((item,index)=>{
      quaternion.setFromAxisAngle(up,item.yaw);
      matrix.compose(position.set(item.x,item.y+1.7,item.z),quaternion,scale);poles.setMatrixAt(index,matrix);
      matrix.compose(position.set(item.x-Math.sin(item.yaw)*.12,item.y+3.2,item.z-Math.cos(item.yaw)*.12),quaternion,scale);housings.setMatrixAt(index,matrix);
      this.heads.push({edge:item.edge,lampIndex:index*3});
      for(let i=0;i<3;i++){
        matrix.compose(position.set(item.x-Math.sin(item.yaw)*.3,item.y+3.55-i*.35,item.z-Math.cos(item.yaw)*.3),quaternion,scale);
        lamps.setMatrixAt(index*3+i,matrix);
      }
      const dx=Math.sin(item.yaw),dz=Math.cos(item.yaw),rightX=-dz,rightZ=dx;
      const roadX=item.x-rightX*(item.width/2+.4),roadZ=item.z-rightZ*(item.width/2+.4);
      for(let lateral=-item.width/2+.5;lateral<item.width/2;lateral+=1){
        const sx=roadX+rightX*lateral+dx*2;
        const sz=roadZ+rightZ*lateral+dz*2;
        matrix.compose(position.set(sx,this.ground.heightAt(sx,sz),sz),quaternion,scale);stripes.setMatrixAt(stripeIndex++,matrix);
      }
    });
    poles.castShadow=housings.castShadow=true;stripes.receiveShadow=true;
    this.group.add(poles,housings,stripes,lamps);
    this.lampMesh=lamps;
    this.update(0,{x:0,z:0});
  }
  private lampMesh:InstancedMesh|null=null;
  /** Distance to the next forbidden stop line (front bumper clearance already included). */
  stopDistance(edge: RoadEdge, progress: number): number {
    if(signalPhase(this.time,edge)==='green') return Infinity;
    const next = this.stops.get(edge.key)?.find(d=>d>=progress-.15);
    return next === undefined ? Infinity : Math.max(0,next-progress);
  }
  update(dt:number, _player:PointXZ):void {
    this.time+=dt;
    for(const head of this.heads) {
      const phase=signalPhase(this.time,head.edge);
      if(head.phase===phase)continue;head.phase=phase;
      [0xff3322,0xffae16,0x24ef72].forEach((bright,i)=>this.lampMesh?.setColorAt(head.lampIndex+i,
        new Color(['red','amber','green'][i]===phase?bright:0x121619)));
    }
    if(this.lampMesh?.instanceColor)this.lampMesh.instanceColor.needsUpdate=true;
  }
  get count():number {return this.heads.length;}
  dispose():void {
    this.group.clear(); this.heads=[];
    for(const item of [this.pole,this.housing,this.lens,this.stripe,this.dark,this.paint,this.lensMaterial]) item.dispose();
  }
}
