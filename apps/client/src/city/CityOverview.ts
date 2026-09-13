import { tileUvToLonLat, type TileCoord } from '@xarita/geo';

import type { CityFrame } from './CityFrame.ts';
import type { OsmSource } from './OsmSource.ts';
import type { CityMapData } from './CityTile.ts';

/** Umumiy xarita rasmining tomoni, piksel. */
const CANVAS_SIZE = 2048;

const COLORS = {
  background: '#161a20',
  water: '#1c3d52',
  green: '#2b4227',
  built: '#242830',
  roadMajor: '#e6e0d2',
  roadMinor: '#7d7a72',
} as const;

const GREEN_CLASSES = new Set(['park', 'grass', 'pitch', 'forest', 'scrub', 'farmland']);
const MAJOR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

export interface CityOverview {
  /** Butun shahar chizilgan rasm. */
  canvas: HTMLCanvasElement;
  /** Rasm qamragan chegaralar, mahalliy metrda. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Mahalliy metrni rasm pikseliga o'tkazish. */
  toPixel: (x: number, z: number) => { px: number; py: number };
  /** Rasm pikselini mahalliy metrga o'tkazish. */
  toWorld: (px: number, py: number) => { x: number; z: number };
  drawDetail: (ctx: CanvasRenderingContext2D, size: number, zoom: number, cx: number, cy: number) => void;
}

/**
 * Butun shaharning bir martalik umumiy xaritasi.
 *
 * Mini-xarita faqat o'yinchi atrofidagi yuklangan tayllardan chiziladi —
 * katta xarita uchun esa butun shahar kerak. Shuning uchun bake indeksidagi
 * BARCHA tayllar bir marta o'qib chiqiladi va natija bitta rasmga chiziladi.
 * Keyin uni ko'rsatish arzon: shunchaki rasmni chizamiz.
 *
 * Binolar ataylab chizilmaydi: shahar masshtabida 35 000 ta kontur o'qishga
 * yordam bermaydi, faqat xaritani "shovqin" bilan to'ldiradi. Ko'chalar,
 * suv va yashil zonalar orientir uchun yetarli.
 */
export async function buildCityOverview(
  osm: OsmSource,
  frame: CityFrame,
  onProgress?: (done: number, total: number) => void,
  extras: CityMapData[] = [],
): Promise<CityOverview | null> {
  const zoom = osm.zoom;
  const tiles = osm.tileList;
  if (zoom === null || tiles.length === 0) return null;

  // 1-qadam: barcha tayllarni o'qib, chegaralarni aniqlaymiz.
  //
  // Bo'laklarga bo'lib PARALLEL yuklaymiz. Ketma-ket `await` bilan 191 ta
  // so'rov birin-ketin ketardi va xarita ochilishi o'nlab sekund davom
  // etardi; bo'lak bilan bu bir necha sekundga tushadi.
  const BATCH = 24;
  const loaded: Array<{ coord: TileCoord; data: NonNullable<Awaited<ReturnType<OsmSource['get']>>> }> = [];

  for (let start = 0; start < tiles.length; start += BATCH) {
    const batch = tiles.slice(start, start + BATCH).map((key) => {
      const [x, y] = key.split('/').map(Number);
      const coord: TileCoord = { z: zoom, x: x!, y: y! };
      return osm.get(coord).then((data) => ({ coord, data }));
    });
    for (const { coord, data } of await Promise.all(batch)) {
      if (data) loaded.push({ coord, data });
    }
    onProgress?.(Math.min(start + BATCH, tiles.length), tiles.length);
  }
  if (loaded.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const point: number[] = [0, 0, 0];

  const corner = (coord: TileCoord, u: number, v: number): void => {
    const { lat, lon } = tileUvToLonLat(coord, u, v);
    frame.toLocalArray({ lat, lon, alt: 0 }, point);
    if (point[0]! < minX) minX = point[0]!;
    if (point[0]! > maxX) maxX = point[0]!;
    if (point[2]! < minZ) minZ = point[2]!;
    if (point[2]! > maxZ) maxZ = point[2]!;
  };
  for (const { coord } of loaded) {
    corner(coord, 0, 0);
    corner(coord, 1, 1);
  }

  // Kvadrat rasm: eng katta tomonni olib, kichigini markazlashtiramiz.
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const span = Math.max(width, depth);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const bounds = {
    minX: cx - span / 2,
    maxX: cx + span / 2,
    minZ: cz - span / 2,
    maxZ: cz + span / 2,
  };

  const scale = CANVAS_SIZE / span;
  const toPixel = (x: number, z: number) => ({
    px: (x - bounds.minX) * scale,
    py: (z - bounds.minZ) * scale,
  });
  const toWorld = (px: number, py: number) => ({
    x: bounds.minX + px / scale,
    z: bounds.minZ + py / scale,
  });

  // 2-qadam: chizish.
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const trace = (coord: TileCoord, extent: number, ring: number[]): void => {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i += 2) {
      const { lat, lon } = tileUvToLonLat(coord, ring[i]! / extent, ring[i + 1]! / extent);
      frame.toLocalArray({ lat, lon, alt: 0 }, point);
      const { px, py } = toPixel(point[0]!, point[2]!);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  };

  // Qatlam tartibi: yuza -> suv -> yo'l. Yo'llar eng ustida.
  for (const { coord, data } of loaded) {
    for (const area of data.areas ?? []) {
      ctx.fillStyle = GREEN_CLASSES.has(area.c) ? COLORS.green : COLORS.built;
      trace(coord, data.extent, area.r);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (const { coord, data } of loaded) {
    ctx.fillStyle = COLORS.water;
    for (const w of data.water) {
      trace(coord, data.extent, w.r);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (const { coord, data } of loaded) {
    for (const road of data.roads) {
      const major = MAJOR_ROADS.has(road.c);
      ctx.strokeStyle = major ? COLORS.roadMajor : COLORS.roadMinor;
      ctx.lineWidth = major ? 3 : 1.4;
      trace(coord, data.extent, road.p);
      ctx.stroke();
    }
  }

  // Vector detail stays sharp at street zoom; do not just enlarge the overview bitmap.
  type Detail = { path: Path2D; minX: number; minY: number; maxX: number; maxY: number; width: number; name: string; kind: string };
  const details: Detail[] = [];
  const seen = new Set<string>();
  for (const { coord, data } of loaded) {
    for (const item of [
      ...(data.areas ?? []).map((a) => ({ points: a.r, id: undefined, kind: GREEN_CLASSES.has(a.c) ? 'green' : 'area', width: 0, name: '' })),
      ...data.water.map((w) => ({ points: w.r, id: undefined, kind: 'water', width: 0, name: '' })),
      ...data.buildings.map((b) => ({ points: b.r, id: b.id, kind: 'building', width: 0, name: b.name ?? '' })),
      ...data.roads.map((r) => ({ points: r.p, id: r.id, kind: 'road', width: r.w, name: r.n ?? '' })),
    ]) {
      const path = new Path2D();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < item.points.length; i += 2) {
        const { lat, lon } = tileUvToLonLat(coord, item.points[i]! / data.extent, item.points[i+1]! / data.extent);
        frame.toLocalArray({ lat, lon, alt: 0 }, point);
        const { px, py } = toPixel(point[0]!, point[2]!);
        if (i === 0) path.moveTo(px, py); else path.lineTo(px, py);
        minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
      }
      const key = `${item.kind}:${item.id ?? [minX,minY,maxX,maxY].map((v) => v.toFixed(2)).join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.kind !== 'road') path.closePath();
      details.push({ path, minX, minY, maxX, maxY, width: item.width * scale, name: item.name, kind: item.kind });
    }
  }
  // Authored landmark paths must agree between the 3D scene, minimap and large map.
  for(const extra of extras)for(const item of [
    ...extra.roads.map(r=>({pts:r.pts,width:r.width,kind:'road',name:r.name??''})),
    ...extra.areas.map(a=>({pts:a.pts,width:0,kind:'area',name:''})),
  ]) {
    const path=new Path2D();let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let i=0;i<item.pts.length;i+=2){const {px,py}=toPixel(item.pts[i]!,item.pts[i+1]!);if(i===0)path.moveTo(px,py);else path.lineTo(px,py);minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);}
    if(item.kind!=='road')path.closePath();
    details.push({path,minX,minY,maxX,maxY,width:item.width*scale,name:item.name,kind:item.kind});
    if(item.kind==='road'){ctx.strokeStyle=COLORS.roadMinor;ctx.lineWidth=Math.max(.3,item.width*scale);ctx.stroke(path);}
  }
  const order: Record<string, number> = { area: 0, green: 1, water: 2, building: 3, road: 4 };
  details.sort((a, b) => order[a.kind]! - order[b.kind]!);
  const drawDetail: CityOverview['drawDetail'] = (context, size, zoomLevel, centerX, centerY) => {
    if (zoomLevel < 3) return;
    context.fillStyle = COLORS.background;
    context.fillRect(0, 0, size, size);
    const k = size * zoomLevel / CANVAS_SIZE;
    const x0 = (centerX - 0.5 / zoomLevel) * CANVAS_SIZE, y0 = (centerY - 0.5 / zoomLevel) * CANVAS_SIZE;
    const x1 = x0 + CANVAS_SIZE / zoomLevel, y1 = y0 + CANVAS_SIZE / zoomLevel;
    const visible = details.filter((d) => d.maxX >= x0 && d.minX <= x1 && d.maxY >= y0 && d.minY <= y1);
    context.save(); context.translate(-x0*k, -y0*k); context.scale(k,k);
    for (const d of visible) {
      if (d.kind === 'road') {
        context.strokeStyle = '#b9b7ad'; context.lineWidth = Math.max(d.width, 0.7/k); context.stroke(d.path);
      } else {
        context.fillStyle = ({ water: '#24536c', building: '#626b72', green: '#314c37', area: '#242830' } as Record<string, string>)[d.kind]!;
        context.fill(d.path);
        if (d.kind === 'building') { context.strokeStyle = '#282f37'; context.lineWidth = 0.6/k; context.stroke(d.path); }
      }
    }
    context.restore();
    const labels = new Set<string>();
    const labelBoxes: Array<{ x: number; y: number; width: number }> = [];
    context.font = '11px system-ui'; context.textAlign = 'center';
    for (const d of [...visible].sort((a, b) => b.width - a.width)) {
      if (!d.name || d.kind !== 'road' || zoomLevel < 5) continue;
      const x = ((d.minX+d.maxX)/2-x0)*k, y = ((d.minY+d.maxY)/2-y0)*k;
      const width = context.measureText(d.name).width + 12;
      if (x < width/2 || y < 16 || x > size-width/2 || y > size-16) continue;
      if (labels.has(d.name) || labelBoxes.some((b) => Math.abs(x-b.x) < (width+b.width)/2 && Math.abs(y-b.y) < 24)) continue;
      labels.add(d.name); labelBoxes.push({ x, y, width });
      context.lineWidth = 3; context.strokeStyle = '#151d25'; context.fillStyle = '#ffffff';
      context.strokeText(d.name, x, y); context.fillText(d.name, x, y);
    }
  };
  onProgress?.(tiles.length, tiles.length);
  return { canvas, bounds, toPixel, toWorld, drawDetail };
}
