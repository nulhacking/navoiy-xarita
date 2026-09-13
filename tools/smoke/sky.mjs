/**
 * Kun-tun sikli: quyosh, oy, soyalar va ko'cha chiroqlari.
 *
 * Astronomiyaning o'zi `packages/geo` da birlik testlar bilan qoplangan —
 * bu yerda SAHNA tekshiriladi: vaqt o'zgarganda yorug'lik, soya yo'nalishi,
 * chiroqlar va kadrning o'zi haqiqatan mos ravishda o'zgaradimi.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://**', route => route.abort());
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__xarita?.city.isReady, null, { timeout: 90000 });

  const result = await page.evaluate(async () => {
    const { city, engine } = window.__xarita;
    engine.stop();
    const tick = () => { for (let i = 0; i < 8; i++) city.update({ dt: 1 / 60, elapsed: i / 60, frame: i }); };

    /** Kadrning o'rtacha yorqinligi — sahna haqiqatan yorishayaptimi. */
    const brightness = () => {
      const gl = engine.renderer.domElement;
      const canvas = document.createElement('canvas');
      canvas.width = gl.width; canvas.height = gl.height;
      canvas.getContext('2d').drawImage(gl, 0, 0);
      const d = canvas.getContext('2d').getImageData(0, 0, gl.width, gl.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4) / 3;
    };

    const lensAt = () => {
      let value = null;
      engine.scene.traverse(n => {
        if (n.name !== 'street-lamp' || !n.material) return;
        const materials = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of materials) if (/yellow/i.test(m.name)) value = m.emissiveIntensity;
      });
      return value;
    };
    const poolAt = () => {
      let value = null;
      engine.scene.traverse(n => { if (n.name === 'street-light-pool') value = n.visible ? n.material.opacity : 0; });
      return value;
    };

    const sample = (hour) => {
      city.clock.reset();
      city.clock.setCityHour(hour);
      tick();
      city.player.render();
      engine.renderer.render(engine.scene, engine.camera);
      const s = city.skyState;
      const key = city.sky.key;
      return {
        hour,
        sunAltitude: (s.sun.altitude * 180) / Math.PI,
        sunAzimuth: (s.sun.azimuth * 180) / Math.PI,
        daylight: s.daylight,
        keyIntensity: key.intensity,
        // Soya yo'nalishi: chiroq nishonidan qaysi tomonda turibdi.
        keyDirection: key.position.clone().sub(key.target.position).normalize().toArray(),
        ambient: city.sky.ambient.intensity,
        lens: lensAt(),
        pool: poolAt(),
        brightness: brightness(),
        clockLabel: (() => {
          const utc5 = new Date(s.date.getTime() + 5 * 3600000);
          return `${String(utc5.getUTCHours()).padStart(2, '0')}:${String(utc5.getUTCMinutes()).padStart(2, '0')}`;
        })(),
      };
    };

    const morning = sample(8);
    const noon = sample(12);
    const evening = sample(17);
    const night = sample(1);

    // Jonli soatga qaytish.
    city.clock.reset();
    tick();
    const live = { live: city.clock.live, driftMs: Math.abs(city.skyState.date.getTime() - Date.now()) };

    const shaderErrors = engine.renderer.info.programs.filter(p => p.diagnostics?.runnable === false).length;
    return { morning, noon, evening, night, live, shaderErrors };
  });

  console.log(JSON.stringify(result, null, 2));
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/navoiy-night.png' });

  const { morning, noon, evening, night, live } = result;

  // Quyosh sutka davomida ko'tarilib, botadi va SHARQDAN G'ARBGA yuradi.
  assert.ok(noon.sunAltitude > morning.sunAltitude, 'tushda quyosh ertalabdan baland turishi kerak');
  assert.ok(noon.sunAltitude > evening.sunAltitude, 'tushda quyosh kechqurundan baland turishi kerak');
  assert.ok(night.sunAltitude < -10, `tunda quyosh ufq ostida bo'lishi kerak: ${night.sunAltitude.toFixed(1)}`);
  assert.ok(morning.sunAzimuth < 180 && evening.sunAzimuth > 180,
    `quyosh sharqdan g'arbga: ${morning.sunAzimuth.toFixed(0)} → ${evening.sunAzimuth.toFixed(0)}`);

  // Soya yo'nalishi quyosh bilan birga buriladi.
  const turn = Math.hypot(morning.keyDirection[0] - evening.keyDirection[0],
    morning.keyDirection[2] - evening.keyDirection[2]);
  assert.ok(turn > 1, `soya yo'nalishi burilmadi: ${turn.toFixed(2)}`);

  // Yorug'lik kunduzi va tunda tubdan farq qiladi.
  assert.equal(noon.daylight, 1);
  assert.equal(night.daylight, 0);
  assert.ok(noon.keyIntensity > 2, `tushda quyosh kuchsiz: ${noon.keyIntensity.toFixed(2)}`);
  assert.ok(night.keyIntensity < 0.5, `tunda chiroq juda kuchli: ${night.keyIntensity.toFixed(2)}`);
  assert.ok(noon.ambient > night.ambient);
  assert.ok(noon.brightness > night.brightness * 1.8,
    `kadr tunda yorishib qolgan: ${noon.brightness.toFixed(1)} vs ${night.brightness.toFixed(1)}`);

  // Ko'cha chiroqlari tunda yonadi, kunduzi o'chadi.
  assert.ok(noon.lens !== null, 'ko\u2018cha chirog\u2018i topilmadi — model yuklanmagan bo\u2018lishi mumkin');
  assert.ok(noon.lens < 0.05, `kunduzi chiroq yonib turibdi: ${noon.lens}`);
  assert.ok(night.lens > 1.5, `tunda chiroq yonmadi: ${night.lens}`);
  assert.ok(noon.pool === 0, `kunduzi yerda yorug'lik dog'i bor: ${noon.pool}`);
  assert.ok(night.pool > 0.2, `tunda yorug'lik dog'i yo'q: ${night.pool}`);

  // Soat: so'ralgan soat ko'rsatiladi, "hozir" esa haqiqiy vaqtga qaytaradi.
  assert.equal(noon.clockLabel.slice(0, 2), '12');
  assert.equal(night.clockLabel.slice(0, 2), '01');
  assert.equal(live.live, true);
  assert.ok(live.driftMs < 2000, `jonli soat haqiqiy vaqtdan uzoqlashdi: ${live.driftMs} ms`);

  assert.equal(result.shaderErrors, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: quyosh yo\u2018li, soya burilishi, kun/tun yorug\u2018ligi, ko\u2018cha chiroqlari va soat');
} finally { await browser.close(); }
