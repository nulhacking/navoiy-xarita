import RAPIER from '@dimforge/rapier3d-compat';

import type { Ground } from './Ground.ts';

/** Fizika qat'iy qadamda ishlaydi — kadr tezligi qanday bo'lishidan qat'i nazar. */
export const FIXED_STEP = 1 / 60;

/** Bir kadrda bajariladigan qadamlarning eng ko'p soni. */
// Bir kadrda uzoq catch-up qilishning o'zi yangi lag hosil qilmasin.
const MAX_STEPS = 6;

/**
 * Rapier fizika dunyosi.
 *
 * Sayyora versiyasidagi "collider bubble" murakkabligi bu yerda kerak emas:
 * shahar chegarasi qat'iy, relyef bitta heightfield, binolar esa o'yinchi
 * atrofidagi bir necha tayl uchungina qo'shiladi.
 */
export class Physics {
  readonly world: RAPIER.World;
  private accumulator = 0;
  private readonly tileColliders = new Map<string, RAPIER.Collider>();
  private readonly staticBody: RAPIER.RigidBody;

  private constructor(world: RAPIER.World) {
    this.world = world;
    world.timestep = FIXED_STEP;
    this.staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  /** WASM modulini bir marta yuklab, dunyoni yaratadi. */
  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics(new RAPIER.World({ x: 0, y: -9.81, z: 0 }));
  }

  /**
   * Relyefni heightfield sifatida qo'shadi.
   *
   * Massiv `Ground.toRapierHeights()` orqali transponirlanadi — Rapier'ning
   * indekslash tartibi bizning to'rimizdan farq qiladi (izohi o'sha yerda).
   */
  addGround(ground: Ground): void {
    // Render va fizika aynan bir xil uchburchaklardan foydalanadi.
    const geometry = ground.mesh.geometry;
    const desc = RAPIER.ColliderDesc.trimesh(
      new Float32Array(geometry.getAttribute('position').array),
      new Uint32Array(geometry.index!.array),
    ).setFriction(1);

    this.world.createCollider(desc, this.staticBody);
  }

  /** Bino devorlarini to'qnashuv sirti sifatida qo'shadi. */
  addTileWalls(key: string, positions: Float32Array): void {
    if (this.tileColliders.has(key) || positions.length === 0) return;

    // Devor geometriyasi indekssiz uchburchaklardan iborat, shuning uchun
    // indekslar oddiy ketma-ketlik.
    const indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;

    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(0.8),
      this.staticBody,
    );
    this.tileColliders.set(key, collider);
  }

  removeTileWalls(key: string): void {
    const collider = this.tileColliders.get(key);
    if (!collider) return;
    this.world.removeCollider(collider, false);
    this.tileColliders.delete(key);
  }

  get wallTileCount(): number {
    return this.tileColliders.size;
  }

  /**
   * Fizikani ilgarilatadi.
   *
   * Qat'iy qadam muhim: o'zgaruvchan `dt` bilan personaj sakrash balandligi
   * va mashina tezlanishi kadr tezligiga bog'liq bo'lib qolardi.
   * Qaytadigan qiymat — bajarilgan qadamlar soni.
   */
  step(dt: number, beforeStep?: (dt: number) => void): number {
    this.accumulator += Math.max(0, Math.min(dt, MAX_STEPS * FIXED_STEP));
    let steps = 0;
    while (this.accumulator + 1e-10 >= FIXED_STEP && steps < MAX_STEPS) {
      this.world.updateSceneQueries();
      beforeStep?.(FIXED_STEP);
      this.world.step();
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    // Juda ko'p qarzdorlik yig'ilib qolsa (tab fonda turgan) — tashlab yuboramiz.
    if (steps === MAX_STEPS) this.accumulator = 0;
    return steps;
  }

  /**
   * Pastga nur tashlab, yer balandligini topadi.
   * Topilmasa `null` — chaqiruvchi relyef qiymatiga qaytadi.
   */
  groundHeightAt(x: number, y: number, z: number, maxDistance = 60): number | null {
    const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDistance, true);
    return hit ? y - hit.toi : null;
  }

  dispose(): void {
    this.tileColliders.clear();
    this.world.free();
  }
}

export { RAPIER };
