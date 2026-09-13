import { Vector3 } from 'three';
import type { CityFrame } from './CityFrame.ts';

/**
 * SOFTEX — dasturiy mahsulotlar ishlab chiqish markazi, Karmana (Eski shahar),
 * Alisher Navoiy ko'chasi, 40.13108 / 65.35080.
 *
 * MANBA VA ANIQLIK:
 *   - Poydevor — OSM way 1060955250 (`building=retail`, `building:levels=2`).
 *     Bu 115 metrli savdo qatori; SOFTEX uning JANUBIY uchida, ko'rsatilgan
 *     nuqta esa aynan shu uchdagi burchakka tushadi.
 *   - Ko'rinish — foydalanuvchi bergan ko'cha darajasidagi fotosurat: ikki
 *     qavat, yumaloq janubi-g'arbiy burchak, parapetda ko'k "SOFTEX" yozuvi,
 *     jigarrang yog'och taqlidli panellar, to'q kulrang lentalar, birinchi
 *     qavat ostidagi ochiq ayvon va oldidagi g'isht yotqizilgan maydoncha.
 *     Fotosurat o'yinga tekstura sifatida KO'CHIRILMAGAN — undan faqat
 *     nisbatlar va ranglar olindi. Balandliklar o'lchanmagan, baholangan.
 *
 * O'Q KONVENSIYASI: `+u` sharqqa (ko'chadan binoga va undan narida), `+v`
 * JANUBGA. Koordinata boshi berilgan nuqtada, ya'ni binoning janubiy devori
 * `v ≈ +0.5` da, bino esa undan SHIMOLGA, manfiy `v` tomon cho'ziladi.
 */
export const SOFTEX_ORIGIN = { lon: 65.35080075448519, lat: 40.13107788394803, alt: 0 };

/** Savdo qatorining uzun o'qi, janubga qarab. OSM konturidan o'lchangan. */
export const SOFTEX_BEARING = 175.5;

/** Umumiy o'rniga qo'yiladigan OSM obyekti — ikki marta chizilmasin. */
export const SOFTEX_IDS = new Set([1060955250]);

/**
 * Bino rejasi, metrda. `west` — ko'chaga qaragan fasad.
 *
 * Qiymatlar OSM konturining mahalliy `u/v` ga o'tkazilgan cho'qqilaridan:
 * g'arbiy devor `u ≈ -9.8`, sharqiy `u ≈ +3.4`, janubiy `v ≈ +0.5`.
 * Janubi-g'arbiy burchak OSM'da qiya kesilgan — fotosuratda u YUMALOQ, shuning
 * uchun o'sha kesim radiusi 4.7 m yoy bilan almashtirilgan.
 */
export const SOFTEX_PLAN = {
  west: -9.8,
  east: 3.4,
  south: 0.5,
  north: -24.5,
  /** Yumaloq janubi-g'arbiy burchak radiusi. */
  corner: 4.7,
  /** Birinchi qavat ostidagi ayvon chuqurligi: tepa hajm shunchaga chiqib turadi. */
  recess: 1.2,
  ground: 3.5,
  upper: 3.8,
  parapet: 1.35,
} as const;

/** Savdo qatorining qolgan qismi — SOFTEX'dan shimolda, soddaroq hajm. */
export const SOFTEX_NEIGHBOUR = { west: -9.2, east: 0.8, from: -24.5, to: -119, height: 6.4 } as const;

/**
 * Ariq (OSM way 173836318, `waterway=drain`, `service=irrigation`).
 *
 * Relyef to'ri 78 metrli, shuning uchun 2 metrlik ariqni CHUQUR qilib
 * o'yib bo'lmaydi — u yer sirtida yotgan sayoz beton nov sifatida
 * quriladi va shunga mos sayoz suv zonasi sifatida ro'yxatdan o'tadi.
 */
export const SOFTEX_DRAIN = { u: 11.6, from: 14, to: -80, width: 2.4, depth: 0.28 } as const;

export function softexBasis(frame: CityFrame) {
  const origin = frame.toLocal(SOFTEX_ORIGIN);
  // Azimutni freymning o'zi orqali o'tkazamiz — meridian yaqinlashuvi shunda
  // hisobga olinadi (Farxod'dagi kabi).
  const rad = (SOFTEX_BEARING * Math.PI) / 180;
  const probe = frame.toLocal({
    lon: SOFTEX_ORIGIN.lon + (200 * Math.sin(rad)) / (111320 * Math.cos((SOFTEX_ORIGIN.lat * Math.PI) / 180)),
    lat: SOFTEX_ORIGIN.lat + (200 * Math.cos(rad)) / 110574,
    alt: 0,
  });
  const south = probe.sub(origin).setY(0).normalize();
  const east = new Vector3(south.z, 0, -south.x);
  return {
    origin, east, south,
    point: (u: number, v: number) => origin.clone().addScaledVector(east, u).addScaledVector(south, v),
    uv: (p: { x: number; z: number }) => ({
      u: (p.x - origin.x) * east.x + (p.z - origin.z) * east.z,
      v: (p.x - origin.x) * south.x + (p.z - origin.z) * south.z,
    }),
  };
}

/** Maydoncha va ariq oralig'ida daraxtlarni landmark o'zi joylashtiradi. */
export function softexTreeExclusion(frame: CityFrame) {
  const basis = softexBasis(frame);
  return (p: { x: number; z: number }) => {
    const { u, v } = basis.uv(p);
    return u > -26 && u < 18 && v > -124 && v < 16;
  };
}
