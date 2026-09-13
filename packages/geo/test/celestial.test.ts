import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  horizontalToLocal,
  julianDays,
  moonPosition,
  sunPosition,
} from '../src/celestial.ts';

/** Navoiy — o'yin shahri. */
const LAT = 40.11;
const LON = 65.38;
const DEG = 180 / Math.PI;

/** Kun davomida quyoshning eng yuqori nuqtasi (bir daqiqalik qadam bilan). */
function solarNoon(dateUtc: string): { altitude: number; azimuth: number; at: Date } {
  let best = { altitude: -Infinity, azimuth: 0, at: new Date(dateUtc) };
  const start = new Date(dateUtc).getTime();
  for (let minute = 0; minute < 24 * 60; minute++) {
    const at = new Date(start + minute * 60000);
    const position = sunPosition(at, LAT, LON);
    if (position.altitude > best.altitude) best = { ...position, at };
  }
  return best;
}

describe('julianDays', () => {
  test('J2000.0 nol nuqtada, 2000-01-01 12:00 UTC', () => {
    assert.ok(Math.abs(julianDays(new Date('2000-01-01T12:00:00Z'))) < 1e-6);
  });

  test('bir sutka — aniq bir birlik', () => {
    const a = julianDays(new Date('2026-03-20T00:00:00Z'));
    const b = julianDays(new Date('2026-03-21T00:00:00Z'));
    assert.ok(Math.abs(b - a - 1) < 1e-9);
  });
});

describe('sunPosition', () => {
  // Tushdagi balandlik geometriyadan kelib chiqadi: 90° - kenglik + og'ish.
  // Og'ish quyoshturishda ±23.44°, tengkunlikda 0. Bu formulalardan
  // MUSTAQIL tekshiruv — shuning uchun qimmatli.
  test('yozgi quyoshturishda tush ≈ 90 - kenglik + 23.44', () => {
    const noon = solarNoon('2026-06-21T00:00:00Z');
    assert.ok(Math.abs(noon.altitude * DEG - (90 - LAT + 23.44)) < 0.5,
      `kutilgan ${(90 - LAT + 23.44).toFixed(2)}, olingan ${(noon.altitude * DEG).toFixed(2)}`);
  });

  test('qishki quyoshturishda tush ≈ 90 - kenglik - 23.44', () => {
    const noon = solarNoon('2026-12-21T00:00:00Z');
    assert.ok(Math.abs(noon.altitude * DEG - (90 - LAT - 23.44)) < 0.5,
      `kutilgan ${(90 - LAT - 23.44).toFixed(2)}, olingan ${(noon.altitude * DEG).toFixed(2)}`);
  });

  test('tengkunlikda tush ≈ 90 - kenglik', () => {
    const noon = solarNoon('2026-03-20T00:00:00Z');
    assert.ok(Math.abs(noon.altitude * DEG - (90 - LAT)) < 0.6,
      `kutilgan ${(90 - LAT).toFixed(2)}, olingan ${(noon.altitude * DEG).toFixed(2)}`);
  });

  test('shimoliy yarim sharda tush JANUBDA', () => {
    const noon = solarNoon('2026-03-20T00:00:00Z');
    assert.ok(Math.abs(noon.azimuth * DEG - 180) < 1);
  });

  test('haqiqiy tush uzunlikdan kelib chiqqan vaqtga yaqin', () => {
    // 65.38°E → Grinvichdan 65.38/15 = 4.36 soat oldin.
    const noon = solarNoon('2026-03-20T00:00:00Z');
    const utcHours = noon.at.getUTCHours() + noon.at.getUTCMinutes() / 60;
    // Vaqt tenglamasi tengkunlik atrofida ±15 daqiqagacha siljitadi.
    assert.ok(Math.abs(utcHours - (12 - LON / 15)) < 0.3,
      `kutilgan ~${(12 - LON / 15).toFixed(2)} UTC, olingan ${utcHours.toFixed(2)}`);
  });

  test('yarim tunda quyosh ufq ostida', () => {
    const midnight = sunPosition(new Date('2026-06-21T19:00:00Z'), LAT, LON);
    assert.ok(midnight.altitude < 0);
  });

  test('tengkunlikda kunduz uzunligi ≈ 12 soat', () => {
    let daylight = 0;
    const start = Date.parse('2026-03-20T00:00:00Z');
    for (let minute = 0; minute < 24 * 60; minute++) {
      if (sunPosition(new Date(start + minute * 60000), LAT, LON).altitude > 0) daylight++;
    }
    assert.ok(Math.abs(daylight / 60 - 12) < 0.3, `olingan ${(daylight / 60).toFixed(2)} soat`);
  });
});

describe('moonPosition', () => {
  test('yoritilganlik [0, 1] oralig‘ida va sinodik oyda ikkala chekkaga ham yetadi', () => {
    let min = Infinity;
    let max = -Infinity;
    const start = Date.parse('2026-01-01T00:00:00Z');
    for (let hour = 0; hour < 30 * 24; hour++) {
      const { illumination } = moonPosition(new Date(start + hour * 3600000), LAT, LON);
      assert.ok(illumination >= 0 && illumination <= 1);
      min = Math.min(min, illumination);
      max = Math.max(max, illumination);
    }
    assert.ok(min < 0.02, `yangi oy topilmadi: eng kichigi ${min.toFixed(3)}`);
    assert.ok(max > 0.98, `to‘lin oy topilmadi: eng kattasi ${max.toFixed(3)}`);
  });

  test('faza sinodik oy (29.53 kun) davomida bir marta aylanadi', () => {
    const start = Date.parse('2026-01-01T00:00:00Z');
    const first = moonPosition(new Date(start), LAT, LON).phase;
    const later = moonPosition(new Date(start + 29.53059 * 86400000), LAT, LON).phase;
    const drift = Math.abs(((later - first + 1.5) % 1) - 0.5);
    assert.ok(drift < 0.02, `faza ${drift.toFixed(3)} ga siljidi`);
  });

  test('to‘lin oy Quyoshga QARAMA-QARSHI tomonda turadi', () => {
    // To'lin oyni topamiz, keyin o'sha lahzada ikkalasining balandligini
    // solishtiramiz: biri chiqqanda ikkinchisi botgan bo'lishi kerak.
    const start = Date.parse('2026-01-01T00:00:00Z');
    let full = { illumination: -1, at: new Date(start) };
    for (let hour = 0; hour < 30 * 24; hour++) {
      const at = new Date(start + hour * 3600000);
      const { illumination } = moonPosition(at, LAT, LON);
      if (illumination > full.illumination) full = { illumination, at };
    }
    const moon = moonPosition(full.at, LAT, LON);
    const sun = sunPosition(full.at, LAT, LON);
    assert.ok(moon.altitude * sun.altitude < 0,
      `oy ${(moon.altitude * DEG).toFixed(1)}°, quyosh ${(sun.altitude * DEG).toFixed(1)}°`);
  });
});

describe('horizontalToLocal', () => {
  test('zenit — toza yuqoriga', () => {
    const up = horizontalToLocal({ altitude: Math.PI / 2, azimuth: 0 });
    assert.ok(Math.abs(up.y - 1) < 1e-9);
    assert.ok(Math.hypot(up.x, up.z) < 1e-9);
  });

  test('shimol — manfiy Z, sharq — musbat X', () => {
    const north = horizontalToLocal({ altitude: 0, azimuth: 0 });
    assert.ok(Math.abs(north.z + 1) < 1e-9 && Math.abs(north.x) < 1e-9);
    const east = horizontalToLocal({ altitude: 0, azimuth: Math.PI / 2 });
    assert.ok(Math.abs(east.x - 1) < 1e-9 && Math.abs(east.z) < 1e-9);
  });

  test('birlik vektor qaytaradi', () => {
    const v = horizontalToLocal({ altitude: 0.6, azimuth: 2.1 });
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-12);
  });
});
