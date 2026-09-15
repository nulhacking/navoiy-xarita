const EMPTY: readonly never[] = [];

/**
 * Nuqta so'rovlari uchun tekis to'r.
 *
 * Har element o'z chegara qutisi (bbox) tushgan barcha kataklarga yoziladi,
 * so'rov esa faqat nuqta turgan bitta katakni qaytaradi. Shunda "shu nuqta
 * biror bino/yo'l ustidami?" savoli minglab poligon o'rniga bir nechtasini
 * tekshiradi. Natija to'liq qidiruv bilan AYNAN bir xil — bbox'dan tashqaridagi
 * element baribir `true` bera olmasdi.
 */
export class SpatialGrid<T> {
  private readonly cells = new Map<number, T[]>();

  constructor(private readonly cellSize: number) {}

  private static key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const c0 = Math.floor(minX / this.cellSize), c1 = Math.floor(maxX / this.cellSize);
    const r0 = Math.floor(minZ / this.cellSize), r1 = Math.floor(maxZ / this.cellSize);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const key = SpatialGrid.key(cx, cz);
        const list = this.cells.get(key);
        if (list) list.push(item);
        else this.cells.set(key, [item]);
      }
    }
  }

  /** `ring` — [x0, z0, x1, z1, ...]; bbox `pad` metrga kengaytiriladi. */
  insertRing(item: T, ring: ArrayLike<number>, pad = 0): void {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]!); maxX = Math.max(maxX, ring[i]!);
      minZ = Math.min(minZ, ring[i + 1]!); maxZ = Math.max(maxZ, ring[i + 1]!);
    }
    if (minX <= maxX) this.insert(item, minX - pad, minZ - pad, maxX + pad, maxZ + pad);
  }

  query(x: number, z: number): readonly T[] {
    return this.cells.get(SpatialGrid.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize))) ?? EMPTY;
  }
}
