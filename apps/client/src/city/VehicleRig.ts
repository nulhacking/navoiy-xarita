import { Box3, Group, Matrix4, Mesh, Vector3, type Object3D } from 'three';

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
    object.traverse(node => { if (node.userData.vehicleWheel) wheels!.push(node); });
    wheelCache.set(object, wheels);
  }
  object.updateMatrixWorld(true);
  for (const wheel of wheels) {
    wheel.rotation.y = wheel.userData.front ? steering : 0;
    const spin = wheel.getObjectByName('WheelSpin');
    const scale = wheel.getWorldScale(new Vector3()).y;
    const radius = Number(wheel.userData.radius) * scale;
    if (spin && radius > .01) spin.rotation.x = (spin.rotation.x + distance / radius * (wheel.userData.spinSign ?? 1)) % (Math.PI * 2);
  }
}
