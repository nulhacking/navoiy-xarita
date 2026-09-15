import { AnimationMixer, Euler, LoopOnce, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Object3D } from 'three';

export interface CharacterMotion {
  speed: number;
  grounded: boolean;
  verticalSpeed: number;
  swimming: boolean;
}

/** A single normalized blend owns every animated bone, including airborne/water poses. */
export class CharacterAnimator {
  readonly mixer: AnimationMixer;
  readonly actions = new Map<string, AnimationAction>();
  current = 'Idle';
  private previousGrounded = false;
  private airTime = 0;
  private landing = 0;
  private gesture = 0;
  private walkSpeed = 1.7;
  private runSpeed = 3.55;
  private pose: Array<{ bone: Object3D; previousPosition: Vector3; position: Vector3; rawPosition: Vector3; previousRotation: Quaternion; rotation: Quaternion; rawRotation: Quaternion }> = [];
  private clock = 0;
  private readonly offset = new Quaternion();
  private readonly angles = new Euler();

  constructor(readonly object: Object3D, clips: AnimationClip[]) {
    this.mixer = new AnimationMixer(object);
    object.traverse(n => { if (n.userData.walkSpeed > 0) this.walkSpeed = n.userData.walkSpeed; if (n.userData.runSpeed > 0) this.runSpeed = n.userData.runSpeed; });
    for (const clip of clips) {
      const name = clip.name.split('|').at(-1)!.replace(/^Female_/, '');
      const action = this.mixer.clipAction(clip);
      if (['Jump', 'Land', 'EnterVehicle', 'ExitVehicle', 'Wave', 'Hit', 'Interact'].includes(name)) {
        action.setLoop(LoopOnce, 1); action.clampWhenFinished = true;
      }
      action.play().setEffectiveWeight(0);
      this.actions.set(name, action);
    }
    (this.actions.get('Idle') ?? this.actions.get('Idle_Neutral'))?.setEffectiveWeight(1);
    object.traverse(bone => {
      if (bone.type === 'Bone') this.pose.push({ bone, previousPosition: bone.position.clone(), position: bone.position.clone(), rawPosition: bone.position.clone(), previousRotation: bone.quaternion.clone(), rotation: bone.quaternion.clone(), rawRotation: bone.quaternion.clone() });
    });
  }

  wave(): void {
    if (!this.actions.has('Wave')) return;
    this.gesture = this.actions.get('Wave')!.getClip().duration;
    this.actions.get('Wave')!.reset().play();
  }

  update(dt: number, motion: CharacterMotion, override?: string): void {
    // Foot IK and display interpolation never become the next animation's input.
    for (const pose of this.pose) {
      pose.bone.position.copy(pose.rawPosition); pose.bone.quaternion.copy(pose.rawRotation);
      pose.previousPosition.copy(pose.position); pose.previousRotation.copy(pose.rotation);
    }
    const step = Math.min(Math.max(dt, 0), .1);
    this.landing = Math.max(0, this.landing - step);
    this.gesture = Math.max(0, this.gesture - step);
    if (!motion.grounded && !motion.swimming) this.airTime += step;
    if (motion.grounded && !this.previousGrounded && this.airTime > .15) this.landing = .28;
    if (motion.grounded || motion.swimming) this.airTime = 0;
    this.previousGrounded = motion.grounded;
    if (motion.speed > .1 || !motion.grounded || motion.swimming) this.gesture = 0;
    let desired = override ?? (motion.swimming ? motion.speed > .1 ? 'Swim' : 'TreadWater'
      : !motion.grounded ? motion.verticalSpeed > .15 ? 'Jump' : 'Fall'
      : this.landing > 0 ? 'Land' : this.gesture > 0 ? 'Wave'
      : motion.speed > 2.7 ? 'Run' : motion.speed > .08 ? 'Walk' : 'Idle');
    if (!this.actions.has(desired)) desired = this.actions.has('Idle') ? 'Idle' : 'Idle_Neutral';
    if (desired !== this.current) {
      const old=this.actions.get(this.current),next=this.actions.get(desired);
      const phase=old?old.time/old.getClip().duration:0;
      next?.reset().play();
      if(old&&next&&['Walk','Run'].includes(desired)&&['Walk','Run'].includes(this.current))next.time=phase*next.getClip().duration;
      this.current = desired;
    }
    const target = new Map<string, number>([[desired, 1]]);
    if (!override && (desired === 'Walk' || desired === 'Run')) {
      const run = this.actions.has('Run') ? Math.max(0, Math.min(1, (motion.speed - 2.2) / 1)) : 0;
      target.set('Walk', 1 - run); target.set('Run', run);
    }
    const walk=this.actions.get('Walk'),runAction=this.actions.get('Run'),runWeight=target.get('Run')??0;
    const stride=(this.walkSpeed*(walk?.getClip().duration??1))*(1-runWeight)+this.runSpeed*(runAction?.getClip().duration??1)*runWeight;
    const cadence=motion.speed/Math.max(.1,stride);
    if(walk&&runAction&&['Walk','Run'].includes(desired)){const main=desired==='Run'?runAction:walk,other=desired==='Run'?walk:runAction;other.time=main.time/main.getClip().duration*other.getClip().duration;}
    const alpha = 1 - Math.exp(-15 * step);
    let total = 0;
    for (const [name, action] of this.actions) {
      let weight = action.getEffectiveWeight() + ((target.get(name) ?? 0) - action.getEffectiveWeight()) * alpha;
      if (weight < .0001) weight = 0;
      action.enabled = weight > 0; action.setEffectiveWeight(weight); total += weight;
      if (name === 'Walk' || name === 'Run') action.setEffectiveTimeScale(Math.max(.1, cadence * action.getClip().duration));
    }
    if (total > 0) for (const action of this.actions.values()) action.setEffectiveWeight(action.getEffectiveWeight() / total);
    this.mixer.update(step);
    this.clock += step;
    const idle = this.actions.get('Idle')?.getEffectiveWeight() ?? 0;
    const breath = Math.sin(this.clock * 1.55), shift = Math.sin(this.clock * .67);
    for (const pose of this.pose) {
      const bone = pose.bone, name = bone.name;
      pose.rawPosition.copy(bone.position); pose.rawRotation.copy(bone.quaternion);
      // Independent rhythms avoid a mechanical, mirrored resting pose. Feet stay put.
      if (idle > .001) {
        let x = 0, y = 0, z = 0;
        if (name === 'Torso') { x = .014 * breath; z = .012 * shift; }
        if (name === 'Chest') { x = -.007 * breath; y = .015 * Math.sin(this.clock * .43); }
        if (name === 'Head') { y = .075 * Math.sin(this.clock * .47); x = .018 * Math.sin(this.clock * .83); }
        if (name === 'UpperArm_L') { x = -.035 + .018 * Math.sin(this.clock * .91); z = .025; }
        if (name === 'UpperArm_R') { x = .015 + .014 * Math.sin(this.clock * .73 + 1.6); z = -.02; }
        if (name === 'LowerArm_L') x = -.10 + .025 * shift;
        if (name === 'LowerArm_R') x = -.055 + .02 * Math.sin(this.clock * .81 + 1.3);
        if (name === 'Hand_L') { x = .04; z = .025 * breath; }
        if (name === 'Hand_R') { x = .065; z = -.02 * shift; }
        if (x || y || z) bone.quaternion.multiply(this.offset.setFromEuler(this.angles.set(x * idle, y * idle, z * idle)));
      }
      pose.position.copy(bone.position); pose.rotation.copy(bone.quaternion);
    }
    this.object.userData.animationState = this.current;
  }

  render(alpha: number): void {
    for (const pose of this.pose) {
      pose.bone.position.lerpVectors(pose.previousPosition, pose.position, alpha);
      pose.bone.quaternion.slerpQuaternions(pose.previousRotation, pose.rotation, alpha);
    }
  }

  dispose(): void { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.object); }
}
