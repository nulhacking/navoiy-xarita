/**
 * Web Mercator (EPSG:3857) tayl matematikasi.
 *
 * NIMA UCHUN MUHIM: loyihaning ikkala rastr manbasi ham aynan shu sxemada:
 *   relyef      — AWS Terrain Tiles  {z}/{x}/{y}.png
 *   sun'iy yo'ldosh — EOX Sentinel-2 cloudless  {z}/{y}/{x}.jpg
 * Demak bitta quadtree ikkalasini ham boshqaradi va tekstura koordinatalari
 * relyef vertekslariga aynan tushadi — qayta proyeksiya qilish kerak emas.
 *
 * Ichki "normallashtirilgan Mercator" koordinatasi: X va Y ∈ [0, 1],
 * (0,0) — shimoli-g'arbiy burchak (lon −180°, lat +85.051°),
 * (1,1) — janubi-sharqiy burchak. Bu `{z}/{x}/{y}` sxemasi bilan bir xil yo'nalish.
 */

/**
 * Mercator proyeksiyasi qutblarda cheksizlikka ketadi, shuning uchun kvadrat
 * jahon xaritasi ±85.0511287798066° da kesiladi. Bu qiymat `atan(sinh(π))`.
 */
export const MERCATOR_MAX_LAT = 85.0511287798066;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Uzunlik → normallashtirilgan Mercator X ∈ [0, 1]. */
export function lonToMercatorX(lon: number): number {
  return (lon + 180) / 360;
}

/** Normallashtirilgan Mercator X → uzunlik. */
export function mercatorXToLon(x: number): number {
  return x * 360 - 180;
}

/**
 * Kenglik → normallashtirilgan Mercator Y ∈ [0, 1] (0 = shimol).
 * Kenglik chegaradan tashqarida bo'lsa qirqiladi — aks holda natija ±Infinity.
 */
export function latToMercatorY(lat: number): number {
  const clamped = Math.min(Math.max(lat, -MERCATOR_MAX_LAT), MERCATOR_MAX_LAT);
  const sin = Math.sin(clamped * DEG2RAD);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

/** Normallashtirilgan Mercator Y → kenglik. */
export function mercatorYToLat(y: number): number {
  return (2 * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - Math.PI / 2) * RAD2DEG;
}

/** Koordinata → shu nuqtani o'z ichiga olgan tayl. */
export function lonLatToTile(lon: number, lat: number, z: number): TileCoord {
  const n = 2 ** z;
  const x = Math.floor(lonToMercatorX(lon) * n);
  const y = Math.floor(latToMercatorY(lat) * n);
  // Sana chizig'ida (lon = 180) x aynan `n` bo'lib qoladi — oxirgi taylga qaytaramiz.
  return { z, x: clampTileIndex(x, n), y: clampTileIndex(y, n) };
}

function clampTileIndex(value: number, n: number): number {
  return Math.min(Math.max(value, 0), n - 1);
}

/** Taylning geografik chegaralari. */
export function tileBounds(tile: TileCoord): TileBounds {
  const n = 2 ** tile.z;
  return {
    west: mercatorXToLon(tile.x / n),
    east: mercatorXToLon((tile.x + 1) / n),
    // Mercator Y pastga o'sadi, kenglik esa yuqoriga — shuning uchun teskari.
    north: mercatorYToLat(tile.y / n),
    south: mercatorYToLat((tile.y + 1) / n),
  };
}

/**
 * Tayl ichidagi nisbiy (u, v) ∈ [0,1]² nuqtaning koordinatasi.
 *
 * MUHIM: namuna olish Mercator fazosida BIR TEKIS bo'ladi, kenglik bo'yicha emas.
 * Sababi — tekstura ham Mercator'da tekis taqsimlangan; agar kenglik bo'yicha
 * tekis olsak, tekstura relyef vertekslariga nisbatan siljib ketadi.
 */
export function tileUvToLonLat(tile: TileCoord, u: number, v: number): { lon: number; lat: number } {
  const n = 2 ** tile.z;
  return {
    lon: mercatorXToLon((tile.x + u) / n),
    lat: mercatorYToLat((tile.y + v) / n),
  };
}

/** Taylning ota-taylini qaytaradi (z = 0 da `null`). */
export function parentTile(tile: TileCoord): TileCoord | null {
  if (tile.z === 0) return null;
  return { z: tile.z - 1, x: tile.x >> 1, y: tile.y >> 1 };
}

/** To'rtta bola tayl, `[NW, NE, SW, SE]` tartibida. */
export function childTiles(tile: TileCoord): [TileCoord, TileCoord, TileCoord, TileCoord] {
  const z = tile.z + 1;
  const x = tile.x * 2;
  const y = tile.y * 2;
  return [
    { z, x, y },
    { z, x: x + 1, y },
    { z, x, y: y + 1 },
    { z, x: x + 1, y: y + 1 },
  ];
}

/** Kesh kaliti sifatida ishlatiladigan barqaror satr. */
export function tileKey(tile: TileCoord): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/**
 * Taylning bir pikseliga to'g'ri keladigan yer masofasi, metr.
 * LOD qarorlari va "bu zoom yetarlimi?" savoli uchun.
 *
 * @param tileSize tayl piksel o'lchami (odatda 256)
 */
export function metersPerPixel(z: number, lat: number, tileSize = 256): number {
  // Ekvatorda butun dunyo eni 2πa; Mercator'da masshtab cos(φ) ga bog'liq.
  const EQUATOR = 2 * Math.PI * 6378137;
  return (EQUATOR * Math.cos(lat * DEG2RAD)) / (tileSize * 2 ** z);
}

/** Taylning yer yuzidagi taxminiy eni, metr (markaziy kenglik bo'yicha). */
export function tileWidthMeters(tile: TileCoord): number {
  const { north, south } = tileBounds(tile);
  return metersPerPixel(tile.z, (north + south) / 2) * 256;
}
