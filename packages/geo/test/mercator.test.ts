import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MERCATOR_MAX_LAT,
  childTiles,
  latToMercatorY,
  lonLatToTile,
  lonToMercatorX,
  mercatorXToLon,
  mercatorYToLat,
  metersPerPixel,
  parentTile,
  tileBounds,
  tileKey,
  tileUvToLonLat,
} from '../src/mercator.ts';

describe('Mercator konversiyalari', () => {
  it('markaz (0,0) → (0.5, 0.5)', () => {
    assert.ok(Math.abs(lonToMercatorX(0) - 0.5) < 1e-15);
    assert.ok(Math.abs(latToMercatorY(0) - 0.5) < 1e-15);
  });

  it('burchaklar', () => {
    assert.ok(Math.abs(lonToMercatorX(-180) - 0) < 1e-15);
    assert.ok(Math.abs(lonToMercatorX(180) - 1) < 1e-15);
    assert.ok(Math.abs(latToMercatorY(MERCATOR_MAX_LAT) - 0) < 1e-9);
    assert.ok(Math.abs(latToMercatorY(-MERCATOR_MAX_LAT) - 1) < 1e-9);
  });

  it('kenglik chegaradan tashqarida qirqiladi, Infinity bermaydi', () => {
    assert.ok(Number.isFinite(latToMercatorY(90)));
    assert.ok(Number.isFinite(latToMercatorY(-90)));
    assert.ok(Math.abs(latToMercatorY(90) - 0) < 1e-9);
  });

  it('aylanma konversiya', () => {
    for (const lat of [-84, -40.5, 0, 40.1035, 60, 85]) {
      const back = mercatorYToLat(latToMercatorY(lat));
      assert.ok(Math.abs(back - lat) < 1e-9, `lat ${back} != ${lat}`);
    }
    for (const lon of [-180, -65.37, 0, 65.3734, 179.999]) {
      const back = mercatorXToLon(lonToMercatorX(lon));
      assert.ok(Math.abs(back - lon) < 1e-12, `lon ${back} != ${lon}`);
    }
  });
});

describe('tayl indekslari', () => {
  it('z0 da butun dunyo bitta taylda', () => {
    assert.deepEqual(lonLatToTile(65.37, 40.1, 0), { z: 0, x: 0, y: 0 });
    const b = tileBounds({ z: 0, x: 0, y: 0 });
    assert.ok(Math.abs(b.west + 180) < 1e-12);
    assert.ok(Math.abs(b.east - 180) < 1e-12);
    assert.ok(Math.abs(b.north - MERCATOR_MAX_LAT) < 1e-9);
  });

  it('Navoiy z14 tayli — real so‘rov bilan tekshirilgan qiymat', () => {
    // 40.1035, 65.3734 → z14 taylida OSM ma'lumoti borligi tasdiqlangan.
    const tile = lonLatToTile(65.3734, 40.1035, 14);
    assert.equal(tile.z, 14);
    const b = tileBounds(tile);
    assert.ok(b.west <= 65.3734 && 65.3734 <= b.east, 'lon chegara ichida emas');
    assert.ok(b.south <= 40.1035 && 40.1035 <= b.north, 'lat chegara ichida emas');
  });

  it('sana chizig‘ida indeks chegaradan chiqmaydi', () => {
    const tile = lonLatToTile(180, 0, 5);
    assert.equal(tile.x, 31, `x=${tile.x}, 2^5-1 bo'lishi kerak`);
    const south = lonLatToTile(0, -90, 5);
    assert.equal(south.y, 31);
  });

  it('chegaralar qo‘shni tayllar bilan aynan tutashadi', () => {
    const a = tileBounds({ z: 10, x: 600, y: 380 });
    const right = tileBounds({ z: 10, x: 601, y: 380 });
    const below = tileBounds({ z: 10, x: 600, y: 381 });
    assert.equal(a.east, right.west, 'gorizontal tirqish bor');
    assert.equal(a.south, below.north, 'vertikal tirqish bor');
  });
});

describe('quadtree navigatsiyasi', () => {
  it('bola → ota aylanma', () => {
    const tile = { z: 12, x: 2791, y: 1549 };
    for (const child of childTiles(tile)) {
      assert.deepEqual(parentTile(child), tile, `${tileKey(child)} ota noto'g'ri`);
    }
  });

  it('z0 ning otasi yo‘q', () => {
    assert.equal(parentTile({ z: 0, x: 0, y: 0 }), null);
  });

  it('to‘rt bola otaning chegarasini to‘liq qoplaydi', () => {
    const tile = { z: 8, x: 100, y: 90 };
    const p = tileBounds(tile);
    const [nw, ne, sw, se] = childTiles(tile).map(tileBounds);
    assert.equal(nw.west, p.west);
    assert.equal(ne.east, p.east);
    assert.equal(nw.north, p.north);
    assert.equal(sw.south, p.south);
    // O'rta chiziqlar mos tushishi kerak — aks holda relyefda tirqish chiqadi.
    assert.equal(nw.east, ne.west);
    assert.equal(nw.south, sw.north);
    assert.equal(se.west, sw.east);
  });
});

describe('tileUvToLonLat', () => {
  const tile = { z: 12, x: 2791, y: 1549 };

  it('burchaklar chegaralarga mos', () => {
    const b = tileBounds(tile);
    const nw = tileUvToLonLat(tile, 0, 0);
    const se = tileUvToLonLat(tile, 1, 1);
    assert.ok(Math.abs(nw.lon - b.west) < 1e-12);
    assert.ok(Math.abs(nw.lat - b.north) < 1e-12);
    assert.ok(Math.abs(se.lon - b.east) < 1e-12);
    assert.ok(Math.abs(se.lat - b.south) < 1e-12);
  });

  it('v bo‘yicha namuna Mercator‘da tekis, kenglikda emas', () => {
    // Bu shu modulning eng nozik joyi: agar kenglik bo'yicha tekis olsak,
    // tekstura relyefga nisbatan siljiydi. Yuqori kenglikda farq sezilarli.
    const high = { z: 6, x: 32, y: 18 };
    const b = tileBounds(high);
    const mid = tileUvToLonLat(high, 0.5, 0.5);
    const naiveMidLat = (b.north + b.south) / 2;
    assert.ok(
      Math.abs(mid.lat - naiveMidLat) > 1e-6,
      'Mercator markazi kenglik o‘rtachasidan farq qilishi kerak edi',
    );
    // Mercator fazosidagi o'rta esa aynan tushadi.
    const n = 2 ** high.z;
    assert.ok(Math.abs(latToMercatorY(mid.lat) - (high.y + 0.5) / n) < 1e-12);
  });
});

describe('metersPerPixel', () => {
  it('ekvatorda z0 da ~156 km/px', () => {
    assert.ok(Math.abs(metersPerPixel(0, 0) - 156543) < 1);
  });

  it('har zoom ikki barobar aniqroq', () => {
    const a = metersPerPixel(10, 40.1);
    const b = metersPerPixel(11, 40.1);
    assert.ok(Math.abs(a / b - 2) < 1e-12);
  });

  it('Navoiy kengligida z14 ≈ 7.3 m/px', () => {
    // Sentinel-2 ning 10 m/px chegarasi shu atrofda tugaydi — z14 dan
    // keyin tekstura yoyiladi. Bu rejadagi asosiy sifat chegarasi.
    const mpp = metersPerPixel(14, 40.1035);
    assert.ok(mpp > 7 && mpp < 7.6, `${mpp} m/px`);
  });
});
