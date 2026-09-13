/**
 * OSM ekstraktidan o'yin uchun tayyor tayllarni tayyorlaydi.
 *
 * Ishlatish:
 *   node tools/osm-pipeline/bake.mjs                 (standart: navoiy)
 *   node tools/osm-pipeline/bake.mjs samarkand
 *   node tools/osm-pipeline/bake.mjs --bbox 40.0,65.3,40.2,65.5
 *
 * Natija: apps/client/public/osm/{z}/{x}/{y}.json
 *
 * NIMA UCHUN OLDINDAN TAYYORLANADI (runtime'da so'ralmaydi):
 *   - Overpass API `out geom` so'rovlarida ishonchsiz (timeout bergan).
 *   - Rasmiy OSM API bulk yuklashni taqiqlaydi.
 *   - Tayyor vektor tayl servislari (OpenFreeMap) bino qatlamini kesadi:
 *     Navoiy markazidagi z14 taylda 11 ta bino, OSM'ning o'zida esa 24 686 ta.
 * Xom ekstraktdan o'zimiz tayyorlash — yagona to'liq va ishonchli yo'l.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { download } from './download.mjs';
import { readOsmPbf } from './pbf-reader.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '../../apps/client/public/osm');

/** Tayl darajasi. z14 ≈ 2.4 km — bir taylda ~800 bino, qulay bo'lak. */
const ZOOM = 14;

/**
 * Tayl ichidagi koordinata to'ri. 2.4 km / 16384 ≈ 15 sm —
 * bino devorlari uchun yetarli, JSON raqamlari esa qisqa qoladi.
 */
const EXTENT = 16384;

/** Chegara yaqinidagi way'lar node'lari yo'qolmasligi uchun zaxira, gradus. */
const BBOX_PADDING = 0.05;

/** [janub, g'arb, shimol, sharq] */
const REGIONS = {
  navoiy: [40.03, 65.28, 40.19, 65.48],
  samarkand: [39.60, 66.89, 39.72, 67.06],
  bukhara: [39.72, 64.35, 39.83, 64.48],
  tashkent: [41.22, 69.15, 41.40, 69.40],
};

// --- Balandlik evristikasi ---------------------------------------------------

/** Bir qavatning o'rtacha balandligi, metr. */
const FLOOR_HEIGHT = 3.2;

/**
 * Bino tipiga qarab taxminiy balandlik.
 *
 * O'zbekistonda OSM'da `height` va `building:levels` teglari kam uchraydi
 * (Navoiyda binolarning ~2% ida bor), shuning uchun qolganini tipdan
 * baholaymiz. Bu taxmin, lekin barcha binoni bir xil balandlikda ko'rsatishdan
 * ancha yaxshi — shahar siluети tanib olinadigan bo'ladi.
 */
const HEIGHT_BY_TYPE = {
  apartments: 5 * FLOOR_HEIGHT,
  residential: 3 * FLOOR_HEIGHT,
  house: 2 * FLOOR_HEIGHT,
  detached: 2 * FLOOR_HEIGHT,
  bungalow: 1 * FLOOR_HEIGHT,
  hut: 2.5,
  shed: 2.5,
  garage: 2.8,
  garages: 2.8,
  carport: 2.6,
  roof: 3,
  greenhouse: 3.5,
  school: 3 * FLOOR_HEIGHT,
  university: 4 * FLOOR_HEIGHT,
  hospital: 4 * FLOOR_HEIGHT,
  hotel: 6 * FLOOR_HEIGHT,
  office: 5 * FLOOR_HEIGHT,
  commercial: 2 * FLOOR_HEIGHT,
  retail: 2 * FLOOR_HEIGHT,
  supermarket: 6,
  industrial: 8,
  warehouse: 8,
  factory: 9,
  train_station: 10,
  mosque: 12,
  church: 12,
  civic: 4 * FLOOR_HEIGHT,
  public: 4 * FLOOR_HEIGHT,
  government: 5 * FLOOR_HEIGHT,
  tower: 25,
  construction: 6,
  yes: 7,
};

/** `height` tegini metrga aylantiradi ("12", "12 m", "40'" kabi shakllar). */
function parseHeight(value) {
  if (!value) return null;
  const feet = /^([\d.]+)\s*'/.exec(value);
  if (feet) return parseFloat(feet[1]) * 0.3048;
  const meters = parseFloat(value);
  return Number.isFinite(meters) && meters > 0 && meters < 1000 ? meters : null;
}

function buildingHeight(tags, id = 0) {
  const explicit = parseHeight(tags.height);
  if (explicit) return explicit;

  const levels = parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0 && levels < 200) {
    // Tomning o'zi ham balandlik qo'shadi.
    return levels * FLOOR_HEIGHT + 1;
  }

  const base = HEIGHT_BY_TYPE[tags.building] ?? HEIGHT_BY_TYPE.yes;
  const seed = ((Math.imul(Number(id) >>> 0, 1664525) + 1013904223) >>> 0) / 4294967296;
  const type = tags.building ?? 'yes';
  const spread = ['house','detached','residential','yes','apartments','industrial','warehouse'].includes(type) ? .38 : .2;
  return base * (1-spread/2+seed*spread);
}

/** Osma qismlar uchun (ko'prik ostidagi bino qismi va h.k.). */
function buildingMinHeight(tags) {
  const explicit = parseHeight(tags.min_height);
  if (explicit) return explicit;
  const minLevel = parseFloat(tags['building:min_level']);
  return Number.isFinite(minLevel) && minLevel > 0 ? minLevel * FLOOR_HEIGHT : 0;
}

// --- Yo'llar -----------------------------------------------------------------

/** Yo'l sinfi → yo'lakning to'liq eni, metr (ikki tomonlama). */
const ROAD_WIDTH = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  service: 4,
  pedestrian: 5,
  footway: 2,
  path: 1.5,
  track: 3,
  cycleway: 2,
  steps: 2,
};

const ROAD_LINK = /^(motorway|trunk|primary|secondary|tertiary)_link$/;

// --- Yer qoplamasi ---------------------------------------------------------

/**
 * OSM tegi -> bizning yuza sinfimiz.
 *
 * Bu GTA ko'rinishi uchun muhim: yer faqat bitta rangda bo'lsa, shahar
 * yassi va sun'iy ko'rinadi. Park, maydon, sanoat zonasi va avtoturargoh
 * bir-biridan farq qilsa, ko'z uchun makon "o'qiladigan" bo'ladi.
 */
const AREA_CLASSES = [
  ['leisure', { park: 'park', garden: 'park', pitch: 'pitch', playground: 'pitch', golf_course: 'grass', stadium: 'pitch' }],
  ['landuse', {
    grass: 'grass', meadow: 'grass', village_green: 'grass', recreation_ground: 'grass',
    forest: 'forest', farmland: 'farmland', farmyard: 'farmland', orchard: 'forest',
    vineyard: 'farmland', cemetery: 'grass', allotments: 'farmland',
    residential: 'residential', industrial: 'industrial', retail: 'urban',
    commercial: 'urban', construction: 'bare', quarry: 'bare', railway: 'bare',
  }],
  ['natural', { wood: 'forest', scrub: 'scrub', grassland: 'grass', sand: 'sand', bare_rock: 'bare', heath: 'scrub' }],
  ['amenity', { parking: 'parking', school: 'urban', hospital: 'urban', university: 'urban' }],
];

function areaClass(tags) {
  for (const [key, mapping] of AREA_CLASSES) {
    const value = tags[key];
    if (value && mapping[value]) return mapping[value];
  }
  return null;
}

function roadClass(tags) {
  const value = tags.highway;
  if (!value) return null;
  if (ROAD_WIDTH[value]) return value;
  const link = ROAD_LINK.exec(value);
  return link ? link[1] : null;
}

// --- Mercator yordamchilari (packages/geo bilan bir xil formulalar) ----------

const MERCATOR_MAX_LAT = 85.0511287798066;

function lonToMercatorX(lon) {
  return (lon + 180) / 360;
}

function latToMercatorY(lat) {
  const clamped = Math.min(Math.max(lat, -MERCATOR_MAX_LAT), MERCATOR_MAX_LAT);
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

// --- Bake --------------------------------------------------------------------

function parseArgs(argv) {
  const bboxFlag = argv.indexOf('--bbox');
  if (bboxFlag !== -1) {
    const parts = (argv[bboxFlag + 1] ?? '').split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error('--bbox uchun format: janub,g\'arb,shimol,sharq');
    }
    return { name: 'bbox', bbox: parts };
  }
  const name = argv.find((a) => !a.startsWith('--')) ?? 'navoiy';
  const bbox = REGIONS[name];
  if (!bbox) {
    throw new Error(`Noma'lum hudud "${name}". Mavjud: ${Object.keys(REGIONS).join(', ')}`);
  }
  return { name, bbox };
}

async function main() {
  const { name, bbox } = parseArgs(process.argv.slice(2));
  const [south, west, north, east] = bbox;
  // Chegarada kesilgan way'lar node'sini yo'qotmaslik uchun kengroq o'qiymiz.
  const padded = [south - BBOX_PADDING, west - BBOX_PADDING, north + BBOX_PADDING, east + BBOX_PADDING];

  console.log(`[bake] hudud: ${name}  bbox: ${bbox.join(', ')}`);

  // Hudud nomi bake'niki; Geofabrik ekstrakti esa doim butun mamlakat.
  const extract = await download();
  console.log('[bake] ekstrakt o\'qilmoqda…');
  const buffer = readFileSync(extract);

  // Node xaritasi: id → indeks, koordinatalar parallel massivlarda.
  // Faqat bbox ichidagi node'lar saqlanadi — aks holda 17M node xotiraga sig'maydi.
  const nodeIndex = new Map();
  const nodeLat = [];
  const nodeLon = [];

  const buildings = [];
  const roads = [];
  const water = [];
  const areas = [];
  // Alohida daraxtlar: OSM'da bular way emas, TEG QO'YILGAN NODE.
  const trees = [];

  let seenNodes = 0;
  let seenWays = 0;
  let skippedIncomplete = 0;

  const t0 = Date.now();

  readOsmPbf(buffer, {
    node(id, lat, lon, tags) {
      seenNodes++;
      if (lat < padded[0] || lat > padded[2] || lon < padded[1] || lon > padded[3]) return;
      nodeIndex.set(id, nodeLat.length);
      nodeLat.push(lat);
      nodeLon.push(lon);

      if (tags && (tags.natural === 'tree' || tags.natural === 'shrub')) {
        trees.push({ lon, lat, shrub: tags.natural === 'shrub' });
      }
    },

    way(id, refs, tags) {
      seenWays++;
      if (!tags || refs.length < 2) return;

      const isBuilding = Boolean(tags.building) && tags.building !== 'no';
      const road = roadClass(tags);
      const linearWater = ['river', 'canal', 'stream', 'drain', 'ditch'].includes(tags.waterway);
      const isWater = linearWater ||
        tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir';
      const area = isBuilding || road || isWater ? null : areaClass(tags);
      if (!isBuilding && !road && !isWater && !area) return;

      // Koordinatalarni yechamiz. Bitta node yetishmasa — way bbox chetidan
      // chiqib ketgan, uni tashlaymiz (padding shu holatni kamaytiradi).
      const points = new Array(refs.length);
      for (let i = 0; i < refs.length; i++) {
        const index = nodeIndex.get(refs[i]);
        if (index === undefined) {
          skippedIncomplete++;
          return;
        }
        points[i] = [nodeLon[index], nodeLat[index]];
      }

      if (isBuilding) {
        buildings.push({ points, height: buildingHeight(tags, id), minHeight: buildingMinHeight(tags),
          meta: { id, kind: tags.building, levels: Number(tags['building:levels']) || undefined,
            name: tags.name, colour: tags['building:colour'], material: tags['building:material'],
            roofColour: tags['roof:colour'], roofShape: tags['roof:shape'] } });
      } else if (road) {
        roads.push({ points, cls: road, width: parseHeight(tags.width) ?? ROAD_WIDTH[road] ?? 6,
          id, name: tags.name ?? '', bridge: !!tags.bridge && tags.bridge !== 'no',
          tunnel: !!tags.tunnel && tags.tunnel !== 'no',
          oneway: tags.oneway === '-1' ? -1 : ['yes', '1', 'true'].includes(tags.oneway) || (tags.junction === 'roundabout' && tags.oneway !== 'no') ? 1 : 0 });
      } else if (isWater) {
        // Linear waterways are buffered in metres; absent width tags use an explicit estimate.
        const width = parseHeight(tags.width) ?? ({ river: 24, canal: 8, stream: 3, drain: 2, ditch: 1.5 }[tags.waterway] ?? 0);
        if (linearWater) {
          for (let i = 0; i + 1 < points.length; i++) {
            const a = points[i], b = points[i + 1];
            const lonScale = 111320 * Math.cos((a[1] + b[1]) * Math.PI / 360);
            const dx = (b[0] - a[0]) * lonScale, dz = (b[1] - a[1]) * 111320;
            const length = Math.hypot(dx, dz);
            if (length < 0.1) continue;
            const nx = -dz / length * width / 2 / lonScale, nz = dx / length * width / 2 / 111320;
            water.push({ points: [[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz],[a[0]+nx,a[1]+nz]] });
          }
        } else if (refs[0] === refs[refs.length - 1]) water.push({ points });
      } else {
        // Yuza yopiq halqa bo'lishi kerak, aks holda uni to'ldirib bo'lmaydi.
        if (points.length >= 4) areas.push({ points, cls: area });
      }
    },
  });

  console.log(
    `[bake] o'qildi ${((Date.now() - t0) / 1000).toFixed(1)} s — ` +
      `${seenNodes.toLocaleString()} node, ${seenWays.toLocaleString()} way`,
  );
  console.log(
    `[bake] bbox ichida: ${nodeIndex.size.toLocaleString()} node | ` +
      `${buildings.length.toLocaleString()} bino, ${roads.length.toLocaleString()} yo'l, ` +
      `${water.length.toLocaleString()} suv, ${areas.length.toLocaleString()} yuza, ` +
      `${trees.length.toLocaleString()} daraxt`,
  );

  // --- Tayllarga taqsimlash ---
  const tiles = new Map();
  const n = 2 ** ZOOM;

  const addToTiles = (points, kind, payload) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [lon, lat] of points) {
      const mx = lonToMercatorX(lon) * n;
      const my = latToMercatorY(lat) * n;
      if (mx < minX) minX = mx;
      if (mx > maxX) maxX = mx;
      if (my < minY) minY = my;
      if (my > maxY) maxY = my;
    }

    const x0 = Math.floor(minX);
    const x1 = Math.floor(maxX);
    const y0 = Math.floor(minY);
    const y1 = Math.floor(maxY);
    // Uzun yo'l bir necha taylni kesib o'tadi. Uni bo'lish o'rniga har bir
    // taylga to'liq nusxasini qo'yamiz: bu tirqishlarni yo'q qiladi va
    // ma'lumot hajmi baribir kichik. Juda uzunlari (daryo, magistral)
    // cheklanadi, aks holda nusxalar soni portlaydi.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 24) return;

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const key = `${x}/${y}`;
        let tile = tiles.get(key);
        if (!tile) {
          tile = { x, y, buildings: [], roads: [], water: [], areas: [], trees: [] };
          tiles.set(key, tile);
        }
        tile[kind].push({ ...payload, coords: quantize(points, x, y, n) });
      }
    }
  };

  for (const b of buildings) {
    addToTiles(b.points, 'buildings', { h: round(b.height, 1), m: round(b.minHeight, 1), meta: b.meta });
  }
  for (const r of roads) {
    addToTiles(r.points, 'roads', { c: r.cls, w: r.width, b: r.bridge ? 1 : 0, id: r.id, n: r.name, o: r.oneway, t: r.tunnel ? 1 : 0 });
  }
  for (const w of water) {
    addToTiles(w.points, 'water', {});
  }
  for (const a of areas) {
    addToTiles(a.points, 'areas', { c: a.cls });
  }

  // Daraxt — bitta nuqta, shuning uchun u faqat bitta taylga tushadi.
  for (const t of trees) {
    const mx = lonToMercatorX(t.lon) * n;
    const my = latToMercatorY(t.lat) * n;
    const x = Math.floor(mx);
    const y = Math.floor(my);
    const tile = tiles.get(`${x}/${y}`);
    if (!tile) continue;
    tile.trees.push(
      Math.round((mx - x) * EXTENT),
      Math.round((my - y) * EXTENT),
      t.shrub ? 1 : 0,
    );
  }

  // --- Yozish ---
  await mkdir(OUT_DIR, { recursive: true });
  let written = 0;
  let bytes = 0;

  for (const tile of tiles.values()) {
    const dir = join(OUT_DIR, String(ZOOM), String(tile.x));
    await mkdir(dir, { recursive: true });

    const json = JSON.stringify({
      z: ZOOM,
      x: tile.x,
      y: tile.y,
      extent: EXTENT,
      buildings: tile.buildings.map((b) => ({ h: b.h, m: b.m, r: b.coords, ...b.meta })),
      roads: tile.roads.map((r) => ({ c: r.c, w: r.w, b: r.b, id: r.id, n: r.n, o: r.o, t: r.t, p: r.coords })),
      water: tile.water.map((w) => ({ r: w.coords })),
      areas: tile.areas.map((a) => ({ c: a.c, r: a.coords })),
      // Yassi uchlik: x, y, tur (0 = daraxt, 1 = buta).
      trees: tile.trees,
    });
    await writeFile(join(dir, `${tile.y}.json`), json);
    written++;
    bytes += json.length;
  }

  const index = {
    zoom: ZOOM,
    extent: EXTENT,
    region: name,
    bbox,
    generated: new Date().toISOString(),
    tiles: [...tiles.values()].map((t) => `${t.x}/${t.y}`).sort(),
  };
  await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(index));

  // --- Suv konturlari, bitta umumiy fayl ---
  //
  // Tayl ichidagi nusxa mini-xarita va suv yuzasi uchun yetarli, lekin relyef
  // BITTA mesh sifatida, tayllar kelishidan ancha oldin quriladi. Suv tubini
  // o'yish esa aynan o'sha qadamda bo'lishi kerak — aks holda ko'rinadigan
  // sirt, fizika sirti va suv sathi bir-biridan ajralib ketadi. Shuning uchun
  // butun shahar suvi alohida, tayllardan mustaqil ro'yxatda ham yoziladi.
  const waterRings = [];
  for (const w of water) {
    const ring = [];
    for (const [lon, lat] of w.points) ring.push(round(lon, 6), round(lat, 6));
    if (ring.length >= 8) waterRings.push(ring);
  }
  const waterJson = JSON.stringify({ bbox, rings: waterRings });
  await writeFile(join(OUT_DIR, 'water.json'), waterJson);

  console.log(
    `[bake] ${written} tayl yozildi (${(bytes / 1024 / 1024).toFixed(1)} MB) → ${OUT_DIR}`,
  );
  console.log(
    `[bake] ${waterRings.length.toLocaleString()} suv konturi → water.json (${(waterJson.length / 1024).toFixed(0)} KB)`,
  );
}

/** Koordinatalarni tayl ichidagi butun songa aylantiradi. */
function quantize(points, tileX, tileY, n) {
  const out = new Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    const [lon, lat] = points[i];
    out[i * 2] = Math.round((lonToMercatorX(lon) * n - tileX) * EXTENT);
    out[i * 2 + 1] = Math.round((latToMercatorY(lat) * n - tileY) * EXTENT);
  }
  return out;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

await main();
