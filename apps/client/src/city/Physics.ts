import RAPIER from '@dimforge/rapier3d-compat';

import type { Ground } from './Ground.ts';
import { LOW_QUALITY } from './Quality.ts';

/** Fizika qat'iy qadamda ishlaydi — kadr tezligi qanday bo'lishidan qat'i nazar. */
export const FIXED_STEP = 1 / 60;

/** Bir kadrda bajariladigan qadamlarning eng ko'p soni. */
// Bir kadrda uzoq catch-up qilishning o'zi yangi lag hosil qilmasin.
// Kuchsiz telefonda 6 qadam quvish kadrni yana sekinlashtirib, "o'lim spirali"ga olib keladi.
const MAX_STEPS = LOW_QUALITY ? 3 : 6;

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
  /** Render between the two most recent fixed steps, without extrapolating through walls. */
  get interpolationAlpha():number { return Math.max(0,Math.min(1,this.accumulator/FIXED_STEP)); }
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

  /**
   * Landmarklarning ko'p sonli mayda qo'zg'almas kolliderlarini bitta trimesh'ga
   * "pishiradi".
   *
   * NIMA UCHUN: bordyur bo'laklari, daraxt tanalari, chiroq ustunlari va
   * binolar ~2000 ta alohida kollider edi. Ular qimirlamasa ham Rapier'ning
   * broadphase'i har qadamda ularni aylanib chiqadi: o'lchovda `world.step()`
   * 2.1 ms dan 0.1 ms ga tushdi, ya'ni soniyasiga 60 qadamda ~120 ms tejaladi —
   * telefonda bu doimiy qotishning asosiy sababi edi. Tayl devorlari allaqachon
   * xuddi shunday bitta trimesh.
   *
   * Qutilar 12 ta, silindrlar 8 qirrali prizma uchburchagiga aylanadi — o'yinchi
   * va mashina uchun to'qnashuv sirti bir xil qoladi. Boshqa shakllar (trimesh,
   * kapsula) tegilmaydi.
   */
  bakeStaticColliders(minColliders = 8): { before: number; after: number } {
    const before = this.world.colliders.len();
    const positions: number[] = [];
    const baked: RAPIER.Collider[] = [];
    const point = (c: RAPIER.Collider, x: number, y: number, z: number) => {
      const q = c.rotation(), p = c.translation();
      // v' = v + 2w(q×v) + 2 q×(q×v)
      const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
      positions.push(
        x + q.w * tx + (q.y * tz - q.z * ty) + p.x,
        y + q.w * ty + (q.z * tx - q.x * tz) + p.y,
        z + q.w * tz + (q.x * ty - q.y * tx) + p.z,
      );
    };
    const quad = (c: RAPIER.Collider, a: number[], b: number[], d: number[], e: number[]) => {
      for (const v of [a, b, d, a, d, e]) point(c, v[0]!, v[1]!, v[2]!);
    };
    this.world.bodies.forEach((body) => {
      if (body === this.staticBody || body.bodyType() !== RAPIER.RigidBodyType.Fixed || body.numColliders() < minColliders) return;
      for (let i = 0; i < body.numColliders(); i++) {
        const c = body.collider(i), shape = c.shape;
        if (shape instanceof RAPIER.Cuboid) {
          const { x: hx, y: hy, z: hz } = shape.halfExtents;
          const p = (sx: number, sy: number, sz: number) => [sx * hx, sy * hy, sz * hz];
          quad(c, p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));
          quad(c, p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1));
          quad(c, p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1));
          quad(c, p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1));
          quad(c, p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1));
          quad(c, p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1));
        } else if (shape instanceof RAPIER.Cylinder) {
          const { radius: r, halfHeight: h } = shape, n = 8;
          for (let k = 0; k < n; k++) {
            const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
            const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
            quad(c, [x0, -h, z0], [x1, -h, z1], [x1, h, z1], [x0, h, z0]);
            for (const v of [[0, h, 0], [x1, h, z1], [x0, h, z0]]) point(c, v[0]!, v[1]!, v[2]!);
          }
        } else continue;
        baked.push(c);
      }
    });
    if (positions.length === 0) return { before, after: before };
    for (const c of baked) this.world.removeCollider(c, false);
    const vertices = new Float32Array(positions);
    const indices = new Uint32Array(vertices.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8), this.staticBody);
    return { before, after: this.world.colliders.len() };
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
