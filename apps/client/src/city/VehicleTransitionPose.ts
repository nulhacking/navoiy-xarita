import { Bone, Quaternion, Vector3, type Object3D } from 'three';

/** Step one foot through the door before the other, instead of unfolding both
 * knees through the floor while the whole seated pose slides sideways. */
export class VehicleTransitionPose {
  private readonly legs: Array<{ side: string; upper: Bone; lower: Bone; foot: Bone; standing: Vector3 }> = [];
  constructor(private avatar: Object3D) {
    avatar.updateMatrixWorld(true);
    for (const side of ['L','R']) {
      const upper=avatar.getObjectByName(`UpperLeg_${side}`),lower=avatar.getObjectByName(`LowerLeg_${side}`),foot=avatar.getObjectByName(`Foot_${side}`);
      if (upper instanceof Bone && lower instanceof Bone && foot instanceof Bone)
        this.legs.push({side,upper,lower,foot,standing:avatar.worldToLocal(foot.getWorldPosition(new Vector3()))});
    }
  }

  apply(rider: Object3D, outside: Vector3, progress: number, side: number, yaw: number): void {
    if(progress<=0 || progress>=1)return;
    const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw);
    this.avatar.updateMatrixWorld(true);rider.updateMatrixWorld(true);
    for(const leg of this.legs){
      const source=rider.getObjectByName(`Foot_${leg.side}`);if(!source)continue;
      const leading=(leg.side==='L')===(side>0);
      const phase=Math.max(0,Math.min(1,(progress-(leading?.10:.28))/(leading?.46:.48)));
      const blend=phase*phase*(3-2*phase);
      const target=source.getWorldPosition(new Vector3()).lerp(leg.standing.clone().applyQuaternion(rotation).add(outside),blend);
      target.y+=.13*Math.sin(Math.PI*phase);
      const start=leg.upper.getWorldPosition(new Vector3()),knee=leg.lower.getWorldPosition(new Vector3()),ankle=leg.foot.getWorldPosition(new Vector3());
      const a=start.distanceTo(knee),b=knee.distanceTo(ankle),direction=target.clone().sub(start);
      const distance=Math.max(.001,Math.min(a+b-.001,direction.length()));direction.normalize();
      const along=(a*a-b*b+distance*distance)/(2*distance);
      const bend=new Vector3(0,.15,1).applyQuaternion(rotation);bend.addScaledVector(direction,-bend.dot(direction)).normalize();
      const joint=start.clone().addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-along*along)));
      // Fade the IK away before either handoff to preserve the exact source pose.
      const weight=Math.min(1,progress*10,(1-progress)*10);
      const upper=leg.upper.quaternion.clone(),lower=leg.lower.quaternion.clone(),foot=leg.foot.quaternion.clone();
      this.aim(leg.upper,leg.lower,joint);this.aim(leg.lower,leg.foot,target);
      leg.foot.quaternion.copy(leg.foot.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));
      leg.upper.quaternion.slerp(upper,1-weight);leg.lower.quaternion.slerp(lower,1-weight);leg.foot.quaternion.slerp(foot,1-weight);
      this.avatar.updateMatrixWorld(true);
    }
  }

  private aim(bone: Bone, child: Bone, target: Vector3): void {
    const start=bone.getWorldPosition(new Vector3());
    const from=child.getWorldPosition(new Vector3()).sub(start).normalize(),to=target.clone().sub(start).normalize();
    const world=bone.getWorldQuaternion(new Quaternion()).premultiply(new Quaternion().setFromUnitVectors(from,to));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));bone.updateWorldMatrix(false,true);
  }
}
