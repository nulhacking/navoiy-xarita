/**
 * WGS84 ellipsoidi bo'yicha geodezik konversiyalar.
 *
 * Atamalar:
 *   LLA  — Latitude / Longitude / Altitude (gradus, gradus, metr).
 *   ECEF — Earth-Centered Earth-Fixed: markazi Yer markazida, Z o'qi shimoliy
 *          qutbga, X o'qi (lat 0, lon 0) nuqtaga qaragan dekart tizimi. Metrda.
 *   ENU  — East / North / Up: berilgan nuqtadagi mahalliy gorizontal tizim.
 *
 * Bu modul three.js'ga bog'liq EMAS — sof matematika, server va worker'da ham ishlaydi.
 */

import { type Mat4d, type Vec3d, mat4d, vec3d } from './vec3d.ts';

/** Katta yarim o'q (ekvator radiusi), metr. */
export const WGS84_A = 6378137.0;
/** Yassilanish (flattening). */
export const WGS84_F = 1 / 298.257223563;
/** Kichik yarim o'q (qutb radiusi), metr. */
export const WGS84_B = WGS84_A * (1 - WGS84_F);
/** Birinchi ekstsentrisitet kvadrati, e². */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** Ikkinchi ekstsentrisitet kvadrati, e'². */
export const WGS84_EP2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface Lla {
  /** Kenglik, gradus. [-90, 90] */
  lat: number;
  /** Uzunlik, gradus. [-180, 180] */
  lon: number;
  /** Ellipsoid sirtidan balandlik, metr. */
  alt: number;
}

export function lla(lat: number, lon: number, alt = 0): Lla {
  return { lat, lon, alt };
}

/**
 * Berilgan kenglikdagi "prime vertical" egrilik radiusi, N(φ).
 * ECEF konversiyalarining o'zagi.
 */
function primeVerticalRadius(sinLat: number): number {
  return WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
}

/** LLA → ECEF. Aniq, yopiq formula (iteratsiyasiz). */
export function llaToEcef(p: Lla, out: Vec3d = vec3d()): Vec3d {
  const latRad = p.lat * DEG2RAD;
  const lonRad = p.lon * DEG2RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);

  const n = primeVerticalRadius(sinLat);
  const nh = n + p.alt;

  out.x = nh * cosLat * cosLon;
  out.y = nh * cosLat * sinLon;
  out.z = (n * (1 - WGS84_E2) + p.alt) * sinLat;
  return out;
}

/**
 * ECEF → LLA. Bowring usuli + bir necha aniqlashtirish iteratsiyasi.
 *
 * Bowring'ning boshlang'ich taxmini o'zi ~0.1 mm aniqlik beradi; qo'shimcha
 * iteratsiyalar juda katta balandliklarda (kosmik kamera) ham barqarorlikni ta'minlaydi.
 */
export function ecefToLla(v: Vec3d, out: Lla = lla(0, 0, 0)): Lla {
  const { x, y, z } = v;
  const p = Math.hypot(x, y);

  out.lon = Math.atan2(y, x) * RAD2DEG;

  // Qutb o'qidagi maxsus holat — atan2(y, x) noaniq, lon 0 deb olinadi.
  if (p < 1e-9) {
    out.lon = 0;
    out.lat = z >= 0 ? 90 : -90;
    out.alt = Math.abs(z) - WGS84_B;
    return out;
  }

  // Bowring boshlang'ich taxmini: yordamchi burchak θ.
  const theta = Math.atan2(z * WGS84_A, p * WGS84_B);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  let latRad = Math.atan2(
    z + WGS84_EP2 * WGS84_B * sinTheta * sinTheta * sinTheta,
    p - WGS84_E2 * WGS84_A * cosTheta * cosTheta * cosTheta,
  );

  // Aniqlashtirish (Hirvonen iteratsiyasi): φ ni N(φ) va h orqali qayta hisoblash.
  // Qutblarga yaqin joyda p/cos(φ) beqaror — u yerda Bowring taxminining o'zi
  // allaqachon sub-millimetr aniqlikda, shuning uchun iteratsiyani o'tkazib yuboramiz.
  let sinLat = Math.sin(latRad);
  let n = primeVerticalRadius(sinLat);
  if (Math.abs(Math.cos(latRad)) > 1e-6) {
    for (let i = 0; i < 3; i++) {
      const h = p / Math.cos(latRad) - n;
      latRad = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + h)));
      sinLat = Math.sin(latRad);
      n = primeVerticalRadius(sinLat);
    }
  }

  const cosLat = Math.cos(latRad);
  // Qutblarga yaqin joyda cosLat → 0 bo'lib, p/cosLat beqaror bo'ladi;
  // u yerda z o'qi bo'ylab formulaga o'tamiz.
  out.alt =
    Math.abs(cosLat) > 1e-6
      ? p / cosLat - n
      : z / sinLat - n * (1 - WGS84_E2);
  out.lat = latRad * RAD2DEG;
  return out;
}

/** Ellipsoid sirtiga tik birlik vektor (ECEF'da "yuqori" yo'nalish). */
export function geodeticSurfaceNormal(p: Pick<Lla, 'lat' | 'lon'>, out: Vec3d = vec3d()): Vec3d {
  const latRad = p.lat * DEG2RAD;
  const lonRad = p.lon * DEG2RAD;
  const cosLat = Math.cos(latRad);
  out.x = cosLat * Math.cos(lonRad);
  out.y = cosLat * Math.sin(lonRad);
  out.z = Math.sin(latRad);
  return out;
}

export interface EnuBasis {
  east: Vec3d;
  north: Vec3d;
  up: Vec3d;
}

/** Berilgan nuqtadagi ENU bazis vektorlari, ECEF koordinatalarida. */
export function enuBasis(p: Pick<Lla, 'lat' | 'lon'>): EnuBasis {
  const latRad = p.lat * DEG2RAD;
  const lonRad = p.lon * DEG2RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);

  return {
    east: { x: -sinLon, y: cosLon, z: 0 },
    north: { x: -sinLat * cosLon, y: -sinLat * sinLon, z: cosLat },
    up: { x: cosLat * cosLon, y: cosLat * sinLon, z: sinLat },
  };
}

/**
 * Mahalliy o'yin freymidan ECEF'ga o'tish matritsasi.
 *
 * MUHIM — o'q konvensiyasi. Geodeziyada ENU "Z yuqoriga" bo'ladi, lekin three.js
 * va o'yin fizikasi "Y yuqoriga" ishlaydi (gravitatsiya -Y bo'ylab). Shuning uchun
 * mahalliy freymni quyidagicha belgilaymiz:
 *
 *     X = East (sharq)      Y = Up (yuqori)      Z = South (janub)
 *
 * Z janubga qaragani bejiz emas: three.js kamerasi o'z -Z o'qi bo'ylab qaraydi,
 * ya'ni "oldinga" = -Z = North. Demak standart kamera shimolga qaragan holda boshlanadi.
 * Bu uchlik o'ng qo'l tizimini tashkil qiladi (X × Y = Z).
 *
 * Natijaviy matritsa column-major — to'g'ridan-to'g'ri `Matrix4.fromArray()` ga beriladi.
 */
export function localFrameAt(p: Lla, out: Mat4d = mat4d()): Mat4d {
  const { east, north, up } = enuBasis(p);
  const origin = llaToEcef(p);

  // 0-ustun: X = East
  out[0] = east.x; out[1] = east.y; out[2] = east.z; out[3] = 0;
  // 1-ustun: Y = Up
  out[4] = up.x; out[5] = up.y; out[6] = up.z; out[7] = 0;
  // 2-ustun: Z = South = -North
  out[8] = -north.x; out[9] = -north.y; out[10] = -north.z; out[11] = 0;
  // 3-ustun: translatsiya = freym boshi ECEF'da
  out[12] = origin.x; out[13] = origin.y; out[14] = origin.z; out[15] = 1;

  return out;
}

/**
 * Ikki LLA nuqta orasidagi to'g'ri chiziqli (chord) masofa, metr.
 * Qisqa masofalarda sirt bo'ylab masofadan farqi sezilmaydi.
 */
export function distanceLla(a: Lla, b: Lla): number {
  const ea = llaToEcef(a);
  const eb = llaToEcef(b);
  return Math.hypot(ea.x - eb.x, ea.y - eb.y, ea.z - eb.z);
}
