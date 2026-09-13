import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  WGS84_A,
  WGS84_B,
  ecefToLla,
  enuBasis,
  geodeticSurfaceNormal,
  lla,
  llaToEcef,
  localFrameAt,
} from '../src/wgs84.ts';
import { PLACES } from '../src/places.ts';
import { dot, invertRigid, length, sub, transformPoint, vec3d } from '../src/vec3d.ts';

/** Konversiyalar millimetr darajasida aniq bo'lishi kerak. */
const MM = 1e-3;

describe('llaToEcef — ma’lum nuqtalar', () => {
  it('(0, 0, 0) ekvator radiusida', () => {
    const v = llaToEcef(lla(0, 0, 0));
    assert.ok(Math.abs(v.x - WGS84_A) < MM, `x=${v.x}`);
    assert.ok(Math.abs(v.y) < MM);
    assert.ok(Math.abs(v.z) < MM);
  });

  it('(0, 90, 0) — Y o‘qida', () => {
    const v = llaToEcef(lla(0, 90, 0));
    assert.ok(Math.abs(v.x) < MM);
    assert.ok(Math.abs(v.y - WGS84_A) < MM);
    assert.ok(Math.abs(v.z) < MM);
  });

  it('shimoliy qutb qutb radiusida', () => {
    const v = llaToEcef(lla(90, 0, 0));
    assert.ok(Math.abs(v.x) < MM);
    assert.ok(Math.abs(v.y) < MM);
    assert.ok(Math.abs(v.z - WGS84_B) < MM, `z=${v.z} kutilgan ${WGS84_B}`);
  });

  it('balandlik normal bo‘ylab qo‘shiladi', () => {
    const surface = llaToEcef(lla(0, 0, 0));
    const up = llaToEcef(lla(0, 0, 1000));
    assert.ok(Math.abs(length(sub(up, surface)) - 1000) < MM);
  });
});

describe('ecefToLla — llaToEcef ning teskarisi', () => {
  // Qutblar, sana chizig'i, katta balandlik va manfiy balandlik — barcha chekka holatlar.
  const cases = [
    lla(0, 0, 0),
    lla(41.3111, 69.2797, 450),
    lla(-33.8568, 151.2153, 10),
    lla(90, 0, 0),
    lla(-90, 0, 0),
    lla(89.9999, 123.456, 100),
    lla(0, 180, 0),
    lla(0, -180, 0),
    lla(45, -73.9857, 8849),
    lla(27.9881, 86.925, -430), // O'lik dengiz darajasidan pastroq
    lla(51.5, -0.12, 20_000_000), // geostatsionar orbitadan uzoqroq
  ];

  for (const p of cases) {
    it(`aylanma: ${p.lat}, ${p.lon}, ${p.alt}`, () => {
      const back = ecefToLla(llaToEcef(p));
      // Qutbda uzunlik ma'nosiz — faqat kenglik va balandlik tekshiriladi.
      const atPole = Math.abs(p.lat) > 89.99999;
      assert.ok(Math.abs(back.lat - p.lat) < 1e-9, `lat ${back.lat} != ${p.lat}`);
      if (!atPole) {
        const dLon = Math.abs(((back.lon - p.lon + 540) % 360) - 180);
        assert.ok(dLon < 1e-9, `lon ${back.lon} != ${p.lon}`);
      }
      assert.ok(Math.abs(back.alt - p.alt) < MM, `alt ${back.alt} != ${p.alt}`);
    });
  }
});

describe('enuBasis', () => {
  it('bazis ortonormal', () => {
    for (const place of PLACES) {
      const { east, north, up } = enuBasis(place.position);
      const label = place.id;
      assert.ok(Math.abs(length(east) - 1) < 1e-12, `${label} east birlik emas`);
      assert.ok(Math.abs(length(north) - 1) < 1e-12, `${label} north birlik emas`);
      assert.ok(Math.abs(length(up) - 1) < 1e-12, `${label} up birlik emas`);
      assert.ok(Math.abs(dot(east, north)) < 1e-12, `${label} east·north ≠ 0`);
      assert.ok(Math.abs(dot(east, up)) < 1e-12, `${label} east·up ≠ 0`);
      assert.ok(Math.abs(dot(north, up)) < 1e-12, `${label} north·up ≠ 0`);
    }
  });

  it('up = sirt normali', () => {
    const p = lla(41.3111, 69.2797, 450);
    const { up } = enuBasis(p);
    const n = geodeticSurfaceNormal(p);
    assert.ok(Math.abs(up.x - n.x) < 1e-15);
    assert.ok(Math.abs(up.y - n.y) < 1e-15);
    assert.ok(Math.abs(up.z - n.z) < 1e-15);
  });
});

describe('localFrameAt — mahalliy o‘yin freymi', () => {
  const origin = lla(41.3111, 69.2797, 450);

  it('freym boshi mahalliy (0,0,0) ga tushadi', () => {
    const toEcef = localFrameAt(origin);
    const toLocal = invertRigid(toEcef);
    const local = transformPoint(toLocal, llaToEcef(origin));
    assert.ok(length(local) < MM, `origin mahalliy ${JSON.stringify(local)}`);
  });

  it('mahalliy +Y = yuqori (balandlik ortadi)', () => {
    const toEcef = localFrameAt(origin);
    const ecef = transformPoint(toEcef, vec3d(0, 100, 0));
    const back = ecefToLla(ecef);
    assert.ok(Math.abs(back.alt - (origin.alt + 100)) < MM, `alt=${back.alt}`);
    assert.ok(Math.abs(back.lat - origin.lat) < 1e-9);
    assert.ok(Math.abs(back.lon - origin.lon) < 1e-9);
  });

  it('mahalliy +X = sharq (uzunlik ortadi, kenglik o‘zgarmaydi)', () => {
    const toEcef = localFrameAt(origin);
    const back = ecefToLla(transformPoint(toEcef, vec3d(1000, 0, 0)));
    assert.ok(back.lon > origin.lon, 'sharqqa yurganda lon ortishi kerak');
    // 1 km yoy — kenglik biroz kamayadi (tekis freym sferaga urinma), lekin arzimas.
    assert.ok(Math.abs(back.lat - origin.lat) < 1e-3);
  });

  it('mahalliy -Z = shimol (kenglik ortadi)', () => {
    const toEcef = localFrameAt(origin);
    const back = ecefToLla(transformPoint(toEcef, vec3d(0, 0, -1000)));
    assert.ok(back.lat > origin.lat, 'shimolga yurganda lat ortishi kerak');
  });

  it('1 km masofada tekis freym xatosi ~8 sm dan oshmaydi', () => {
    // Mahalliy freym — urinma TEKISLIK, Yer esa uning ostida egilib ketadi.
    // Shuning uchun freymda gorizontal yurgan nuqta ellipsoid sirtidan
    // d²/2R ≈ 1000²/(2·6.37e6) ≈ 0.078 m ga KO'TARILADI.
    // Bu floating origin radiusini tanlashning asosi: 1 km da 8 sm — sezilmaydi,
    // 10 km da esa 7.8 m bo'lib, personaj havoda yurayotgandek ko'rinardi.
    const toEcef = localFrameAt(origin);
    const back = ecefToLla(transformPoint(toEcef, vec3d(1000, 0, 0)));
    const rise = back.alt - origin.alt;
    assert.ok(rise > 0.07 && rise < 0.09, `egrilik ko'tarilishi ${rise} m`);
  });

  it('invertRigid haqiqatan teskari', () => {
    const toEcef = localFrameAt(origin);
    const toLocal = invertRigid(toEcef);
    const p = vec3d(1234.5, -678.9, 246.8);
    const roundTrip = transformPoint(toLocal, transformPoint(toEcef, p));
    assert.ok(Math.abs(roundTrip.x - p.x) < 1e-6);
    assert.ok(Math.abs(roundTrip.y - p.y) < 1e-6);
    assert.ok(Math.abs(roundTrip.z - p.z) < 1e-6);
  });
});

describe('aniqlik — nima uchun float64 kerak', () => {
  it('float32 Yer masshtabida metrdan yomonroq aniqlik beradi', () => {
    // Bu test hujjat vazifasini bajaradi: floating origin nima uchun majburiy.
    const ecef = llaToEcef(lla(41.3111, 69.2797, 450));
    const f32 = Math.fround(ecef.x);
    const error = Math.abs(ecef.x - f32);
    assert.ok(error > 0.05, `f32 xatosi atigi ${error} m — kutilgandan kichik`);
  });

  it('mahalliy freymda float32 millimetr aniqlik beradi', () => {
    // 1 km atrofidagi qiymatlar f32 da ~0.06 mm aniq — o'yin uchun mutlaqo yetarli.
    const local = 1000.5;
    assert.ok(Math.abs(local - Math.fround(local)) < 1e-4);
  });
});
