import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  // Haqiqiy telefon rejimi: sensorli ekran, `pointer: coarse`, mobil UA.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], id) => ({ x, y, id })),
  });

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__xarita?.city.isReady, null, { timeout: 180000 });
  await page.waitForSelector('.joystick');
  mkdirSync('artifacts', { recursive: true });

  const layout = await page.evaluate(() => ({
    touchClass: document.body.classList.contains('touch'),
    pixelRatio: window.__xarita.engine.renderer.getPixelRatio(),
    help: document.querySelector('.help') ? getComputedStyle(document.querySelector('.help')).display : 'none',
    buttons: [...document.querySelectorAll('.touch-btn')].map((b) => b.textContent),
    clockCollapsed: document.querySelector('.clock')?.classList.contains('collapsed'),
    shadows: window.__xarita.engine.renderer.shadowMap.enabled,
    quality: (window.__xarita.engine.renderer.getContextAttributes()?.antialias ? 'yuqori' : 'yengil'),
    frame: (() => { const { engine } = window.__xarita, r = engine.renderer; r.info.autoReset = false; r.info.reset(); r.render(engine.scene, engine.camera); const out = { calls: r.info.render.calls, triangles: r.info.render.triangles }; r.info.autoReset = true; return out; })(),
    lambert: (() => { let lite = 0, pbr = 0; window.__xarita.engine.scene.traverse((n) => { if (!n.isMesh) return; for (const m of [n.material].flat()) { if (m.isMeshLambertMaterial) lite++; else if (m.isMeshStandardMaterial) pbr++; } }); return { lite, pbr }; })(),
  }));

  // 1. Joystikni yuqoriga suramiz — personaj oldinga yurishi kerak.
  const stick = await page.locator('.joystick').boundingBox();
  const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
  const before = await page.evaluate(() => ({ ...window.__xarita.city.playerState.position }));
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx, cy - i * 9]]); await page.waitForTimeout(30); }
  await page.waitForTimeout(2500);
  const axisWhileHeld = await page.evaluate(() => window.__xarita.city.player.input.moveAxis());
  await touch('touchEnd', []);
  const after = await page.evaluate(() => ({ ...window.__xarita.city.playerState.position }));
  const walked = Math.hypot(after.x - before.x, after.z - before.z);
  await page.waitForTimeout(300);
  const axisReleased = await page.evaluate(() => window.__xarita.city.player.input.moveAxis());

  // 2. Bo'sh joyni sudrash — kamera buriladi.
  const yaw0 = await page.evaluate(() => window.__xarita.city.player.yaw);
  await touch('touchStart', [[300, 400]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[300 - i * 12, 400]]); await page.waitForTimeout(20); }
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const yaw1 = await page.evaluate(() => window.__xarita.city.player.yaw);

  await page.screenshot({ path: 'artifacts/mobile-walk.png' });

  // 3. Xarita tugmasi.
  await page.locator('.touch-btn', { hasText: 'Xarita' }).tap();
  await page.waitForTimeout(500);
  const mapOpen = await page.evaluate(() => !!document.querySelector('.bigmap'));
  await page.screenshot({ path: 'artifacts/mobile-map.png' });

  // 4. Xaritada ikki barmoq bilan kattalashtirish.
  const mapBox = await page.locator('.bigmap-canvas canvas').boundingBox();
  const mx = mapBox.x + mapBox.width / 2, my = mapBox.y + mapBox.height / 2;
  await touch('touchStart', [[mx - 20, my], [mx + 20, my]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[mx - 20 - i * 10, my], [mx + 20 + i * 10, my]]); await page.waitForTimeout(20); }
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  const mapZoom = await page.evaluate(() => parseFloat(document.querySelector('.map-tools span')?.textContent ?? '1'));
  const waypointAfterPinch = await page.evaluate(() => !!document.querySelector('.waypoint-badge'));
  await page.locator('.bigmap-panel .close').tap();
  await page.waitForTimeout(300);

  // 5. Mashinaga o'tirib, joystik bilan haydash.
  await page.locator('.touch-btn', { hasText: 'O‘tirish' }).tap();
  await page.waitForFunction(() => window.__xarita.city.playerState.mode === 'drive', null, { timeout: 5000 });
  const drivingButtons = await page.evaluate(() => [...document.querySelectorAll('.touch-btn')].map((b) => b.textContent));
  const car0 = await page.evaluate(() => ({ ...window.__xarita.city.playerState.carPosition }));
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx, cy - i * 9]]); await page.waitForTimeout(30); }
  await page.waitForTimeout(3000);
  await touch('touchEnd', []);
  const car1 = await page.evaluate(() => ({ ...window.__xarita.city.playerState.carPosition }));
  const driven = Math.hypot(car1.x - car0.x, car1.z - car0.z);
  await page.screenshot({ path: 'artifacts/mobile-drive.png' });

  const data = { layout, walked, axisWhileHeld, axisReleased, yawChange: yaw1 - yaw0, mapOpen, mapZoom, waypointAfterPinch, drivingButtons, driven };
  console.log(JSON.stringify(data, null, 2));

  assert.ok(layout.touchClass, 'phone must get the touch layout');
  assert.ok(layout.pixelRatio <= 1, 'phone render resolution must be capped');
  assert.equal(layout.help, 'none', 'keyboard help must be hidden on phones');
  assert.ok(layout.clockCollapsed, 'menu starts collapsed on phones');
  assert.ok(!layout.shadows && layout.quality.includes('yengil'), 'phones start in the light graphics profile');
  assert.ok(layout.lambert.lite > layout.lambert.pbr, 'light profile swaps most PBR materials');
  assert.ok(axisWhileHeld.y > .8, `joystick forward axis ${axisWhileHeld.y}`);
  assert.ok(walked > 2, `joystick must move the player (${walked.toFixed(2)} m)`);
  assert.equal(Math.hypot(axisReleased.x, axisReleased.y), 0, 'releasing the stick stops movement');
  assert.ok(Math.abs(yaw1 - yaw0) > .05, 'dragging the scene turns the camera');
  assert.ok(mapOpen, 'map button opens the big map');
  assert.ok(mapZoom > 1.3, `pinch must zoom the map (${mapZoom})`);
  assert.ok(!waypointAfterPinch, 'a pinch must not drop a waypoint');
  assert.ok(drivingButtons.some((t) => t.includes('Tushish')) && drivingButtons.some((t) => t.includes('Tormoz')), 'drive mode swaps the buttons');
  assert.ok(driven > 3, `joystick must drive the car (${driven.toFixed(2)} m)`);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile layout, joystick walk/drive, touch camera, map button and pinch');
} finally {
  await browser.close();
}
