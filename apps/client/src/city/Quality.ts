/**
 * Grafika sifati: "yuqori" (kompyuter) yoki "yengil" (telefon, kuchsiz GPU).
 *
 * Sahnani ishga tushirishdan OLDIN bir marta aniqlanadi: antialiasing,
 * soya xaritasi va tayl tarkibi renderer/tayl yaratilganda o'rnatiladi va
 * keyin almashtirib bo'lmaydi. Shuning uchun almashtirish sahifani qayta
 * yuklaydi — tanlov `localStorage` da saqlanadi.
 *
 * Yengil rejim mo'ljali: Snapdragon 660 / Adreno 512 darajasidagi telefon
 * (masalan Redmi Note 7). Nima o'chadi va nega:
 *   - soyalar: alohida chuqurlik o'tishi + har pikselda PCF namunalari;
 *   - antialiasing: MSAA bufer kuchsiz GPU xotirasini ikki barobar oladi;
 *   - bino detallari (balkon, konditsioner): ~330 ming uchburchak va har
 *     100 m da qayta quriladigan JS ishi;
 *   - ko'rish masofasi 2.4 km → 0.65 km, undan naridagi tayllar chizilmaydi;
 *   - batafsil daraxt modellari 300 m emas, 70 m ichida;
 *   - NPC: 6 mashina / 10 piyoda o'rniga 2 / 4.
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
  shadows: !LOW_QUALITY,
  antialias: !LOW_QUALITY,
  buildingDetails: !LOW_QUALITY,
  /** Tuman boshlanishi va to'liq yopilishi, metr. */
  fogNear: LOW_QUALITY ? 170 : 350,
  fogFar: LOW_QUALITY ? 650 : 2400,
  /** Kamera `far` tekisligi — tumandan biroz narida. */
  cameraFar: LOW_QUALITY ? 720 : 6000,
  /** Tayl chegarasi o'yinchidan shundan uzoq bo'lsa, tayl chizilmaydi. */
  tileViewDistance: LOW_QUALITY ? 640 : Infinity,
  /** Batafsil daraxt modellarining masofasi (landmarklar o'z qiymatini beradi). */
  treeDetail: (desktop: number) => (LOW_QUALITY ? 70 : desktop),
  maxTreesPerTile: LOW_QUALITY ? 900 : 2400,
  maxCars: LOW_QUALITY ? 2 : 6,
  maxPeople: LOW_QUALITY ? 4 : 10,
  /** Render aniqligi chegaralari (devicePixelRatio ga ko'paytma emas, mutlaq). */
  maxPixelRatio: LOW_QUALITY ? 0.85 : 1.35,
  minPixelRatio: LOW_QUALITY ? 0.5 : 0.8,
} as const;

export function setQuality(level: QualityLevel): void {
  try { localStorage.setItem(STORAGE_KEY, level); } catch { /* saqlanmasa ham qayta yuklanadi */ }
  location.reload();
}
