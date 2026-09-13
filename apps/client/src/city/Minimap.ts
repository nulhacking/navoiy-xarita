import type { CityMapData } from './CityTile.ts';

/** Xarita radiusi metrda — GTA'dagi kabi taxminan bir mahalla ko'rinadi. */
const RADIUS_METERS = 170;

/** Sekundiga necha marta qayta chiziladi. 12 Hz silliq ko'rinadi va arzon. */
const REDRAW_HZ = 12;

const COLORS = {
  background: '#1d2229',
  area: {
    park: '#2f4a2a',
    grass: '#35502c',
    pitch: '#2c4a28',
    forest: '#263d20',
    scrub: '#3a4229',
    farmland: '#4a4529',
    sand: '#5a5340',
    bare: '#403c35',
    residential: '#2a2e35',
    urban: '#2d3138',
    industrial: '#33342f',
    parking: '#31343b',
  } as Record<string, string>,
  water: '#1e4258',
  building: '#4a5058',
  roadMajor: '#d8d2c4',
  roadMinor: '#8f8b82',
  player: '#ffcf4d',
  car: '#e2543c',
  waypoint: '#ffd166',
} as const;

/** Bu sinflar "katta yo'l" deb hisoblanadi — ular yorqinroq chiziladi. */
const MAJOR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

export interface MinimapSource {
  /** Ko'rinadigan tayllarning 2D ma'lumoti. */
  mapTiles(): Iterable<CityMapData>;
  /** O'yinchining shahar freymidagi joyi. */
  playerXZ(): { x: number; z: number };
  /** O'yinchi qaragan yo'nalish, radian (0 = shimol, soat strelkasi bo'yicha). */
  playerHeading(): number;
  /** Mashina joyi — o'yinchi piyoda bo'lganda ko'rsatiladi. */
  carXZ(): { x: number; z: number } | null;
  /** Katta xaritada qo'yilgan metka, agar bo'lsa. */
  waypoint(): { x: number; z: number } | null;
}

/**
 * GTA uslubidagi dumaloq mini-xarita.
 *
 * Alohida 3D render o'tishi (render-to-texture) o'rniga oddiy 2D canvas —
 * u ancha arzon va aniqroq: chiziqlar tiniq, ranglar nazorat ostida.
 * Ma'lumot `CityTile` qurilayotganda yig'ilgan 2D konturlardan olinadi.
 *
 * Xarita O'YINCHI BILAN AYLANADI: yuqori har doim "oldinga" tomon.
 * Shimol qayerdaligini alohida belgi ko'rsatadi.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly source: MinimapSource;
  private timer = 0;
  /** CSS pikselidagi o'lcham (kvadrat). */
  private size = 0;

  constructor(canvas: HTMLCanvasElement, source: MinimapSource) {
    this.canvas = canvas;
    this.source = source;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Mini-xarita uchun 2D kontekst mavjud emas');
    this.ctx = ctx;
    this.resize();
    this.draw();
  }

  /** Canvas o'lchamini CSS o'lchamiga va piksel zichligiga moslaydi. */
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.round(rect.width || 180);
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (this.size === size && this.canvas.width === size * dpr) return;
    this.size = size;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    // Bundan keyin barcha chizish CSS pikselida bo'ladi.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  update(dt: number): void {
    this.timer += dt;
    if (this.timer < 1 / REDRAW_HZ) return;
    this.timer = 0;
    this.draw();
  }

  private draw(): void {
    this.resize();
    const { ctx } = this;
    const size = this.size;
    if (size === 0) return;

    const center = size / 2;
    const scale = center / RADIUS_METERS;
    const player = this.source.playerXZ();
    const heading = this.source.playerHeading();

    ctx.save();
    ctx.clearRect(0, 0, size, size);

    // Dumaloq qirqim: undan tashqarida hech narsa chizilmaydi.
    ctx.beginPath();
    ctx.arc(center, center, center - 1, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, size, size);

    // Dunyo -> xarita almashtirishi.
    // Ketma-ketlik: markazga surish -> o'yinchi burilishiga teskari aylantirish
    // -> masshtab -> o'yinchini nolga surish. Shunda o'yinchi doim markazda
    // turadi va u qaragan tomon doim yuqoriga qaraydi.
    ctx.translate(center, center);
    ctx.rotate(heading);
    ctx.scale(scale, scale);
    ctx.translate(-player.x, -player.z);

    // Chiziq eni dunyo birligida beriladi, shuning uchun masshtabga bo'linadi.
    const px = 1 / scale;

    for (const tile of this.source.mapTiles()) {
      this.drawAreas(tile, player);
    }
    for (const tile of this.source.mapTiles()) {
      this.drawWater(tile, player);
    }
    for (const tile of this.source.mapTiles()) {
      this.drawBuildings(tile, player);
    }
    // Yo'llar eng ustida: GTA'da ham ko'cha to'ri asosiy orientir.
    for (const tile of this.source.mapTiles()) {
      this.drawRoads(tile, player, px);
    }

    ctx.restore();

    this.drawMarkers(center, scale, player, heading);
    this.drawFrame(center);
  }

  /** Nuqta xarita doirasiga tushadimi (tez, taxminiy tekshiruv). */
  private inRange(pts: Float32Array, player: { x: number; z: number }): boolean {
    // Konturning istalgan nuqtasi radius ichida bo'lsa yetarli. Chekkadagi
    // katta poligonlar biroz ortiqcha chiziladi, lekin qirqim ularni kesadi.
    const limit = (RADIUS_METERS + 120) ** 2;
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i]! - player.x;
      const dz = pts[i + 1]! - player.z;
      if (dx * dx + dz * dz < limit) return true;
    }
    return false;
  }

  private tracePolygon(pts: Float32Array): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    ctx.closePath();
  }

  private drawAreas(tile: CityMapData, player: { x: number; z: number }): void {
    for (const area of tile.areas) {
      if (!this.inRange(area.pts, player)) continue;
      this.ctx.fillStyle = COLORS.area[area.cls] ?? '#2b2f36';
      this.tracePolygon(area.pts);
      this.ctx.fill();
    }
  }

  private drawWater(tile: CityMapData, player: { x: number; z: number }): void {
    this.ctx.fillStyle = COLORS.water;
    for (const pts of tile.water) {
      if (!this.inRange(pts, player)) continue;
      this.tracePolygon(pts);
      this.ctx.fill();
    }
  }

  private drawBuildings(tile: CityMapData, player: { x: number; z: number }): void {
    this.ctx.fillStyle = COLORS.building;
    for (const pts of tile.buildings) {
      if (!this.inRange(pts, player)) continue;
      this.tracePolygon(pts);
      this.ctx.fill();
    }
  }

  private drawRoads(tile: CityMapData, player: { x: number; z: number }, px: number): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const road of tile.roads) {
      if (road.pts.length < 4 || !this.inRange(road.pts, player)) continue;
      const major = MAJOR_ROADS.has(road.cls);
      ctx.strokeStyle = major ? COLORS.roadMajor : COLORS.roadMinor;
      // Haqiqiy en juda ingichka chiqadi, shuning uchun eng kam qalinlik
      // piksel birligida beriladi — xarita o'qiladigan bo'lib qolsin.
      ctx.lineWidth = Math.max(road.width * 0.55, (major ? 2.4 : 1.5) * px);
      ctx.beginPath();
      ctx.moveTo(road.pts[0]!, road.pts[1]!);
      for (let i = 2; i < road.pts.length; i += 2) {
        ctx.lineTo(road.pts[i]!, road.pts[i + 1]!);
      }
      ctx.stroke();
    }
  }

  /** O'yinchi va mashina belgilari — bular aylanmaydigan qatlamda. */
  private drawMarkers(
    center: number,
    scale: number,
    player: { x: number; z: number },
    heading: number,
  ): void {
    const { ctx } = this;

    const car = this.source.carXZ();
    if (car) {
      // Mashina belgisi xarita bilan birga aylanadi, shuning uchun uning
      // ekrandagi joyini qo'lda hisoblaymiz.
      const dx = (car.x - player.x) * scale;
      const dz = (car.z - player.z) * scale;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      const sx = center + dx * cos - dz * sin;
      const sy = center + dx * sin + dz * cos;
      const distance = Math.hypot(sx - center, sy - center);
      if (distance < center - 6) {
        ctx.fillStyle = COLORS.car;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Metka. Doiradan tashqarida bo'lsa, chekkasiga "yopishtiriladi" —
    // shunda yo'nalish har doim ko'rinib turadi, xuddi GTA'dagi kabi.
    const target = this.source.waypoint();
    if (target) {
      const dx = (target.x - player.x) * scale;
      const dz = (target.z - player.z) * scale;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      let wx = dx * cos - dz * sin;
      let wy = dx * sin + dz * cos;
      const distance = Math.hypot(wx, wy);
      const limit = center - 9;
      if (distance > limit) {
        wx = (wx / distance) * limit;
        wy = (wy / distance) * limit;
      }
      ctx.fillStyle = COLORS.waypoint;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(center + wx, center + wy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // O'yinchi — markazda, yuqoriga qaragan uchburchak.
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.moveTo(center, center - 7);
    ctx.lineTo(center + 5, center + 6);
    ctx.lineTo(center, center + 3);
    ctx.lineTo(center - 5, center + 6);
    ctx.closePath();
    ctx.fill();
  }

  /** Ramka va shimol belgisi. */
  private drawFrame(center: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, center - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
