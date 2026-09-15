// Urib yuborilgan NPC yo'qolmaydi: odam o'rnidan turib yana yuradi, mashina joyida qoladi
// va uning haydovchisi piyoda bo'lib tushadi.
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

  const result = await page.evaluate(() => {
    const { city } = window.__xarita;
    const traffic = city.traffic;
    city.paused = false;
    let frame = 0;
    const tick = (n) => { for (let i = 0; i < n; i++, frame++) { city.update({ dt: 1 / 60, elapsed: frame / 60, frame }); } };
    let walker = null, car = null;
    for (let i = 0; i < 80 && !(walker && car); i++) {
      tick(30);
      walker ??= traffic.agents.find((a) => a.pedestrian && a.speed > 1);
      car ??= traffic.agents.find((a) => !a.pedestrian && a.riderTemplate && a.speed > 3);
    }
    const out = {};
    if (walker) {
      const template = walker.template, start = { ...walker.body.translation() };
      traffic.knockDown(walker, 9, 3);
      tick(30);
      const flying = traffic.knocked.find((k) => k.agent === walker);
      const flew = flying?.body ? Math.hypot(flying.body.translation().x - start.x, flying.body.translation().z - start.z) : 0;
      const known = new Set(traffic.agents);
      let risingSeen = false, standing = null, stoodAt = null;
      for (let s = 0; s < 60 * 15 && !standing; s++) {
        tick(1);
        if (traffic.knocked.some((k) => k.agent === walker && k.phase === 'rising')) risingSeen = true;
        standing = traffic.agents.find((a) => a.pedestrian && !known.has(a) && a.template === template &&
          Math.hypot(a.body.translation().x - start.x, a.body.translation().z - start.z) < 25) ?? null;
        if (standing) stoodAt = s / 60;
      }
      const p0 = standing ? { ...standing.body.translation() } : null;
      tick(60 * 4);
      out.walker = { flew, risingSeen, stoodUp: !!standing, stoodAt, stillKnocked: traffic.knocked.some((k) => k.agent === walker),
        alive: standing ? traffic.agents.includes(standing) : false,
        walked: standing && traffic.agents.includes(standing) ? Math.hypot(standing.body.translation().x - p0.x, standing.body.translation().z - p0.z) : 0 };
    }
    if (car) {
      const known = new Set(traffic.agents);
      traffic.knockDown(car, 12, 0);
      tick(60 * 10);
      const k = traffic.knocked.find((entry) => entry.agent === car);
      const driver = traffic.agents.find((a) => a.pedestrian && !known.has(a) && a.template === car.riderTemplate);
      out.car = { present: !!k && !!k.agent.object.parent, phase: k?.phase, riderLeft: !car.rider, driverOut: !!driver };
    }
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(result.walker, 'yuruvchi piyoda topilmadi');
  assert.ok(result.walker.flew > 1, 'piyoda uchib ketishi kerak');
  assert.ok(result.walker.risingSeen, 'piyoda o\'rnidan turishi kerak');
  assert.ok(result.walker.stoodUp && !result.walker.stillKnocked, 'piyoda yana NPC bo\'lishi kerak');
  assert.ok(result.walker.alive && result.walker.walked > 1, 'turgan piyoda yurib ketishi kerak');
  if (result.car) {
    assert.ok(result.car.present, 'urilgan mashina yo\'qolmasligi kerak');
    assert.equal(result.car.phase, 'settled');
    assert.ok(result.car.riderLeft && result.car.driverOut, 'haydovchi mashinadan tushishi kerak');
  }
  console.log('PASS: urilgan odam o\'rnidan turib yuradi, mashina joyida qoladi, haydovchi tushadi');
} finally {
  await browser.close();
}
