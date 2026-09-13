/**
 * SOFTEX markazi va transportning suvdagi holati.
 *
 * Ikki narsani tekshiradi:
 *   1. Landmark OSM poydevorining o'rnida turibdimi, umumiy tayl o'sha binoni
 *      ikkinchi marta chizmayaptimi, kollider ko'rinadigan hajm bilan bir xilmi.
 *   2. Mashina suvga kiraveradimi, chuqurlikka qarab sekinlashadimi, motor
 *      o'chgach cho'kadimi va o'yinchi suvdan chiqib keta oladimi.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => p && existsSync(p));
assert.ok(executablePath, 'Install Chrome/Edge or set CHROME_PATH');
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(process.env.TEST_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__xarita?.city.isReady, null, { timeout: 180000 });
  await page.evaluate(() => window.__xarita.engine.stop());
  await page.getByRole('button', { name: '⌖ SOFTEX markaziga borish', exact: true }).click();
  await page.waitForFunction(() => !window.__xarita.city.teleporting, null, { timeout: 120000 });
  mkdirSync('artifacts', { recursive: true });

  const site = await page.evaluate(() => {
    const { city } = window.__xarita, s = city.softex;
    for (let i = 0; i < 120; i++) city.update({ dt: 1 / 60, elapsed: i / 60, frame: i });
    let meshes = 0, invalid = 0;
    s.group.traverse((n) => {
      if (!n.isMesh) return;
      meshes++;
      for (const v of n.geometry.getAttribute('position').array) if (!Number.isFinite(v)) invalid++;
    });
    // Poydevordagi OSM binosi endi landmarkka tegishli — tayl uni chizmasligi kerak.
    let overlappingGeneric = 0;
    for (const t of city.tiles.values()) for (const b of t.detailContext.buildings) {
      const q = s.basis.uv({ x: b.ring[0], z: b.ring[1] });
      if (q.u > -11 && q.u < 5 && q.v > -120 && q.v < 2) overlappingGeneric++;
    }
    // Tom balandligi: nur tomga urilishi kerak, yerga emas.
    const roof = s.basis.point(-3, -10);
    const roofHit = city.physics.groundHeightAt(roof.x, s.base + 40, roof.z, 80);
    // Ariq — sayoz suv zonasi: kechib o'tsa bo'ladi, cho'kib bo'lmaydi.
    const wet = s.basis.point(11.6, -20), dry = s.basis.point(-16, -20);
    const wetLevel = city.ground.waterLevelAt(wet.x, wet.z);
    return {
      ...s.group.userData, meshes, invalid, overlappingGeneric,
      roofHeight: +(roofHit - s.base).toFixed(2),
      drainDepth: wetLevel === null ? null : +(wetLevel - city.ground.heightAt(wet.x, wet.z)).toFixed(2),
      dryIsDry: city.ground.waterLevelAt(dry.x, dry.z) === null,
      playerUv: s.basis.uv(city.playerState.position),
    };
  });
  console.log(JSON.stringify(site, null, 2));
  assert.ok(site.meshes > 8, 'landmark geometry missing');
  assert.equal(site.invalid, 0);
  assert.equal(site.overlappingGeneric, 0, 'generic tile still extrudes the replaced OSM way');
  assert.ok(site.roofHeight > 6 && site.roofHeight < 12, `roof collider at ${site.roofHeight} m`);
  assert.ok(site.drainDepth > 0.1 && site.drainDepth < 0.6, `drain depth ${site.drainDepth}`);
  assert.ok(site.dryIsDry, 'forecourt must not be water');

  for (const [name, u, v, elevation, hour] of [
    ['front', -30, 20, 3.2, 15], ['corner', -22, 16, 4, 11], ['air', -24, 34, 34, 12], ['night', -20, 12, 4, 21],
  ]) {
    await page.evaluate(({ u, v, elevation, hour }) => {
      const { city, engine } = window.__xarita, s = city.softex;
      city.clock.setCityHour(hour);
      city.update({ dt: 0, elapsed: 1, frame: 200 });
      const target = s.basis.point(-3, -5);
      target.y = s.base + (elevation > 20 ? 0 : 4);
      city.sky.update(city.clock.now(), 40.13108, 65.35080, target);
      const eye = s.basis.point(u, v);
      eye.y = s.base + elevation;
      engine.camera.position.copy(eye);
      engine.camera.lookAt(target);
      engine.camera.updateMatrixWorld(true);
      engine.renderer.render(engine.scene, engine.camera);
    }, { u, v, elevation, hour });
    await page.screenshot({ path: `artifacts/softex-${name}.png` });
  }

  // --- Suvdagi transport ---
  const water = await page.evaluate(async () => {
    const { city } = window.__xarita;
    const p = city.frame.toLocal({ lat: 40.10915, lon: 65.36285, alt: 0 });
    await city.teleport(p.x, p.z);
    return { x: p.x, z: p.z };
  });
  await page.waitForFunction(() => !window.__xarita.city.teleporting, null, { timeout: 120000 });
  const drive = await page.evaluate(() => {
    const { city } = window.__xarita;
    const tick = (s, hz = 60) => { for (let i = 0; i < Math.round(s * hz); i++) city.update({ dt: 1 / hz, elapsed: i / hz, frame: i }); };
    const key = (c, d) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c }));
    tick(2);
    key('KeyF', true); tick(0.05); key('KeyF', false); tick(0.4);
    const entered = city.playerState.mode;
    // Eng yaqin suv tomon buriladi.
    const c = city.player.carPosition;
    let best = null;
    for (let a = 0; a < 360; a += 5) {
      const r = a * Math.PI / 180;
      for (let d = 10; d < 240; d += 5) {
        if (city.ground.waterLevelAt(c.x + Math.sin(r) * d, c.z + Math.cos(r) * d) !== null) {
          if (!best || d < best.d) best = { a: r, d };
          break;
        }
      }
    }
    if (!best) return { entered, error: 'no water nearby' };
    city.player.carYaw = best.a;
    city.player.carBody.setRotation({ x: 0, y: Math.sin(best.a / 2), z: 0, w: Math.cos(best.a / 2) }, true);
    key('KeyW', true);
    let entryY = null, deepest = 0, floodPeak = 0;
    for (let i = 0; i < 120; i++) {
      tick(0.25);
      const p = city.player;
      if (p.carDepth > 0.2 && entryY === null) entryY = p.carPosition.y;
      deepest = Math.max(deepest, p.carDepth);
      floodPeak = Math.max(floodPeak, p.carFlood);
      if (p.carFlood >= 1) break;
    }
    key('KeyW', false);
    tick(4);
    const sunkY = city.player.carPosition.y;
    const speedInWater = city.playerState.speed;
    const waterState = city.playerState.water;
    key('KeyF', true); tick(0.05); key('KeyF', false); tick(1.5);
    return { entered, deepest: +deepest.toFixed(2), floodPeak: +floodPeak.toFixed(2),
      sank: +(entryY - sunkY).toFixed(2), speedInWater: +speedInWater.toFixed(1),
      waterState, exited: city.playerState.mode, swimming: city.playerState.water };
  });
  console.log(JSON.stringify(drive, null, 2));
  assert.equal(drive.entered, 'drive');
  assert.ok(drive.deepest > 1, `car never reached deep water (${drive.deepest} m)`);
  assert.ok(drive.floodPeak > 0.9, `engine never flooded (${drive.floodPeak})`);
  assert.ok(drive.sank > 0.6, `car did not sink (${drive.sank} m)`);
  assert.equal(drive.speedInWater, 0, 'flooded car must not drive');
  assert.equal(drive.waterState, 2);
  assert.equal(drive.exited, 'walk', 'player must be able to leave a sunken car');
  assert.equal(drive.swimming, 2, 'player should be swimming after a wet exit');
  assert.deepEqual(errors, []);
  console.log('PASS: SOFTEX massing/collider/OSM takeover, shallow drain, car wading, flooding, sinking and wet exit');
} finally { await browser.close(); }
