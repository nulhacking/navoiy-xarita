/**
 * Grafika sifati: "yuqori" (kompyuter) yoki "yengil" (telefon, kuchsiz GPU).
 *
 * Sahnani ishga tushirishdan OLDIN bir marta aniqlanadi: antialiasing,
 * soya xaritasi va tayl tarkibi renderer/tayl yaratilganda o'rnatiladi va
 * keyin almashtirib bo'lmaydi. Shuning uchun almashtirish sahifani qayta
 * yuklaydi — tanlov `localStorage` da saqlanadi.
 *
 * Yengil rejim mo'ljali: Snapdragon 660 / Adreno 512 darajasidagi telefon
 * (masalan Redmi Note 7).
 *
 * Birinchi versiyada soya, antialiasing va aniqlik ham kesilgan edi — tasvir
 * xira bo'lib qoldi, qotish esa asosan qolaverdi. O'lchov boshqa sababni
 * ko'rsatdi: qotishni GPU emas, JS — ~2000 ta mayda kollider (Rapier broadphase),
 * NPC to'siq qidiruvi va 1 mln uchburchakli sport mashina berardi. Ular
 * tuzatilgach, sifat qisman qaytarildi. Endi yengil rejimda:
 *   - soyalar 1024 px xaritada, antialiasing yoqiq, aniqlik ≤ 1.25;
 *   - bino detallari (balkon, konditsioner) o'chiq: ~330 ming uchburchak va
 *     har 100 m da qayta quriladigan JS ishi;
 *   - ko'rish masofasi 2.4 km → 1 km, undan naridagi tayllar chizilmaydi;
 *   - PBR o'rniga Lambert material, sport mashina o'rniga sedan;
 *   - NPC: 6 mashina / 10 piyoda o'rniga 3 / 5.
 * FPS baribir past bo'lsa `Engine` avval aniqlikni, keyin soyani o'zi tushiradi.
 */
export type QualityLevel = 'high' | 'low';

const STORAGE_KEY = 'xarita.quality';

function detect(): QualityLevel {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'high' || saved === 'low') return saved;
  } catch { /* maxfiy rejim — avtomatik tanlov */ }
  if (typeof window === 'undefined') return 'high';
  const touch = window.matchMedia('(pointer: coarse)').matches;
  // Xotirasi juda kam qurilma kompyuter bo'lsa ham yengil rejimga (faqat Chromium beradi).
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return touch || memory < 4 ? 'low' : 'high';
}

export const QUALITY_LEVEL: QualityLevel = detect();
export const LOW_QUALITY = QUALITY_LEVEL === 'low';

export const QUALITY = {
  shadows: true,
  shadowMapSize: LOW_QUALITY ? 1024 : 2048,
  antialias: true,
  buildingDetails: !LOW_QUALITY,
  /** Tuman boshlanishi va to'liq yopilishi, metr. */
  fogNear: LOW_QUALITY ? 260 : 350,
  fogFar: LOW_QUALITY ? 1000 : 2400,
  /** Kamera `far` tekisligi — tumandan biroz narida. */
  cameraFar: LOW_QUALITY ? 1100 : 6000,
  /** Tayl chegarasi o'yinchidan shundan uzoq bo'lsa, tayl chizilmaydi. */
  tileViewDistance: LOW_QUALITY ? 1000 : Infinity,
  /** Batafsil daraxt modellarining masofasi (landmarklar o'z qiymatini beradi). */
  treeDetail: (desktop: number) => (LOW_QUALITY ? 120 : desktop),
  maxTreesPerTile: LOW_QUALITY ? 1400 : 2400,
  maxCars: LOW_QUALITY ? 3 : 6,
  maxPeople: LOW_QUALITY ? 5 : 10,
  /** Render aniqligi chegaralari (devicePixelRatio ga ko'paytma emas, mutlaq). */
  maxPixelRatio: LOW_QUALITY ? 1.25 : 1.35,
  minPixelRatio: LOW_QUALITY ? 0.75 : 0.8,
} as const;

export function setQuality(level: QualityLevel): void {
  try { localStorage.setItem(STORAGE_KEY, level); } catch { /* saqlanmasa ham qayta yuklanadi */ }
  location.reload();
}
