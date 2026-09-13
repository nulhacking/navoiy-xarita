import { Vector3 } from 'three';
import type { CityFrame } from './CityFrame.ts';

/**
 * "Farhod" madaniyat markazi, Navoiy — Xalqlar Do'stligi shoh ko'chasidan sharqda,
 * F. Xodjaev va Tolstoy ko'chalari orasidagi kvartalda (40.09437, 65.37999).
 *
 * NIMA UCHUN KOORDINATALAR QO'LDA: OSM'da binoning konturi yo'q. Bor narsa —
 * kirish kozireki (`building=roof` 507516370), favvoralar, gulzorlar va
 * yo'lkalar. Shuning uchun poydevor sun'iy yo'ldosh tasviridan (Bing z19,
 * 0.228 m/px) o'lchandi: devor azimuti butun kvartal bo'yicha gradient
 * yo'nalishlari histogrammasi bilan (159° — shahar to'rining o'zi), chetlari
 * esa aylantirilgan freymdagi yorug'lik profillari va soyaning chegarasi
 * bilan.
 *
 * Koordinata boshi BINONING G'ARBIY FASADIDA: +u sharqqa, bino ichiga;
 * -u tomonda favvora, gulzorlar va prospekt. Bosh kirish ham shu tomonda.
 */
export const FARXOD_ORIGIN = { lon: 65.37999, lat: 40.09437, alt: 0 };

/** +v o'qining azimuti — binoning uzun devorlari va butun kvartal shu to'rda. */
export const FARXOD_BEARING = 159.0;

/** Asosiy hajm parapetgacha. Fotosuratdan baholangan, o'lchanmagan. */
export const FARXOD_HEIGHT = 17.5;

/** Sun'iy yo'ldoshdan o'lchangan tashqi kontur, mahalliy metrda. */
export const FARXOD_FOOTPRINT = { uMin: 0, uMax: 55, vMin: -48, vMax: 48 } as const;

/** Ichki hovli — janubiy qanotning o'rtasida, tasvirda qorong'i to'rtburchak. */
export const FARXOD_COURTYARD = { uMin: 15, uMax: 40, vMin: 18, vMax: 39 } as const;

/**
 * Favvoralar — OSM `amenity=fountain`. Bake konveyeri bu tegni tanimaydi,
 * shuning uchun ular shu yerda saqlanadi.
 *
 * `basin` — nomli "Фархад" hovuzi (way 507268880): shimolda keng, janubga
 * torayib boruvchi uchta zinali bo'lak. `pools` — undan g'arbdagi uchta
 * kvadrat hovuzcha (507378248, 904201597, 507378250).
 */
export const FARXOD_BASIN = [
  { uMin: -33.5, uMax: -16.8, vMin: -8.5, vMax: 24.2 },
  { uMin: -33.5, uMax: -22.4, vMin: 24.2, vMax: 29.7 },
  { uMin: -33.5, uMax: -26.1, vMin: 29.7, vMax: 44.0 },
] as const;

export const FARXOD_POOLS = [
  { uMin: -34.2, uMax: -28.1, vMin: -58.2, vMax: -51.9 },
  { uMin: -34.3, uMax: -28.0, vMin: -42.6, vMax: -36.3 },
  { uMin: -34.1, uMax: -27.8, vMin: -26.9, vMax: -20.6 },
] as const;

/** Kirish kozireki OSM'da `building=roof` (507516370). */
export const FARXOD_IDS = new Set([507516370]);
export const FARXOD_CANOPY = { uMin: -7.3, uMax: 1.3, vMin: -21.6, vMax: -10.3 } as const;

export function farxodBasis(frame: CityFrame) {
  const origin = frame.toLocal(FARXOD_ORIGIN);
  // Azimutni freymning O'ZI orqali o'tkazamiz: meridian yaqinlashuvi va
  // Merkator cho'zilishi shunda hisobga olinadi, qo'lda emas.
  const rad = FARXOD_BEARING * Math.PI / 180;
  const probe = frame.toLocal({
    lon: FARXOD_ORIGIN.lon + 200 * Math.sin(rad) / (111320 * Math.cos(FARXOD_ORIGIN.lat * Math.PI / 180)),
    lat: FARXOD_ORIGIN.lat + 200 * Math.cos(rad) / 110574,
    alt: 0,
  });
  const south = probe.sub(origin).setY(0).normalize(), east = new Vector3(south.z, 0, -south.x);
  return {
    origin, east, south,
    point: (u: number, v: number) => origin.clone().addScaledVector(east, u).addScaledVector(south, v),
    uv: (p: { x: number; z: number }) => ({
      u: (p.x - origin.x) * east.x + (p.z - origin.z) * east.z,
      v: (p.x - origin.x) * south.x + (p.z - origin.z) * south.z,
    }),
  };
}

/** Farhod binosi va maydoni: daraxtlarni shu modul o'zi ekadi. */
export function farxodTreeExclusion(frame: CityFrame) {
  const basis = farxodBasis(frame);
  return (p: { x: number; z: number }) => {
    const { u, v } = basis.uv(p);
    return u > -50 && u < 66 && v > -64 && v < 88;
  };
}

/** Farhod maydonidagi xom OSM poligonlari (avtoturargoh/maydoncha) chetlatiladi. */
export function farxodAreaExclusion(frame: CityFrame) {
  const basis = farxodBasis(frame);
  return (p: { x: number; z: number }) => {
    const { u, v } = basis.uv(p);
    return u > -50 && u < 60 && v > -62 && v < 86;
  };
}
