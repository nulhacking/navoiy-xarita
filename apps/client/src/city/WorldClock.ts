/**
 * O'zbekiston yagona vaqt mintaqasida, UTC+5, yozgi vaqtga o'tmaydi.
 *
 * Shuning uchun siljish qat'iy son — `Intl` ga murojaat qilish shart emas
 * va soat brauzer sozlamasidan qat'i nazar Navoiy vaqtini ko'rsatadi.
 */
export const CITY_UTC_OFFSET_HOURS = 5;

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Dunyo soati.
 *
 * Model — HAQIQIY vaqtdan siljish, muzlatilgan lahza emas. Shuning uchun
 * foydalanuvchi "kechqurun 20:00" ni tanlagandan keyin ham vaqt o'z yo'lida
 * oqib turadi: quyosh botadi, soyalar cho'ziladi, chiroqlar yonadi. Muzlatish
 * kerak bo'lganda ham bu model buzilmaydi — siljishning o'zi o'zgaradi.
 */
export class WorldClock {
  /** Haqiqiy vaqtdan siljish, millisekund. Nol — jonli soat. */
  private offset = 0;

  /** Hozirgi dunyo lahzasi. */
  now(): Date {
    return new Date(Date.now() + this.offset);
  }

  /** Jonli soatmi (siljishsiz)? */
  get live(): boolean {
    return this.offset === 0;
  }

  /** Soatni haqiqiy vaqtga qaytaradi. */
  reset(): void {
    this.offset = 0;
  }

  /**
   * Shahar vaqti bo'yicha sutkaning shu soatiga o'tadi.
   *
   * Eng yaqin lahza tanlanadi: 23:00 da 01:00 so'ralsa ertaga o'tiladi,
   * orqaga 22 soat qaytilmaydi.
   *
   * @param hour Shahar vaqtidagi soat, 0..24 (kasr bilan).
   */
  setCityHour(hour: number): void {
    const real = Date.now();
    const current = cityHour(new Date(real + this.offset));
    let delta = (hour - current) * HOUR_MS;
    // Sutka aylanasi bo'ylab eng qisqa yo'l.
    delta = ((delta % DAY_MS) + DAY_MS) % DAY_MS;
    if (delta > DAY_MS / 2) delta -= DAY_MS;
    this.offset += delta;
  }

  /** Soatni berilgan miqdorga suradi (soatda). */
  shiftHours(hours: number): void {
    this.offset += hours * HOUR_MS;
  }
}

/** Berilgan lahzaning shahar vaqtidagi soati, 0..24 (kasr bilan). */
export function cityHour(date: Date): number {
  const shifted = date.getTime() + CITY_UTC_OFFSET_HOURS * HOUR_MS;
  return ((shifted % DAY_MS) + DAY_MS) % DAY_MS / HOUR_MS;
}

/** Shahar vaqti `HH:MM` ko'rinishida. */
export function formatCityTime(date: Date): string {
  const hour = cityHour(date);
  const hours = Math.floor(hour);
  const minutes = Math.floor((hour - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
