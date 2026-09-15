import type { Object3D } from 'three';
import { LOW_QUALITY } from './Quality.ts';

const cache = new WeakMap<Object3D, Array<{ node: Object3D; level: number; distance: number }>>();
/** Shared skeletons and materials; only one geometry level is rendered at a time. */
export function updateModelLOD(object: Object3D, distanceSquared = 0): void {
  let levels = cache.get(object);
  if (!levels) {
    levels = [];
    object.traverse(node => {
      if (typeof node.userData.lodLevel !== 'number' || node.userData.brakeLight || node.userData.indicator) return;
      let root: Object3D | null = node;
      while (root && typeof root.userData.lodDistance !== 'number') root = root.parent;
      levels!.push({ node, level: node.userData.lodLevel, distance: root?.userData.lodDistance ?? 24 });
    });
    cache.set(object, levels);
  }
  for (const item of levels) {
    const threshold = item.distance * (LOW_QUALITY ? .65 : 1);
    // A small hysteresis band prevents flickering while the camera is near a boundary.
    const highVisible = item.level === 0 ? item.node.visible : !item.node.visible;
    const limit = threshold * (highVisible ? 1.08 : .92);
    const useLow = distanceSquared > limit * limit;
    item.node.visible = item.level === (useLow ? 1 : 0);
  }
}
