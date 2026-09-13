import { Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';

import type { Ground } from './Ground.ts';
import { RAPIER, type Physics } from './Physics.ts';

/**
 * Buziladigan ko'cha jihozlari: daraxt, chiroq ustuni, svetofor, skameyka.
 *
 * ARXITEKTURA: jihozlar odatiy holatda fizikada UMUMAN yo'q. Ular instanced
 * meshlarning nusxalari va bitta 10 m lik katak indeksidagi doiralar, xolos.
 * Shahar yuzlab jihozga ega; har biri kollider bo'lsa Rapier broadphase'i har
 * qadamda ularni aylanib chiqardi (telefonda qotishning sababi aynan shu edi).
 *
 * To'qnashuv shu indeks orqali tekshiriladi:
 *   - mashina sekin tegsa yoki piyoda yurib kelsa — jihoz qattiq to'siq;
 *   - mashina `BREAK_SPEED` dan tez urilsa — nusxa yashiriladi, o'rniga shu
 *     geometriyadan yasalgan HAQIQIY dinamik jism paydo bo'lib, turtki oladi va
 *     yiqiladi. Mashina jihoz massasiga qarab sekinlashadi.
 * Yiqilgan jism bir necha soniyadan keyin "muzlaydi" (fizikadan chiqadi, mesh
 * yotgan joyida qoladi) — faol dinamik jismlar soni doim kichik.
 *
 * Cheklov: uzoq masofadagi daraxtlar birlashtirilgan yengil meshda chiziladi
 * va undan bitta daraxtni olib tashlab bo'lmaydi — yiqilgan daraxt 120–300 m
 * narida qaytib ko'rinishi mumkin. Tayl qayta yuklanganda jihozlar tiklanadi.
 */
export type PropKind = 'tree' | 'lamp' | 'bench' | 'signal';

interface PropPart {
  mesh: InstancedMesh;
  index: number;
  /** Faqat yashiriladi, qulab tushadigan bo'lakka qo'shilmaydi (yerdagi yorug'lik dog'i). */
  hideOnly?: boolean;
}

interface Prop {
  owner: object;
  kind: PropKind;
  parts: PropPart[];
  x: number;
  z: number;
  radius: number;
  height: number;
  mass: number;
  broken: boolean;
}

/** Mashina shundan sekin bo'lsa jihoz buzilmaydi, to'siq bo'lib turadi (≈ 8 km/soat). */
const BREAK_SPEED = 2.2;
const CELL = 10;
const MAX_ACTIVE = 14;
const ACTIVE_SECONDS = 7;
const FROZEN_SECONDS = 45;

const MASS: Record<PropKind, number> = { tree: 220, lamp: 90, signal: 70, bench: 45 };

const ZERO = new Matrix4().makeScale(0, 0, 0);

class PropRegistry {
  private readonly grid = new Map<string, Prop[]>();
  private readonly byOwner = new Map<object, Prop[]>();

  add(owner: object, kind: PropKind, x: number, z: number, radius: number, height: number, parts: PropPart[]): void {
    const prop: Prop = { owner, kind, parts, x, z, radius, height, mass: MASS[kind] * Math.max(.5, height / (kind === 'tree' ? 8 : 6)), broken: false };
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    const cell = this.grid.get(key);
    if (cell) cell.push(prop); else this.grid.set(key, [prop]);
    const list = this.byOwner.get(owner);
    if (list) list.push(prop); else this.byOwner.set(owner, [prop]);
  }

  remove(owner: object): void {
    const list = this.byOwner.get(owner);
    if (!list) return;
    this.byOwner.delete(owner);
    const gone = new Set(list);
    for (const prop of list) {
      const key = `${Math.floor(prop.x / CELL)},${Math.floor(prop.z / CELL)}`;
      const cell = this.grid.get(key);
      if (!cell) continue;
      const kept = cell.filter((p) => !gone.has(p));
      if (kept.length) this.grid.set(key, kept); else this.grid.delete(key);
    }
  }

  /** (x, z) atrofida `reach` metr ichidagi butun jihozlar. */
  near(x: number, z: number, reach: number, visit: (prop: Prop) => void): void {
    const x0 = Math.floor((x - reach) / CELL), x1 = Math.floor((x + reach) / CELL);
    const z0 = Math.floor((z - reach) / CELL), z1 = Math.floor((z + reach) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const cell = this.grid.get(`${cx},${cz}`);
      if (cell) for (const prop of cell) if (!prop.broken) visit(prop);
    }
  }

  clear(): void {
    this.grid.clear();
    this.byOwner.clear();
  }

  get size(): number {
    let n = 0;
    for (const list of this.byOwner.values()) n += list.length;
    return n;
  }
}

/** Modul darajasidagi reyestr: jihozlarni chizuvchi kod fizikani bilmasdan ro'yxatdan o'tkazadi. */
export const props = new PropRegistry();

interface Debris {
  group: Group;
  meshes: Array<{ mesh: Mesh; world: Matrix4 }>;
  body: RAPIER.RigidBody | null;
  pivotInverse: Matrix4;
  age: number;
}

export interface CarImpact {
  /** Buzilgan jihozlarning jami massasi, kg — mashina shunga qarab sekinlashadi. */
  mass: number;
  /** Buzilmagan (sekin tegilgan) jihozdan chiqarish vektori, metr. */
  push: { x: number; z: number } | null;
}

export class Breakables {
  readonly group = new Group();
  private readonly debris: Debris[] = [];
  private readonly matrix = new Matrix4();
  private readonly bodyMatrix = new Matrix4();

  constructor(private readonly physics: Physics, private readonly ground: Ground) {
    this.group.name = 'Breakable props · debris';
  }

  /**
   * Mashina to'rtburchagi (markaz, burilish, yarim o'lchamlar) jihozlarga tegdimi.
   * `speed` — oldinga m/s (orqaga manfiy).
   */
  carImpact(center: Vector3, yaw: number, half: { x: number; z: number }, speed: number): CarImpact {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mass = 0, push: CarImpact['push'] = null;
    props.near(center.x, center.z, half.z + 2, (prop) => {
      const dx = prop.x - center.x, dz = prop.z - center.z;
      const along = dx * fx + dz * fz, side = dx * rx + dz * rz;
      const overZ = half.z + prop.radius - Math.abs(along), overX = half.x + prop.radius - Math.abs(side);
      if (overZ <= 0 || overX <= 0) return;
      if (Math.abs(speed) >= BREAK_SPEED) {
        this.topple(prop, fx * speed, fz * speed);
        mass += prop.mass;
        return;
      }
      // Sekin tegish: eng kichik kirib qolish o'qi bo'ylab mashinani chiqaramiz.
      const px = overX < overZ ? -Math.sign(side) * overX * rx : -Math.sign(along) * overZ * fx;
      const pz = overX < overZ ? -Math.sign(side) * overX * rz : -Math.sign(along) * overZ * fz;
      push = { x: (push?.x ?? 0) + px, z: (push?.z ?? 0) + pz };
    });
    return { mass, push };
  }

  /** Piyoda uchun: doira jihozlarga kirib qolsa, tashqariga chiqarish vektori. */
  pushOut(x: number, z: number, radius: number): { x: number; z: number } | null {
    let px = 0, pz = 0, hit = false;
    props.near(x, z, radius + 2, (prop) => {
      const dx = x - prop.x, dz = z - prop.z, distance = Math.hypot(dx, dz), limit = radius + prop.radius;
      if (distance >= limit) return;
      const nx = distance > 1e-4 ? dx / distance : 1, nz = distance > 1e-4 ? dz / distance : 0;
      px += nx * (limit - distance);
      pz += nz * (limit - distance);
      hit = true;
    });
    return hit ? { x: px, z: pz } : null;
  }

  /** Jihozni yiqitadi: nusxani yashirib, o'rniga dinamik jism yaratadi. */
  private topple(prop: Prop, vx: number, vz: number): void {
    prop.broken = true;
    const group = new Group();
    group.name = `Debris · ${prop.kind}`;
    const meshes: Debris['meshes'] = [];
    for (const part of prop.parts) {
      part.mesh.getMatrixAt(part.index, this.matrix);
      part.mesh.updateWorldMatrix(true, false);
      const world = part.mesh.matrixWorld.clone().multiply(this.matrix);
      part.mesh.setMatrixAt(part.index, ZERO);
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.hideOnly) continue;
      const mesh = new Mesh(part.mesh.geometry, part.mesh.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(world);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      meshes.push({ mesh, world });
    }
    this.group.add(group);

    const base = this.ground.heightAt(prop.x, prop.z);
    const pivot = new Vector3(prop.x, base + prop.height / 2, prop.z);
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pivot.x, pivot.y, pivot.z).setLinearDamping(.25).setAngularDamping(.5).setCcdEnabled(true));
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(prop.radius, prop.height / 2, prop.radius)
      .setMass(prop.mass).setFriction(.7).setRestitution(.1), body);
    const speed = Math.hypot(vx, vz) || 1, ux = vx / speed, uz = vz / speed;
    // Tezlikning bir qismi jihozga o'tadi, ozgina yuqoriga — urilganda "sakraydi".
    body.applyImpulse({ x: vx * prop.mass * .75, y: prop.mass * Math.min(4, speed * .25), z: vz * prop.mass * .75 }, true);
    // Uchi urilish yo'nalishida yiqiladi: zarba o'qi harakatga perpendikulyar.
    const torque = prop.mass * speed * prop.height * .12;
    body.applyTorqueImpulse({ x: uz * torque, y: (Math.random() - .5) * torque * .2, z: -ux * torque }, true);

    this.debris.push({ group, meshes, body, pivotInverse: new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z), age: 0 });
    const active = this.debris.filter((d) => d.body);
    if (active.length > MAX_ACTIVE) this.freeze(active[0]!);
  }

  private freeze(debris: Debris): void {
    if (!debris.body) return;
    this.physics.world.removeRigidBody(debris.body);
    debris.body = null;
  }

  /** Kadr: dinamik bo'laklarni jism holatiga moslash, eskilarini muzlatish va o'chirish. */
  update(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.age += dt;
      if (d.body) {
        const t = d.body.translation(), r = d.body.rotation();
        this.bodyMatrix.compose(new Vector3(t.x, t.y, t.z), new Quaternion(r.x, r.y, r.z, r.w), new Vector3(1, 1, 1)).multiply(d.pivotInverse);
        for (const { mesh, world } of d.meshes) mesh.matrix.multiplyMatrices(this.bodyMatrix, world);
        if (d.age > ACTIVE_SECONDS || (d.age > 2 && d.body.isSleeping())) this.freeze(d);
      } else if (d.age > FROZEN_SECONDS) {
        d.group.removeFromParent();
        this.debris.splice(i, 1);
      }
    }
  }

  /** Jihozlar reyestri (testlar va diagnostika uchun). */
  get registry(): PropRegistry {
    return props;
  }

  get activeBodies(): number {
    return this.debris.filter((d) => d.body).length;
  }

  dispose(): void {
    props.clear();
    for (const d of this.debris) this.freeze(d);
    this.debris.length = 0;
    this.group.clear();
  }
}
