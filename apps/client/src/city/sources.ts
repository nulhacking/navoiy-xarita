import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Texture,
} from 'three';

import { type TileCoord, tileKey } from '@xarita/geo';

/**
 * Tashqi bepul tayl manbalari. Ikkalasi ham kalitsiz va Web Mercator
 * `{z}/{x}/{y}` sxemasida — 2026-09-09 da HTTP so'rov bilan tekshirilgan.
 *
 * Atribut ekranda ko'rsatilishi litsenziya talabi (`ATTRIBUTIONS` ga qarang).
 */

/** Relyef: AWS Terrain Tiles, Terrarium formatidagi PNG. */
export const TERRAIN_SOURCE = {
  url: (t: TileCoord) =>
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${t.z}/${t.x}/${t.y}.png`,
  // z16 da 404 qaytaradi — tekshirilgan.
  maxZoom: 15,
  tileSize: 256,
  attribution: 'Balandlik: AWS Terrain Tiles (SRTM, NED, GMTED)',
} as const;

/**
 * Sun'iy yo'ldosh tasviri: EOX Sentinel-2 cloudless.
 * DIQQAT — URL tartibi `{z}/{y}/{x}`, odatdagi `{z}/{x}/{y}` emas (WMTS sxemasi).
 */
export const IMAGERY_SOURCE = {
  url: (t: TileCoord) =>
    `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${t.z}/${t.y}/${t.x}.jpg`,
  // Server z17+ ni ham beradi (o'zi kattalashtiradi), lekin haqiqiy aniqlik
  // 10 m/px — z14 atrofida tugaydi. Relyef z15 da to'xtagani uchun biz ham shu
  // yerda to'xtaymiz: ortiqcha so'rov bepul servisni bekorga yuklaydi.
  maxZoom: 15,
  tileSize: 256,
  attribution:
    'Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data)',
} as const;

export const OSM_ATTRIBUTION = '(c) OpenStreetMap contributors';

export const ATTRIBUTIONS: readonly string[] = [
  OSM_ATTRIBUTION,
  IMAGERY_SOURCE.attribution,
  TERRAIN_SOURCE.attribution,
];

/**
 * Terrarium PNG dan dekodlangan balandlik to'ri.
 * `size x size` qiymat, shimoli-g'arbdan janubi-sharqga qatorma-qator.
 */
export interface HeightGrid {
  size: number;
  /** Balandlik, metr. Dengiz sathidan past joylar manfiy. */
  data: Float32Array;
  min: number;
  max: number;
}

/**
 * Terrarium kodlashi: har piksel RGB da 1/256 m aniqlikda balandlikni saqlaydi.
 *
 *   height = R*256 + G + B/256 - 32768
 *
 * Siljish (32768) manfiy balandliklarni ifodalash uchun — O'lik dengiz -430 m.
 */
export function decodeTerrarium(pixels: Uint8ClampedArray, size: number): HeightGrid {
  const data = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const height = pixels[p]! * 256 + pixels[p + 1]! + pixels[p + 2]! / 256 - 32768;
    data[i] = height;
    if (height < min) min = height;
    if (height > max) max = height;
  }

  return { size, data, min, max };
}

/** Bir vaqtda ochiq so'rovlar soni — bepul servislarni ortiqcha yuklamaslik uchun. */
const MAX_CONCURRENT = 12;

/**
 * Tayl yuklovchi: bir xil tayl uchun takroriy so'rovni birlashtiradi,
 * navbat bilan cheklaydi va bekor qilishni qo'llab-quvvatlaydi.
 */
class TileLoader<T> {
  private readonly pending = new Map<string, Promise<T | null>>();
  private readonly controllers = new Map<string, AbortController>();
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly load: (tile: TileCoord, signal: AbortSignal) => Promise<T>) {}

  get(tile: TileCoord): Promise<T | null> {
    const key = tileKey(tile);
    const existing = this.pending.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    this.controllers.set(key, controller);

    const promise = this.schedule(async () => {
      try {
        return await this.load(tile, controller.signal);
      } catch (error) {
        // Bekor qilish xato emas, oddiy hol: tayl ko'rinishdan chiqdi.
        if (controller.signal.aborted) return null;
        throw error;
      } finally {
        this.pending.delete(key);
        this.controllers.delete(key);
      }
    });

    this.pending.set(key, promise);
    return promise;
  }

  /** Hali tugamagan so'rovni bekor qiladi. */
  abort(tile: TileCoord): void {
    this.controllers.get(tileKey(tile))?.abort();
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.pending.clear();
    this.queue.length = 0;
  }

  private schedule<R>(task: () => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const run = () => {
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.queue.shift()?.();
          });
      };
      if (this.active < MAX_CONCURRENT) run();
      else this.queue.push(run);
    });
  }
}

async function fetchImageBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal, mode: 'cors' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} - ${url}`);
  return createImageBitmap(await response.blob());
}

/**
 * Relyef manbasi. PNG ni ImageBitmap sifatida oladi va OffscreenCanvas orqali
 * piksellarga aylantiradi.
 *
 * `willReadFrequently: true` — brauzerga bu canvas'dan doim o'qishimizni
 * aytadi, shunda u tekstura ma'lumotini GPU'ga ko'chirmaydi. Busiz har
 * `getImageData` GPU'dan qaytarib o'qishga aylanadi va kadrni to'xtatadi.
 */
export class TerrainSource {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  private readonly loader = new TileLoader<HeightGrid>(async (tile, signal) => {
    const local = `/terrain/${tile.z}/${tile.x}/${tile.y}.png`;
    const bitmap = await fetchImageBitmap(local, signal).catch(() => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return fetchImageBitmap(TERRAIN_SOURCE.url(tile), signal);
    });
    try {
      return this.decode(bitmap);
    } finally {
      bitmap.close();
    }
  });

  private decode(bitmap: ImageBitmap): HeightGrid {
    const size = bitmap.width;
    if (!this.canvas || this.canvas.width !== size) {
      this.canvas = new OffscreenCanvas(size, size);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.ctx;
    if (!ctx) throw new Error('OffscreenCanvas 2D konteksti mavjud emas');

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bitmap, 0, 0);
    return decodeTerrarium(ctx.getImageData(0, 0, size, size).data, size);
  }

  get(tile: TileCoord): Promise<HeightGrid | null> {
    return this.loader.get(tile);
  }

  abort(tile: TileCoord): void {
    this.loader.abort(tile);
  }

  dispose(): void {
    this.loader.abortAll();
    this.canvas = null;
    this.ctx = null;
  }
}

/** Sun'iy yo'ldosh tasviri manbasi. */
export class ImagerySource {
  private readonly loader = new TileLoader<Texture>(async (tile, signal) => {
    const bitmap = await fetchImageBitmap(IMAGERY_SOURCE.url(tile), signal);
    const texture = new Texture(bitmap);
    // `flipY = false` — three.js sukut bo'yicha tasvirni ag'daradi, lekin
    // `ImageBitmap` uchun bu barcha brauzerlarda ishonchli ishlamaydi.
    // Ag'darmaslik esa aniq: tasvirning 0-qatori (shimol) t = 0 ga tushadi,
    // bizning UV ham v = 0 da shimol — ikkalasi to'g'ridan-to'g'ri mos keladi.
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    // Tayl chetida qo'shni taylning pikseli "sizib" chiqmasligi uchun.
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  });

  get(tile: TileCoord): Promise<Texture | null> {
    return this.loader.get(tile);
  }

  abort(tile: TileCoord): void {
    this.loader.abort(tile);
  }

  dispose(): void {
    this.loader.abortAll();
  }
}
