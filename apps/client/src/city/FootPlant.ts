import { Bone, Quaternion, Vector3, type Object3D } from 'three';

interface Leg {
  upper: Bone; lower: Bone; foot: Bone;
  soleOffset: number;
  heel: Vector3; toe: Vector3;
  anchor: Vector3; previousLocal: Vector3;
  planted: boolean; weight: number; initialized: boolean;
}

/** Keep a support foot in world space while the captured swing leg stays free. */
export class FootPlant {
  private legs: Leg[] = [];
  constructor(private object: Object3D) {
    object.updateMatrixWorld(true);
    for(const side of ['L','R']){
      const upper=object.getObjectByName(`UpperLeg_${side}`),lower=object.getObjectByName(`LowerLeg_${side}`),foot=object.getObjectByName(`Foot_${side}`);
      if(!(upper instanceof Bone)||!(lower instanceof Bone)||!(foot instanceof Bone))continue;
      const point=foot.getWorldPosition(new Vector3());
      const origin=object.getWorldPosition(new Vector3()),forward=new Vector3(0,0,1).applyQuaternion(object.getWorldQuaternion(new Quaternion()));
      const heel=point.clone().addScaledVector(forward,-.06),toe=point.clone().addScaledVector(forward,.17);heel.y=toe.y=origin.y+.01;
      this.legs.push({upper,lower,foot,soleOffset:Math.max(.03,point.y-origin.y),heel:foot.worldToLocal(heel),toe:foot.worldToLocal(toe),anchor:new Vector3(),previousLocal:new Vector3(),planted:false,weight:0,initialized:false});
    }
  }

  reset(): void { for(const leg of this.legs){leg.planted=false;leg.weight=0;leg.initialized=false;} }

  update(dt: number, groundHeight: (x:number,z:number)=>number): void {
    this.object.updateMatrixWorld(true);
    for(const leg of this.legs){
      const animated=leg.foot.getWorldPosition(new Vector3()),local=this.object.worldToLocal(animated.clone());
      const heel=leg.foot.localToWorld(leg.heel.clone()),toe=leg.foot.localToWorld(leg.toe.clone());
      const clearance=Math.min(heel.y-groundHeight(heel.x,heel.z),toe.y-groundHeight(toe.x,toe.z));
      const forwardVelocity=leg.initialized?(local.z-leg.previousLocal.z)/Math.max(.001,dt):0;
      const support=clearance<.045&&forwardVelocity<.12;
      leg.previousLocal.copy(local);leg.initialized=true;
      if(support&&!leg.planted){leg.anchor.copy(animated);leg.planted=true;}
      leg.anchor.y=animated.y-clearance;
      if(!support||animated.distanceTo(leg.anchor)>.22)leg.planted=false;
      leg.weight+=(Number(leg.planted)-leg.weight)*(1-Math.exp(-48*dt));
      if(leg.weight<.015)continue;
      const target=animated.clone().lerp(leg.anchor,leg.weight);
      const start=leg.upper.getWorldPosition(new Vector3()),knee=leg.lower.getWorldPosition(new Vector3());
      const l1=start.distanceTo(knee),l2=knee.distanceTo(animated),direction=target.clone().sub(start);
      const distance=Math.min(l1+l2-.001,Math.max(.001,direction.length()));direction.normalize();
      const along=(l1*l1-l2*l2+distance*distance)/(2*distance),bend=knee.clone().sub(start);
      bend.addScaledVector(direction,-bend.dot(direction));
      if(bend.lengthSq()<1e-6)bend.set(0,0,1).applyQuaternion(this.object.getWorldQuaternion(new Quaternion())).addScaledVector(direction,-direction.z);
      const joint=start.clone().addScaledVector(direction,along).addScaledVector(bend.normalize(),Math.sqrt(Math.max(0,l1*l1-along*along)));
      const orientation=leg.foot.getWorldQuaternion(new Quaternion());
      this.aim(leg.upper,leg.lower,joint);this.aim(leg.lower,leg.foot,target);
      // Preserve the animated heel/toe roll while stabilizing the ankle.
      leg.foot.quaternion.copy(leg.foot.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(orientation));
      leg.foot.updateWorldMatrix(false,true);
    }
  }

  private aim(bone: Bone, child: Bone, target: Vector3): void {
    const start=bone.getWorldPosition(new Vector3()),from=child.getWorldPosition(new Vector3()).sub(start).normalize(),to=target.clone().sub(start).normalize();
    const q=new Quaternion().setFromUnitVectors(from,to).multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(q));bone.updateWorldMatrix(false,true);
  }
}
