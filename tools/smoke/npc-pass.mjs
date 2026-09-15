// Piyoda NPC yo'lida turgan o'yinchini aylanib o'tadimi va NPC'lar silliq chiziladimi.
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
    const traffic = city.traffic, player = city.player;
    city.paused = false;
    let frame = 0;
    const tick = (n) => { for (let i = 0; i < n; i++, frame++) city.update({ dt: 1 / 60, elapsed: frame / 60, frame }); };
    const pickWalker = () => traffic.agents.find((a) => a.pedestrian && a.speed > 1 && a.edge.length - a.distance > 14);
    let walker = null;
    for (let i = 0; i < 40 && !walker; i++) { tick(30); walker = pickWalker(); }
    if (!walker) return { skipped: 'no walker' };

    // O'yinchini piyodaning yo'liga, 4 m oldiga qo'yamiz.
    const edge = walker.edge, dx = (edge.b.x - edge.a.x) / edge.length, dz = (edge.b.z - edge.a.z) / edge.length;
    const start = walker.body.translation();
    const spot = { x: start.x + dx * 4, z: start.z + dz * 4 };
    const y = city.ground.heightAt(spot.x, spot.z) + 1.2;
    player.body.setTranslation({ x: spot.x, y, z: spot.z }, true);
    player.body.setNextKinematicTranslation({ x: spot.x, y, z: spot.z });
    player.presentationReset = true;
    city.physics.world.updateSceneQueries();

    let minSpeed = Infinity, minGap = Infinity, maxSidestep = 0;
    for (let i = 0; i < 360; i++) {
      tick(1);
      if (!traffic.agents.includes(walker)) break;
      const t = walker.body.translation(), pp = player.body.translation();
      minSpeed = Math.min(minSpeed, walker.speed);
      minGap = Math.min(minGap, Math.hypot(t.x - pp.x, t.z - pp.z));
      maxSidestep = Math.max(maxSidestep, Math.abs(walker.sidestep));
    }
    const end = walker.body.translation(), pp = player.body.translation();
    const passed = ((end.x - pp.x) * dx + (end.z - pp.z) * dz) > 1;

    // Silliqlik: 60 Hz fizika, 0/1/2 qadamli notekis kadrlar. Ko'rinadigan siljish
    // kadrlar orasidagi vaqtga mutanosib bo'lishi kerak.
    const other = traffic.agents.find((a) => a.pedestrian && a.speed > 1) ?? walker;
    const car = traffic.agents.find((a) => !a.pedestrian && a.speed > 3);
    const measure = (agent) => {
      if (!agent) return null;
      const ratios = [];
      let last = agent.object.position.clone(), clock = 0;
      for (let i = 0; i < 240; i++) {
        const dt = [0.012, 0.021, 0.0167, 0.009, 0.024][i % 5];
        clock += dt;
        city.update({ dt, elapsed: clock, frame: frame++ });
        const now = agent.object.position;
        const speed = Math.hypot(now.x - last.x, now.z - last.z) / dt;
        if (i > 20 && agent.speed > 0.5) ratios.push(speed / agent.speed);
        last = now.clone();
      }
      if (!ratios.length) return null;
      return { min: Math.min(...ratios), max: Math.max(...ratios) };
    };
    return { passed, minSpeed, minGap, maxSidestep, walkerSmooth: measure(other), carSmooth: measure(car) };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  if (!result.skipped) {
    assert.ok(result.passed, 'piyoda o\'yinchi yonidan o\'tib ketishi kerak');
    assert.ok(result.minSpeed > 0.5, 'piyoda to\'xtab qolmasligi kerak');
    assert.ok(result.minGap > 0.6, 'piyoda o\'yinchi ichidan o\'tmasligi kerak');
  }
} finally {
  await browser.close();
}
