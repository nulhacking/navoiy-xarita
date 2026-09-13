import { insidePolygon, type PointXZ } from './RoadNetwork.ts';

const CELL = 80;

/**
 * Qirg'oq balandliklaridan suv sathini chiqaradi: pastdan CHORAK.
 *
 * Nima uchun eng past emas: bitta xato past nuqta butun havzani yerga
 * ko'mib yuborardi. Nima uchun o'rtacha emas: suv o'zining past chekkasi
 * darajasida turadi, undan yuqorisi quruqlik — o'rtacha qiymat suvni
 * qirg'oqdan toshirib yuboradi.
 *
 * `Ground` tubni shu sathdan o'yadi, `CityTile` esa ko'rinadigan yuzani shu
 * sathga qo'yadi. Bitta funksiya — ikkalasi hech qachon ajralmaydi.
 */
export function waterSurfaceLevel(samples: number[]): number {
  if (samples.length === 0) return Infinity;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.25)]!;
}

/**
 * Shahar suvi: qayerda suv borligi va uning SATHI.
 *
 * Halqalar butun shahar uchun bir marta (`water.json` dan) o'rnatiladi —
 * tayl oqimiga bog'liq emas. Sath relyef bilan birga hisoblanadi, chunki suv
 * tubini o'yish ham o'sha yerda bo'ladi: `Ground` ga qarang.
 */
export class WaterZones {
  private cells = new Map<string, Set<Float32Array>>();
  /** Halqa → suv sathi (mahalliy freymdagi Y). Berilmasa — sath noma'lum. */
  private levels = new Map<Float32Array, number>();

  set(rings: Iterable<Float32Array>, levelOf?: (ring: Float32Array) => number): void {
    this.cells.clear();
    this.levels.clear();
    for (const ring of rings) this.addZone(ring, levelOf?.(ring));
  }

  /**
   * Bitta havzani qo'shadi — mavjudlarini o'chirmasdan.
   *
   * Landmarklar o'z suvini (hovuz, ariq) shu orqali ro'yxatdan o'tkazadi:
   * ular relyef yuklangandan KEYIN quriladi, shuning uchun `set` ga
   * ulgurmaydi. Sath berilmasa zona faqat "suv bor" deb belgilanadi.
   */
  addZone(ring: Float32Array, level?: number): void {
    if (level !== undefined) this.levels.set(ring, level);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]!); maxX = Math.max(maxX, ring[i]!);
      minZ = Math.min(minZ, ring[i + 1]!); maxZ = Math.max(maxZ, ring[i + 1]!);
    }
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        const key = `${x}/${z}`, bucket = this.cells.get(key) ?? new Set<Float32Array>();
        bucket.add(ring); this.cells.set(key, bucket);
      }
    }
  }

  /**
   * Shu nuqtadagi suv sathi, yoki quruqlikda `null`.
   *
   * Bir necha havza ustma-ust tushsa — eng yuqorisi: kanal ko'l ichiga kirib
   * ketgan joyda suv sathi ko'lniki bo'lishi kerak, aks holda daryo ko'l
   * yuzasidan pastda "kesilgandek" ko'rinadi.
   */
  levelAt(point: PointXZ): number | null {
    let level: number | null = null;
    for (const ring of this.candidates(point, 0)) {
      const value = this.levels.get(ring);
      if (value === undefined || !insidePolygon(point, ring)) continue;
      if (level === null || value > level) level = value;
    }
    return level;
  }

  private candidates(point: PointXZ, margin: number): Set<Float32Array> {
    const candidates = new Set<Float32Array>();
    for (let x = Math.floor((point.x-margin)/CELL); x <= Math.floor((point.x+margin)/CELL); x++)
      for (let z = Math.floor((point.z-margin)/CELL); z <= Math.floor((point.z+margin)/CELL); z++)
        for (const ring of this.cells.get(`${x}/${z}`) ?? []) candidates.add(ring);
    return candidates;
  }

  contains(point: PointXZ, margin = 0): boolean {
    const candidates = new Set<Float32Array>();
    for (let x = Math.floor((point.x-margin)/CELL); x <= Math.floor((point.x+margin)/CELL); x++)
      for (let z = Math.floor((point.z-margin)/CELL); z <= Math.floor((point.z+margin)/CELL); z++)
        for (const ring of this.cells.get(`${x}/${z}`) ?? []) candidates.add(ring);
    for (const ring of candidates) {
      if (insidePolygon(point, ring)) return true;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const x = ring[j]!, z = ring[j+1]!, dx = ring[i]! - x, dz = ring[i+1]! - z;
        const t = Math.max(0, Math.min(1, ((point.x-x)*dx+(point.z-z)*dz)/(dx*dx+dz*dz || 1)));
        if (Math.hypot(point.x-x-dx*t, point.z-z-dz*t) <= margin) return true;
      }
    }
    return false;
  }

  /** Sample the swept path too, so a fast car cannot skip a narrow canal. */
  movementFraction(from: PointXZ, to: PointXZ, margin: number): number {
    const distance = Math.hypot(to.x-from.x, to.z-from.z);
    const steps = Math.max(1, Math.ceil(distance / 0.4));
    for (let i = 1; i <= steps; i++) {
      const t = i/steps;
      if (this.contains({ x: from.x+(to.x-from.x)*t, z: from.z+(to.z-from.z)*t }, margin)) return (i-1)/steps;
    }
    return 1;
  }
}
