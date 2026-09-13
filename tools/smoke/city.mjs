import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => p && existsSync(p));
assert.ok(executablePath, 'Install Chrome/Edge or set CHROME_PATH');
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => window.__xarita?.city.isReady, null, { timeout: 120_000 });
  } catch (error) {
    console.log('Startup diagnostics:', await page.locator('body').innerText(), errors);
    mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/startup-failed.png' });
    throw error;
  }
  const result = await page.evaluate(async () => {
    const { city, engine } = window.__xarita;
    engine.stop();
    const tick = (seconds, hz = 60) => {
      for (let i = 0; i < Math.round(seconds * hz); i++) city.update({ dt: 1 / hz, elapsed: i / hz, frame: i });
    };
    const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    const gap = () => {
      const p = city.playerState;
      return p.position.y - (p.mode === 'walk' ? 0.9 : 0.7) - city.ground.heightAt(p.position.x, p.position.z);
    };
    tick(2);
    const spawn = city.playerState.position.clone();
    const groundGap = gap();
    const grounded = city.playerState.grounded;
    const distances = [];
    for (const hz of [30, 60, 120]) {
      city.player.teleport(spawn.x, spawn.z);
      tick(1);
      const before = city.playerState.position;
      key('KeyW', true); tick(1, hz); key('KeyW', false);
      distances.push(before.distanceTo(city.playerState.position));
    }
    city.player.teleport(spawn.x, spawn.z);tick(1);
    const runStart=city.playerState.position;
    key('ShiftLeft',true);key('KeyW',true);tick(1);const runScale=city.player.runAction?.timeScale ?? 0;
    key('KeyW',false);key('ShiftLeft',false);
    const runDistance=runStart.distanceTo(city.playerState.position);
    city.player.teleport(spawn.x, spawn.z); tick(1);
    key('Space', true); key('Space', false); tick(0.4);
    const jumpGap = gap();
    tick(2);
    const landingGap = gap();
    key('KeyF', true); key('KeyF', false); tick(0.1);
    const entered = city.playerState.mode;
    key('KeyW', true); tick(1.5); key('KeyW', false);
    const carSpeed = city.playerState.speed;
    const carPosition = city.playerState.position.clone();
    key('KeyF', true); key('KeyF', false); tick(0.1);
    const exited = city.playerState.mode;
    const exitDistance = city.playerState.position.distanceTo(carPosition);
    tick(12);
    const beforeAgents = city.traffic.snapshot;
    tick(2);
    const afterAgents = city.traffic.snapshot;
    const moved = { cars: 0, people: 0 };
    for (const a of beforeAgents) {
      const b = afterAgents.find((candidate) => candidate.id === a.id);
      if (!b) continue;
      if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 0.5) moved[a.pedestrian ? 'people' : 'cars']++;
    }
    const trafficCounts = city.traffic.counts;
    const trafficGaps = afterAgents.map((a) => a.position.y - (a.pedestrian ? 0.9 : 0.7) - city.ground.heightAt(a.position.x, a.position.z));
    const p0 = city.playerState.position.clone();
    city.paused = true; key('KeyW', true); tick(1); key('KeyW', false);
    const pausedDistance = p0.distanceTo(city.playerState.position); city.paused = false;
    // Check the exact rendered ground against a clean Rapier world, without building roofs.
    const { Physics } = await import('/src/city/Physics.ts');
    const physics = await Physics.create(); physics.addGround(city.ground); physics.world.updateSceneQueries();
    let groundError = 0;
    const b = city.ground.bounds;
    for (let i = 1; i < 25; i++) {
      const x = b.minX + (b.maxX - b.minX) * i / 26;
      const z = b.minZ + (b.maxZ - b.minZ) * ((i * 7) % 25 + 0.3) / 26;
      const y = city.ground.heightAt(x, z);
      const physical = physics.groundHeightAt(x, y + 20, z, 40);
      groundError = Math.max(groundError, physical === null ? 999 : Math.abs(y - physical));
    }
    physics.dispose();
    engine.renderer.render(engine.scene, engine.camera);
    return { groundGap, grounded, distances, runDistance, runScale, jumpGap, landingGap, entered, exited, carSpeed, exitDistance,
      trafficCounts, moved, trafficGaps, pausedDistance, groundError, stats: engine.getStats() };
  });
  console.log(JSON.stringify(result, null, 2));
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/navoiy-city.png' });
  assert.ok(result.grounded && Math.abs(result.groundGap) < 0.12, 'Feet should rest on ground');
  assert.ok(Math.max(...result.distances) - Math.min(...result.distances) < 0.08, 'Movement must be frame-rate independent');
  assert.ok(Math.min(...result.distances) > 2.5, 'Walking must move the player');
  assert.ok(result.runDistance>8.5&&result.runDistance<9.5&&result.runScale>1.5,'Run speed and animation must stay synchronized');
  assert.ok(result.jumpGap > 0.6 && Math.abs(result.landingGap) < 0.12, 'Quick jump tap must take off and land');
  assert.equal(result.entered, 'drive'); assert.equal(result.exited, 'walk');
  assert.ok(result.carSpeed > 1 && result.exitDistance > 1 && result.exitDistance < 5, 'Driving/exit position');
  assert.ok(result.trafficCounts.cars >= 3 && result.trafficCounts.people >= 3, 'Population must spawn');
  assert.ok(result.moved.cars >= 1 && result.moved.people >= 1, 'Cars and pedestrians must actually move');
  assert.ok(result.trafficGaps.every((gap) => gap > -0.2 && gap < 1), 'NPC feet/wheels must stay on ground');
  assert.equal(result.pausedDistance, 0); assert.ok(result.groundError < 0.03, 'Rendered terrain and physics must match');
  await page.keyboard.press('KeyM');
  await page.locator('.bigmap').waitFor();
  await page.waitForFunction(() => !document.querySelector('.bigmap-status'), null, { timeout: 30_000 });
  const map = page.locator('.bigmap-canvas canvas');
  await page.getByRole('button', { name: 'Mening joyim' }).click();
  assert.ok((await page.locator('.map-tools').innerText()).includes('8.0'));
  await map.hover(); await page.mouse.wheel(0, -300);
  await page.waitForFunction(() => !document.querySelector('.map-tools')?.textContent?.includes('8.0×'));
  const rect = await map.boundingBox();
  await page.mouse.move(rect.x + 200, rect.y + 200); await page.mouse.down();
  await page.mouse.move(rect.x + 245, rect.y + 220, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.getByRole('button', { name: "O'sha yerda paydo bo'lish" }).count(), 0, 'Dragging must not place a waypoint');
  await page.screenshot({ path: 'artifacts/navoiy-map-zoom.png' });
  await page.getByRole('button', { name: 'Butun shahar' }).click();
  await map.click({ position: { x: 210, y: 230 } });
  await page.screenshot({ path: 'artifacts/navoiy-map.png' });
  assert.ok(await page.getByRole('button', { name: "O'sha yerda paydo bo'lish" }).isVisible());
  await page.getByRole('button', { name: "O'sha yerda paydo bo'lish" }).click();
  await page.waitForFunction(() => !window.__xarita.city.teleporting);
  const teleport = await page.evaluate(() => {
    const c = window.__xarita.city;
    for (let i = 0; i < 120; i++) c.update({ dt: 1/60, elapsed: i/60, frame: i });
    const p = c.playerState.position;
    return { grounded: c.playerState.grounded, gap: p.y - 0.9 - c.ground.heightAt(p.x, p.z), physicsTiles: c.stats.physicsTiles };
  });
  console.log('teleport', teleport);
  assert.ok(teleport.grounded && Math.abs(teleport.gap) < 0.15 && teleport.physicsTiles > 0);
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS: ground, gravity, FPS independence, jump, driving, exit, traffic, pause, map and teleport');
} finally {
  await browser.close();
}
