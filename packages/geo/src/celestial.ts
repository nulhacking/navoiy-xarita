/**
 * Quyosh va Oyning osmondagi o'rni.
 *
 * Meeus'ning "Astronomical Algorithms" kitobidagi past aniqlikdagi
 * formulalari. Ular quyosh uchun ~0.01°, oy uchun ~0.3° xato beradi — bu
 * o'yin uchun mo'l-ko'l: bir gradus osmonda ko'z ilg'amaydigan farq, quyosh
 * chiqishi esa bir necha sekundga siljiydi, xolos.
 *
 * Nima uchun tayyor kutubxona emas: kerak bo'lgani ikkita funksiya, ular
 * hammasi bo'lib yuz qatorcha, va ular loyihaning boshqa geodeziya
 * matematikasi bilan bir joyda, bir xil testlar ostida turgani ma'qul.
 *
 * Barcha burchaklar RADIANDA. Kiruvchi `lat`, `lon` esa GRADUSDA — paketning
 * qolgan qismidagi kabi.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
/** Unix epoxidan Julian sanasigacha. */
const J1970 = 2440588;
/** J2000.0 — formulalar sanaydigan boshlang'ich lahza. */
const J2000 = 2451545;
/** Ekliptika qiyaligi (obliquity), 2000-yil uchun. */
const OBLIQUITY = RAD * 23.4397;
/** Yerdan Quyoshgacha o'rtacha masofa, km — oy fazasi uchun kerak. */
const SUN_DISTANCE = 149598000;

/** Osmon sferasidagi o'rin: balandlik va azimut, radian. */
export interface Horizontal {
  /** Ufqdan balandlik. Manfiy — ufq ostida. */
  altitude: number;
  /** SHIMOLDAN soat strelkasi bo'yicha (sharq = +90°), [0, 2π). */
  azimuth: number;
}

export interface MoonPosition extends Horizontal {
  /**
   * Faza, [0, 1): 0 — yangi oy, 0.25 — birinchi chorak, 0.5 — to'lin oy.
   * 0.5 dan katta qiymat — oyning so'nib borayotgan yarmi.
   */
  phase: number;
  /** Yoritilgan diskning ulushi, [0, 1]. */
  illumination: number;
}

/** Ekvatorial koordinatalar: to'g'ri chiqish va og'ish, radian. */
interface Equatorial {
  ra: number;
  dec: number;
}

/** J2000.0 dan beri o'tgan sutkalar (kasr bilan). */
export function julianDays(date: Date): number {
  return date.getTime() / DAY_MS - 0.5 + J1970 - J2000;
}

function rightAscension(longitude: number, latitude: number): number {
  return Math.atan2(
    Math.sin(longitude) * Math.cos(OBLIQUITY) - Math.tan(latitude) * Math.sin(OBLIQUITY),
    Math.cos(longitude),
  );
}

function declination(longitude: number, latitude: number): number {
  return Math.asin(
    Math.sin(latitude) * Math.cos(OBLIQUITY)
      + Math.cos(latitude) * Math.sin(OBLIQUITY) * Math.sin(longitude),
  );
}

/** Grinvich yulduz vaqti, kuzatuvchining uzunligiga tuzatilgan. */
function siderealTime(days: number, lon: number): number {
  return RAD * (280.16 + 360.9856235 * days) + RAD * lon;
}

/** Quyoshning ekvatorial koordinatasi. */
function sunCoords(days: number): Equatorial {
  // O'rtacha anomaliya.
  const anomaly = RAD * (357.5291 + 0.98560028 * days);
  // Markaz tenglamasi — orbitaning aylanadan farqi.
  const center = RAD * (1.9148 * Math.sin(anomaly)
    + 0.02 * Math.sin(2 * anomaly)
    + 0.0003 * Math.sin(3 * anomaly));
  // Perigeliy uzunligi + 180° (Quyoshdan Yerga emas, Yerdan Quyoshga).
  const longitude = anomaly + center + RAD * 102.9372 + Math.PI;
  return { ra: rightAscension(longitude, 0), dec: declination(longitude, 0) };
}

/** Oyning ekvatorial koordinatasi va masofasi (km). */
function moonCoords(days: number): Equatorial & { distance: number } {
  const meanLongitude = RAD * (218.316 + 13.176396 * days);
  const meanAnomaly = RAD * (134.963 + 13.064993 * days);
  const meanDistance = RAD * (93.272 + 13.229350 * days);

  const longitude = meanLongitude + RAD * 6.289 * Math.sin(meanAnomaly);
  const latitude = RAD * 5.128 * Math.sin(meanDistance);
  const distance = 385001 - 20905 * Math.cos(meanAnomaly);

  return { ra: rightAscension(longitude, latitude), dec: declination(longitude, latitude), distance };
}

/**
 * Ekvatorial koordinatani kuzatuvchining ufq tizimiga o'tkazadi.
 *
 * Meeus azimutni JANUBDAN sanaydi; biz shimoldan sanaymiz, chunki o'yin
 * dunyosida "shimol" asosiy yo'nalish. Shuning uchun π qo'shiladi.
 */
function toHorizontal(hourAngle: number, lat: number, dec: number): Horizontal {
  const phi = RAD * lat;
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
  ) + Math.PI;
  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle),
  );
  return { altitude, azimuth: ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) };
}

/** Berilgan lahzada Quyoshning ufq tizimidagi o'rni. */
export function sunPosition(date: Date, lat: number, lon: number): Horizontal {
  const days = julianDays(date);
  const sun = sunCoords(days);
  return toHorizontal(siderealTime(days, lon) - sun.ra, lat, sun.dec);
}

/** Berilgan lahzada Oyning o'rni, fazasi va yoritilganligi. */
export function moonPosition(date: Date, lat: number, lon: number): MoonPosition {
  const days = julianDays(date);
  const sun = sunCoords(days);
  const moon = moonCoords(days);
  const horizontal = toHorizontal(siderealTime(days, lon) - moon.ra, lat, moon.dec);

  // Quyosh–Yer–Oy burchagi (elongatsiya).
  const elongation = Math.acos(
    Math.sin(sun.dec) * Math.sin(moon.dec)
      + Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra),
  );
  // Faza burchagi: Yer Oydan qanchalik chetda ko'rinadi.
  const inclination = Math.atan2(
    SUN_DISTANCE * Math.sin(elongation),
    moon.distance - SUN_DISTANCE * Math.cos(elongation),
  );
  // Yoritilgan yarmning qaysi tomonda ekani — o'sish/so'nishni ajratadi.
  const limb = Math.atan2(
    Math.cos(sun.dec) * Math.sin(sun.ra - moon.ra),
    Math.sin(sun.dec) * Math.cos(moon.dec)
      - Math.cos(sun.dec) * Math.sin(moon.dec) * Math.cos(sun.ra - moon.ra),
  );

  return {
    ...horizontal,
    illumination: (1 + Math.cos(inclination)) / 2,
    phase: 0.5 + 0.5 * inclination * (limb < 0 ? -1 : 1) / Math.PI,
  };
}

/**
 * Ufq koordinatasini shahar freymidagi BIRLIK vektorga aylantiradi.
 *
 * Freym konvensiyasi (`CityFrame` ga qarang): X = sharq, Y = yuqori,
 * Z = janub. Demak shimol — manfiy Z.
 */
export function horizontalToLocal(position: Horizontal): { x: number; y: number; z: number } {
  const horizontal = Math.cos(position.altitude);
  return {
    x: Math.sin(position.azimuth) * horizontal,
    y: Math.sin(position.altitude),
    z: -Math.cos(position.azimuth) * horizontal,
  };
}
