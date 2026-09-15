// NPC transportini olganda haydovchi yo'qolmaydi: piyoda bo'lib tushadi va yurib ketadi.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

const browser = await chromium.launch({
  executablePath, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__xarita?.city.isReady, null, { timeout: 180000 });
  await page.evaluate(() => window.__xarita.engine.stop());

  const results = await page.evaluate(() => {
    const { city } = window.__xarita;
    const traffic = city.traffic, player = city.player;
    city.paused = false;
    let frame = 0;
    const tick = (n) => { for (let i = 0; i < n; i++, frame++) city.update({ dt: 1 / 60, elapsed: frame / 60, frame }); };
    const out = [];
    for (let round = 0; round < 3; round++) {
      if (player.mode === 'drive') { player.input.pressed.add('KeyF'); tick(120); }
      let car = null;
      for (let i = 0; i < 60 && !car; i++) { tick(30); car = traffic.agents.find((a) => !a.pedestrian && a.riderTemplate && a.speed > 2 && !out.some((o) => o.id === a.body.handle)); }
      if (!car) break;
      const id = car.body.handle;
      // O'yinchini mashina yoniga (4 m) qo'yamiz — yurish rejimida.
      const t = car.body.translation();
      const side = { x: t.x + Math.cos(car.yaw) * 4, z: t.z - Math.sin(car.yaw) * 4 };
      const y = city.ground.heightAt(side.x, side.z) + 1.2;
      player.body.setTranslation({ x: side.x, y, z: side.z }, true);
      player.body.setNextKinematicTranslation({ x: side.x, y, z: side.z });
      player.presentationReset = true;
      city.physics.world.updateSceneQueries();
      car.speed = 0;
      const peopleBefore = traffic.agents.filter((a) => a.pedestrian).length;
      const known = new Set(traffic.agents);
      player.input.pressed.add('KeyF');
      tick(1);
      const claimed = !traffic.agents.includes(car);
      const driver = traffic.agents.find((a) => a.pedestrian && !known.has(a));
      const spawnGap = driver ? Math.hypot(driver.body.translation().x - t.x, driver.body.translation().z - t.z) : null;
      const start = driver ? { ...driver.body.translation() } : null;
      tick(60 * 5);
      const alive = driver ? traffic.agents.includes(driver) : false;
      const walked = driver && alive ? Math.hypot(driver.body.translation().x - start.x, driver.body.translation().z - start.z) : 0;
      out.push({ id, claimed, peopleBefore, peopleAfter: traffic.agents.filter((a) => a.pedestrian).length,
        driverSpawned: !!driver, spawnGap, alive, walked, mode: player.mode });
    }
    return out;
  });
  console.log(JSON.stringify(results, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(results.length > 0, 'haydovchili NPC transport topilmadi');
  for (const r of results) {
    assert.ok(r.claimed, 'transport olinishi kerak');
    assert.ok(r.driverSpawned, 'haydovchi piyoda bo\'lib tushishi kerak');
    assert.ok(r.spawnGap < 4, 'haydovchi mashina yonida paydo bo\'lishi kerak');
    assert.ok(r.alive, 'haydovchi yo\'qolmasligi kerak');
    assert.ok(r.walked > 2, 'haydovchi yurib ketishi kerak');
    assert.equal(r.mode, 'drive', 'o\'yinchi mashinaga o\'tirishi kerak');
  }
  console.log('PASS: haydovchi tushadi, yo\'qolmaydi, yurib ketadi; o\'yinchi o\'tiradi');
} finally {
  await browser.close();
}
