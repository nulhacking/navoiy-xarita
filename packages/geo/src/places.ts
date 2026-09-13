import { type Lla, lla } from './wgs84.ts';

/**
 * Tez teleport va test uchun nuqtalar.
 * `alt` — yer sirtining taxminiy balandligi (kamera emas), relyefni tekshirish uchun.
 * Koordinatalar Nominatim (OSM) dan olingan.
 */
export interface Place {
  id: string;
  name: string;
  position: Lla;
  /** Nima uchun ro'yxatda — relyef, bino zichligi yoki chekka holat testi. */
  note?: string;
}

export const PLACES: Place[] = [
  { id: 'navoiy', name: 'Navoiy', position: lla(40.1035, 65.3734, 382) },
  { id: 'samarkand', name: 'Samarqand — Registon', position: lla(39.6547, 66.9758, 705) },
  { id: 'bukhara', name: 'Buxoro — Poi Kalon', position: lla(39.7756, 64.4143, 229) },
  { id: 'tashkent', name: 'Toshkent — Amir Temur xiyoboni', position: lla(41.3111, 69.2797, 450) },
  {
    id: 'chimgan',
    name: 'Chimyon tog‘lari',
    position: lla(41.5619, 70.0142, 2100),
    note: 'Tik relyef — DEM sifatini tekshirish uchun',
  },
  {
    id: 'everest',
    name: 'Everest cho‘qqisi',
    position: lla(27.9881, 86.925, 8849),
    note: 'Eng baland nuqta — balandlik dekodlashni tekshirish',
  },
  {
    id: 'deadsea',
    name: 'O‘lik dengiz',
    position: lla(31.5, 35.47, -430),
    note: 'Manfiy balandlik — dekodlashning chekka holati',
  },
  {
    id: 'manhattan',
    name: 'Nyu-York — Manhattan',
    position: lla(40.7484, -73.9857, 10),
    note: 'Zich OSM binolari — yuklama testi',
  },
];

// Tur aniq belgilangan: `PLACES` bo'sh bo'lmagan literal, lekin buni
// `noUncheckedIndexedAccess` yoqilgan iste'molchi paketlar bilmaydi.
export const DEFAULT_PLACE: Place = PLACES[0]!;

export function findPlace(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id);
}
