/**
 * Asosiy kiritish qurilmasi barmoqmi.
 *
 * `pointer: coarse` — asosiy ko'rsatkich barmoq (telefon, planshet). Sensorli
 * ekranli noutbukda asosiy ko'rsatkich sichqoncha, shuning uchun u yerda
 * klaviatura rejimi qoladi.
 */
export const isTouchDevice: boolean = typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches ||
    (navigator.maxTouchPoints > 0 && !window.matchMedia('(any-pointer: fine)').matches));
