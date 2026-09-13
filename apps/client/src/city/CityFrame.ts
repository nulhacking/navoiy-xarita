import { Vector3 } from 'three';

import {
  type Lla,
  type Mat4d,
  type Vec3d,
  ecefToLla,
  invertRigid,
  llaToEcef,
  localFrameAt,
  mat4d,
  transformPoint,
  vec3d,
} from '@xarita/geo';

/**
 * Shaharning qo'zg'almas mahalliy koordinata tizimi.
 *
 * NIMA UCHUN FLOATING ORIGIN KERAK EMAS: sayyora masshtabida (radius 6.4 mln m)
 * `float32` ~0.5 m aniqlik beradi va kamera qimirlaganda hamma narsa titraydi —
 * shuning uchun oldingi versiyada freym o'yinchi ortidan ko'chib yurardi.
 * Bitta shahar esa atigi ~20 km. Shu kattalikda `float32` ning qadami
 * 20000 * 2^-23 ≈ 0.0024 m, ya'ni ikki millimetr. Demak butun Navoiyni bitta
 * qo'zg'almas freymda saqlash mumkin va bu butun bir murakkablik qatlamini
 * (rebase, obyektlarni qayta joylashtirish, boshqaruv holatini tiklash)
 * butunlay yo'q qiladi.
 *
 * O'q konvensiyasi (three.js va fizika bilan mos):
 *   X = sharq,  Y = yuqori,  Z = janub
 * Kamera o'z `-Z` o'qi bo'ylab qaraydi, ya'ni "oldinga" = shimol.
 */
export class CityFrame {
  /** Freym boshi — shahar markazi, yer sirtida. */
  readonly origin: Lla;

  private readonly localToEcefD: Mat4d = mat4d();
  private readonly ecefToLocalD: Mat4d = mat4d();
  private readonly scratch = vec3d();

  constructor(origin: Lla) {
    this.origin = { ...origin };
    localFrameAt(this.origin, this.localToEcefD);
    invertRigid(this.localToEcefD, this.ecefToLocalD);
  }

  /** Geografik koordinatani mahalliy metrga aylantiradi. */
  toLocal(position: Lla, out = new Vector3()): Vector3 {
    llaToEcef(position, this.scratch);
    transformPoint(this.ecefToLocalD, this.scratch, this.scratch);
    return out.set(this.scratch.x, this.scratch.y, this.scratch.z);
  }

  /** Uchta son sifatida — massivga yozish uchun (verteks bufferlari). */
  toLocalArray(position: Lla, out: number[], offset = 0): void {
    llaToEcef(position, this.scratch);
    transformPoint(this.ecefToLocalD, this.scratch, this.scratch);
    out[offset] = this.scratch.x;
    out[offset + 1] = this.scratch.y;
    out[offset + 2] = this.scratch.z;
  }

  /** Mahalliy metrni geografik koordinataga qaytaradi. */
  toLla(local: { x: number; y: number; z: number }): Lla {
    const ecef: Vec3d = transformPoint(this.localToEcefD, local, vec3d());
    return ecefToLla(ecef);
  }
}
