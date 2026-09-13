import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';

import { type TileCoord, latToMercatorY, lonToMercatorX } from '@xarita/geo';

import { type HeightGrid, TERRAIN_SOURCE, TerrainSource } from './sources.ts';
import type { CityFrame } from './CityFrame.ts';
import { groundTexture } from './SurfaceMaterials.ts';
import { insidePolygon } from './RoadNetwork.ts';
import { WaterZones, waterSurfaceLevel } from './WaterZones.ts';
import { isNavoiLake } from './LakeReference.ts';
import { LakeTerrain } from './LakeTerrain.ts';

/**
 * Relyef namunalari to'ri. Shahar ~20 km, 257 nuqta → ~78 m qadam.
 *
 * Nozik ko'rinadi, lekin manba SRTM'ning o'zi 30 m/px va Navoiy tekislikda
 * joylashgan (butun shahar bo'ylab balandlik farqi ~40 m). Bundan zichroq
 * to'r yangi ma'lumot bermaydi, faqat verteks sarflaydi. Fizika uchun ham
 * shu to'rning o'zi ishlatiladi — bitta manba, ikki maqsad.
 */
const GRID = 257;

/** DEM qaysi darajadan olinadi. z12 tayl ~7.5 km, 256 px → 29 m/px. */
const DEM_ZOOM = 12;

/** Gauss silliqlash kengligi, katakda. Izohi `smoothHeights` da. */
const SMOOTHING = 0.8;

/**
 * Suv havzasining tubi sath'dan shuncha past o'yiladi, metr.
 *
 * DEM ko'l yuzasini o'lchaydi, tubini emas — ya'ni o'yish ma'lumotdan emas,
 * taxmindan. 4 m tanlangan, chunki bo'yi 1.8 m personaj uchun bu "suzish"
 * chuqurligi, lekin qirg'oq qiyaligi bitta katakka (67 m) yoyilgani uchun
 * suvga kirish asta-sekin bo'ladi.
 */
const WATER_DEPTH = 4;

/**
 * Relyefni mahalliy yerdan shundan chuqur kesmaymiz, metr.
 *
 * Sath butun halqa bo'yicha bitta, yer esa qiya bo'lishi mumkin: qiya
 * daryoda sath quyi uchidan olinib, yuqori uchi 18 metrlik chuqurga
 * aylanardi. Bu chegara havzani yer bag'rida o'yilgan quduq emas, haqiqiy
 * tub qilib qoldiradi.
 */
const MAX_CUT = 6;

/**
 * Bundan tor havza o'yilmaydi, metr.
 *
 * To'r qadami 67 m: 8 metrli ariqni o'yish uni chuqurlashtirmaydi, balki
 * tasodifan ustiga tushgan bitta tugunni 4 m ga tushirib, yo'l va yer
 * qoplamasini ham o'sha chuqurga tortadi. Ariq kechib o'tiladigan bo'lib
 * qolgani — to'g'ri natija: bu masshtabda relyef uni ko'tara olmaydi.
 */
const MIN_WATER_SPAN = 60;

export interface GroundBounds {
  /** Mahalliy metrda: shahar to'rtburchagi. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Shahar relyefi: bitta katta mesh + balandlikni so'rash imkoni.
 *
 * Sayyora versiyasidagi quadtree o'rniga — shahar chegarasi qat'iy, LOD
 * kerak emas. Buning evaziga relyef fizika uchun ham tayyor: bir xil to'rdan
 * Rapier heightfield collider quriladi.
 */
export class Ground {
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly bounds: GroundBounds;
  /**
   * `GRID x GRID` balandliklar, qatorma-qator shimoldan janubga.
   *
   * DIQQAT: bu yerda MAHALLIY freymdagi Y saqlanadi, geodezik balandlik EMAS.
   * Farqi Yer egriligi: shahar chetida (markazdan ~9 km) mahalliy Y geodezik
   * balandlikdan ~6 m past bo'ladi. Avval bu yerda geodezik qiymat turgan edi
   * va shu sababli fizika yer sirti ko'rinadigan sirtdan bir necha metr
   * yuqorida turardi — personaj havoda yurgandek ko'rinardi.
   */
  readonly heights: Float32Array;
  /**
   * Suv o'yilmagan holdagi yer sathi — qirg'oq balandligi.
   *
   * `heights` suv tubini beradi (fizika va mesh shundan), `surface` esa suv
   * YUZASI qayerda turishini aytadi. Ikkalasi bitta hisobdan chiqqani uchun
   * suv sathi bilan tub hech qachon bir-biridan ajralmaydi.
   */
  readonly surface: Float32Array;
  /** Butun shahar suvi: chegaralari va sathi. */
  readonly water = new WaterZones();
  readonly gridSize = GRID;
  /** Namunalar orasidagi masofa, metr. */
  readonly spacingX: number;
  readonly spacingZ: number;
  detail:LakeTerrain|null=null;

  private constructor(
    heights: Float32Array,
    surface: Float32Array,
    bounds: GroundBounds,
    geometry: BufferGeometry,
  ) {
    this.heights = heights;
    this.surface = surface;
    this.bounds = bounds;
    this.spacingX = (bounds.maxX - bounds.minX) / (GRID - 1);
    this.spacingZ = (bounds.maxZ - bounds.minZ) / (GRID - 1);

    this.mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({ color: 0x8a8266, map:groundTexture(), roughness: 1, metalness: 0 }),
    );
    this.mesh.matrixAutoUpdate = false;
    this.mesh.receiveShadow = true;
  }

  /**
   * Shahar chegarasi bo'yicha relyefni yuklab, meshni quradi.
   *
   * @param bbox [janub, g'arb, shimol, sharq] — bake indeksidagi bilan bir xil.
   */
  /**
   * @param waterRings Butun shahar suvi, `water.json` dan: har biri
   *   `[lon, lat, lon, lat, …]`. Bo'sh bo'lsa suv o'yilmaydi.
   */
  static async load(
    frame: CityFrame,
    bbox: [number, number, number, number],
    source: TerrainSource,
    waterRings: number[][] = [],
  ): Promise<Ground> {
    const [south, west, north, east] = bbox;
    const grids = await loadDemTiles(bbox, source);

    const heights = new Float32Array(GRID * GRID);
    const positions = new Float32Array(GRID * GRID * 3);
    const point: number[] = [0, 0, 0];

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const lat of [south, north]) for (const lon of [west, east]) {
      frame.toLocalArray({ lat, lon, alt: 0 }, point);
      minX = Math.min(minX, point[0]!);
      maxX = Math.max(maxX, point[0]!);
      minZ = Math.min(minZ, point[2]!);
      maxZ = Math.max(maxZ, point[2]!);
    }

    // 1-qadam: har bir to'r tugunining geografik joyi va DEM piksel koordinatasi.
    const lats = new Float64Array(GRID * GRID);
    const lons = new Float64Array(GRID * GRID);
    const pxs = new Float64Array(GRID * GRID);
    const pys = new Float64Array(GRID * GRID);
    const demPixels = 2 ** DEM_ZOOM * TERRAIN_SOURCE.tileSize;
    for (let row = 0; row < GRID; row++) {
      const z = minZ + (maxZ - minZ) * row / (GRID - 1);
      for (let col = 0; col < GRID; col++) {
        const x = minX + (maxX - minX) * col / (GRID - 1);
        const { lat, lon } = frame.toLla({ x, y: 0, z });
        const index = row * GRID + col;
        lats[index] = lat;
        lons[index] = lon;
        pxs[index] = lonToMercatorX(lon) * demPixels;
        pys[index] = latToMercatorY(lat) * demPixels;
      }
    }

    // 2-qadam: katak kengligi bo'yicha o'rtachalangan balandlik (anti-aliasing).
    const alts = new Float32Array(GRID * GRID);
    for (let row = 0; row < GRID; row++) {
      const rowAbove = Math.max(row - 1, 0);
      const rowBelow = Math.min(row + 1, GRID - 1);
      for (let col = 0; col < GRID; col++) {
        const left = Math.max(col - 1, 0);
        const right = Math.min(col + 1, GRID - 1);
        const index = row * GRID + col;
        // Qo'shni tugunlargacha bo'lgan piksel qadami — katakning o'lchami.
        const stepX = Math.abs(pxs[row * GRID + right]! - pxs[row * GRID + left]!) / (right - left);
        const stepY = Math.abs(pys[rowBelow * GRID + col]! - pys[rowAbove * GRID + col]!) / (rowBelow - rowAbove);
        alts[index] = sampleDemCell(grids, pxs[index]!, pys[index]!, stepX, stepY);
      }
    }

    // 3-qadam: qolgan DEM "donasi" ni yo'qotamiz — izohi smoothHeights da.
    const smoothed = smoothHeights(alts, SMOOTHING);

    for (let row = 0; row < GRID; row++) {
      const z = minZ + (maxZ - minZ) * row / (GRID - 1);
      for (let col = 0; col < GRID; col++) {
        const x = minX + (maxX - minX) * col / (GRID - 1);
        const index = row * GRID + col;
        frame.toLocalArray({ lat: lats[index]!, lon: lons[index]!, alt: smoothed[index]! }, point);
        // Ko'rinadigan mesh ham, fizika ham, binolar ham AYNAN shu qiymatdan
        // foydalanadi — shuning uchun ular hech qachon bir-biridan ajralmaydi.
        heights[index] = point[1]!;
        positions[index * 3] = x;
        positions[index * 3 + 1] = point[1]!;
        positions[index * 3 + 2] = z;
      }
    }

    // Suvdan OLDINGI sath — qirg'oq balandligi va suv yuzasi shundan.
    const bounds: GroundBounds = { minX, maxX, minZ, maxZ };
    const surface = heights.slice();

    const local = toLocalRings(frame, waterRings);
    const levels = local.map((ring) => waterLevel(ring, surface, bounds));
    carveWater(heights, surface, bounds, local, levels);
    for (let i = 0; i < heights.length; i++) positions[i * 3 + 1] = heights[i]!;

    const byRing = new Map(local.map((ring, i) => [ring, levels[i]!]));
    const lakeIndex=waterRings.findIndex(isNavoiLake);
    const detail=lakeIndex<0?null:new LakeTerrain(local[lakeIndex]!,levels[lakeIndex]!,bounds,(maxX-minX)/(GRID-1),(maxZ-minZ)/(GRID-1),(x,z)=>sampleGrid(heights,bounds,x,z));
    const ground = new Ground(heights, surface, bounds, buildGeometry(positions,detail));
    ground.detail=detail;
    ground.water.set(local, (ring) => byRing.get(ring) ?? Infinity);
    return ground;
  }

  /**
   * Berilgan mahalliy nuqtadagi yer balandligi, metr.
   * Chegaradan tashqarida eng yaqin chetdagi qiymat qaytadi.
   */
  heightAt(x: number, z: number): number {
    if(this.detail?.contains(x,z))return this.detail.heightAt(x,z);
    return sampleGrid(this.heights, this.bounds, x, z);
  }

  /** Suv o'yilmagan holdagi sath — qirg'oq va suv yuzasi shu yerda. */
  surfaceAt(x: number, z: number): number {
    return sampleGrid(this.surface, this.bounds, x, z);
  }

  /** Shu nuqtadagi suv sathi, quruqlikda `null`. */
  waterLevelAt(x: number, z: number): number | null {
    return this.water.levelAt({ x, z });
  }

  /**
   * Rapier heightfield uchun ko'chirilgan (transponirlangan) nusxa.
   *
   * Rapier massivni `heights[zIndex + xIndex * (nrows + 1)]` tartibida o'qiydi,
   * ya'ni TEZ indeks Z o'qi bo'ylab yuradi. Bizning to'r esa qatorma-qator
   * (tez indeks = X) saqlanadi. Bu empirik tekshirilgan: teskari tartibda
   * bersak relyef fizikasi ko'rinadigan relyefga nisbatan transponirlanadi
   * va personaj tepalikda havoda, tekislikda esa yer ostida qoladi.
   */
  toRapierHeights(): Float32Array {
    const out = new Float32Array(GRID * GRID);
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        out[row + col * GRID] = this.heights[row * GRID + col]!;
      }
    }
    return out;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * To'rdan bilinear namuna.
 *
 * Uchburchak ichida interpolyatsiya qilinadi, bilinear emas: mesh katakni
 * b--c diagonali bo'yicha ikkiga bo'ladi, shuning uchun ko'rinadigan sirt ham,
 * fizika ham AYNAN shu qiymatni beradi.
 */
function sampleGrid(data: Float32Array, bounds: GroundBounds, x: number, z: number): number {
  const fx = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * (GRID - 1);
  const fz = ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * (GRID - 1);

  const cx = Math.min(Math.max(fx, 0), GRID - 1);
  const cz = Math.min(Math.max(fz, 0), GRID - 1);
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, GRID - 1);
  const z1 = Math.min(z0 + 1, GRID - 1);
  const tx = cx - x0;
  const tz = cz - z0;

  const h00 = data[z0 * GRID + x0]!;
  const h10 = data[z0 * GRID + x1]!;
  const h01 = data[z1 * GRID + x0]!;
  const h11 = data[z1 * GRID + x1]!;
  return tx + tz <= 1
    ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
    : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}

/** `[lon, lat, …]` halqalarini shahar freymidagi `[x, z, …]` ga o'giradi. */
function toLocalRings(frame: CityFrame, rings: number[][]): Float32Array[] {
  const point: number[] = [0, 0, 0];
  const out: Float32Array[] = [];
  for (const ring of rings) {
    if (ring.length < 8) continue;
    const local = new Float32Array(ring.length);
    for (let i = 0; i < ring.length; i += 2) {
      frame.toLocalArray({ lon: ring[i]!, lat: ring[i + 1]!, alt: 0 }, point);
      local[i] = point[0]!;
      local[i + 1] = point[2]!;
    }
    out.push(local);
  }
  return out;
}

function waterLevel(ring: Float32Array, surface: Float32Array, bounds: GroundBounds): number {
  const samples: number[] = [];
  for (let i = 0; i < ring.length; i += 2) {
    samples.push(sampleGrid(surface, bounds, ring[i]!, ring[i + 1]!));
  }
  return waterSurfaceLevel(samples);
}

/**
 * Suv havzalarining tubini o'yadi.
 *
 * Faqat `heights` o'zgaradi — `surface` tegilmaydi, shuning uchun suv yuzasi
 * qirg'oq darajasida qoladi va o'yilgan tub bilan orasida haqiqiy chuqurlik
 * paydo bo'ladi. Qirg'oq qiyaligi alohida hisoblanmaydi: to'rning o'zi suv
 * ichidagi tugun bilan tashqaridagisi orasini chiziqli bog'laydi va bu 67 m
 * da 4 m — yumshoq, kirib boriladigan qiyalik.
 */
function carveWater(
  heights: Float32Array,
  surface: Float32Array,
  bounds: GroundBounds,
  rings: Float32Array[],
  levels: number[],
): void {
  const spacingX = (bounds.maxX - bounds.minX) / (GRID - 1);
  const spacingZ = (bounds.maxZ - bounds.minZ) / (GRID - 1);

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!;
    const level = levels[r]!;
    if (!Number.isFinite(level)) continue;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]!); maxX = Math.max(maxX, ring[i]!);
      minZ = Math.min(minZ, ring[i + 1]!); maxZ = Math.max(maxZ, ring[i + 1]!);
    }
    if (Math.min(maxX - minX, maxZ - minZ) < MIN_WATER_SPAN) continue;

    const c0 = Math.max(0, Math.floor((minX - bounds.minX) / spacingX));
    const c1 = Math.min(GRID - 1, Math.ceil((maxX - bounds.minX) / spacingX));
    const r0 = Math.max(0, Math.floor((minZ - bounds.minZ) / spacingZ));
    const r1 = Math.min(GRID - 1, Math.ceil((maxZ - bounds.minZ) / spacingZ));

    for (let row = r0; row <= r1; row++) {
      const z = bounds.minZ + row * spacingZ;
      for (let col = c0; col <= c1; col++) {
        const x = bounds.minX + col * spacingX;
        if (!insidePolygon({ x, z }, ring)) continue;
        const index = row * GRID + col;
        // Tub — sathdan `WATER_DEPTH` past, lekin mahalliy yerdan `MAX_CUT`
        // dan chuqur emas. Tashqi `min` relyefni hech qachon ko'tarmaydi va
        // ustma-ust tushgan havzalardan chuqurrog'ini oladi.
        heights[index] = Math.min(
          heights[index]!,
          Math.max(level - WATER_DEPTH, surface[index]! - MAX_CUT),
        );
      }
    }
  }
}

/** Shahar to'rtburchagini qoplaydigan DEM tayllarini yuklaydi. */
async function loadDemTiles(
  bbox: [number, number, number, number],
  source: TerrainSource,
): Promise<Map<string, HeightGrid>> {
  const [south, west, north, east] = bbox;
  const n = 2 ** DEM_ZOOM;
  const x0 = Math.floor(lonToMercatorX(west) * n);
  const x1 = Math.floor(lonToMercatorX(east) * n);
  const y0 = Math.floor(latToMercatorY(north) * n);
  const y1 = Math.floor(latToMercatorY(south) * n);

  const jobs: Promise<[string, HeightGrid | null]>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const coord: TileCoord = { z: DEM_ZOOM, x, y };
      jobs.push(source.get(coord).then((grid) => [`${x}/${y}`, grid] as [string, HeightGrid | null]));
    }
  }

  const grids = new Map<string, HeightGrid>();
  for (const [key, grid] of await Promise.all(jobs)) {
    if (grid) grids.set(key, grid);
  }
  return grids;
}

/**
 * Bitta DEM pikseli. `px, py` — GLOBAL piksel koordinatasi, ya'ni tayl
 * chegarasidan bemalol o'tadi.
 *
 * Avval namuna bitta tayl ichida qirqilardi va tayl chetida qo'shnisining
 * o'rniga o'zining chekka pikseli takrorlanardi — har 7.5 km da bir chok.
 *
 * Tayl kelmagan bo'lsa `NaN`: chaqiruvchi uni o'rtachadan chiqarib tashlaydi,
 * shunda bitta yetishmagan tayl butun chekkani dengiz sathiga tortmaydi.
 */
function demPixel(grids: Map<string, HeightGrid>, px: number, py: number): number {
  const size = TERRAIN_SOURCE.tileSize;
  const tx = Math.floor(px / size);
  const ty = Math.floor(py / size);
  const grid = grids.get(`${tx}/${ty}`);
  if (!grid) return NaN;
  const ix = Math.min(size - 1, Math.max(0, Math.floor(px) - tx * size));
  const iy = Math.min(size - 1, Math.max(0, Math.floor(py) - ty * size));
  return grid.data[iy * size + ix]!;
}

/** Global piksel koordinatasida bilinear namuna. */
function demBilinear(grids: Map<string, HeightGrid>, px: number, py: number): number {
  const fx = px - 0.5;
  const fy = py - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const corners: Array<[number, number]> = [
    [demPixel(grids, x0, y0), (1 - tx) * (1 - ty)],
    [demPixel(grids, x0 + 1, y0), tx * (1 - ty)],
    [demPixel(grids, x0, y0 + 1), (1 - tx) * ty],
    [demPixel(grids, x0 + 1, y0 + 1), tx * ty],
  ];
  let sum = 0;
  let weight = 0;
  for (const [height, w] of corners) {
    if (Number.isNaN(height)) continue;
    sum += height * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : NaN;
}

/** Uchburchak (tent) filtrining namuna nuqtalari, katak ulushida. */
const TENT_OFFSETS = [-0.8, -0.4, 0, 0.4, 0.8];
const TENT_WEIGHTS = TENT_OFFSETS.map((offset) => 1 - Math.abs(offset));

/**
 * Bitta to'r katagining balandligi — katak ENI bo'yicha o'rtachalangan.
 *
 * Nima uchun o'rtacha, nuqtaviy namuna emas: DEM 29 m/px, bizning to'r esa
 * 67 m qadamda. Ya'ni to'r manbadan 2.3 marta siyrak va nuqtaviy o'qish
 * klassik aliasing beradi — SRTM'ning shovqini har 67 metrda tasodifiy
 * do'nglikka aylanadi. Tekis Navoiy tekisligida aynan shu narsa butun
 * shaharni g'adir-budur qilib ko'rsatardi.
 *
 * Tent filtri — to'g'ri qadam: chiqish to'ri ko'tara olmaydigan chastotalarni
 * OLDIN olib tashlaydi, keyin siyraklashtiradi.
 */
function sampleDemCell(
  grids: Map<string, HeightGrid>,
  px: number,
  py: number,
  stepX: number,
  stepY: number,
): number {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < TENT_OFFSETS.length; i++) {
    for (let j = 0; j < TENT_OFFSETS.length; j++) {
      const height = demBilinear(grids, px + TENT_OFFSETS[j]! * stepX, py + TENT_OFFSETS[i]! * stepY);
      if (Number.isNaN(height)) continue;
      const w = TENT_WEIGHTS[i]! * TENT_WEIGHTS[j]!;
      sum += height * w;
      weight += w;
    }
  }
  // Butun katak DEM'siz qolsa — dengiz sathi. Navoiy tekis, shuning uchun bu
  // holat kadrni buzmaydi, faqat o'sha joy biroz pastroq bo'ladi.
  return weight > 0 ? sum / weight : 0;
}

/**
 * Gauss silliqlash, `sigma` KATAKDA.
 *
 * Tent filtri aliasingni to'xtatadi, lekin SRTM'ning o'z shovqinini emas:
 * u manbada ham bor va to'r qadamiga yaqin chastotada yotadi. Navoiy
 * tekisligida haqiqiy relyef kilometr masshtabida (6 km da ~48 m), shovqin
 * esa har 67 metrda bir necha o'nlab santimetr — ikkalasini chastota bo'yicha
 * ajratsa bo'ladi.
 *
 * `0.8` katak (~53 m) o'lchab tanlangan: shaharda egrilik 1.82 m dan 0.39 m
 * ga tushadi (4.7 barobar silliq), janubdagi haqiqiy tog'lar esa cho'qqisidan
 * atigi 3.6 m yo'qotadi — 480 m relyefning 0.8% i. Ya'ni soxta do'ngliklar
 * ketadi, haqiqiylari qoladi.
 */
function smoothHeights(source: Float32Array, sigma: number): Float32Array {
  if (sigma <= 0) return source;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  for (let i = -radius; i <= radius; i++) kernel.push(Math.exp(-(i * i) / (2 * sigma * sigma)));

  // Ajratiladigan filtr: avval ustunlar bo'yicha, keyin qatorlar bo'yicha.
  // Bitta 2D yadroga qaraganda ancha arzon, natija esa aynan bir xil.
  const blur = (input: Float32Array, alongRow: boolean): Float32Array => {
    const out = new Float32Array(input.length);
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const centre = alongRow ? col : row;
        let sum = 0;
        let weight = 0;
        for (let i = -radius; i <= radius; i++) {
          const k = centre + i;
          // Chetda yadro qisqaradi: chekka qiymat sun'iy takrorlanmaydi.
          if (k < 0 || k >= GRID) continue;
          const w = kernel[i + radius]!;
          sum += input[alongRow ? row * GRID + k : k * GRID + col]! * w;
          weight += w;
        }
        out[row * GRID + col] = sum / weight;
      }
    }
    return out;
  };

  return blur(blur(source, true), false);
}

function buildGeometry(positions: Float32Array,detail:LakeTerrain|null): BufferGeometry {
  const indices:number[]=[];
  let offset = 0;
  for (let row = 0; row < GRID - 1; row++) {
    for (let col = 0; col < GRID - 1; col++) {
      if(detail?.ownsCell(col,row))continue;
      const a = row * GRID + col;
      const b = a + 1;
      const c = a + GRID;
      const d = c + 1;
      // Yuqoridan qaralganda old tomon: row janubga, col sharqqa o'sadi.
      indices[offset++] = a;
      indices[offset++] = c;
      indices[offset++] = b;
      indices[offset++] = b;
      indices[offset++] = c;
      indices[offset++] = d;
    }
  }

  const allPositions=Array.from(positions);
  const uvs:number[]=[];
  for(let row=0;row<GRID;row++) for(let col=0;col<GRID;col++) {
    const i=(row*GRID+col)*2; uvs[i]=col/6; uvs[i+1]=row/6;
  }
  if(detail) {
    const base=allPositions.length/3;
    for(let row=0;row<detail.nz;row++)for(let col=0;col<detail.nx;col++) {
      allPositions.push(detail.bounds.minX+col*detail.sx,detail.heights[row*detail.nx+col]!,detail.bounds.minZ+row*detail.sz);
      uvs.push((detail.c0+col/16)/6,(detail.r0+row/16)/6);
      if(col<detail.nx-1&&row<detail.nz-1){const a=base+row*detail.nx+col,b=a+1,c=a+detail.nx,d=c+1;indices.push(a,c,b,b,c,d);}
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(allPositions), 3));
  geometry.setAttribute('uv',new BufferAttribute(new Float32Array(uvs),2));
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
