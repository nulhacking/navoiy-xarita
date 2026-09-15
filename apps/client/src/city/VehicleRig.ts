import { Box3, Group, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { BICYCLE_METRES_PER_RADIAN } from './VehicleMotion.ts';

/** CarConcept's front wheels are authored at 30 degrees. Preserve their pivots,
 * straighten the axle, and batch the body separately. Runtime forward is +Z. */
export function rigVehicle(source: Group, batch: (group: Group) => Group): Group {
  source.updateMatrixWorld(true);
  const roots: Object3D[] = [];
  source.traverse(node => { if (/^Wheel(Front|Rear)[LR]$/.test(node.name)) roots.push(node); });
  if (roots.length !== 4) throw new Error('Vehicle asset must expose four named wheel assemblies');
  const front = new Vector3(), rear = new Vector3();
  for (const root of roots) (root.name.includes('Front') ? front : rear).add(root.getWorldPosition(new Vector3()));
  const direction = front.sub(rear).normalize();
  const orientation = new Matrix4().makeRotationY(-Math.atan2(direction.x, direction.z));
  const result = new Group();
  for (const root of roots) {
    const pivot = root.getWorldPosition(new Vector3());
    const axle = new Vector3().setFromMatrixColumn(root.matrixWorld, 0).normalize();
    const straighten = new Matrix4().makeRotationY(Math.atan2(axle.z, axle.x));
    const shift = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    const pieces = new Group(), pads = new Group();
    root.traverse(node => {
      if (!(node instanceof Mesh)) return;
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld).applyMatrix4(shift)
        .applyMatrix4(straighten);
      (node.name.includes('BrakePad') ? pads : pieces).add(new Mesh(geometry, node.material));
    });
    root.removeFromParent();
    const steer = new Group(), spin = batch(pieces);
    steer.name = root.name; spin.name = 'WheelSpin';
    steer.position.copy(pivot.applyMatrix4(orientation));
    steer.userData.vehicleWheel = true;
    steer.userData.front = root.name.includes('Front');
    const bounds = new Box3().setFromObject(spin);
    steer.userData.radius = (bounds.max.y - bounds.min.y) / 2;
    steer.add(spin, batch(pads)); result.add(steer);
  }
  const body = batch(source);
  body.applyMatrix4(orientation);
  result.add(body);
  result.userData.forward = '+Z';
  return result;
}

const wheelCache = new WeakMap<Object3D, Object3D[]>();
/** Distance is the signed, collision-resolved travel in metres, not throttle. */
export function animateVehicle(object: Object3D, distance: number, steering: number): void {
  let wheels = wheelCache.get(object);
  if (!wheels) {
    wheels = [];
    object.traverse(node => { if (node.userData.vehicleWheel || node.userData.vehicleHandlebar || node.userData.vehicleCrank) wheels!.push(node); });
    wheelCache.set(object, wheels);
  }
  object.updateMatrixWorld(true);
  for (const wheel of wheels) {
    if(wheel.userData.vehicleHandlebar){wheel.rotation.y=steering;continue;}
    if(wheel.userData.vehicleCrank){
      object.userData.pedalPhase=((object.userData.pedalPhase??0)-distance/BICYCLE_METRES_PER_RADIAN)%(Math.PI*2);
      wheel.rotation.x=-object.userData.pedalPhase;
      for(const pedal of wheel.children)if(pedal.userData.vehiclePedal)pedal.rotation.x=-wheel.rotation.x;
      continue;
    }
    wheel.rotation.y = wheel.userData.front ? steering : 0;
    const spin = wheel.children.find(n => n.userData.vehicleSpin) ?? wheel.getObjectByName('WheelSpin');
    const scale = wheel.getWorldScale(new Vector3()).y;
    const radius = Number(wheel.userData.radius) * scale;
    if (spin && radius > .01) {
      spin.userData.previousRoll = spin.userData.roll ?? spin.rotation.x;
      spin.userData.roll = (spin.userData.previousRoll + distance / radius * (wheel.userData.spinSign ?? 1)) % (Math.PI * 2);
      spin.rotation.x = spin.userData.roll;
    }
  }
}

/** Draw between fixed physics ticks without feeding display transforms back into travel. */
export function renderVehiclePose(object: Object3D, alpha: number, steering: number, phase: number): void {
  for (const node of wheelCache.get(object) ?? []) {
    if (node.userData.vehicleHandlebar) { node.rotation.y = steering; continue; }
    if (node.userData.vehicleCrank) {
      node.rotation.x = -phase;
      for (const pedal of node.children) if (pedal.userData.vehiclePedal) pedal.rotation.x = phase;
      continue;
    }
    node.rotation.y = node.userData.front ? steering : 0;
    const spin = node.children.find(n => n.userData.vehicleSpin) ?? node.getObjectByName('WheelSpin');
    if (spin && spin.userData.roll !== undefined) {
      const previous = spin.userData.previousRoll, delta = spin.userData.roll - previous;
      spin.rotation.x = previous + Math.atan2(Math.sin(delta), Math.cos(delta)) * alpha;
    }
  }
}

const accessoryCache = new WeakMap<Object3D, Object3D[]>();
/** Per-instance visibility and transforms; shared materials are never mutated. */
export function animateVehicleAccessories(object: Object3D, state: { time: number; steering: number; brake: boolean; door?: number; doorSide?: number; wipers?: boolean }): void {
  let nodes = accessoryCache.get(object);
  if (!nodes) { nodes = []; object.traverse(n => { if (n.userData.vehicleDoor || n.userData.brakeLight || n.userData.indicator || /^Wiper_|^SteeringWheel$/.test(n.name)) nodes!.push(n); }); accessoryCache.set(object, nodes); }
  for (const node of nodes) {
    if (node.userData.vehicleDoor && node.userData.front) { const side=node.userData.left?1:-1;node.rotation.y=side===(state.doorSide??1)?-side*(state.door??0)*1.05:0; }
    if (node.userData.brakeLight) node.visible = state.brake;
    if (node.userData.indicator) node.visible = Math.abs(state.steering) > .12 && Math.sign(state.steering) === node.userData.indicator && Math.floor(state.time * 2.5) % 2 === 0;
    if (node.name === 'SteeringWheel') node.rotation.z = -state.steering * 2.6;
    if (/^Wiper_/.test(node.name)) node.quaternion.setFromAxisAngle(new Vector3(...(node.userData.wiperAxis ?? [0,.84,.54])).normalize(),state.wipers?(1-Math.cos(state.time*Math.PI*2/1.2))*.5:0);
  }
}
