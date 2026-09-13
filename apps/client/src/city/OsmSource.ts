import { type TileCoord, tileKey } from '@xarita/geo';
import type { BuildingTags } from './BuildingStyle.ts';

/**
 * `tools/osm-pipeline/bake.mjs` chiqargan tayl formati.
 *
 * Koordinatalar tayl ichidagi butun sonlar: `[0, extent]` oralig'i taylning
 * o'ziga to'g'ri keladi. Chegaradan chiqib ketgan obyektlar uchun qiymat
 * manfiy yoki `extent` dan katta bo'lishi mumkin — bu normal, chunki bino
 * yoki yo'l tayl chetidan oshib turishi mumkin.
 */
export interface OsmTileData {
  z: number;
  x: number;
  y: number;
  extent: number;
  buildings: Array<BuildingTags & {
    /** Balandligi, metr. */
    h: number;
    /** Pastki chegarasi (osma qismlar uchun), metr. */
    m: number;
    /** Halqa: [x0, y0, x1, y1, ...] */
    r: number[];
  }>;
  roads: Array<{
    c: string;
    /** Eni, metr. */
    w: number;
    /** Ko'prikmi (1/0). */
    b: number;
    id?: number;
    n?: string;
    o?: number;
    t?: number;
    p: number[];
  }>;
  water: Array<{ r: number[] }>;
  /** Yer qoplamasi: park, o't, sanoat zonasi, avtoturargoh va h.k. */
  areas?: Array<{ c: string; r: number[] }>;
}

/** Bake indeksi — qaysi tayllar mavjudligini oldindan bilish uchun. */
interface OsmIndex {
  zoom: number;
  extent: number;
  region: string;
  bbox: [number, number, number, number];
  tiles: string[];
}

/**
 * Bir vaqtda ochiq so'rovlar. Bu fayllar bizning o'z serverimizdan keladi
 * (tashqi servis emas), shuning uchun chegara faqat brauzerning o'z
 * cheklovini hisobga oladi.
 */
const MAX_CONCURRENT = 16;

/**
 * Oldindan tayyorlangan OSM tayllarini o'qiydi.
 *
 * Indeks eng muhim qismi: u bo'lmasa har bir ko'rinadigan tayl uchun 404
 * so'rov ketardi. Bake faqat bitta shahar uchun qilingani sababli tayllarning
 * aksariyati mavjud emas — indeks ularni so'ramaslikni ta'minlaydi.
 */
export class OsmSource {
  private index: Set<string> | null = null;
  private indexPromise: Promise<void> | null = null;
  private indexMeta: OsmIndex | null = null;

  private readonly cache = new Map<string, OsmTileData>();
  private readonly pending = new Map<string, Promise<OsmTileData | null>>();
  private readonly controllers = new Map<string, AbortController>();
  private active = 0;
  private readonly queue: (() => void)[] = [];

  /** Bake qilingan tayllar darajasi (indeks yuklanmaguncha `null`). */
  get zoom(): number | null {
    return this.indexMeta?.zoom ?? null;
  }

  get extent(): number | null {
    return this.indexMeta?.extent ?? null;
  }

  get region(): string | null {
    return this.indexMeta?.region ?? null;
  }

  /** Bake qilingan barcha tayllar ro'yxati ("x/y" ko'rinishida). */
  get tileList(): string[] {
    return this.indexMeta?.tiles ?? [];
  }

  /** Bake qilingan hudud chegarasi: [janub, g'arb, shimol, sharq]. */
  get bbox(): [number, number, number, number] | null {
    return this.indexMeta?.bbox ?? null;
  }

  /**
   * Butun shahar suvining konturlari: `[[lon, lat, lon, lat, …], …]`.
   *
   * Tayl ichidagi nusxa yetarli emas, chunki relyef bitta mesh sifatida,
   * tayllar kelishidan oldin quriladi — suv tubini esa aynan o'sha qadamda
   * o'yish kerak (`Ground` ga qarang).
   */
  async waterRings(): Promise<number[][]> {
    try {
      const response = await fetch('/osm/water.json');
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = (await response.json()) as { rings?: number[][] };
      return data.rings ?? [];
    } catch {
      // Eski bake'da bu fayl yo'q — suv shunchaki o'yilmaydi, o'yin ishlaydi.
      return [];
    }
  }

  /** Indeksni bir marta yuklaydi. Takroriy chaqiruvlar bir promise'ni kutadi. */
  loadIndex(): Promise<void> {
    this.indexPromise ??= (async () => {
      try {
        const response = await fetch('/osm/index.json');
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const meta = (await response.json()) as OsmIndex;
        this.indexMeta = meta;
        this.index = new Set(meta.tiles);
      } catch {
        // Bake qilinmagan bo'lsa — bu xato emas, shunchaki OSM qatlami yo'q.
        this.index = new Set();
      }
    })();
    return this.indexPromise;
  }

  /** Bu taylda ma'lumot bormi? Indeks yuklanmagan bo'lsa `false`. */
  has(tile: TileCoord): boolean {
    return this.index?.has(`${tile.x}/${tile.y}`) ?? false;
  }

  get(tile: TileCoord): Promise<OsmTileData | null> {
    const key = tileKey(tile);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);

    const existing = this.pending.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    this.controllers.set(key, controller);

    const promise = this.schedule(async () => {
      try {
        const response = await fetch(`/osm/${tile.z}/${tile.x}/${tile.y}.json`, {
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const data = (await response.json()) as OsmTileData;
        this.cache.set(key, data);
        return data;
      } catch {
        return null;
      } finally {
        this.pending.delete(key);
        this.controllers.delete(key);
      }
    });

    this.pending.set(key, promise);
    return promise;
  }

  abort(tile: TileCoord): void {
    this.controllers.get(tileKey(tile))?.abort();
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
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

  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.pending.clear();
    this.cache.clear();
    this.queue.length = 0;
  }
}
