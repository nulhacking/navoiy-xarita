/**
 * OSM bake chegarani kesib o'tgan obyektni bir nechta taylga yozadi. Bu
 * navigatsiya uchun qulay, ammo hamma tayl uni chizsa sirtlar ustma-ust
 * tushib, depth-buffer "laparlashi" yuzaga keladi. Quyidagi qoidalar
 * geometriyani aynan bitta egasiga biriktiradi.
 */
export interface TileOwner {
  x: number;
  y: number;
  extent: number;
}

/** Poligon markazi qaysi taylda bo'lsa, faqat o'sha tayl uni chizadi. */
export function ownsQuantizedPolygon(tile: TileOwner, ring: readonly number[]): boolean {
  const count = Math.floor(ring.length / 2);
  if (count === 0) return false;
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i++) {
    x += ring[i * 2]!;
    y += ring[i * 2 + 1]!;
  }
  return owner(tile, x / count, y / count);
}

/** Yo'lning har bir bo'lagi markazidagi taylga tegishli bo'ladi. */
export function ownsQuantizedSegment(tile: TileOwner, x0: number, y0: number, x1: number, y1: number): boolean {
  return owner(tile, (x0 + x1) * 0.5, (y0 + y1) * 0.5);
}

function owner(tile: TileOwner, qx: number, qy: number): boolean {
  const globalX = tile.x + qx / tile.extent;
  const globalY = tile.y + qy / tile.extent;
  return Math.floor(globalX) === tile.x && Math.floor(globalY) === tile.y;
}
