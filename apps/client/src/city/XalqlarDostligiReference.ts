import { Vector3 } from 'three';
import type { CityFrame } from './CityFrame.ts';

/**
 * Xalqlar Do'stligi shoh ko'chasi (OSM'da hali "Islom Karimov shoh ko'chasi",
 * `old_name2` — "Xalqlar Do'stligi shox ko'chasi"), Navoiy.
 *
 * MANBALAR (2026-09-13 tekshiruvi):
 *   - Google sun'iy yo'ldosh tayllari z19 (~0.23 m/px), ko'chaga burilgan
 *     freymda 0.1–0.3 m/px qirqimlar bilan o'lchangan. OSM qatnov qismi o'qlari
 *     (way 1427939982/987) tasvir bilan 1 m ichida mos keldi.
 *   - Google Street View: Lemala 360 avtomobil kamerasi ketma-ketligi (2024-iyul),
 *     har ~100 m da to'rt yo'nalish. Undan: o'rta ajratgich — maysa EMAS, oq
 *     bo'yalgan 1 m beton bordyur; chetlarida keng oq bordyurlar; chiroqlar
 *     tashqi chetlarda (shimolda "palma" shaklli bezakli, qolganida ikki boshli);
 *     ko'cha ustida bayramona chiroq girlyandalari; Farhod tomonida oq panjara.
 *   - Balandliklar fotosuratdagi qavatlardan baholangan, o'lchanmagan.
 *
 * O'Q KONVENSIYASI: koordinata boshi Lemala 360 fotosferasi (g'arbiy qatnov
 * qismi o'qi, Farhod ro'parasi). `+v` ko'cha bo'ylab janubga (azimut 159°),
 * `+u` ko'chaga perpendikulyar sharqqa (Farhod tomoni). Shimoliy uchi
 * (Amir Temur chorrahasi) `v ≈ -1150`, janubiy chorraha `v ≈ +400`.
 */
export const XD_ORIGIN = { lat: 40.0942727, lon: 65.3790715, alt: 0 } as const;
export const XD_BEARING = 159.0;

/** Janubiy chorrahadan janubi-sharqqa ketadigan tarmoq: o'z freymi, azimut 119.8°. */
export const XD_ARM_ORIGIN = { lat: 40.090704, lon: 65.381489, alt: 0 } as const;
export const XD_ARM_BEARING = 119.8;

export type XdBasis = ReturnType<typeof xdBasis>;

function basisFor(frame: CityFrame, origin: { lat: number; lon: number; alt: number }, bearing: number) {
  const o = frame.toLocal(origin);
  // Azimut freymning o'zi orqali o'tkaziladi — meridian yaqinlashuvi hisobga olinadi.
  const rad = bearing * Math.PI / 180;
  const probe = frame.toLocal({
    lon: origin.lon + 200 * Math.sin(rad) / (111320 * Math.cos(origin.lat * Math.PI / 180)),
    lat: origin.lat + 200 * Math.cos(rad) / 110574,
    alt: 0,
  });
  const south = probe.sub(o).setY(0).normalize();
  const east = new Vector3(south.z, 0, -south.x);
  return {
    origin: o, east, south,
    point: (u: number, v: number) => o.clone().addScaledVector(east, u).addScaledVector(south, v),
    uv: (p: { x: number; z: number }) => ({
      u: (p.x - o.x) * east.x + (p.z - o.z) * east.z,
      v: (p.x - o.x) * south.x + (p.z - o.z) * south.z,
    }),
  };
}

export function xdBasis(frame: CityFrame) {
  return basisFor(frame, XD_ORIGIN, XD_BEARING);
}

export function xdArmBasis(frame: CityFrame) {
  return basisFor(frame, XD_ARM_ORIGIN, XD_ARM_BEARING);
}

/**
 * Asosiy kesim (0.1 m/px qirqimlardan: v = -1000, -800, -600, -400, -180, 40, 250).
 * Har qatnov qismi ~12 m, uch bo'lak; lane chiziqlari `westLanes`/`eastLanes`.
 */
export const XD_ROAD = {
  north: -1178,
  /** Shu yerdan janubiy chorrahagacha ko'cha sharqqa egiladi — `XD_BEND`. */
  south: 270,
  west: -6.2,
  medianWest: 5.8,
  medianEast: 6.8,
  east: 18.4,
  westLanes: [-2.2, 1.8],
  eastLanes: [10.6, 14.5],
  curbWidth: 0.5,
  curbHeight: 0.18,
  medianHeight: 0.2,
  /** Amir Temur chorrahasidan shimoldagi bo'lingan emas, bo'yoq chiziqli davomi. */
  stub: { north: -1300, west: -4.5, east: 22.5, centre: 5.2 },
} as const;

/**
 * Janubiy chorraha oldidagi egilish: OSM qatnov qismi o'qlari (u, v). To'g'ri
 * qismda ular chekkadan aynan 5.0 / 5.7 m ichkarida yotadi (0.1 m/px qirqim),
 * egilishda ham shu masofa sun'iy yo'ldoshda tasdiqlandi.
 */
export const XD_BEND = {
  sb: [[-1.3, 264.9], [-1.6, 275.5], [3.2, 323.1], [14.4, 370.8]],
  nb: [[12.7, 265.8], [12.7, 275.8], [17.8, 325.1], [23.7, 350.5], [25.5, 358.2]],
  /** O'qdan chekkagacha va ajratgichgacha masofalar. */
  sbEdge: -4.9, sbMedian: 7.1, nbMedian: -5.9, nbEdge: 5.7,
  end: 352,
} as const;

/**
 * Janubiy chorraha (Janubiy ko'chasi va janubi-sharqiy tarmoq): asfalt ko'pburchagi
 * 0.2 m/px qirqimdan; zebra chiziqlari [boshi, oxiri, harakat yo'nalishi].
 */
export const XD_JUNCTION = {
  polygon: [[3.8, 352], [30.5, 351], [43, 368], [60, 395], [75.2, 448.9], [63.6, 458.4], [40, 432], [21, 421], [1, 424], [-5, 390], [0, 368]],
  zebras: [
    { from: [8, 366], to: [32, 361], dir: [.23, .97] },
    { from: [31, 418], to: [53, 404], dir: [.635, .775] },
    { from: [1, 406], to: [13, 419], dir: [-.74, .67] },
  ],
} as const;

/** Chorrahalar: o'rta ajratgich va chekka bordyurlar uziladi. */
export const XD_JUNCTIONS = [
  { name: 'Amir Temur', v0: -1172, v1: -1122, west: true, east: true, signals: true },
  { name: "O'zbekiston", v0: -566, v1: -537, west: true, east: false, signals: false },
  { name: 'Tolstoy', v0: 87, v1: 109, west: true, east: true, signals: false },
] as const;

/** Faqat bir tomonga kiradigan ko'cha va xizmat yo'llari: bordyur uziladi, ajratgich emas. */
export const XD_SIDE_ENTRIES = [
  { side: 1, v0: -916, v1: -902 }, // Islom Karimov ko'chasi
  { side: 1, v0: -780, v1: -768 },
  { side: 1, v0: -719, v1: -707 }, // Nurafshon
  { side: 1, v0: -655, v1: -643 },
  { side: 1, v0: -583, v1: -571 },
  { side: -1, v0: -327, v1: -300 }, // Tolstoy tor ko'chasi
  { side: 1, v0: -310, v1: -297 }, // Zarafshon
  { side: 1, v0: -54, v1: -40 }, // F. Xodjaev
  { side: -1, v0: 112, v1: 126 },
  { side: 1, v0: 112, v1: 120 },
  { side: 1, v0: 326, v1: 338 },
] as const;

/** Zebra o'tish joylari — OSM `highway=crossing` tugunlari, tasvirda tasdiqlangan. */
export const XD_CROSSINGS = [-1168, -1126, -908, -727, -564, -539, -300, -206, -56, 89, 106] as const;

/** Ko'cha ustidagi bayramona chiroq girlyandalari (Street View'da ko'ringan joylar atrofida). */
export const XD_GARLANDS = [-1085, -975, -860, -760, -650, -452, -345, -240, -130, 180, 290] as const;

/** Bekatlar: OSM `highway=bus_stop`, soyabon trotuar chetida. */
export const XD_BUS_STOPS = [
  { u: 27.5, v: -1213, side: 1 },
  { u: 22.5, v: -1042, side: 1 },
  { u: 24.5, v: -598, side: 1 },
  { u: -14.5, v: -506, side: -1 },
  { u: 23.5, v: -95, side: 1 },
  { u: -12.5, v: 153, side: -1 },
] as const;

/** Reklama shchitlari — fotosuratlardagi katta ikki oyoqli va ekranli shchitlar. */
export const XD_BILLBOARDS = [
  { u: 30, v: -1188, yaw: 0 },
  { u: -13, v: -968, yaw: Math.PI },
  { u: 27, v: -145, yaw: 0 },
  { u: -16, v: 80, yaw: Math.PI },
  { u: 27, v: 118, yaw: 0 },
] as const;

/**
 * G'arbiy xiyobon (bulvar) — Hokimiyat maydonidan O'zbekiston ko'chasigacha.
 * Markaziy o'q `u = -28`, cho'zinchoq favvoralar va oval maydon; olti burchakli
 * maysa parterlari diagonal yo'laklar bilan.
 */
export const XD_BOULEVARD = {
  uMin: -47, uMax: -13, vMin: -945, vMax: -566, axis: -28,
  fountains: [-900, -823, -745, -668],
  oval: { u: -26.5, v: -787, ru: 7.5, rv: 14.5 },
  /** G'arbiy qatnov qismi yonidagi qiya avtoturargoh. */
  parking: { uMin: -10, vMin: -925, vMax: -600 },
} as const;

/** Mehmonxona "Navoiy": 7 qavatli plastinka va 2 qavatli podium (sun'iy yo'ldosh konturi). */
export const XD_HOTEL = {
  slab: { uMin: -149, uMax: -77, vMin: -915, vMax: -896, height: 24.5 },
  tower: { uMin: -107, uMax: -99, vMin: -917, vMax: -894, height: 27.5 },
  podium: [
    { uMin: -107, uMax: -61, vMin: -896, vMax: -862, height: 7.2 },
    { uMin: -77, uMax: -61, vMin: -915, vMax: -896, height: 7.2 },
  ],
} as const;

/** "Ishonch · SO · Bonum" savdo majmuasi va uning rotundasi. */
export const XD_MALL = {
  north: { uMin: -121, uMax: -70, vMin: -830, vMax: -762, height: 10 },
  south: { uMin: -119, uMax: -74, vMin: -762, vMax: -686, height: 9 },
  tail: { uMin: -118, uMax: -75, vMin: -686, vMax: -671, height: 6.5 },
  annex: { uMin: -70, uMax: -58, vMin: -831, vMax: -795, height: 5 },
  side: { uMin: -139, uMax: -121, vMin: -830, vMax: -795, height: 7 },
  rotunda: { u: -97, v: -790, r: 19, height: 14 },
  forecourt: { uMin: -74, uMax: -47, vMin: -835, vMax: -660 },
  carpets: [
    { uMin: -69, uMax: -57, vMin: -771, vMax: -711 },
    { uMin: -69, uMax: -57, vMin: -699, vMax: -665 },
  ],
} as const;

/** Sport Saroyi (OSM 146490152 "Sogdiana") — kontur tasvirda 5 m g'arbroq, shu yerdan olingan. */
export const XD_SPORT = {
  hall: { uMin: -114, uMax: -45, vMin: -7, vMax: 61, height: 14.5 },
  annex: { uMin: -118, uMax: -114, vMin: -5, vMax: 59, height: 6 },
  capsule: { uMin: -114, uMax: -96, vMin: -50, vMax: -18, height: 8.5 },
  forecourt: { uMin: -45, uMax: -12, vMin: -60, vMax: 86 },
  flags: [-12, 2, 16],
} as const;

/** "Delfin" suzish havzasi: 50 m hovuz, kichik hovuz va palubasi. Binolar OSM'dan. */
export const XD_POOL = {
  deck: { uMin: -69, uMax: -29, vMin: -400, vMax: -334 },
  main: { uMin: -60, uMax: -39, vMin: -385, vMax: -336 },
  small: { uMin: -60, uMax: -39, vMin: -332, vMax: -322 },
} as const;

/** G'alaba bog'i (Park of Victory): yodgorlik maydoni, Farhod shimolida. */
export const XD_MEMORIAL = {
  plaza: { uMin: 25, uMax: 103, vMin: -171, vMax: -53 },
  lawn: { uMin: 42, uMax: 68, vMin: -147, vMax: -93 },
  statue: { u: 52, v: -133 },
  blocks: [
    [48, -142], [56, -142], [63, -142], [63, -135], [63, -127], [48, -120], [56, -120], [63, -120],
    [48, -113], [56, -113], [48, -105], [56, -105], [48, -98], [56, -98],
  ],
  flowers: { uMin: 40, uMax: 70, vMin: -85, vMax: -55 },
  planters: [[-150, -131], [-128, -111], [-108, -95], [-91, -73], [-71, -55]],
} as const;

/** Muallif modulida chiziladigan OSM way'lar: tayl ularni takror chizmasin. */
export const XD_ROAD_IDS = new Set([1427939981, 1427939982, 1427939987, 1427939988]);

/** Sport Saroyi binosi endi muallif modulida — tayl uni ikkinchi marta chizmasin. */
export const XD_BUILDING_IDS = new Set([146490152]);

/** Qatnov qismining ichidagi OSM piyoda yo'laklari/zebra chiziqlari: ko'cha ustida takror chizilmaydi. */
export function xdRoadExclusion(frame: CityFrame) {
  const b = xdBasis(frame), arm = xdArmBasis(frame);
  return (p: { x: number; z: number }, road?: { id?: number; c?: string }) => {
    if (road?.id !== undefined && XD_ROAD_IDS.has(road.id)) return true;
    if (road?.c && !['footway', 'path', 'pedestrian', 'steps', 'cycleway'].includes(road.c)) return false;
    const { u, v } = b.uv(p);
    if (v > XD_ROAD.stub.north && v < XD_ROAD.south && u > -13 && u < 27) return true;
    const a = arm.uv(p);
    return a.v > 20 && a.v < 470 && a.u > -1 && a.u < 17;
  };
}

/** Muallif modulining tasodifiy daraxtlar chiqmaydigan zonasi — daraxtlar o'lchangan qatorlarda. */
export function xdTreeExclusion(frame: CityFrame) {
  const b = xdBasis(frame), arm = xdArmBasis(frame);
  return (p: { x: number; z: number }) => {
    const { u, v } = b.uv(p);
    if (v > -1310 && v < 360 && u > -50 && u < 34) return true;
    if (v > 260 && v < 470 && u > -20 && u < 90) return true;
    if (u > 20 && u < 106 && v > -175 && v < -40) return true;
    if (u > -125 && u < -45 && v > -60 && v < 90) return true;
    const a = arm.uv(p);
    return a.v > 10 && a.v < 470 && a.u > -18 && a.u < 32;
  };
}

/** Yuzasi qayta chizilgan hududlar: OSM park/maydon poligonlari ustma-ust tushmasin. */
export function xdAreaExclusion(frame: CityFrame) {
  const b = xdBasis(frame);
  return (p: { x: number; z: number }) => {
    const { u, v } = b.uv(p);
    return (u > XD_BOULEVARD.uMin && u < 0 && v > XD_BOULEVARD.vMin && v < XD_BOULEVARD.vMax) ||
      (u > 24 && u < 104 && v > -172 && v < -52) ||
      (u > -122 && u < -10 && v > -60 && v < 86);
  };
}
