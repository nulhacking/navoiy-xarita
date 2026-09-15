import { Group, Vector3, type Object3D } from 'three';
import { RAPIER, type Physics } from './Physics.ts';
import type { VehicleClaim } from './Player.ts';
import { vehicleSpec } from './FleetAssets.ts';
import { updateModelLOD } from './ModelLOD.ts';

/** Released vehicles keep their exact mesh, paint, pose and a physical obstacle. */
export class ParkedVehicles {
  readonly group=new Group();
  private entries:Array<{vehicle:VehicleClaim;body:RAPIER.RigidBody}>=[];
  constructor(private physics:Physics){}
  add(vehicle:VehicleClaim):void {
    if(!vehicle.object)return;
    const spec=vehicleSpec(vehicle.object),p=vehicle.position;
    vehicle.object.position.set(p.x,p.y-spec.half.y,p.z);vehicle.object.rotation.set(0,vehicle.yaw,0);
    this.group.add(vehicle.object);
    const body=this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x,p.y,p.z).setRotation({x:0,y:Math.sin(vehicle.yaw/2),z:0,w:Math.cos(vehicle.yaw/2)}));
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(spec.half.x,spec.half.y,spec.half.z),body);
    this.entries.push({vehicle:{...vehicle,position:p.clone(),speed:0},body});
    this.physics.world.updateSceneQueries();
  }
  nearestDistance(p:Vector3,radius:number):number|null {
    let best=radius,found=false;for(const e of this.entries){const d=Math.hypot(p.x-e.vehicle.position.x,p.z-e.vehicle.position.z);if(d<best){best=d;found=true;}}
    return found?best:null;
  }
  claim(p:Vector3,radius:number):VehicleClaim|null {
    let best=radius,nearest:(typeof this.entries)[number]|undefined;
    for(const e of this.entries){const d=Math.hypot(p.x-e.vehicle.position.x,p.z-e.vehicle.position.z);if(d<best){best=d;nearest=e;}}
    if(!nearest)return null;
    this.physics.world.removeRigidBody(nearest.body);nearest.vehicle.object?.removeFromParent();
    this.entries=this.entries.filter(e=>e!==nearest);return nearest.vehicle;
  }
  get snapshot(){return this.entries.map(e=>({id:e.vehicle.object?.uuid,kind:vehicleSpec(e.vehicle.object as Object3D).kind,position:e.vehicle.position}));}
  updateDetail(point:Vector3):void {
    for(const {vehicle} of this.entries)if(vehicle.object)updateModelLOD(vehicle.object,(point.x-vehicle.position.x)**2+(point.z-vehicle.position.z)**2);
  }
  dispose():void {for(const e of this.entries)this.physics.world.removeRigidBody(e.body);this.entries=[];this.group.clear();}
}
